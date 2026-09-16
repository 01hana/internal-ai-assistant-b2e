import { EventEmitter } from 'node:events';
import { ConnectorBindingService } from '../../src/bindings/connector-binding.service';
import { InMemoryConnectorBindingStore } from '../../src/bindings/in-memory-connector-binding.store';
import { CredentialExecutionBoundary } from '../../src/credentials/credential-execution.boundary';
import { CredentialProfileRegistry } from '../../src/credentials/credential-profile.registry';
import { ConnectorInvocationService } from '../../src/invocation/connector-invocation.service';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { ConnectorDestinationPolicy } from '../../src/upstream/connector-destination-policy';
import { SafeUpstreamHttpClient } from '../../src/upstream/safe-upstream-http-client';
import { UpstreamExecutionService } from '../../src/upstream/upstream-execution.service';
import { customerBOperation, parsedManifest } from '../fixtures/phase5-manifests';
import { credentialFixtures, profileConfigurations } from '../fixtures/phase5-credentials';

const NOW = 1_800_000_000;
const READY_RUNTIME = Object.freeze({ snapshot: () => Object.freeze({ ready: true }) });

describe('Phase 6 credential rejection binding lifecycle', () => {
  it.each([
    ['HTTP 401', 401, '{}', {}],
    ['HTTP 403', 403, '{}', {}],
    ['mapped application auth rejection', 200, '{"sku":"SKU-1","quantity":9,"code":9001}', { errorMap: { '9001': 'CONNECTOR_UPSTREAM_AUTH_FAILED' } }]
  ])('releases then revokes the binding generation for %s', async (_case, status, responseBody, operationOverrides) => {
    const harness = await lifecycleHarness(status, responseBody, operationOverrides);
    const result = await harness.service.handle(harness.input);
    expect(result.body).toEqual({
      version: '1', requestId: 'req-phase6-auth-rejection', status: 'failed',
      error: { code: 'CONNECTOR_UPSTREAM_AUTH_FAILED' }
    });
    expect(harness.handleRevoke).toHaveBeenCalledTimes(1);
    expect(harness.handleRevoke.mock.calls[0]?.[0]).toMatchObject({
      opaqueCredentialHandle: 'customer-b-handle', activeLeases: 0
    });
    expect(harness.handleRevoke.mock.calls[0]?.[1]).toBe('provider_rejected');
    await expect(harness.bindings.withInvocationLease(harness.reference, { trustedContext: trustedContext() }, async () => true))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });
    expect(JSON.stringify(result)).not.toMatch(/customer-b-handle|api-key-secret-sentinel|9001/);
  });

  it.each([
    ['DNS rejection', 'CONNECTOR_DESTINATION_REJECTED'],
    ['TLS rejection', 'CONNECTOR_DESTINATION_REJECTED'],
    ['upstream availability', 'CONNECTOR_UPSTREAM_FAILED'],
    ['timeout', 'CONNECTOR_TIMEOUT'],
    ['response validation', 'CONNECTOR_RESPONSE_INVALID']
  ] as const)('does not revoke the binding for non-auth failure %s', async (_case, code) => {
    const handleRevoke = jest.fn().mockResolvedValue(undefined);
    const { bindings, reference } = await bindingFixture(handleRevoke);
    const service = invocationService(bindings, { execute: jest.fn().mockResolvedValue({ ok: false, code }) });
    const result = await service.handle(invocationInput(reference));
    expect(result.body).toMatchObject({ status: 'failed', error: { code } });
    expect(handleRevoke).not.toHaveBeenCalled();
    await expect(bindings.withInvocationLease(reference, { trustedContext: trustedContext() }, async () => true))
      .resolves.toEqual({ ok: true, value: true });
  });
});

