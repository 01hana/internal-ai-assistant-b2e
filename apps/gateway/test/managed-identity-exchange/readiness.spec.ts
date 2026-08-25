import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ManagedExchangeReadinessValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator';

type ReadinessDependencies = ConstructorParameters<typeof ManagedExchangeReadinessValidator>[0];
type FutureValidator = Readonly<{
  validateProvider(value: Readonly<Record<string, unknown>>): void;
  validateAdmission(value: unknown): void;
  validatePermissionPolicy(value: Readonly<Record<string, unknown>>, hasActiveSource: boolean): void;
  validateIssuer(value: Readonly<Record<string, unknown>>): void;
  validateSigningKey(value: Readonly<Record<string, unknown>>): void;
}>;

describe('Managed exchange readiness contract', () => {
  it('T004 ALREADY_GREEN_SECURITY_REGRESSION: remains read-only and has no IDX transport path', () => {
    const path = resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator.ts');
    expect(existsSync(path)).toBe(true);
    const source = existsSync(path) ? require('node:fs').readFileSync(path, 'utf8') : '';
    expect(source).toMatch(/class ManagedExchangeReadinessValidator/);
    expect(source).not.toMatch(/\.create\(|\.update\(|\.delete\(|nativeCredential|customerId|GatewaySigningKeyRepository|fetch\(|DelegatedHttpTransport|httpsRequest|MenuDetail/i);
  });

  it('T004 EXPECTED_RED: considers a fully provisioned future IDX integration ready without contacting IDX', async () => {
    await expect(new ManagedExchangeReadinessValidator(futureDependencies()).assertReady('integration-idx')).resolves.toBeUndefined();
  });

  it.each<[string, Partial<ReadinessDependencies>]>([
    ['missing or disabled Feature 004 IntegrationBinding', { findBinding: async () => null }],
    ['no active exchange config', { findEnabledActiveConfigsByIntegrationId: async () => [] }],
    ['ambiguous active exchange configs', { findEnabledActiveConfigsByIntegrationId: async () => [config(), { ...config(), id: 'config-idx-2' }] }],
    ['missing active IDX provider instance', { findEnabledActiveProviderById: async () => null }],
    ['wrong IDX contract', { findEnabledActiveProviderById: async () => ({ ...provider(), responseContractVersion: 'wrong/v1' }) }],
    ['non-GET IDX provider', { findEnabledActiveProviderById: async () => ({ ...provider(), httpMethod: 'POST' }) }],
    ['non-bearer IDX credential placement', { findEnabledActiveProviderById: async () => ({ ...provider(), credentialPlacement: 'query' }) }],
    ['missing sole idx_entry capability', { findEnabledActiveProviderById: async () => ({ ...provider(), declaredAnchorKinds: ['organization'] }) }],
    ['missing exact idx_entry admission policy', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'organization', allowedValues: ['organization-a'] }] }] }],
    ['non-provider_trusted permission policy', { findEnabledActivePermissionPoliciesByConfigId: async () => [{ ...permissionPolicy(), mode: 'allow_empty' }] }],
    ['missing IDX normalizer', { hasPermissionNormalizer: () => false }],
    ['invalid projection contract', { findEnabledActivePermissionPoliciesByConfigId: async () => [{ ...permissionPolicy(), projectionContract: { scopeSchema: 'wrong/v1' } }] }],
    ['missing managed issuer', { findEnabledActiveIssuers: async () => [] }],
    ['ambiguous managed issuers', { findEnabledActiveIssuers: async () => [issuer(), { ...issuer(), id: 'issuer-b' }] }],
    ['missing active signing key', { findEnabledActiveSigningKeysByIssuerId: async () => [] }],
    ['ambiguous active signing keys', { findEnabledActiveSigningKeysByIssuerId: async () => [key(), { ...key(), kid: 'managed-kid-2' }] }],
    ['missing compatible Feature 004 trust profile', { findTrustProfiles: async () => [] }],
    ['ambiguous compatible Feature 004 trust profiles', { findTrustProfiles: async () => [trustProfile(), { ...trustProfile() }] }],
    ['incompatible Feature 004 trust profile', { findTrustProfiles: async () => [{ ...trustProfile(), expectedAudience: 'different-audience' }] }]
  ])('T004 %s fails closed without an external IDX request', async (_caseName, overrides) => {
    await expect(new ManagedExchangeReadinessValidator(futureDependencies(overrides), futureIdxValidator() as never).assertReady('integration-idx')).rejects.toThrow('Managed identity exchange is not ready.');
  });
});

