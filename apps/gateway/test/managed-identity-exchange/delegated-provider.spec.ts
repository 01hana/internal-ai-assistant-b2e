import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ManagedExchangeCredentialError,
  ManagedExchangeInfrastructureError
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { DelegatedHttpV1Adapter } from '../../src/managed-identity-exchange/providers/delegated-http-v1.adapter';
import { IdentityProviderAdapterRegistry } from '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';

const nativeCredential = 'DO_NOT_LEAK_NATIVE_SECRET';
const rawSentinel = 'DO_NOT_LEAK_RAW_RESPONSE';
const policy = (overrides: Record<string, unknown> = {}) => ({
  id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST',
  credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'delegated-http/v1',
  declaredAnchorKinds: Object.freeze(['organization', 'tenant']),
  providerContract: Object.freeze({ anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' }), ...overrides
});
const input = (overrides: Record<string, unknown> = {}) => ({ nativeCredential, providerInstancePolicy: policy(), requestId: 'request-a', ...overrides });
const response = (body: unknown) => ({ status: 200 as const, contentType: 'application/json' as const, body });
const body = (overrides: Record<string, unknown> = {}) => ({ subject: 'actor-a', anchors: [{ kind: 'organization', value: 'org-a' }], ...overrides });

describe('Delegated HTTP V1 adapter (T020A)', () => {
  it('resolves only the fixed delegated adapter without invoking verification', () => {
    const adapter = new DelegatedHttpV1Adapter(successful(body()) as never);
    const verify = jest.spyOn(adapter, 'verify');
    const registry = new IdentityProviderAdapterRegistry(adapter, new IdxDelegatedVerificationAdapter());
    expect(registry.resolve('delegated_http')).toBe(adapter);
    expect(registry.resolve('delegated_http')).toBe(adapter);
    expect(registry.resolve('unknown')).toBeUndefined();
    expect(registry.resolve('')).toBeUndefined();
    expect(verify).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyNames(IdentityProviderAdapterRegistry.prototype)).toEqual(expect.arrayContaining(['constructor', 'resolve']));
    expect(Object.getOwnPropertyNames(IdentityProviderAdapterRegistry.prototype)).not.toEqual(expect.arrayContaining(['register', 'unregister']));
  });

  it('creates a frozen verified identity from the exact V1 response shape', async () => {
    const transport = successful(body({ organization: 'org-a', trustedPermissionReference: 'permissions-a' }));
    const result = await new DelegatedHttpV1Adapter(transport as never).verify(input() as never);
    expect(result).toEqual({ subject: 'actor-a', organization: 'org-a', anchors: [{ kind: 'organization', value: 'org-a' }], trustedPermissionReference: 'permissions-a' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.anchors)).toBe(true);
    expect(Object.isFrozen(result.anchors[0])).toBe(true);
    expect(JSON.stringify(result)).not.toContain(nativeCredential);
    expect(JSON.stringify(result)).not.toContain(rawSentinel);
    expect(transport.execute).toHaveBeenCalledTimes(1);
    expect(transport.execute).toHaveBeenCalledWith(input());
  });

  it('accepts absent optional organization/reference and deduplicates identical anchors', async () => {
    const transport = successful(body({ anchors: [{ kind: 'tenant', value: 'tenant-a' }, { kind: 'tenant', value: 'tenant-a' }] }));
    const result = await new DelegatedHttpV1Adapter(transport as never).verify(input() as never);
    expect(result).toEqual({ subject: 'actor-a', anchors: [{ kind: 'tenant', value: 'tenant-a' }] });
  });

  it.each([
    [body({ subject: undefined })], [body({ subject: '   ' })], [body({ subject: 7 })], [body({ subject: 'actor\u0000a' })],
    [body({ anchors: undefined })], [body({ anchors: [] })], [body({ anchors: [{ kind: 'organization' }] })],
    [body({ anchors: [{ kind: 'organization', value: 'org-a', extra: true }] })], [body({ anchors: [{ kind: 'undeclared', value: 'value' }] })],
    [body({ anchors: [{ kind: 'organization', value: 'org-a' }, { kind: 'organization', value: 'org-b' }] })],
    [body({ organization: '' })], [body({ trustedPermissionReference: 'permission\u0000ref' })]
  ])('rejects malformed or untrusted V1 semantic response', async (invalidBody) => {
    await expect(new DelegatedHttpV1Adapter(successful(invalidBody) as never).verify(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
  });

  it.each([
    { roles: ['admin'] }, { permissions: ['root:*'] }, { customerId: 'customer-a' }, { integrationId: 'integration-a' },
    { hostApp: 'admin' }, { rawToken: rawSentinel }, { nativeClaims: { sub: 'actor-a' } }, { trustedPermissionMaterial: {} }, { UserType: 'Admin' }, { IsAdmin: 'Y' }
  ])('rejects unknown role-like, native-like, or authority fields', async (unknown) => {
    await expect(new DelegatedHttpV1Adapter(successful(body(unknown)) as never).verify(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
  });

  it.each([
    [policy({ providerType: 'other' })], [policy({ responseContractVersion: 'unknown/v1' })], [policy({ providerContract: {} })]
  ])('rejects incompatible runtime provider contract before sending credentials', async (providerInstancePolicy) => {
    const transport = successful(body());
    await expect(new DelegatedHttpV1Adapter(transport as never).verify(input({ providerInstancePolicy }) as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(transport.execute).not.toHaveBeenCalled();
  });

  it('preserves credential and infrastructure failures from the transport without retrying', async () => {
    const credential = { execute: jest.fn(async () => { throw new ManagedExchangeCredentialError(); }) };
    await expect(new DelegatedHttpV1Adapter(credential as never).verify(input() as never)).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
    expect(credential.execute).toHaveBeenCalledTimes(1);
    const unavailable = { execute: jest.fn(async () => { throw new ManagedExchangeInfrastructureError(); }) };
    await expect(new DelegatedHttpV1Adapter(unavailable as never).verify(input() as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(unavailable.execute).toHaveBeenCalledTimes(1);
  });

  it('has no forbidden authorities or raw-response escape hatch', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/providers/delegated-http-v1.adapter.ts'), 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|PageContext|Canonicalization|ManagedTokenIssuer|GatewaySigning|Feature 004|IDX|ES512|UserType|IsAdmin|decodeJwt|admit\(|canonicalize|issue\(/i);
  });

  it('keeps registry resolution free of runtime authority and mutation APIs', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry.ts'), 'utf8');
    expect(source).not.toMatch(/Customer|CustomerScope|IntegrationBinding|PageContext|ES512|decodeJwt|ManagedTokenIssuer|Canonicalization|integrationSelector|integrationId|nativeCredential|register\(|unregister\(|fallback/i);
  });
});

function successful(bodyValue: unknown) {
  return { execute: jest.fn(async () => response(bodyValue)) };
}
