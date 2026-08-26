import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ManagedExchangeInfrastructureError } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedExchangeActivationValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { ProviderContractValidatorRegistry } from '../../src/managed-identity-exchange/persistence/managed-contract-registries';
import { ManagedExchangeReadinessValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator';
import { DelegatedHttpV1Adapter } from '../../src/managed-identity-exchange/providers/delegated-http-v1.adapter';
import { IdentityProviderAdapterRegistry } from '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';

const nativeCredential = 'DO_NOT_LEAK_NATIVE_SECRET';
const idxProvider = (overrides: Record<string, unknown> = {}) => ({
  id: 'provider-idx', providerType: 'idx_delegated', endpointUri: 'https://idx.example.test/menu-detail', httpMethod: 'GET',
  credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'idx-menu-detail/v1',
  declaredAnchorKinds: ['idx_entry'], contractConfig: { responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' }, ...overrides
});

describe('Disabled IDX adapter shell (T021)', () => {
  it('is a known provider that always fails closed without credential disclosure', async () => {
    const shell = new IdxDelegatedVerificationAdapter();
    expect(shell.providerType).toBe('idx_delegated');
    const failure = await shell.verify({ nativeCredential, providerInstancePolicy: idxProvider() as never, requestId: 'idx-a' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(String(failure)).not.toContain(nativeCredential);
    expect(JSON.stringify(failure)).not.toContain(nativeCredential);
  });

  it('resolves the disabled shell, keeps delegated resolution exact, and leaves unknown types undefined', () => {
    const delegated = new DelegatedHttpV1Adapter({ execute: jest.fn() } as never);
    const idx = new IdxDelegatedVerificationAdapter();
    const registry = new IdentityProviderAdapterRegistry(delegated, idx);
    expect(registry.resolve('delegated_http')).toBe(delegated);
    expect(registry.resolve('idx_delegated')).toBe(idx);
    expect(registry.resolve('unknown')).toBeUndefined();
  });

  it('registers the fixed provider contract while the adapter and readiness remain disabled', async () => {
    const contracts = new ProviderContractValidatorRegistry();
    expect(contracts.isActiveEligible('idx_delegated', 'idx-menu-detail/v1')).toBe(true);
    expect(() => contracts.validate('idx_delegated', 'idx-menu-detail/v1', idxProvider().contractConfig)).not.toThrow();
    expect(() => new ManagedExchangeActivationValidator().validateProvider(idxProvider())).not.toThrow();
    await expect(readinessWithIdx().assertReady('integration-a')).rejects.toThrow();
  });

  it('keeps provider capability authority in the contract registry, not the generic activation validator', () => {
    const contracts = new ProviderContractValidatorRegistry();
    const validate = jest.spyOn(contracts, 'validate');
    const activation = new ManagedExchangeActivationValidator(contracts);
    expect(activation.validateProvider({
      id: 'provider-delegated', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST',
      credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'delegated-http/v1',
      declaredAnchorKinds: ['organization'], contractConfig: { anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' }
    })).toMatchObject({ providerType: 'delegated_http' });
    expect(activation.validateProvider(idxProvider())).toMatchObject({ providerType: 'idx_delegated', httpMethod: 'GET' });
    expect(() => activation.validateProvider(idxProvider({ providerType: 'unknown_provider' }))).toThrow();
    expect(validate).toHaveBeenCalledWith('idx_delegated', 'idx-menu-detail/v1', expect.any(Object));
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-activation.validator.ts'), 'utf8');
    expect(source).not.toMatch(/\['delegated_http', 'idx_delegated'\]|delegated_http.*idx_delegated/i);
  });

  it('keeps the uncomposed adapter free of local crypto, Customer, permission, and signing authority', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter.ts'), 'utf8');
    expect(source).not.toMatch(/fetch\(|httpsRequest|ES512|jose|JWKS|kid|publicKey|decodeJwt|jwtVerify|crypto\.verify|CustomerScope|IntegrationBinding|ManagedTokenIssuer|PermissionSource|RefreshToken|GatewaySigningKey|customerId|integrationId|host_app|roles|scope|ALLOW_IDX|SYNTHETIC|NODE_ENV/i);
  });
});

function readinessWithIdx() {
  return new ManagedExchangeReadinessValidator({
    findBinding: async () => ({ enabled: true }),
    findEnabledActiveConfigsByIntegrationId: async () => [{ id: 'config-a', integrationId: 'integration-a', providerInstanceId: 'provider-idx', canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null }],
    findEnabledActiveProviderById: async () => idxProvider(),
    findEnabledActiveAdmissionPoliciesByConfigId: async () => [],
    findEnabledActivePermissionPoliciesByConfigId: async () => [],
    findEnabledActivePermissionSourceById: async () => null,
    hasPermissionAdapter: () => false,
    hasPermissionNormalizer: () => false,
    findEnabledActiveIssuers: async () => [],
    findEnabledActiveSigningKeysByIssuerId: async () => [],
    findTrustProfiles: async () => []
  });
}
