import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorBindingService } from '../../src/bindings/connector-binding.service';
import { InMemoryConnectorBindingStore } from '../../src/bindings/in-memory-connector-binding.store';
import { opaqueCredentialHandle } from '../../src/bindings/binding-bootstrap-provider';
import { ManifestFileLoader } from '../../src/manifest/manifest-file.loader';
import { ReplayProtectionService } from '../../src/replay/replay-protection.service';
import { ExactRawBodyAuthenticator } from '../../src/service-auth/exact-raw-body.authenticator';
import { RuntimeServiceProfileRegistry } from '../../src/service-auth/service-profile.registry';
import { ConnectorServiceProofVerifier } from '../../src/service-auth/service-proof.verifier';
import { bodyDigest, serviceProofFixtureSet, signServiceProof } from '../fixtures/service-proof-fixtures';
import { customerBOperation } from '../fixtures/phase5-manifests';

const NOW = 1_800_000_000;
const CONTEXT = Object.freeze({
  customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
  connectorInstanceId: 'customer-b-inventory-connector-1', organizationId: 'org-b', actorId: 'actor-b'
});

describe('Phase 13 service-profile, binding-dimension, and manifest attack matrix', () => {
  it('binds central and bootstrap proofs to exact bytes and claims every jti once', async () => {
    const profiles = serviceProofFixtureSet();
    const authenticator = new ExactRawBodyAuthenticator(
      new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([
        profiles.central.config, profiles.bridge.config, profiles.customerB.config
      ]), () => NOW + 10),
      new ReplayProtectionService(16, () => NOW + 10)
    );
    const centralBytes = Buffer.from('{"version":"1","requestId":"central-phase13"}');
    const centralProof = await signServiceProof(profiles.central, {
      body_sha256: bodyDigest(centralBytes), request_id: 'central-phase13',
      jti: '105d9aca-bb32-4f9d-9077-175e2f34dfe7'
    });
    const centralInput = authenticationInput('central-invocation', centralBytes, centralProof);
    await expect(authenticator.authenticate(centralInput)).resolves.toMatchObject({ ok: true });
    await expect(authenticator.authenticate(centralInput))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_REPLAY_REJECTED' });
    await expect(authenticator.authenticate(authenticationInput(
      'central-invocation', Buffer.from('{"version":"1","requestId":"central-mutated"}'), centralProof
    ))).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });

    const bootstrapBytes = Buffer.from('{"version":"1","requestId":"bootstrap-phase13"}');
    const bootstrapProof = await signServiceProof(profiles.bridge, {
      body_sha256: bodyDigest(bootstrapBytes), request_id: 'bootstrap-phase13',
      jti: '4dd1efbf-97fb-433e-8098-558eebfc8a35'
    });
    const bootstrapInput = authenticationInput('binding-bootstrap', bootstrapBytes, bootstrapProof);
    await expect(authenticator.authenticateRegisteredBootstrap(bootstrapInput)).resolves.toMatchObject({ ok: true });
    await expect(authenticator.authenticateRegisteredBootstrap(bootstrapInput))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_REPLAY_REJECTED' });
  });

  it('rejects every central/bootstrap cross-profile direction', async () => {
    const profiles = serviceProofFixtureSet();
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([
      profiles.central.config, profiles.bridge.config, profiles.customerB.config
    ]), () => NOW + 10);
    const proofs = {
      central: await signServiceProof(profiles.central),
      bridge: await signServiceProof(profiles.bridge),
      customerB: await signServiceProof(profiles.customerB)
    };
    const cases = [
      ['binding-bootstrap', proofs.central, profiles.bridge.config.profileKey],
      ['binding-bootstrap', proofs.central, profiles.customerB.config.profileKey],
      ['central-invocation', proofs.bridge, undefined],
      ['binding-bootstrap', proofs.bridge, profiles.customerB.config.profileKey],
      ['central-invocation', proofs.customerB, undefined],
      ['binding-bootstrap', proofs.customerB, profiles.bridge.config.profileKey]
    ] as const;
    for (const [kind, proof, expectedProfile] of cases) {
      await expect(verifier.verify(kind, proof, expectedProfile))
        .resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    }
  });

  it('rejects every mutated binding dimension, stale generation, expiry, revocation, and lease overflow', async () => {
    let entropy = 0;
    let now = NOW;
    const store = new InMemoryConnectorBindingStore(
      { maxEntries: 16, scopeMaxEntries: 8, sweepBatchSize: 8 },
      { nowSeconds: () => now, randomBytes: (size) => Buffer.alloc(size, ++entropy) }
    );
    const bindings = new ConnectorBindingService(store);
    const first = await bindings.mint(bindingInput());
    if (!first.ok) throw new Error('Expected first binding.');
    const mutations = [
      { customerId: 'other-customer' }, { integrationId: 'other-integration' },
      { hostApp: 'other-host' }, { connectorInstanceId: 'other-instance' },
      { organizationId: 'other-organization' }, { actorId: 'other-actor' }
    ];
    for (const mutation of mutations) {
      await expect(bindings.withInvocationLease(first.value.connectorContextRef, {
        trustedContext: { ...CONTEXT, ...mutation }
      }, async () => 'unexpected')).resolves.toEqual({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });
    }

    const replacement = await bindings.mint(bindingInput({ opaqueCredentialHandle: opaqueCredentialHandle('handle-2')! }));
    if (!replacement.ok) throw new Error('Expected replacement binding.');
    await expect(bindings.resolve(first.value.connectorContextRef, expectation()))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });

    const leases = await Promise.all(Array.from({ length: 4 }, () => store.acquireForInvocation(
      replacement.value.connectorContextRef, { trustedContext: CONTEXT }
    )));
    expect(leases.every(({ ok }) => ok)).toBe(true);
    expect(store.acquireForInvocation(replacement.value.connectorContextRef, { trustedContext: CONTEXT }))
      .toEqual({ ok: false, code: 'CONNECTOR_BINDING_BUSY' });
    for (const lease of leases) if (lease.ok) lease.value.release();

    await bindings.revoke(replacement.value.connectorContextRef);
    await expect(bindings.resolve(replacement.value.connectorContextRef, expectation()))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });

    const expiring = await bindings.mint(bindingInput({ providerExpiresAt: NOW + 30 }));
    if (!expiring.ok) throw new Error('Expected expiring binding.');
    now = expiring.value.expiresAt;
    await expect(bindings.resolve(expiring.value.connectorContextRef, expectation()))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });
  });

  it.each([
    ['duplicate registration', { operations: [customerBOperation(), customerBOperation()] }],
    ['wildcard registration', { connectorKey: '*' }],
    ['dynamic URL', { request: { profile: 'POST_QUERY_JSON_V1', path: 'https://evil.test', fixedBody: {}, argumentMappings: [] } }],
    ['dynamic method', { request: { ...requestProfile(), method: 'DELETE' } }],
    ['dynamic path', { request: { ...requestProfile(), path: '/${caller}' } }],
    ['unexpected query', { request: { ...requestProfile(), query: { caller: true } } }],
    ['unexpected header', { request: { ...requestProfile(), headers: { authorization: 'caller' } } }],
    ['arbitrary body', { request: { ...requestProfile(), body: { caller: true } } }],
    ['credential override', { credential: { token: 'caller' } }],
    ['traversal', { request: { ...requestProfile(), path: '/../secret' } }],
    ['callback', { callback: 'run' }], ['template', { template: '${input}' }],
    ['script', { script: 'fetch(url)' }], ['SQL', { sql: 'select *' }],
    ['shell', { shell: 'echo unsafe' }], ['command', { command: 'run' }],
    ['bad pointer', { response: { ...responseProfile(), extraction: [{ sourcePointer: 'not-a-pointer', targetField: 'sku', conversion: 'string' }] } }],
    ['response cap bypass', { limits: { ...limits(), maxResponseBytes: 262_145 } }],
    ['write classification', { readOnly: false }]
  ])('rejects %s before a runtime graph can become available', (_label, override) => {
    const base = customerBOperation();
    const manifest = 'operations' in override
      ? { version: '1', connectorKey: 'inventory', operations: override.operations }
      : { version: '1', connectorKey: (override as { connectorKey?: string }).connectorKey ?? 'inventory', operations: [{ ...base, ...override }] };
    expect(new ManifestFileLoader().load([manifestFile(manifest)]))
      .toEqual({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
  });
});

