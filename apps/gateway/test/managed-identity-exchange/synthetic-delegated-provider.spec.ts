import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { DELEGATED_HTTP_MAX_RESPONSE_BYTES } from '../../src/managed-identity-exchange/providers/delegated-http.transport';
import { createSyntheticDelegatedProviderFixture } from './fixtures/synthetic-delegated-provider.fixture';

const fixturePath = resolve(__dirname, './fixtures/synthetic-delegated-provider.fixture.ts');
const adapterPath = resolve(__dirname, '../../src/managed-identity-exchange/providers/delegated-http-v1.adapter.ts');
const nativeCredential = 'DO_NOT_LEAK_SYNTHETIC_NATIVE_CREDENTIAL';
const diagnostic = 'DO_NOT_LEAK_SYNTHETIC_PROVIDER_DIAGNOSTIC';

describe('Synthetic delegated identity-provider fixture (T039)', () => {
  it('drives the production transport and adapter to create one frozen verified identity', async () => {
    const fixture = createSyntheticDelegatedProviderFixture();
    const identity = await fixture.adapter.verify(fixture.input());

    expect(identity).toEqual({
      subject: 'synthetic-subject', organization: 'synthetic-organization',
      anchors: [
        { kind: 'organization', value: 'synthetic-organization' },
        { kind: 'tenant', value: 'synthetic-tenant' }
      ],
      trustedPermissionReference: 'synthetic-permission-reference'
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.anchors)).toBe(true);
    for (const anchor of identity.anchors) expect(Object.isFrozen(anchor)).toBe(true);
    expect(JSON.stringify(identity)).not.toContain(nativeCredential);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({
      endpoint: 'https://synthetic-idp.example.test/verify', method: 'POST', accept: 'application/json',
      authorization: `Bearer ${nativeCredential}`
    });
    expect(fixture.policy).toMatchObject({
      id: 'synthetic-provider', providerType: 'delegated_http', endpointUri: 'https://synthetic-idp.example.test/verify',
      httpMethod: 'POST', credentialPlacement: 'authorization_bearer', responseContractVersion: 'delegated-http/v1',
      declaredAnchorKinds: ['organization', 'tenant']
    });
    expect(Object.isFrozen(fixture.policy)).toBe(true);
  });

  it('leaves endpoint and provider routing fixed regardless of credential or response behavior', async () => {
    const fixture = createSyntheticDelegatedProviderFixture('authority-like');
    await expect(fixture.adapter.verify(fixture.input())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.policy.endpointUri).toBe('https://synthetic-idp.example.test/verify');
    expect(fixture.policy.providerType).toBe('delegated_http');
    expect(fixture.policy.declaredAnchorKinds).toEqual(['organization', 'tenant']);
    expect(fixture.requests).toHaveLength(1);
  });

  it.each([
    'malformed-identity', 'blank-subject', 'missing-anchors', 'empty-anchors', 'malformed-anchor',
    'unknown-top-level', 'undeclared-anchor', 'authority-like'
  ] as const)('rejects the %s semantic response through the production adapter', async (scenario) => {
    const fixture = createSyntheticDelegatedProviderFixture(scenario);
    await expect(fixture.adapter.verify(fixture.input())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.requests).toHaveLength(1);
  });

  it('rejects conflicting anchors and deduplicates identical anchors through the production adapter', async () => {
    const conflicting = createSyntheticDelegatedProviderFixture('conflicting-anchor');
    await expect(conflicting.adapter.verify(conflicting.input())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(conflicting.requests).toHaveLength(1);

    const duplicate = createSyntheticDelegatedProviderFixture('duplicate-anchor');
    const identity = await duplicate.adapter.verify(duplicate.input());
    expect(identity.anchors).toEqual([{ kind: 'organization', value: 'org-a' }]);
    expect(duplicate.requests).toHaveLength(1);
  });

  it.each([
    ['credential-401', ManagedExchangeCredentialError],
    ['credential-403', ManagedExchangeIdentityDeniedError],
    ['five-hundred', ManagedExchangeInfrastructureError],
    ['malformed-json', ManagedExchangeInfrastructureError],
    ['invalid-mime', ManagedExchangeInfrastructureError],
    ['oversized', ManagedExchangeInfrastructureError]
  ] as const)('classifies %s without retrying', async (scenario, ErrorType) => {
    const fixture = createSyntheticDelegatedProviderFixture(scenario);
    const error = await fixture.adapter.verify(fixture.input()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ErrorType);
    expect(fixture.requests).toHaveLength(1);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(nativeCredential);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(diagnostic);
  });

  it('aborts the bounded stalled request without retrying', async () => {
    const fixture = createSyntheticDelegatedProviderFixture('timeout');
    await expect(fixture.adapter.verify(fixture.input())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.lastSignal?.aborted).toBe(true);
  });

  it('accepts a valid response exactly at the production response-size threshold', async () => {
    const fixture = createSyntheticDelegatedProviderFixture('exact-limit');
    const response = await fixture.transport.execute(fixture.input());
    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(fixture.requests).toHaveLength(1);
    expect(DELEGATED_HTTP_MAX_RESPONSE_BYTES).toBe(256 * 1024);
  });

  it('keeps this fixture test-only and free of non-provider authority dependencies', () => {
    const fixture = readFileSync(fixturePath, 'utf8');
    const adapter = readFileSync(adapterPath, 'utf8');
    expect(fixture).toContain('DelegatedHttpTransport');
    expect(fixture).toContain('DelegatedHttpV1Adapter');
    expect(fixture).toContain('DELEGATED_HTTP_MAX_RESPONSE_BYTES');
    expect(fixture).not.toMatch(/MultiProfileUpstreamTokenVerifier|CandidateTrustProfileResolver|ProfileScopedVerifier|CanonicalIdentityResolver|IntegrationBindingRepository|GatewayTrustChainHandler|InternalIdentityTokenIssuer|idx_delegated|ManagedUpstreamTokenIssuer|ManagedPermissionService|ManagedCanonicalizationService|PageContext|browser/i);
    expect(adapter).not.toMatch(/Customer|IntegrationBinding|GatewaySigning|Canonicalization|ManagedTokenIssuer|IDX/i);
    expect(fixture).not.toMatch(/https:\/\/(?!synthetic-idp\.example\.test)|api[_-]?key|production.*secret/i);
  });
});