function futureDependencies(overrides: Partial<ReadinessDependencies> = {}): ReadinessDependencies {
  const defaults: ReadinessDependencies = {
    findBinding: async () => ({ enabled: true }),
    findEnabledActiveConfigsByIntegrationId: async () => [config()],
    findEnabledActiveProviderById: async () => provider(),
    findEnabledActiveAdmissionPoliciesByConfigId: async () => [admissionPolicy()],
    findEnabledActivePermissionPoliciesByConfigId: async () => [permissionPolicy()],
    findEnabledActivePermissionSourceById: async () => null,
    hasPermissionAdapter: () => false,
    hasPermissionNormalizer: (type: string) => type === 'idx-menu-detail/v1',
    findEnabledActiveIssuers: async () => [issuer()],
    findEnabledActiveSigningKeysByIssuerId: async () => [key()],
    findTrustProfiles: async () => [trustProfile()]
  };
  return { ...defaults, ...overrides };
}

function config() { return { id: 'config-idx', integrationId: 'integration-idx', providerInstanceId: 'provider-idx', canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null }; }
function provider() { return { id: 'provider-idx', providerType: 'idx_delegated', endpointUri: 'https://idx.example.test/menu-detail', httpMethod: 'GET', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'idx-menu-detail/v1', declaredAnchorKinds: ['idx_entry'], contractConfig: { responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' } }; }
function admissionPolicy() { return { anchorRequirements: [{ kind: 'idx_entry', allowedValues: ['entry-a'] }] }; }
function permissionPolicy() { return { mode: 'provider_trusted', permissionSourceInstanceId: null, normalizerType: 'idx-menu-detail/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' } }; }
function issuer() { return { id: 'issuer-a', issuer: 'https://issuer.example.test', expectedAudience: 'audience-a', publicJwksUri: 'https://issuer.example.test/jwks.json' }; }
function key() { return { kid: 'managed-kid', keyReference: 'ref:managed', publicJwk: { kty: 'RSA', n: 'public', e: 'AQAB' } }; }
function trustProfile() { return { integrationId: 'integration-idx', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'audience-a', jwksUri: 'https://issuer.example.test/jwks.json', enabled: true, lifecycle: 'active' }; }

function futureIdxValidator(): FutureValidator {
  return {
    validateProvider(value) {
      const contract = value.contractConfig as Record<string, unknown>;
      if (value.providerType !== 'idx_delegated' || value.responseContractVersion !== 'idx-menu-detail/v1' || value.httpMethod !== 'GET' || value.credentialPlacement !== 'authorization_bearer' || !Array.isArray(value.declaredAnchorKinds) || value.declaredAnchorKinds.length !== 1 || value.declaredAnchorKinds[0] !== 'idx_entry' || contract.responseSchema !== 'idx-menu-detail/v1' || contract.contentType !== 'application/json') throw new Error('invalid future IDX provider');
    },
    validateAdmission(value) {
      const policies = value as readonly { kind?: unknown; allowedValues?: unknown }[];
      if (!Array.isArray(policies) || policies.length !== 1 || policies[0]?.kind !== 'idx_entry' || !Array.isArray(policies[0]?.allowedValues) || policies[0].allowedValues.length !== 1) throw new Error('invalid future IDX admission');
    },
    validatePermissionPolicy(value, hasActiveSource) {
      const projection = value.projectionContract as Record<string, unknown>;
      if (hasActiveSource || value.mode !== 'provider_trusted' || value.permissionSourceInstanceId !== null || value.normalizerType !== 'idx-menu-detail/v1' || value.projectionContractVersion !== 'managed-permissions/v1' || projection.scopeSchema !== 'managed-normalized-scopes/v1') throw new Error('invalid future IDX permission policy');
    },
    validateIssuer(value) { if (!value.issuer || !value.expectedAudience || !value.publicJwksUri) throw new Error('invalid issuer'); },
    validateSigningKey(value) { if (value.kid !== 'managed-kid' || value.keyReference !== 'ref:managed') throw new Error('invalid key'); }
  };
}