function bindingInput(overrides: Record<string, unknown> = {}) {
  return {
    trustedContext: CONTEXT, bootstrapProviderKey: 'customer-b-bootstrap-provider-v1',
    credentialProviderKey: 'customer-b-provider-v1',
    opaqueCredentialHandle: opaqueCredentialHandle('handle-1')!, credentialGeneration: 'generation-1',
    providerMetadata: Object.freeze({}), ...overrides
  };
}

function expectation() {
  return {
    trustedContext: CONTEXT, bootstrapProviderKey: 'customer-b-bootstrap-provider-v1',
    credentialProviderKey: 'customer-b-provider-v1', bindingGeneration: 1
  };
}

function requestProfile() {
  return {
    profile: 'POST_QUERY_JSON_V1', path: '/inventory/stock/query', fixedBody: { scope: 'available' },
    argumentMappings: [{ argument: 'sku', target: 'body', name: 'sku', scalarType: 'string' }]
  };
}

function responseProfile() {
  return (customerBOperation() as { response: object }).response;
}

function limits() {
  return (customerBOperation() as { limits: object }).limits;
}

function manifestFile(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'phase13-manifest-'));
  const path = join(directory, 'manifest.json');
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o444);
  return path;
}

function authenticationInput<const K extends 'central-invocation' | 'binding-bootstrap'>(
  routeClass: K,
  rawBody: Buffer,
  token: string
) {
  return {
    routeClass, method: 'POST', contentType: 'application/json', contentEncoding: undefined,
    authorization: `Bearer ${token}`, rawBody
  } as const;
}
