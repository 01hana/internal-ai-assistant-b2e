import { ManagedExchangeProvisionPostCommitError } from '../../src/commands/managed-exchange-control-plane';
import { ProvisionManagedAdmissionPolicyCommand } from '../../src/commands/provision-managed-admission-policy';
import { ProvisionManagedIdentityProviderCommand } from '../../src/commands/provision-managed-identity-provider';
import { ProvisionManagedIntegrationExchangeConfigCommand, createManagedIntegrationConfigLifecycle } from '../../src/commands/provision-managed-integration-exchange-config';
import { ProvisionManagedPermissionPolicyCommand } from '../../src/commands/provision-managed-permission-policy';
import { ProvisionManagedPermissionSourceCommand } from '../../src/commands/provision-managed-permission-source';
import { ProvisionManagedUpstreamIssuerCommand } from '../../src/commands/provision-managed-upstream-issuer';
import { ProvisionManagedUpstreamSigningKeyCommand } from '../../src/commands/provision-managed-upstream-signing-key';
import { GatewaySigningAuthorityReader } from '../../src/managed-identity-exchange/persistence/gateway-signing-authority.reader';
import { createManagedExchangeReadinessValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.composition';
import { IdxMenuDetailPermissionNormalizer } from '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { SyntheticV1PermissionNormalizer } from '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer';
import { ManagedIntegrationExchangeConfigActivationValidator } from '../../src/managed-identity-exchange/persistence/managed-integration-exchange-config-activation.validator';
import { ManagedExchangeLifecycleRepository, ManagedIdentityProviderInstanceRepository, ManagedIntegrationAdmissionPolicyRepository, ManagedIntegrationExchangeConfigRepository, ManagedPermissionPolicyRepository, ManagedPermissionSourceInstanceRepository, ManagedUpstreamIssuerRepository, ManagedUpstreamSigningKeyRepository } from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';
import { GatewaySigningKeyRepository } from '../../src/signing/gateway-signing-key.repository';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const providerInput = (overrides: Record<string, unknown> = {}) => ({ providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'delegated-http/v1', declaredAnchorKinds: ['org'], contractConfig: { anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' }, ...overrides });
const idxProviderInput = () => ({ providerType: 'idx_delegated', endpointUri: 'https://idx.example.test/menu-detail', httpMethod: 'GET', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'idx-menu-detail/v1', declaredAnchorKinds: ['idx_entry'], contractConfig: { responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' } });
const sourceInput = (overrides: Record<string, unknown> = {}) => ({ sourceType: 'synthetic', endpointUri: null, providerInstanceId: null, serviceCredentialReference: null, adapterContractReference: 'synthetic/v1', contractConfig: { materialSchema: 'managed-permission-material/v1' }, ...overrides });
const issuerInput = (overrides: Record<string, unknown> = {}) => ({ issuer: 'https://managed.example.test', expectedAudience: 'managed-audience', publicJwksUri: 'https://managed.example.test/jwks.json', ...overrides });
const keyInput = (issuerId: string, overrides: Record<string, unknown> = {}) => ({ issuerId, kid: 'managed-kid', keyReference: 'managed-ref', publicJwk: { kty: 'RSA', n: 'managed-n', e: 'AQAB' }, ...overrides });

describeRegistry('Feature 005 Phase 2B DB acceptance', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('managed-exchange-phase2b');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    await prisma.customer.create({ data: { id: 'customer-a' } });
    await prisma.integrationBinding.createMany({ data: [
      { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true },
      { integrationId: 'integration-b', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true }
    ] });
  });
  afterEach(async () => { await prisma?.$disconnect(); await database?.dispose(); });

  it('provisions provider lifecycle with replacement rollback and IDX fail-closed', async () => {
    const h = harness(prisma);
    const first = await h.provider.create({ ...providerInput(), requestId: 'provider-create' });
    expect(first).toMatchObject({ version: 1, enabled: true, lifecycle: 'active' });
    await expect(h.provider.create({ ...providerInput({ responseContractVersion: 'unknown/v1' }), requestId: 'bad' })).rejects.toThrow();
    await expect(prisma.managedIdentityProviderInstance.count()).resolves.toBe(1);
    const second = await h.provider.replace({ predecessorId: String(first.id), requestId: 'provider-replace', successor: providerInput({ endpointUri: 'https://provider-v2.example.test/verify' }) });
    expect(await prisma.managedIdentityProviderInstance.findUnique({ where: { id: String(first.id) } })).toMatchObject({ enabled: false, lifecycle: 'replaced' });
    expect(second).toMatchObject({ version: 2, enabled: true, lifecycle: 'active', replacesProviderId: first.id });
    await expect(h.provider.replace({ predecessorId: String(first.id), requestId: 'stale', successor: providerInput() })).rejects.toThrow();
    await expect(h.provider.create({ ...providerInput({ providerType: 'idx_delegated' }), requestId: 'idx' })).rejects.toThrow();
  });

  it('uses server-owned config selectors and validates binding/provider/org anchors', async () => {
    const h = harness(prisma); const provider = await h.provider.create({ ...providerInput(), requestId: 'provider' });
    const config = await h.config.createConfig({ integrationId: 'integration-a', providerInstanceId: String(provider.id), canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null, requestId: 'config' });
    expect(config).toMatchObject({ version: 1, enabled: true, lifecycle: 'active', replacesConfigId: null });
    expect(String(config.publicSelector)).toMatch(/^mie_/);
    await expect(h.config.createConfig({ integrationId: 'integration-a', providerInstanceId: String(provider.id), canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null, publicSelector: 'caller', requestId: 'authority' })).rejects.toThrow();
    const next = await h.config.replaceConfig({ predecessorId: String(config.id), requestId: 'replace', successor: { integrationId: 'integration-a', providerInstanceId: String(provider.id), canonicalHostApp: 'admin', organizationMode: 'fixed_single_organization', fixedOrganizationId: 'org-a' } });
    expect(next.publicSelector).not.toEqual(config.publicSelector);
    await expect(new ManagedIntegrationExchangeConfigRepository(prisma).findEnabledActiveByPublicSelector(String(config.publicSelector))).resolves.toBeNull();
    await expect(h.config.replaceConfig({ predecessorId: String(next.id), requestId: 'cross', successor: { integrationId: 'integration-b', providerInstanceId: String(provider.id), canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null } })).rejects.toThrow();
    await expect(h.config.createConfig({ integrationId: 'integration-a', providerInstanceId: String(provider.id), canonicalHostApp: 'admin', organizationMode: 'fixed_single_organization', fixedOrganizationId: null, requestId: 'org' })).rejects.toThrow();
  });

  it('rolls back a failed successor insert and preserves the active predecessor', async () => {
    const h = harness(prisma); const first = await h.provider.create({ ...providerInput({ id: 'provider-fixed' }), requestId: 'create' });
    await expect(h.provider.replace({ predecessorId: String(first.id), requestId: 'replace', successor: providerInput({ id: 'provider-fixed' }) })).rejects.toThrow();
    await expect(prisma.managedIdentityProviderInstance.findUnique({ where: { id: String(first.id) } })).resolves.toMatchObject({ enabled: true, lifecycle: 'active' });
  });

  it('rolls back a failed config successor insert without a committed zero-active interval', async () => {
    const h = harness(prisma); const provider = await h.provider.create({ ...providerInput(), requestId: 'provider' });
    const config = await h.config.createConfig({ id: 'config-fixed', integrationId: 'integration-a', providerInstanceId: String(provider.id), canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null, requestId: 'config' });
    await expect(h.config.replaceConfig({ predecessorId: String(config.id), requestId: 'replace', successor: { id: 'config-fixed', integrationId: 'integration-a', providerInstanceId: String(provider.id), canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null } })).rejects.toThrow();
    await expect(prisma.managedIntegrationExchangeConfig.findUnique({ where: { id: String(config.id) } })).resolves.toMatchObject({ enabled: true, lifecycle: 'active' });
  });

  it('enforces admission/source/policy fixed contracts, lifecycle history, and active-source dependencies', async () => {
    const h = harness(prisma); const provider = await h.provider.create({ ...providerInput(), requestId: 'provider' }); const config = await createConfig(h, provider.id);
    const admission = await h.admission.create({ integrationConfigId: String(config.id), anchorRequirements: [{ kind: 'org', allowedValues: ['org-a'] }], requestId: 'admission' });
    await expect(h.admission.create({ integrationConfigId: String(config.id), anchorRequirements: [], requestId: 'bad-admission' })).rejects.toThrow();
    const source = await h.source.create({ ...sourceInput(), requestId: 'source' });
    await expect(h.source.create({ ...sourceInput({ contractConfig: { materialSchema: 'native credential' } }), requestId: 'unsafe' })).rejects.toThrow();
    await expect(h.policy.create({ integrationConfigId: String(config.id), mode: 'allow_empty', permissionSourceInstanceId: null, normalizerType: null, projectionContractVersion: null, projectionContract: null, requestId: 'no-source' })).resolves.toMatchObject({ enabled: true });
    await expect(h.policy.replace({ predecessorId: String(admission.id), requestId: 'wrong-kind', successor: {} })).rejects.toThrow();
    const secondConfig = await createConfig(h, provider.id, 'integration-b');
    await expect(h.policy.create({ integrationConfigId: String(secondConfig.id), mode: 'allow_empty', permissionSourceInstanceId: 'missing', normalizerType: 'synthetic-normalizer/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' }, requestId: 'missing-source' })).rejects.toThrow();
    await expect(h.policy.create({ integrationConfigId: String(secondConfig.id), mode: 'required', permissionSourceInstanceId: String(source.id), normalizerType: 'synthetic-normalizer/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' }, requestId: 'complete' })).resolves.toMatchObject({ enabled: true });
  });

  it('enforces issuer/key separation, transitions, late collisions, replacement, and post-commit semantics', async () => {
    const h = harness(prisma); const issuer = await h.issuer.create({ ...issuerInput(), requestId: 'issuer' });
    await expect(h.issuer.create({ ...issuerInput({ issuer: 'https://gateway.example.test' }), requestId: 'collision' })).rejects.toThrow();
    const key = await h.key.registerKey({ ...keyInput(String(issuer.id)), requestId: 'register' });
    await h.key.transitionKey({ id: String(key.id), to: 'published', requestId: 'published' });
    await prisma.gatewaySigningKey.create({ data: { kid: 'gateway-kid', keyReference: 'gateway-ref', publicJwk: { kty: 'RSA', n: 'gateway-n', e: 'AQAB' }, status: 'active' } });
    await expect(h.key.transitionKey({ id: String(key.id), to: 'active', requestId: 'active' })).resolves.toMatchObject({ status: 'active', enabled: true, lifecycle: 'active' });
    const replacement = await h.key.replaceKey({ predecessorId: String(key.id), requestId: 'replace', successor: keyInput(String(issuer.id), { kid: 'managed-kid-v2', keyReference: 'managed-ref-v2', publicJwk: { kty: 'RSA', n: 'managed-n-v2', e: 'AQAB' } }) });
    await expect(prisma.managedUpstreamSigningKey.findUnique({ where: { id: String(key.id) } })).resolves.toMatchObject({ status: 'retired', enabled: false, lifecycle: 'replaced' });
    expect(replacement).toMatchObject({ status: 'active', enabled: true, lifecycle: 'active', version: 2, replacesKeyId: key.id });
    const committed = harness(prisma, { failInvalidation: true });
    await expect(committed.provider.create({ ...providerInput({ endpointUri: 'https://committed.example.test/verify' }), requestId: 'post-commit' })).rejects.toMatchObject({ committed: true });
    await expect(prisma.managedIdentityProviderInstance.findFirst({ where: { endpointUri: 'https://committed.example.test/verify' } })).resolves.not.toBeNull();
  });

  it('rejects nested signing replacement metadata without mutating the active predecessor', async () => {
    const h = harness(prisma); const issuer = await h.issuer.create({ ...issuerInput(), requestId: 'issuer' }); const key = await activateKey(h, issuer.id);
    await expect(h.key.replaceKey({ predecessorId: String(key.id), requestId: 'replace', successor: keyInput(String(issuer.id), { kid: 'nested-kid', keyReference: 'nested-ref', publicJwk: { kty: 'RSA', n: 'nested-n', e: 'AQAB' }, requestId: 'nested' }) })).rejects.toThrow();
    await expect(prisma.managedUpstreamSigningKey.findUnique({ where: { id: String(key.id) } })).resolves.toMatchObject({ status: 'active', enabled: true, lifecycle: 'active' });
    await expect(prisma.managedUpstreamSigningKey.count()).resolves.toBe(1);
  });

  it.each([
    { kid: 'managed-kid', keyReference: 'gateway-ref', publicJwk: { kty: 'RSA', n: 'gateway-n', e: 'AQAB' } },
    { kid: 'gateway-kid', keyReference: 'managed-ref', publicJwk: { kty: 'RSA', n: 'gateway-n', e: 'AQAB' } },
    { kid: 'gateway-kid', keyReference: 'gateway-ref', publicJwk: { kty: 'RSA', n: 'managed-n', e: 'AQAB' } }
  ])('rejects late Gateway signing collision before activation', async (gateway) => {
    const h = harness(prisma); const issuer = await h.issuer.create({ ...issuerInput(), requestId: 'issuer' });
    const key = await h.key.registerKey({ ...keyInput(String(issuer.id)), requestId: 'register' });
    await h.key.transitionKey({ id: String(key.id), to: 'published', requestId: 'published' });
    await prisma.gatewaySigningKey.create({ data: { ...gateway, status: 'active' } });
    await expect(h.key.transitionKey({ id: String(key.id), to: 'active', requestId: 'active' })).rejects.toThrow();
    await expect(prisma.managedUpstreamSigningKey.findUnique({ where: { id: String(key.id) } })).resolves.toMatchObject({ status: 'published', enabled: false, lifecycle: 'draft' });
  });

  it('uses production readiness composition for no-source and configured-source happy paths plus exact F004 compatibility', async () => {
    const h = harness(prisma); const provider = await h.provider.create({ ...providerInput(), requestId: 'provider' }); const config = await createConfig(h, provider.id);
    await h.admission.create({ integrationConfigId: String(config.id), anchorRequirements: [{ kind: 'org', allowedValues: ['org-a'] }], requestId: 'admission' });
    await h.policy.create({ integrationConfigId: String(config.id), mode: 'allow_empty', permissionSourceInstanceId: null, normalizerType: null, projectionContractVersion: null, projectionContract: null, requestId: 'policy' });
    const issuer = await h.issuer.create({ ...issuerInput(), requestId: 'issuer' }); const key = await activateKey(h, issuer.id);
    await prisma.registeredUpstreamTrustProfile.create({ data: { integrationId: 'integration-a', expectedIssuer: String(issuer.issuer), expectedAudience: String(issuer.expectedAudience), jwksUri: String(issuer.publicJwksUri), algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null } });
    await expect(h.readiness.assertReady('integration-a')).resolves.toBeUndefined();
    await prisma.registeredUpstreamTrustProfile.create({ data: { integrationId: 'integration-a', expectedIssuer: String(issuer.issuer), expectedAudience: String(issuer.expectedAudience), jwksUri: String(issuer.publicJwksUri), algorithm: 'RS256', enabled: false, lifecycle: 'disabled', version: 2, replacesProfileId: null } });
    await expect(h.readiness.assertReady('integration-a')).resolves.toBeUndefined();
    await expect(new ManagedUpstreamSigningKeyRepository(prisma).findEnabledActiveByIssuerId(String(issuer.id))).resolves.toEqual([expect.objectContaining({ id: key.id })]);
  });

  it('accepts configured-source readiness and fails closed if the source becomes disabled', async () => {
    const h = harness(prisma); const provider = await h.provider.create({ ...providerInput(), requestId: 'provider' }); const config = await createConfig(h, provider.id);
    await h.admission.create({ integrationConfigId: String(config.id), anchorRequirements: [{ kind: 'org', allowedValues: ['org-a'] }], requestId: 'admission' });
    const source = await h.source.create({ ...sourceInput(), requestId: 'source' });
    await h.policy.create({ integrationConfigId: String(config.id), mode: 'required', permissionSourceInstanceId: String(source.id), normalizerType: 'synthetic-normalizer/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' }, requestId: 'policy' });
    const issuer = await h.issuer.create({ ...issuerInput(), requestId: 'issuer' }); await activateKey(h, issuer.id);
    await prisma.registeredUpstreamTrustProfile.create({ data: { integrationId: 'integration-a', expectedIssuer: String(issuer.issuer), expectedAudience: String(issuer.expectedAudience), jwksUri: String(issuer.publicJwksUri), algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null } });
    await expect(h.readiness.assertReady('integration-a')).resolves.toBeUndefined();
    await h.source.disable({ id: String(source.id), requestId: 'source-disable' });
    await expect(h.readiness.assertReady('integration-a')).rejects.toThrow();
  });

  it('proves fully provisioned IDX readiness through production DB composition without normalizer execution', async () => {
    const h = harness(prisma);
    const normalize = jest.spyOn(h.idxNormalizer, 'normalize');
    const provider = await h.provider.create({ ...idxProviderInput(), requestId: 'idx-provider' });
    const config = await createConfig(h, provider.id);
    await h.admission.create({ integrationConfigId: String(config.id), anchorRequirements: [{ kind: 'idx_entry', allowedValues: ['entry-a'] }], requestId: 'idx-admission' });
    await h.policy.create({ integrationConfigId: String(config.id), mode: 'provider_trusted', permissionSourceInstanceId: null, normalizerType: 'idx-menu-detail/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: { scopeSchema: 'managed-normalized-scopes/v1' }, requestId: 'idx-permission' });
    const issuer = await h.issuer.create({ ...issuerInput(), requestId: 'idx-issuer' });
    await activateKey(h, issuer.id);
    await prisma.registeredUpstreamTrustProfile.create({ data: { integrationId: 'integration-a', expectedIssuer: String(issuer.issuer), expectedAudience: String(issuer.expectedAudience), jwksUri: String(issuer.publicJwksUri), algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null } });

    await expect(h.readiness.assertReady('integration-a')).resolves.toBeUndefined();
    expect(normalize).not.toHaveBeenCalled();
  });
});

async function createConfig(h: ReturnType<typeof harness>, providerInstanceId: unknown, integrationId = 'integration-a') {
  return h.config.createConfig({ integrationId, providerInstanceId: String(providerInstanceId), canonicalHostApp: 'admin', organizationMode: 'verified', fixedOrganizationId: null, requestId: `config-${integrationId}` });
}
async function activateKey(h: ReturnType<typeof harness>, issuerId: unknown) {
  const key = await h.key.registerKey({ ...keyInput(String(issuerId), { kid: `key-${String(issuerId)}`, keyReference: `ref-${String(issuerId)}`, publicJwk: { kty: 'RSA', n: `n-${String(issuerId)}`, e: 'AQAB' } }), requestId: 'key-register' });
  await h.key.transitionKey({ id: String(key.id), to: 'published', requestId: 'key-published' });
  return h.key.transitionKey({ id: String(key.id), to: 'active', requestId: 'key-active' });
}

function harness(prisma: ReturnType<typeof createGatewayPrismaClient>, options: { failInvalidation?: boolean } = {}) {
  const lifecycle = new ManagedExchangeLifecycleRepository(prisma);
  const audit = { append: async () => undefined };
  const invalidation = { invalidate: async () => { if (options.failInvalidation) throw new Error('invalidation unavailable'); } };
  const provider = new ProvisionManagedIdentityProviderCommand({ repository: lifecycle, audit, invalidation });
  const providerRepository = new ManagedIdentityProviderInstanceRepository(prisma);
  const configValidator = new ManagedIntegrationExchangeConfigActivationValidator({ findBinding: async (id) => prisma.integrationBinding.findUnique({ where: { integrationId: id }, select: { enabled: true } }), findProvider: async (id) => providerRepository.findById(id) });
  const configLifecycle = createManagedIntegrationConfigLifecycle({ repository: lifecycle, audit, invalidation, activationValidator: configValidator });
  const config = new ProvisionManagedIntegrationExchangeConfigCommand(configLifecycle, configValidator);
  const admission = new ProvisionManagedAdmissionPolicyCommand({ repository: lifecycle, audit, invalidation });
  const source = new ProvisionManagedPermissionSourceCommand({ repository: lifecycle, audit, invalidation });
  const adapters = { resolve: (type: string) => type === 'synthetic' ? { sourceType: 'synthetic', resolve: async () => ({ kind: 'synthetic' }) } : undefined };
  const idxNormalizer = new IdxMenuDetailPermissionNormalizer();
  const normalizers = new PermissionNormalizerRegistry([new SyntheticV1PermissionNormalizer(), idxNormalizer]);
  const policy = new ProvisionManagedPermissionPolicyCommand({ repository: lifecycle, audit, invalidation, permissionSources: new ManagedPermissionSourceInstanceRepository(prisma), permissionAdapters: adapters, permissionNormalizers: normalizers });
  const authority = new GatewaySigningAuthorityReader({ config: { config: { internalIssuer: 'https://gateway.example.test' } } as never, signingKeys: new GatewaySigningKeyRepository(prisma) });
  const issuer = new ProvisionManagedUpstreamIssuerCommand({ repository: lifecycle, audit, invalidation, gatewaySigningAuthority: authority });
  const key = new ProvisionManagedUpstreamSigningKeyCommand({ repository: lifecycle, audit, invalidation, gatewaySigningAuthority: authority });
  const readiness = createManagedExchangeReadinessValidator({ bindings: new IntegrationBindingRepository(prisma), configs: new ManagedIntegrationExchangeConfigRepository(prisma), providers: providerRepository, admissions: new ManagedIntegrationAdmissionPolicyRepository(prisma), permissionPolicies: new ManagedPermissionPolicyRepository(prisma), permissionSources: new ManagedPermissionSourceInstanceRepository(prisma), issuers: new ManagedUpstreamIssuerRepository(prisma), signingKeys: new ManagedUpstreamSigningKeyRepository(prisma), trustProfiles: new TrustProfileRepository(prisma), permissionAdapters: adapters, permissionNormalizers: normalizers });
  return { provider, config, admission, source, policy, issuer, key, readiness, idxNormalizer };
}
