import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IdxMenuDetailPermissionNormalizer } from '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import {
  ManagedExchangeReadinessError,
  ManagedExchangeReadinessValidator
} from '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator';

type ReadinessDependencies = ConstructorParameters<typeof ManagedExchangeReadinessValidator>[0];

describe('Feature 006 production IDX readiness (T032/T033)', () => {
  it('accepts a fully provisioned IDX capability through the real activation validator without executing the normalizer', async () => {
    const fixture = readinessFixture();

    await expect(fixture.validator.assertReady('integration-idx')).resolves.toBeUndefined();

    expect(fixture.calls.findBinding).toHaveBeenCalledWith('integration-idx');
    expect(fixture.calls.findConfigs).toHaveBeenCalledWith('integration-idx');
    expect(fixture.calls.findProvider).toHaveBeenCalledWith('provider-idx');
    expect(fixture.calls.findAdmissions).toHaveBeenCalledWith('config-idx');
    expect(fixture.calls.findPermissions).toHaveBeenCalledWith('config-idx');
    expect(fixture.calls.hasPermissionNormalizer).toHaveBeenCalledWith('idx-menu-detail/v1');
    expect(fixture.calls.findPermissionSource).not.toHaveBeenCalled();
    expect(fixture.calls.hasPermissionAdapter).not.toHaveBeenCalled();
    expect(fixture.normalize).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<ReadinessDependencies>]>([
    ['missing IntegrationBinding', { findBinding: async () => null }],
    ['disabled IntegrationBinding', { findBinding: async () => ({ enabled: false }) }],
    ['no active exchange config', { findEnabledActiveConfigsByIntegrationId: async () => [] }],
    ['duplicate active exchange configs', { findEnabledActiveConfigsByIntegrationId: async () => [config(), { ...config(), id: 'config-idx-2' }] }],
    ['blank canonical HostApp', { findEnabledActiveConfigsByIntegrationId: async () => [{ ...config(), canonicalHostApp: '   ' }] }],
    ['fixed organization mode', { findEnabledActiveConfigsByIntegrationId: async () => [{ ...config(), organizationMode: 'fixed_single_organization', fixedOrganizationId: 'company-fixed' }] }],
    ['verified mode with a fixed organization', { findEnabledActiveConfigsByIntegrationId: async () => [{ ...config(), fixedOrganizationId: 'company-fixed' }] }],
    ['missing active IDX provider', { findEnabledActiveProviderById: async () => null }],
    ['wrong provider type', { findEnabledActiveProviderById: async () => ({ ...provider(), providerType: 'delegated_http' }) }],
    ['wrong response contract version', { findEnabledActiveProviderById: async () => ({ ...provider(), responseContractVersion: 'delegated-http/v1' }) }],
    ['non-GET method', { findEnabledActiveProviderById: async () => ({ ...provider(), httpMethod: 'POST' }) }],
    ['non-bearer placement', { findEnabledActiveProviderById: async () => ({ ...provider(), credentialPlacement: 'query' }) }],
    ['zero timeout', { findEnabledActiveProviderById: async () => ({ ...provider(), timeoutMilliseconds: 0 }) }],
    ['oversized timeout', { findEnabledActiveProviderById: async () => ({ ...provider(), timeoutMilliseconds: 5_001 }) }],
    ['non-integer timeout', { findEnabledActiveProviderById: async () => ({ ...provider(), timeoutMilliseconds: 1.5 }) }],
    ['unsafe endpoint', { findEnabledActiveProviderById: async () => ({ ...provider(), endpointUri: 'http://idx.example.test/menu-detail' }) }],
    ['missing idx_entry declaration', { findEnabledActiveProviderById: async () => ({ ...provider(), declaredAnchorKinds: [] }) }],
    ['wrong declared anchor', { findEnabledActiveProviderById: async () => ({ ...provider(), declaredAnchorKinds: ['organization'] }) }],
    ['extra declared anchor', { findEnabledActiveProviderById: async () => ({ ...provider(), declaredAnchorKinds: ['idx_entry', 'organization'] }) }],
    ['wrong closed provider contract', { findEnabledActiveProviderById: async () => ({ ...provider(), contractConfig: { responseSchema: 'wrong/v1', contentType: 'application/json' } }) }],
    ['zero admission policies', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [] }],
    ['duplicate admission policies', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [admissionPolicy(), admissionPolicy()] }],
    ['wrong admission anchor kind', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'organization', allowedValues: ['entry-a'] }] }] }],
    ['zero allowed Entry values', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'idx_entry', allowedValues: [] }] }] }],
    ['multiple allowed Entry values', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'idx_entry', allowedValues: ['entry-a', 'entry-b'] }] }] }],
    ['blank Entry value', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'idx_entry', allowedValues: ['   '] }] }] }],
    ['extra admission requirement', { findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'idx_entry', allowedValues: ['entry-a'] }, { kind: 'organization', allowedValues: ['company-a'] }] }] }],
    ['zero permission policies', { findEnabledActivePermissionPoliciesByConfigId: async () => [] }],
    ['duplicate permission policies', { findEnabledActivePermissionPoliciesByConfigId: async () => [permissionPolicy(), permissionPolicy()] }],
    ['non-provider_trusted permission mode', { findEnabledActivePermissionPoliciesByConfigId: async () => [{ ...permissionPolicy(), mode: 'allow_empty', normalizerType: null, projectionContractVersion: null, projectionContract: null }] }],
    ['non-null Permission Source ID', { findEnabledActivePermissionPoliciesByConfigId: async () => [{ ...permissionPolicy(), permissionSourceInstanceId: 'source-a' }] }],
    ['wrong normalizer type', { findEnabledActivePermissionPoliciesByConfigId: async () => [{ ...permissionPolicy(), normalizerType: 'synthetic-normalizer/v1' }] }],
    ['production IDX normalizer unavailable', { hasPermissionNormalizer: () => false }],
    ['wrong projection version', { findEnabledActivePermissionPoliciesByConfigId: async () => [{ ...permissionPolicy(), projectionContractVersion: 'wrong/v1' }] }],
    ['wrong projection contract', { findEnabledActivePermissionPoliciesByConfigId: async () => [{ ...permissionPolicy(), projectionContract: { scopeSchema: 'wrong/v1' } }] }],
    ['zero issuers', { findEnabledActiveIssuers: async () => [] }],
    ['duplicate issuers', { findEnabledActiveIssuers: async () => [issuer(), { ...issuer(), id: 'issuer-b' }] }],
    ['malformed issuer', { findEnabledActiveIssuers: async () => [{ ...issuer(), expectedAudience: '' }] }],
    ['zero signing keys', { findEnabledActiveSigningKeysByIssuerId: async () => [] }],
    ['duplicate signing keys', { findEnabledActiveSigningKeysByIssuerId: async () => [key(), { ...key(), kid: 'managed-kid-2' }] }],
    ['malformed signing key', { findEnabledActiveSigningKeysByIssuerId: async () => [{ ...key(), publicJwk: { kty: 'EC', x: 'public' } }] }],
    ['zero compatible Feature 004 profiles', { findTrustProfiles: async () => [] }],
    ['duplicate compatible Feature 004 profiles', { findTrustProfiles: async () => [trustProfile(), { ...trustProfile() }] }],
    ['wrong profile issuer', { findTrustProfiles: async () => [{ ...trustProfile(), expectedIssuer: 'https://wrong.example.test' }] }],
    ['wrong profile audience', { findTrustProfiles: async () => [{ ...trustProfile(), expectedAudience: 'wrong-audience' }] }],
    ['wrong profile JWKS URI', { findTrustProfiles: async () => [{ ...trustProfile(), jwksUri: 'https://wrong.example.test/jwks.json' }] }],
    ['wrong profile integration', { findTrustProfiles: async () => [{ ...trustProfile(), integrationId: 'integration-other' }] }],
    ['disabled profile', { findTrustProfiles: async () => [{ ...trustProfile(), enabled: false }] }],
    ['replaced profile', { findTrustProfiles: async () => [{ ...trustProfile(), lifecycle: 'replaced' }] }]
  ])('fails closed for %s without invoking IDX capability code', async (_caseName, overrides) => {
    const fixture = readinessFixture(overrides);
    const failure = await fixture.validator.assertReady('integration-idx').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ManagedExchangeReadinessError);
    expect(String(failure)).toBe('Error: Managed identity exchange is not ready.');
    expect(fixture.normalize).not.toHaveBeenCalled();
  });

  it('accepts exactly one compatible profile alongside unrelated profiles', async () => {
    const fixture = readinessFixture({ findTrustProfiles: async () => [trustProfile(), { ...trustProfile(), expectedAudience: 'unrelated-audience' }] });
    await expect(fixture.validator.assertReady('integration-idx')).resolves.toBeUndefined();
  });

  it('normalizes unexpected dependency failures to the generic readiness error', async () => {
    const fixture = readinessFixture({ findBinding: async () => { throw new Error('DO_NOT_LEAK_DB_DIAGNOSTIC'); } });
    const failure = await fixture.validator.assertReady('integration-idx').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ManagedExchangeReadinessError);
    expect(String(failure)).not.toContain('DO_NOT_LEAK_DB_DIAGNOSTIC');
  });

  it('keeps generic delegated fixed-organization and source-backed readiness unchanged', async () => {
    await expect(new ManagedExchangeReadinessValidator(genericDependencies()).assertReady('integration-generic')).resolves.toBeUndefined();
  });

  it('accepts only integrationId and contains no external-call, credential, Customer, or mutation path', () => {
    const validatorSource = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator.ts'), 'utf8');
    const compositionSource = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.composition.ts'), 'utf8');
    const source = `${validatorSource}\n${compositionSource}`;

    expect(ManagedExchangeReadinessValidator.prototype.assertReady).toHaveLength(1);
    expect(source).not.toMatch(/nativeCredential|Authorization|AccessToken|RefreshToken|DelegatedHttpTransport|IdxDelegatedVerificationAdapter|IdxMenuDetailValidator|MenuDetail|fetch\(|httpsRequest|axios|CustomerRepository|CustomerScope|customerId/i);
    expect(source).not.toMatch(/\.create\(|\.update\(|\.upsert\(|\.delete\(|\.transaction\(/);
  });
});

function readinessFixture(overrides: Partial<ReadinessDependencies> = {}) {
  const idxNormalizer = new IdxMenuDetailPermissionNormalizer();
  const normalize = jest.spyOn(idxNormalizer, 'normalize');
  const normalizers = new PermissionNormalizerRegistry([idxNormalizer]);
  const calls = {
    findBinding: jest.fn(async () => ({ enabled: true })),
    findConfigs: jest.fn(async () => [config()]),
    findProvider: jest.fn(async () => provider()),
    findAdmissions: jest.fn(async () => [admissionPolicy()]),
    findPermissions: jest.fn(async () => [permissionPolicy()]),
    findPermissionSource: jest.fn(async () => null),
    hasPermissionAdapter: jest.fn(() => false),
    hasPermissionNormalizer: jest.fn((type: string) => Boolean(normalizers.resolve(type))),
    findIssuers: jest.fn(async () => [issuer()]),
    findKeys: jest.fn(async () => [key()]),
    findProfiles: jest.fn(async () => [trustProfile()])
  };
  const defaults: ReadinessDependencies = {
    findBinding: calls.findBinding,
    findEnabledActiveConfigsByIntegrationId: calls.findConfigs,
    findEnabledActiveProviderById: calls.findProvider,
    findEnabledActiveAdmissionPoliciesByConfigId: calls.findAdmissions,
    findEnabledActivePermissionPoliciesByConfigId: calls.findPermissions,
    findEnabledActivePermissionSourceById: calls.findPermissionSource,
    hasPermissionAdapter: calls.hasPermissionAdapter,
    hasPermissionNormalizer: calls.hasPermissionNormalizer,
    findEnabledActiveIssuers: calls.findIssuers,
    findEnabledActiveSigningKeysByIssuerId: calls.findKeys,
    findTrustProfiles: calls.findProfiles
  };
  return { validator: new ManagedExchangeReadinessValidator({ ...defaults, ...overrides }), calls, normalize };
}

function config() { return { id: 'config-idx', integrationId: 'integration-idx', providerInstanceId: 'provider-idx', canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null }; }
function provider() {
  return {
    id: 'provider-idx', providerType: 'idx_delegated', endpointUri: 'https://idx.example.test/menu-detail', httpMethod: 'GET',
    credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'idx-menu-detail/v1',
    declaredAnchorKinds: ['idx_entry'], contractConfig: { responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' }
  };
}
function admissionPolicy() { return { anchorRequirements: [{ kind: 'idx_entry', allowedValues: ['entry-a'] }] }; }
function permissionPolicy() { return { mode: 'provider_trusted', permissionSourceInstanceId: null, normalizerType: 'idx-menu-detail/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' } }; }
function issuer() { return { id: 'issuer-a', issuer: 'https://issuer.example.test', expectedAudience: 'audience-a', publicJwksUri: 'https://issuer.example.test/jwks.json' }; }
function key() { return { kid: 'managed-kid', keyReference: 'ref:managed', publicJwk: { kty: 'RSA', n: 'public', e: 'AQAB' } }; }
function trustProfile() { return { integrationId: 'integration-idx', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'audience-a', jwksUri: 'https://issuer.example.test/jwks.json', enabled: true, lifecycle: 'active' }; }

function genericDependencies(): ReadinessDependencies {
  const source = { sourceType: 'synthetic', endpointUri: null, providerInstanceId: null, serviceCredentialReference: null, adapterContractReference: 'synthetic/v1', contractConfig: { materialSchema: 'managed-permission-material/v1' } };
  return {
    findBinding: async () => ({ enabled: true }),
    findEnabledActiveConfigsByIntegrationId: async () => [{ id: 'config-generic', integrationId: 'integration-generic', providerInstanceId: 'provider-generic', canonicalHostApp: 'admin', organizationMode: 'fixed_single_organization', fixedOrganizationId: 'organization-fixed' }],
    findEnabledActiveProviderById: async () => ({ id: 'provider-generic', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'delegated-http/v1', declaredAnchorKinds: ['organization'], contractConfig: { anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' } }),
    findEnabledActiveAdmissionPoliciesByConfigId: async () => [{ anchorRequirements: [{ kind: 'organization', allowedValues: ['organization-fixed'] }] }],
    findEnabledActivePermissionPoliciesByConfigId: async () => [{ mode: 'required', permissionSourceInstanceId: 'source-generic', normalizerType: 'synthetic-normalizer/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' } }],
    findEnabledActivePermissionSourceById: async () => source,
    hasPermissionAdapter: (type) => type === 'synthetic',
    hasPermissionNormalizer: (type) => type === 'synthetic-normalizer/v1',
    findEnabledActiveIssuers: async () => [{ id: 'issuer-generic', issuer: 'https://generic-issuer.example.test', expectedAudience: 'generic-audience', publicJwksUri: 'https://generic-issuer.example.test/jwks.json' }],
    findEnabledActiveSigningKeysByIssuerId: async () => [{ kid: 'generic-kid', keyReference: 'ref:generic', publicJwk: { kty: 'RSA', n: 'public', e: 'AQAB' } }],
    findTrustProfiles: async () => [{ integrationId: 'integration-generic', expectedIssuer: 'https://generic-issuer.example.test', expectedAudience: 'generic-audience', jwksUri: 'https://generic-issuer.example.test/jwks.json', enabled: true, lifecycle: 'active' }]
  };
}
