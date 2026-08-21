import { ProvisionManagedPermissionPolicyCommand } from '../../src/commands/provision-managed-permission-policy';
import { ManagedExchangeReadinessValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator';

const source = Object.freeze({ id: 'source-a', sourceType: 'synthetic', endpointUri: null, providerInstanceId: null, serviceCredentialReference: null, adapterContractReference: 'synthetic/v1', contractConfig: { materialSchema: 'managed-permission-material/v1' }, enabled: true, lifecycle: 'active' });
const policy = (sourceId: string | null) => ({ integrationConfigId: 'config-a', mode: 'allow_empty', permissionSourceInstanceId: sourceId, normalizerType: sourceId ? 'synthetic-normalizer/v1' : null, projectionContractVersion: sourceId ? 'managed-permissions/v1' : null, projectionContract: sourceId ? { scopeSchema: 'managed-normalized-scopes/v1' } : null, requestId: 'request-a' });
const adapterRegistry = { resolve: (type: string) => type === 'synthetic' ? { sourceType: type, resolve: async () => ({ kind: 'synthetic' }) } : undefined };
const normalizerRegistry = { resolve: (type: string) => type === 'synthetic-normalizer/v1' ? { normalizerType: type, normalize: () => [] } : undefined };

describe('Phase 2A permission policy active-source semantics', () => {
  it('accepts explicit allow_empty no-source and a valid active configured source', async () => {
    await expect(command(null).create(policy(null))).resolves.toMatchObject({ lifecycle: 'active' });
    await expect(command(source).create(policy('source-a'))).resolves.toMatchObject({ lifecycle: 'active' });
  });

  it.each([null, { ...source, contractConfig: {} }])('rejects a missing or invalid configured source', async (value) => {
    await expect(command(value).create(policy('source-a'))).rejects.toThrow();
  });

  it('fails readiness closed for configured adapter or normalizer absence', async () => {
    await expect(readiness({ adapter: false }).assertReady('integration-a')).rejects.toThrow();
    await expect(readiness({ normalizer: false }).assertReady('integration-a')).rejects.toThrow();
    await expect(readiness({ source: null }).assertReady('integration-a')).rejects.toThrow();
  });

  it('requires exactly one compatible active Feature 004 profile and a valid organization mode', async () => {
    await expect(readiness({ profiles: [] }).assertReady('integration-a')).rejects.toThrow();
    await expect(readiness({ profiles: [{ integrationId: 'integration-a', expectedIssuer: 'https://wrong.example.test', expectedAudience: 'audience', jwksUri: 'https://issuer.example.test/jwks', enabled: true, lifecycle: 'active' }] }).assertReady('integration-a')).rejects.toThrow();
    const compatible = { integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'audience', jwksUri: 'https://issuer.example.test/jwks', enabled: true, lifecycle: 'active' };
    await expect(readiness({ profiles: [compatible, compatible] }).assertReady('integration-a')).rejects.toThrow();
    await expect(readiness({ organizationMode: 'fixed_single_organization', fixedOrganizationId: null }).assertReady('integration-a')).rejects.toThrow();
    await expect(readiness({}).assertReady('integration-a')).resolves.toBeUndefined();
  });
});

function command(activeSource: Record<string, unknown> | null) {
  const repository = { transaction: async (callback: (transaction: object) => Promise<Record<string, unknown>>) => callback({}), create: async (_kind: string, data: Record<string, unknown>) => ({ id: 'policy-a', ...data }) };
  return new ProvisionManagedPermissionPolicyCommand({ repository: repository as never, audit: { append: async () => undefined }, invalidation: { invalidate: async () => undefined }, permissionSources: { findEnabledActiveById: async () => activeSource } as never, permissionAdapters: adapterRegistry, permissionNormalizers: normalizerRegistry });
}

type Profile = Readonly<{ integrationId: string; expectedIssuer: string; expectedAudience: string; jwksUri: string; enabled: boolean; lifecycle: string }>;
function readiness(overrides: Readonly<{ adapter?: boolean; normalizer?: boolean; source?: Record<string, unknown> | null; profiles?: readonly Profile[]; organizationMode?: string; fixedOrganizationId?: string | null }>) {
  const activeSource = overrides.source === undefined ? source : overrides.source;
  return new ManagedExchangeReadinessValidator({
    findBinding: async () => ({ enabled: true }),
    findEnabledActiveConfigsByIntegrationId: async () => [{ id: 'config-a', integrationId: 'integration-a', providerInstanceId: 'provider-a', canonicalHostApp: 'admin', organizationMode: overrides.organizationMode ?? 'verified', fixedOrganizationId: overrides.fixedOrganizationId === undefined ? null : overrides.fixedOrganizationId }],
    findEnabledActiveProviderById: async () => ({ id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'delegated-http/v1', declaredAnchorKinds: ['org'], contractConfig: { anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' } }),
    findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'org', allowedValues: ['org-a'] }] }],
    findEnabledActivePermissionPoliciesByConfigId: async () => [policy('source-a')],
    findEnabledActivePermissionSourceById: async () => activeSource,
    hasPermissionAdapter: () => overrides.adapter !== false,
    hasPermissionNormalizer: () => overrides.normalizer !== false,
    findEnabledActiveIssuers: async () => [{ id: 'issuer-a', issuer: 'https://issuer.example.test', expectedAudience: 'audience', publicJwksUri: 'https://issuer.example.test/jwks' }],
    findEnabledActiveSigningKeysByIssuerId: async () => [{ kid: 'managed-kid', keyReference: 'managed-ref', publicJwk: { kty: 'RSA', n: 'n', e: 'AQAB' } }],
    findTrustProfiles: async () => overrides.profiles ?? [{ integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'audience', jwksUri: 'https://issuer.example.test/jwks', enabled: true, lifecycle: 'active' }]
  });
}
