import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  ManagedExchangeIssuanceError,
  createVerifiedExternalIdentity
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedIdentityExchangeService } from '../../src/managed-identity-exchange/exchange.service';

const servicePath = resolve(__dirname, '../../src/managed-identity-exchange/exchange.service.ts');
const nativeCredential = 'DO_NOT_FORWARD_NATIVE_CREDENTIAL';
const input = Object.freeze({ integrationSelector: 'selector-a', nativeCredential, requestId: 'request-a' });

type Failure =
  | 'configMissing' | 'providerMissing' | 'readiness' | 'adapterMissing' | 'providerCredential' | 'providerInfrastructure'
  | 'admissionDenied' | 'policyZero' | 'policyAmbiguous' | 'permissionDenied' | 'permissionInfrastructure'
  | 'canonicalDenied' | 'canonicalInfrastructure' | 'issuerInfrastructure' | 'issuerFailure' | 'audit'
  | 'configInfrastructure' | 'providerRepositoryInfrastructure' | 'policyInfrastructure';

describe('Managed identity exchange ordered service contract (T034)', () => {
  it('executes the complete authority sequence with exact trusted references and safe result', async () => {
    const fixture = fixtureFor();
    const service = new ManagedIdentityExchangeService(fixture.dependencies as never);
    const result = await service.exchange(input);

    expect(fixture.events).toEqual(['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions', 'canonicalize', 'issue', 'audit']);
    expect(fixture.calls.config).toHaveBeenCalledTimes(1);
    expect(fixture.calls.config.mock.calls).toEqual([['selector-a']]);
    expect(fixture.calls.provider).toHaveBeenCalledWith('provider-a');
    expect(fixture.calls.readiness).toHaveBeenCalledWith('integration-a');
    expect(fixture.calls.resolveAdapter).toHaveBeenCalledWith('delegated_http');
    expect(fixture.calls.verify).toHaveBeenCalledWith({ nativeCredential, providerInstancePolicy: fixture.providerPolicy, requestId: 'request-a' });
    expect(fixture.calls.admit).toHaveBeenCalledWith({ identity: fixture.identity, integrationConfigId: 'config-a' });
    expect(fixture.calls.policy).toHaveBeenCalledWith('config-a');
    expect(fixture.calls.permissions).toHaveBeenCalledWith({
      admittedIdentity: fixture.identity, integrationConfigId: 'config-a', requestId: 'request-a', policy: fixture.policy,
      serverOwnedIntegrationContext: { integrationId: 'integration-a', hostApp: 'admin' }
    });
    expect(fixture.calls.canonicalize).toHaveBeenCalledWith({ identity: fixture.identity, integrationConfigId: 'config-a', permissionScopes: fixture.scopes });
    expect(fixture.calls.issue).toHaveBeenCalledWith(fixture.canonical);
    expect(fixture.calls.audit).toHaveBeenCalledWith({
      requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued', integrationId: 'integration-a',
      integrationConfigId: 'config-a', providerType: 'delegated_http', providerInstanceId: 'provider-a', jti: 'jti-a', kid: 'managed-kid'
    });
    expect(result).toEqual({ accessToken: 'managed-token', tokenType: 'Bearer', expiresIn: 300 });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('forwards the native credential only to provider verification and preserves authority references', async () => {
    const fixture = fixtureFor();
    await new ManagedIdentityExchangeService(fixture.dependencies as never).exchange(input);
    expect(fixture.calls.config.mock.calls).toEqual([['selector-a']]);
    expect(fixture.calls.provider.mock.calls).toEqual([['provider-a']]);
    expect(fixture.calls.readiness.mock.calls).toEqual([['integration-a']]);
    expect(fixture.calls.resolveAdapter.mock.calls).toEqual([['delegated_http']]);
    expect(fixture.calls.policy.mock.calls).toEqual([['config-a']]);
    expect(firstArgument(fixture.calls.verify).nativeCredential).toBe(nativeCredential);
    expect(firstArgument(fixture.calls.admit).identity).toBe(fixture.identity);
    expect(firstArgument(fixture.calls.permissions).admittedIdentity).toBe(fixture.identity);
    expect(firstArgument(fixture.calls.canonicalize).identity).toBe(fixture.identity);
    expect(firstArgument(fixture.calls.canonicalize).permissionScopes).toBe(fixture.scopes);
    expect(firstArgument(fixture.calls.issue)).toBe(fixture.canonical);
    for (const call of [fixture.calls.admit, fixture.calls.permissions, fixture.calls.canonicalize, fixture.calls.issue, fixture.calls.audit]) {
      expect(JSON.stringify(call.mock.calls)).not.toContain(nativeCredential);
    }
    expect(Object.keys(fixture.providerPolicy).sort()).toEqual(['credentialPlacement', 'declaredAnchorKinds', 'endpointUri', 'httpMethod', 'id', 'providerContract', 'providerType', 'responseContractVersion', 'timeoutMilliseconds']);
    expect(Object.isFrozen(fixture.providerPolicy)).toBe(true);
    expect(Object.isFrozen(fixture.providerPolicy.declaredAnchorKinds)).toBe(true);
  });

  it('keeps selected configuration, not selector or hostile identity-like values, as integration authority', async () => {
    const fixture = fixtureFor();
    const hostileIdentity = { ...fixture.identity, integrationId: 'integration-b', customerId: 'customer-b', host_app: 'forged-host' };
    fixture.calls.verify.mockResolvedValueOnce(hostileIdentity);
    await new ManagedIdentityExchangeService(fixture.dependencies as never).exchange(input);
    expect(fixture.calls.admit).toHaveBeenCalledWith({ identity: hostileIdentity, integrationConfigId: 'config-a' });
    expect(firstArgument(fixture.calls.permissions).serverOwnedIntegrationContext).toEqual({ integrationId: 'integration-a', hostApp: 'admin' });
    expect(fixture.calls.canonicalize).toHaveBeenCalledWith(expect.objectContaining({ integrationConfigId: 'config-a' }));
  });

  it.each([
    ['missing selected config', 'configMissing', ManagedExchangeCredentialError, ['config']],
    ['config repository failure', 'configInfrastructure', ManagedExchangeInfrastructureError, ['config']],
    ['missing selected provider', 'providerMissing', ManagedExchangeInfrastructureError, ['config', 'provider']],
    ['provider repository failure', 'providerRepositoryInfrastructure', ManagedExchangeInfrastructureError, ['config', 'provider']],
    ['readiness failure', 'readiness', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness']],
    ['missing adapter', 'adapterMissing', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter']],
    ['provider credential failure', 'providerCredential', ManagedExchangeCredentialError, ['config', 'provider', 'readiness', 'adapter', 'verify']],
    ['provider infrastructure failure', 'providerInfrastructure', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify']],
    ['admission denial', 'admissionDenied', ManagedExchangeCredentialError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission']],
    ['no permission policy', 'policyZero', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy']],
    ['ambiguous permission policy', 'policyAmbiguous', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy']],
    ['permission-policy repository failure', 'policyInfrastructure', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy']],
    ['permission denial', 'permissionDenied', ManagedExchangeIdentityDeniedError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions']],
    ['permission infrastructure failure', 'permissionInfrastructure', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions']],
    ['canonicalization denial', 'canonicalDenied', ManagedExchangeIdentityDeniedError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions', 'canonicalize']],
    ['canonicalization infrastructure failure', 'canonicalInfrastructure', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions', 'canonicalize']],
    ['issuer infrastructure failure', 'issuerInfrastructure', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions', 'canonicalize', 'issue']],
    ['issuer failure', 'issuerFailure', ManagedExchangeIssuanceError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions', 'canonicalize', 'issue']],
    ['success audit failure withholds token', 'audit', ManagedExchangeInfrastructureError, ['config', 'provider', 'readiness', 'adapter', 'verify', 'admission', 'policy', 'permissions', 'canonicalize', 'issue', 'audit']]
  ] as readonly [string, Failure, new () => Error, readonly string[]][])('fails closed and stops later authority for %s', async (_name, failure, ErrorType, expectedEvents) => {
    const fixture = fixtureFor(failure);
    await expect(new ManagedIdentityExchangeService(fixture.dependencies as never).exchange(input)).rejects.toBeInstanceOf(ErrorType);
    expect(fixture.events).toEqual(failure === 'audit' ? expectedEvents : [...expectedEvents, 'audit']);
    expect(fixture.calls.audit).toHaveBeenCalledTimes(1);
    if (failure === 'audit') expect(fixture.calls.issue).toHaveBeenCalledTimes(1);
  });

  it('preserves a typed operation failure after one safe failure audit and maps audit persistence failure to infrastructure', async () => {
    const preserved = fixtureFor('providerCredential');
    await expect(new ManagedIdentityExchangeService(preserved.dependencies as never).exchange(input)).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
    expect(preserved.calls.audit).toHaveBeenCalledWith({ requestId: 'request-a', integrationId: 'integration-a', integrationConfigId: 'config-a', providerType: 'delegated_http', providerInstanceId: 'provider-a', outcome: 'denied', reasonCode: 'managed_exchange_identity_invalid' });

    const failed = fixtureFor('providerCredential');
    failed.calls.audit.mockRejectedValueOnce(new Error('audit'));
    await expect(new ManagedIdentityExchangeService(failed.dependencies as never).exchange(input)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(failed.calls.audit).toHaveBeenCalledTimes(1);
  });

  it('keeps the future orchestration source free of Feature 004, customer, browser, signer, fallback, and transaction authority', () => {
    const source = readFileSync(servicePath, 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|CanonicalIdentityResolver|MultiProfileUpstreamTokenVerifier|InternalIdentityTokenIssuer|GatewaySigningKeyRepository|GatewayConfig|PageContext|Authorization|decodeJwt|SignJWT|ManagedSigningKeyProvider|ManagedSigningKeyRuntimeProvider|fallback|\.transaction\(/i);
  });
});

function firstArgument(mock: unknown): Record<string, unknown> {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  const args = calls[0];
  if (!args || !args[0] || typeof args[0] !== 'object') throw new Error('expected invocation');
  return args[0] as Record<string, unknown>;
}

function fixtureFor(failure?: Failure) {
  const events: string[] = [];
  const identity = createVerifiedExternalIdentity({ subject: 'subject-a', organization: 'org-a', anchors: [{ kind: 'org', value: 'org-a' }] });
  const scopes = Object.freeze(['orders:read', 'orders:update']);
  const canonical = Object.freeze({ integrationId: 'integration-a', subject: 'subject-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze([]), permissionScopes: scopes });
  const providerPolicy = Object.freeze({
    id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000,
    responseContractVersion: 'delegated-http/v1', declaredAnchorKinds: Object.freeze(['org']), providerContract: Object.freeze({ responseSchema: 'managed-verified-identity/v1' })
  });
  const config = { id: 'config-a', integrationId: 'integration-a', providerInstanceId: 'provider-a', canonicalHostApp: 'admin' };
  const provider = { ...providerPolicy, contractConfig: providerPolicy.providerContract, enabled: true, lifecycle: 'active', version: 1, replacesProviderId: null };
  const policy = { integrationConfigId: 'config-a', mode: 'required', permissionSourceInstanceId: 'source-a', normalizerType: 'synthetic-normalizer/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' } };
  const verify = jest.fn(async () => { events.push('verify'); if (failure === 'providerCredential') throw new ManagedExchangeCredentialError(); if (failure === 'providerInfrastructure') throw new Error('provider'); return identity; });
  const calls = {
    config: jest.fn(async () => { events.push('config'); if (failure === 'configInfrastructure') throw new Error('config'); return failure === 'configMissing' ? null : config; }),
    provider: jest.fn(async () => { events.push('provider'); if (failure === 'providerRepositoryInfrastructure') throw new Error('provider'); return failure === 'providerMissing' ? null : provider; }),
    readiness: jest.fn(async () => { events.push('readiness'); if (failure === 'readiness') throw new Error('readiness'); }),
    resolveAdapter: jest.fn(() => { events.push('adapter'); return failure === 'adapterMissing' ? undefined : { verify }; }),
    verify,
    admit: jest.fn(async () => { events.push('admission'); if (failure === 'admissionDenied') throw new ManagedExchangeIdentityDeniedError(); }),
    policy: jest.fn(async () => { events.push('policy'); if (failure === 'policyInfrastructure') throw new Error('policy'); if (failure === 'policyZero') return []; if (failure === 'policyAmbiguous') return [policy, policy]; return [policy]; }),
    permissions: jest.fn(async () => { events.push('permissions'); if (failure === 'permissionDenied') throw new ManagedExchangeIdentityDeniedError(); if (failure === 'permissionInfrastructure') throw new Error('permissions'); return scopes; }),
    canonicalize: jest.fn(async () => { events.push('canonicalize'); if (failure === 'canonicalDenied') throw new ManagedExchangeIdentityDeniedError(); if (failure === 'canonicalInfrastructure') throw new Error('canonical'); return canonical; }),
    issue: jest.fn(async () => { events.push('issue'); if (failure === 'issuerInfrastructure') throw new ManagedExchangeInfrastructureError(); if (failure === 'issuerFailure') throw new ManagedExchangeIssuanceError(); return Object.freeze({ accessToken: 'managed-token', tokenType: 'Bearer' as const, expiresIn: 300, jti: 'jti-a', kid: 'managed-kid' }); }),
    audit: jest.fn(async () => { events.push('audit'); if (failure === 'audit') throw new Error('audit'); })
  };
  return {
    events, calls, identity, scopes, canonical, providerPolicy, policy,
    dependencies: {
      configs: { findEnabledActiveByPublicSelector: calls.config }, providers: { findEnabledActiveById: calls.provider }, readiness: { assertReady: calls.readiness },
      providerAdapters: { resolve: calls.resolveAdapter }, admission: { admit: calls.admit }, permissionPolicies: { findEnabledActiveByConfigId: calls.policy },
      permissions: { resolve: calls.permissions }, canonicalizer: { canonicalize: calls.canonicalize }, issuer: { issue: calls.issue }, audit: { append: calls.audit }
    }
  };
}