async function lifecycleHarness(statusCode: number, body: string, operationOverrides: Record<string, unknown>) {
  const handleRevoke = jest.fn().mockResolvedValue(undefined);
  const { bindings, reference } = await bindingFixture(handleRevoke);
  const fixtures = credentialFixtures();
  const profiles = new CredentialProfileRegistry(profileConfigurations,
    [fixtures.bearerProvider, fixtures.apiKeyProvider], [fixtures.bearerStrategy, fixtures.apiKeyStrategy]);
  const manifests = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation(operationOverrides)])]);
  const requestFactory = jest.fn((_options: object, callback: (response: unknown) => void) => {
    const outgoing = new EventEmitter() as EventEmitter & { write: jest.Mock; end(): void; destroy: jest.Mock };
    outgoing.write = jest.fn();
    outgoing.destroy = jest.fn();
    outgoing.end = () => callback(Object.assign(new EventEmitter(), {
      statusCode, headers: { 'content-type': 'application/json' },
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(body); }, destroy: jest.fn()
    }));
    return outgoing;
  });
  const upstream = new UpstreamExecutionService(
    new ConnectorDestinationPolicy([{
      upstreamServiceRef: 'inventory-api', origin: 'https://inventory.test', basePath: '/', addressMode: 'public_only', allowedCidrs: []
    }], 'production'),
    new SafeUpstreamHttpClient(requestFactory as never),
    jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  );
  return {
    bindings, reference, handleRevoke,
    service: new ConnectorInvocationService(authenticator(), READY_RUNTIME, bindings, manifests, new CredentialExecutionBoundary(profiles), upstream),
    input: invocationInput(reference)
  };
}

function invocationService(bindings: ConnectorBindingService, upstream: { execute: jest.Mock }) {
  const fixtures = credentialFixtures();
  const profiles = new CredentialProfileRegistry(profileConfigurations,
    [fixtures.bearerProvider, fixtures.apiKeyProvider], [fixtures.bearerStrategy, fixtures.apiKeyStrategy]);
  return new ConnectorInvocationService(
    authenticator(), READY_RUNTIME, bindings,
    new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])]),
    new CredentialExecutionBoundary(profiles), upstream
  );
}

async function bindingFixture(handleRevoke: jest.Mock) {
  const store = new InMemoryConnectorBindingStore(
    { maxEntries: 8, scopeMaxEntries: 8, sweepBatchSize: 8 },
    { nowSeconds: () => NOW, randomBytes: () => Buffer.alloc(32, 12) }
  );
  const bindings = new ConnectorBindingService(store, { revoke: handleRevoke });
  const minted = await bindings.mint({
    trustedContext: trustedContext(), bootstrapProviderKey: 'customer-b-bootstrap-provider-v1',
    credentialProviderKey: 'customer-b-provider-v1', opaqueCredentialHandle: 'customer-b-handle',
    credentialGeneration: 'credential-generation-1', providerMetadata: {}
  });
  if (!minted.ok) throw new Error('binding lifecycle fixture');
  return { bindings, reference: minted.value.connectorContextRef };
}

function invocationInput(connectorContextRef: string) {
  const body = Buffer.from(JSON.stringify({
    version: '1', requestId: 'req-phase6-auth-rejection', remainingBudgetMs: 4500,
    trustedContext: { ...trustedContext(), connectorKey: 'inventory' },
    operation: { key: 'inventory.stock-on-hand', version: '1.0.0', arguments: { sku: 'SKU-1' } },
    connectorContextRef
  }));
  return { method: 'POST', contentType: 'application/json', authorization: 'Bearer fixture',
    requestIdHeader: 'req-phase6-auth-rejection', rawBody: body };
}

function authenticator() {
  return { authenticate: jest.fn().mockResolvedValue({ ok: true, value: { proof: {
    kind: 'central-invocation', profileKey: 'central-v1', keyDomain: 'central', kid: 'kid', bodySha256: 'digest', jti: 'jti',
    expiresAt: NOW + 30, requestId: 'req-phase6-auth-rejection', claims: {
      customer_id: 'customer-b', integration_id: 'inventory-b', host_app: 'customer-b-inventory', connector_key: 'inventory',
      connector_instance_id: 'customer-b-inventory-connector-1', operation: 'inventory.stock-on-hand', operation_version: '1.0.0'
    }
  } } }) };
}

function trustedContext() {
  return Object.freeze({
    customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
    connectorInstanceId: 'customer-b-inventory-connector-1', organizationId: 'org-b', actorId: 'actor-b'
  });
}
