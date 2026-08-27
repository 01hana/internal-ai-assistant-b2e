import { generateKeyPair, exportJWK, type JWK } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma } from '../../src/generated/prisma/client';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { CanonicalIdentityResolver } from '../../src/integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileCache } from '../../src/integration-registry/trust-profile-cache';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { ManagedUpstreamTokenIssuer } from '../../src/managed-identity-exchange/issuer/managed-upstream-token-issuer';
import { ManagedJwksService } from '../../src/managed-identity-exchange/issuer/managed-jwks.service';
import { ManagedIdentityExchangeService } from '../../src/managed-identity-exchange/exchange.service';
import { IntegrationAdmissionService } from '../../src/managed-identity-exchange/admission/integration-admission.service';
import { ManagedCanonicalizationService } from '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service';
import { createVerifiedExternalIdentity, ManagedExchangeCredentialError, ManagedExchangeInfrastructureError, type IdentityProviderAdapter, type VerifyNativeCredentialInput } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { IdxMenuDetailPermissionNormalizer } from '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { ManagedPermissionScopeProjector } from '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector';
import { ManagedPermissionService } from '../../src/managed-identity-exchange/permissions/managed-permission.service';
import { PermissionSourceAdapterRegistry } from '../../src/managed-identity-exchange/permissions/permission-source-adapter.registry';
import { IdentityProviderAdapterRegistry } from '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';
import { IdxMenuDetailValidator } from '../../src/managed-identity-exchange/providers/idx-menu-detail.validator';
import { DelegatedHttpV1Adapter } from '../../src/managed-identity-exchange/providers/delegated-http-v1.adapter';
import {
  ManagedIdentityProviderInstanceRepository,
  ManagedIntegrationAdmissionPolicyRepository,
  ManagedIntegrationExchangeConfigRepository,
  ManagedPermissionPolicyRepository,
  ManagedPermissionSourceInstanceRepository
} from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';
import { MultiProfileUpstreamTokenVerifier } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../src/upstream-auth/routing-metadata.parser';
import { UpstreamAuthTelemetry } from '../../src/upstream-auth/upstream-auth-telemetry';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const issuer = 'https://managed.example.test';
const audience = 'managed-feature004';
const jwksUri = 'https://managed.example.test/jwks';

describeRegistry('Managed JWT to unchanged Feature 004 compatibility (T041)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('managed-feature004-compatibility');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    await prisma.customer.create({ data: { id: 'customer-a' } });
    await prisma.integrationBinding.create({ data: { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true } });
  });
  afterEach(async () => { await prisma?.$disconnect(); await database?.dispose(); });

  it('verifies a production-managed RS256 token through Feature 004 and resolves binding-owned Customer authority', async () => {
    const runtime = await createCompatibilityRuntime(prisma, [profile('managed-profile-a', 'integration-a')]);
    const token = await runtime.issue();
    const verified = await runtime.verifier.verify({ authorization: `Bearer ${token}`, requestId: 'request-managed-a' });
    const resolved = await runtime.resolver.resolve({ identity: verified, requestId: 'request-managed-a' });

    expect(verified).toMatchObject({ integrationId: 'integration-a', subject: 'synthetic-subject', organizationId: 'synthetic-organization', hostApp: 'admin', roles: [], permissionScopes: ['orders:read', 'orders:update'] });
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.roles)).toBe(true);
    expect(Object.isFrozen(verified.permissionScopes)).toBe(true);
    expect(resolved).toMatchObject({ customerId: 'customer-a', integrationId: 'integration-a', subject: 'synthetic-subject', organizationId: 'synthetic-organization', hostApp: 'admin', roles: [], permissionScopes: ['orders:read', 'orders:update'] });
    expect(JSON.stringify(token)).not.toContain('customer-a');
    expect(JSON.stringify(decode(token))).not.toHaveProperty('customer_id');
    expect(await prisma.gatewayIdentityAuditEvent.findFirst({ where: { requestId: 'request-managed-a' } })).toBeTruthy();
  });

  it('keeps HostApp authority at the real IntegrationBinding', async () => {
    const runtime = await createCompatibilityRuntime(prisma, [profile('managed-profile-a', 'integration-a')]);
    const verified = await runtime.verifyIssued();
    await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { allowedHostApp: 'another-host' } });
    await expect(runtime.resolver.resolve({ identity: verified, requestId: 'request-host-mismatch' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
  });

  it.each([
    ['missing profile', []],
    ['wrong issuer', [profile('wrong-issuer', 'integration-a', { expectedIssuer: 'https://other.example.test' })]],
    ['wrong audience', [profile('wrong-audience', 'integration-a', { expectedAudience: 'wrong-audience' })]],
    ['wrong jwks key', [profile('wrong-key', 'integration-a', { jwksUri: 'https://managed.example.test/wrong-key' })]]
  ])('fails closed for %s before binding resolution', async (_label, profiles) => {
    const runtime = await createCompatibilityRuntime(prisma, profiles);
    const token = await runtime.issue();
    await expect(runtime.verifier.verify({ authorization: `Bearer ${token}`, requestId: 'request-negative' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    expect(runtime.bindingLookup).not.toHaveBeenCalled();
  });

  it('requires exactly one decision when two real profiles share managed issuer, audience, JWKS, and key', async () => {
    await prisma.customer.create({ data: { id: 'customer-b' } });
    await prisma.integrationBinding.create({ data: { integrationId: 'integration-b', customerId: 'customer-b', allowedHostApp: 'admin', enabled: true } });
    const runtime = await createCompatibilityRuntime(prisma, [profile('managed-profile-a', 'integration-a'), profile('managed-profile-b', 'integration-b')]);
    const candidates = await runtime.candidateResolver.resolve({ issuerHint: issuer });
    const verified = await runtime.verifyIssued();
    expect(candidates).toHaveLength(2);
    expect(runtime.profileVerify).toHaveBeenCalledTimes(2);
    expect(verified.integrationId).toBe('integration-a');
  });

  describe('T042 multi-integration and multi-profile isolation', () => {
    beforeEach(async () => {
      await prisma.customer.create({ data: { id: 'customer-b' } });
      await prisma.integrationBinding.create({ data: { integrationId: 'integration-b', customerId: 'customer-b', allowedHostApp: 'admin', enabled: true } });
      await seedIsolationControlPlane(prisma);
    });

    it('uses one shared provider for independent A/B exchange and binding-owned Customer resolution', async () => {
      const runtime = await createIsolationRuntime(prisma, [profile('managed-profile-a', 'integration-a'), profile('managed-profile-b', 'integration-b')]);

      const exchangedA = await runtime.exchange('selector-a', 'credential-a', 'request-isolation-a');
      const resolvedA = await runtime.resolve(exchangedA.accessToken, 'request-isolation-a');
      const exchangedB = await runtime.exchange('selector-b', 'credential-b', 'request-isolation-b');
      const resolvedB = await runtime.resolve(exchangedB.accessToken, 'request-isolation-b');

      expect(resolvedA).toMatchObject({ customerId: 'customer-a', integrationId: 'integration-a', subject: 'shared-subject', organizationId: 'shared-organization', hostApp: 'admin', roles: [], permissionScopes: [] });
      expect(resolvedB).toMatchObject({ customerId: 'customer-b', integrationId: 'integration-b', subject: 'shared-subject', organizationId: 'shared-organization', hostApp: 'admin', roles: [], permissionScopes: [] });
      expect(runtime.adapter).toHaveBeenCalledTimes(2);
      expect(runtime.adapter.mock.calls.map(([input]) => input.providerInstancePolicy)).toEqual([
        expect.objectContaining({ id: 'provider-shared', providerType: 'delegated_http' }),
        expect.objectContaining({ id: 'provider-shared', providerType: 'delegated_http' })
      ]);
      expect(runtime.readiness).toHaveBeenNthCalledWith(1, 'integration-a');
      expect(runtime.readiness).toHaveBeenNthCalledWith(2, 'integration-b');
      expect(runtime.profileVerify).toHaveBeenCalledTimes(4);
      expect(Object.isFrozen(resolvedA.permissionScopes)).toBe(true);
      expect(Object.isFrozen(resolvedB.permissionScopes)).toBe(true);
      expect(JSON.stringify([exchangedA.accessToken, exchangedB.accessToken])).not.toContain('customer-');
    });

    it.each([
      ['selector-b', 'credential-a'],
      ['selector-a', 'credential-b'],
      ['selector-a', 'credential-wrong']
    ])('rejects tenant-anchor replay %s/%s before issuing or Feature 004 use', async (selector, credential) => {
      const runtime = await createIsolationRuntime(prisma, [profile('managed-profile-a', 'integration-a'), profile('managed-profile-b', 'integration-b')]);
      await expect(runtime.exchange(selector, credential, 'request-replay')).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
      expect(runtime.issue).not.toHaveBeenCalled();
      expect(runtime.profileVerify).not.toHaveBeenCalled();
      expect(runtime.bindingLookup).not.toHaveBeenCalled();
    });

    it('rejects a global public-selector collision without changing the active selected config', async () => {
      await expect(prisma.managedIntegrationExchangeConfig.create({ data: isolationConfig('config-collision', 'selector-a', 'integration-b', 2) })).rejects.toThrow();
      const selected = await new ManagedIntegrationExchangeConfigRepository(prisma).findEnabledActiveByPublicSelector('selector-a');
      expect(selected).toMatchObject({ id: 'config-a', integrationId: 'integration-a', enabled: true, lifecycle: 'active' });
    });

    it('fails closed on duplicate same-integration trust-profile decisions before binding lookup', async () => {
      const runtime = await createIsolationRuntime(prisma, [
        profile('managed-profile-a', 'integration-a'),
        profile('managed-profile-a-duplicate', 'integration-a', {}, 2),
        profile('managed-profile-b', 'integration-b')
      ]);
      const exchanged = await runtime.exchange('selector-a', 'credential-a', 'request-profile-ambiguity');
      const candidates = await runtime.candidateResolver.resolve({ issuerHint: issuer });
      await expect(runtime.verifier.verify({ authorization: `Bearer ${exchanged.accessToken}`, requestId: 'request-profile-ambiguity' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
      expect(candidates).toHaveLength(3);
      expect(runtime.bindingLookup).not.toHaveBeenCalled();
    });

    it('ignores hostile Customer hints and keeps Customer authority solely at the binding', async () => {
      const runtime = await createIsolationRuntime(prisma, [profile('managed-profile-a', 'integration-a'), profile('managed-profile-b', 'integration-b')]);
      const exchanged = await runtime.exchange('selector-a', 'credential-a', 'request-hints');
      const verified = await runtime.verifier.verify({ authorization: `Bearer ${exchanged.accessToken}`, requestId: 'request-hints' });
      const hostile = Object.assign(Object.create(verified), {
        customerId: 'customer-b', requestedCustomerId: 'customer-b', 'x-customer-id': 'customer-b', body: { customer_id: 'customer-b' }
      });
      await expect(runtime.resolver.resolve({ identity: hostile, requestId: 'request-hints' })).resolves.toMatchObject({ customerId: 'customer-a', integrationId: 'integration-a' });
      expect(JSON.stringify(decode(exchanged.accessToken))).not.toContain('customer-');
      const rows = await prisma.registeredUpstreamTrustProfile.findMany();
      expect(JSON.stringify(rows)).not.toContain('customer-');
    });

    it('denies a host mismatch and disabled binding A while leaving B independently usable', async () => {
      const runtime = await createIsolationRuntime(prisma, [profile('managed-profile-a', 'integration-a'), profile('managed-profile-b', 'integration-b')]);
      const tokenA = (await runtime.exchange('selector-a', 'credential-a', 'request-host')).accessToken;
      const identityA = await runtime.verifier.verify({ authorization: `Bearer ${tokenA}`, requestId: 'request-host' });
      await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { allowedHostApp: 'another-host' } });
      await expect(runtime.resolver.resolve({ identity: identityA, requestId: 'request-host' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
      await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { enabled: false, allowedHostApp: 'admin' } });
      const tokenDisabledA = (await runtime.exchange('selector-a', 'credential-a', 'request-disabled-a')).accessToken;
      const identityDisabledA = await runtime.verifier.verify({ authorization: `Bearer ${tokenDisabledA}`, requestId: 'request-disabled-a' });
      await expect(runtime.resolver.resolve({ identity: identityDisabledA, requestId: 'request-disabled-a' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
      const tokenB = (await runtime.exchange('selector-b', 'credential-b', 'request-disabled-b')).accessToken;
      await expect(runtime.resolve(tokenB, 'request-disabled-b')).resolves.toMatchObject({ customerId: 'customer-b', integrationId: 'integration-b' });
    });

    it('contains no fixture-specific integration or Customer branches in production authority sources', () => {
      const files = [
        '../../src/managed-identity-exchange/exchange.service.ts', '../../src/managed-identity-exchange/admission/integration-admission.service.ts',
        '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service.ts', '../../src/upstream-auth/multi-profile-upstream-token-verifier.ts',
        '../../src/integration-registry/canonical-identity-resolver.service.ts'
      ];
      const source = files.map((file) => readFileSync(resolve(__dirname, file), 'utf8')).join('\n');
      expect(source).not.toMatch(/integration-a(?![a-z])|integration-b(?![a-z])|customer-a(?![a-z])|customer-b(?![a-z])|selector-a(?![a-z])|selector-b(?![a-z])/i);
      expect(source).not.toMatch(/(?:case\s+|(?:integrationId|customerId)\s*={2,3}\s*['"])(?:integration-|customer-)/i);
    });
  });

  it('keeps Feature 004 unaware of managed exchange sources and does not bypass verification', () => {
    const files = [
      '../../src/upstream-auth/multi-profile-upstream-token-verifier.ts', '../../src/upstream-auth/profile-scoped-verifier.ts',
      '../../src/upstream-auth/routing-metadata.parser.ts', '../../src/integration-registry/candidate-trust-profile.resolver.ts',
      '../../src/integration-registry/canonical-identity-resolver.service.ts', '../../src/integration-registry/integration-binding.repository.ts'
    ];
    const source = files.map((file) => readFileSync(resolve(__dirname, file), 'utf8')).join('\n');
    expect(source).not.toMatch(/managed-identity-exchange|ManagedIdentityExchange|ManagedUpstreamTokenIssuer|ManagedJwksService|publicSelector|providerInstanceId/i);
  });
});

type IdxReuseSide = Readonly<{
  name: 'a' | 'b'; provider: Readonly<Record<string, unknown>>; config: Readonly<Record<string, unknown>>;
  admission: Readonly<Record<string, unknown>>; permission: Readonly<Record<string, unknown>>;
  credential: string; claims: Readonly<Record<string, unknown>>; menuDetail: Readonly<Record<string, unknown>>;
  expectedScopes: readonly string[];
}>;
type IdxReuseFixture = Readonly<{ a: IdxReuseSide; b: IdxReuseSide }>;

describeRegistry('Feature 006 two-integration IDX capability reuse (T036-T037)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let fixture: IdxReuseFixture;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('feature006-idx-reuse');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    fixture = loadIdxReuseFixture();
    await seedIdxReuseControlPlane(prisma, fixture);
  });
  afterEach(async () => { await prisma?.$disconnect(); await database?.dispose(); });

  it('persists two independent IDX provider/config/admission/permission chains', async () => {
    const providers = await prisma.managedIdentityProviderInstance.findMany({ orderBy: { id: 'asc' } });
    const configs = await prisma.managedIntegrationExchangeConfig.findMany({ orderBy: { id: 'asc' } });
    const admissions = await prisma.managedIntegrationAdmissionPolicy.findMany({ orderBy: { id: 'asc' } });
    const permissions = await prisma.managedPermissionPolicy.findMany({ orderBy: { id: 'asc' } });

    expect(providers).toHaveLength(2);
    expect(providers[0]).toMatchObject(fixture.a.provider);
    expect(providers[1]).toMatchObject(fixture.b.provider);
    expect(providers[0].id).not.toBe(providers[1].id);
    expect(providers[0].endpointUri).not.toBe(providers[1].endpointUri);
    expect(providers.map((provider) => provider.providerType)).toEqual(['idx_delegated', 'idx_delegated']);
    expect(configs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.a.config.id, publicSelector: fixture.a.config.publicSelector, providerInstanceId: fixture.a.provider.id }),
      expect.objectContaining({ id: fixture.b.config.id, publicSelector: fixture.b.config.publicSelector, providerInstanceId: fixture.b.provider.id })
    ]));
    expect(admissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ integrationConfigId: fixture.a.config.id, anchorRequirements: fixture.a.admission.anchorRequirements }),
      expect.objectContaining({ integrationConfigId: fixture.b.config.id, anchorRequirements: fixture.b.admission.anchorRequirements })
    ]));
    expect(permissions).toEqual(expect.arrayContaining([
      expect.objectContaining({ integrationConfigId: fixture.a.config.id, mode: 'provider_trusted', permissionSourceInstanceId: null }),
      expect.objectContaining({ integrationConfigId: fixture.b.config.id, mode: 'provider_trusted', permissionSourceInstanceId: null })
    ]));
    expect(await prisma.managedPermissionSourceInstance.count()).toBe(0);
  });

  it('uses the same real IDX adapter capability while keeping A and B endpoints, identities, and permissions isolated', async () => {
    const runtime = await createIdxReuseRuntime(prisma, fixture);
    const exchangedA = await runtime.exchange(fixture.a);
    const exchangedB = await runtime.exchange(fixture.b);
    const decodedA = decode(exchangedA.accessToken);
    const decodedB = decode(exchangedB.accessToken);

    expect(decodedA).toMatchObject({ integration_id: fixture.a.config.integrationId, sub: fixture.a.claims.sub, org_id: fixture.a.claims.UUID_Company, roles: [], permission_scopes: fixture.a.expectedScopes });
    expect(decodedB).toMatchObject({ integration_id: fixture.b.config.integrationId, sub: fixture.b.claims.sub, org_id: fixture.b.claims.UUID_Company, roles: [], permission_scopes: fixture.b.expectedScopes });
    expect(JSON.stringify(decodedA)).not.toContain('FIXTURE_INVENTORY');
    expect(JSON.stringify(decodedB)).not.toContain('FIXTURE_ORDERS');
    expect(JSON.stringify([decodedA, decodedB])).not.toMatch(/customer_id|customerId/i);

    expect(runtime.transport).toHaveBeenNthCalledWith(1, expect.objectContaining({ nativeCredential: fixture.a.credential, providerInstancePolicy: expect.objectContaining({ id: fixture.a.provider.id, endpointUri: fixture.a.provider.endpointUri }) }));
    expect(runtime.transport).toHaveBeenNthCalledWith(2, expect.objectContaining({ nativeCredential: fixture.b.credential, providerInstancePolicy: expect.objectContaining({ id: fixture.b.provider.id, endpointUri: fixture.b.provider.endpointUri }) }));
    expect(runtime.readiness).toHaveBeenNthCalledWith(1, fixture.a.config.integrationId);
    expect(runtime.readiness).toHaveBeenNthCalledWith(2, fixture.b.config.integrationId);
    expect(runtime.registryResolve).toHaveBeenNthCalledWith(1, 'idx_delegated');
    expect(runtime.registryResolve).toHaveBeenNthCalledWith(2, 'idx_delegated');
    expect(runtime.registryResolve.mock.results.map((result) => result.value)).toEqual([runtime.idxAdapter, runtime.idxAdapter]);

    const identities = runtime.admit.mock.calls.map(([input]) => input.identity);
    expect(identities[0]).toEqual({ subject: fixture.a.claims.sub, organization: fixture.a.claims.UUID_Company, anchors: [{ kind: 'idx_entry', value: fixture.a.claims.UUID_Entry }], trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'FIXTURE_ORDERS', actions: ['read', 'update'] }] } });
    expect(identities[1]).toEqual({ subject: fixture.b.claims.sub, organization: fixture.b.claims.UUID_Company, anchors: [{ kind: 'idx_entry', value: fixture.b.claims.UUID_Entry }], trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'FIXTURE_INVENTORY', actions: ['read', 'export'] }] } });
    expect(runtime.permissionSourceLookup).not.toHaveBeenCalled();
    expect(runtime.permissionSourceExecute).not.toHaveBeenCalled();
    expect(runtime.issue).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['A credential through selector B', 'a', 'b'],
    ['B credential through selector A', 'b', 'a']
  ] as const)('denies %s after the selected endpoint accepts the unchanged credential', async (_label, credentialSide, selectorSide) => {
    const runtime = await createIdxReuseRuntime(prisma, fixture);
    const credential = fixture[credentialSide];
    const selected = fixture[selectorSide];
    await expect(runtime.service.exchange({ integrationSelector: selected.config.publicSelector as string, nativeCredential: credential.credential, requestId: `request-replay-${credentialSide}-${selectorSide}` })).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
    expect(runtime.transport).toHaveBeenCalledTimes(1);
    expect(runtime.transport).toHaveBeenCalledWith(expect.objectContaining({ nativeCredential: credential.credential, providerInstancePolicy: expect.objectContaining({ id: selected.provider.id, endpointUri: selected.provider.endpointUri }) }));
    expect(runtime.admit).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ subject: credential.claims.sub, organization: credential.claims.UUID_Company, anchors: [{ kind: 'idx_entry', value: credential.claims.UUID_Entry }] }), integrationConfigId: selected.config.id }));
    expect(runtime.permissions).not.toHaveBeenCalled();
    expect(runtime.canonicalize).not.toHaveBeenCalled();
    expect(runtime.issue).not.toHaveBeenCalled();
  });

  it('keeps fixtures synthetic and production authority sources free of fixture or Customer branches', () => {
    const fixtureSource = readFileSync(resolve(__dirname, 'fixtures/production-idx-two-integration.fixture.ts'), 'utf8');
    expect(fixtureSource).not.toMatch(/password|username|RefreshToken|AccessToken|Bearer\s+[A-Za-z0-9._-]+|\.com\b|\.net\b|\.org\b/i);
    expect(JSON.stringify(fixture)).not.toMatch(/customerId|customer_id|RefreshToken|password|username/i);
    for (const side of [fixture.a, fixture.b]) {
      expect(new URL(side.provider.endpointUri as string).hostname).toMatch(/\.example\.test$/);
      expect([side.provider.id, side.config.id, side.config.integrationId, side.config.publicSelector, side.claims.sub, side.claims.UUID_Company, side.claims.UUID_Entry].every((value) => typeof value === 'string' && value.startsWith('fixture-'))).toBe(true);
    }
    const production = [
      '../../src/managed-identity-exchange/exchange.service.ts', '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter.ts',
      '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry.ts', '../../src/managed-identity-exchange/admission/integration-admission.service.ts',
      '../../src/managed-identity-exchange/permissions/managed-permission.service.ts', '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer.ts',
      '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service.ts'
    ].map((file) => readFileSync(resolve(__dirname, file), 'utf8')).join('\n');
    expect(production).not.toMatch(/fixture-provider-idx-|fixture-integration-idx-|fixture-selector-|fixture-entry-|idx-[ab]\.example\.test/i);
    expect(production).not.toMatch(/(?:if|switch)\s*\([^)]*(?:customerId|customer)|(?:integrationId|customerId)\s*={2,3}\s*['"][^'"]+/i);
  });
});

describeRegistry('Feature 006 IDX managed JWT through unchanged Feature 004 (T038-T039)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let fixture: IdxReuseFixture;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('idx-feature004-session-bootstrap');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    fixture = loadIdxReuseFixture();
    await seedIdxFeature004ControlPlane(prisma, fixture.a);
  });
  afterEach(async () => { await prisma?.$disconnect(); await database?.dispose(); });

  it('exchanges the native IDX credential, verifies its managed RS256 JWT, and resolves binding-owned Customer authority', async () => {
    const runtime = await createIdxFeature004Runtime(prisma, fixture.a, [profile('fixture-idx-profile-a', fixture.a.config.integrationId as string)]);
    const exchanged = await runtime.exchange('fixture-idx-feature004-success');
    const managed = decode(exchanged.accessToken);
    const verified = await runtime.verifier.verify({ authorization: `Bearer ${exchanged.accessToken}`, requestId: 'fixture-idx-feature004-success' });
    const resolved = await runtime.resolver.resolve({ identity: verified, requestId: 'fixture-idx-feature004-success' });

    expect(managed).toMatchObject({ integration_id: fixture.a.config.integrationId, sub: fixture.a.claims.sub, org_id: fixture.a.claims.UUID_Company, host_app: 'fixture-assistant', roles: [], permission_scopes: fixture.a.expectedScopes });
    expect(managed).not.toHaveProperty('customer_id');
    expect(JSON.stringify(managed)).not.toMatch(/UUID_|idx_entry|trustedPermissionMaterial|fixture-entry-a|customer/i);
    expect(verified).toMatchObject({ integrationId: fixture.a.config.integrationId, subject: fixture.a.claims.sub, organizationId: fixture.a.claims.UUID_Company, hostApp: 'fixture-assistant', roles: [], permissionScopes: fixture.a.expectedScopes });
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.roles)).toBe(true);
    expect(Object.isFrozen(verified.permissionScopes)).toBe(true);
    expect(resolved).toMatchObject({ customerId: 'fixture-session-customer-a', integrationId: fixture.a.config.integrationId, subject: fixture.a.claims.sub, organizationId: fixture.a.claims.UUID_Company, hostApp: 'fixture-assistant', roles: [], permissionScopes: fixture.a.expectedScopes });
    expect(runtime.transport).toHaveBeenCalledTimes(1);
    expect(runtime.permissionSourceLookup).not.toHaveBeenCalled();
    expect(runtime.permissionSourceExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['zero compatible profiles', []],
    ['two compatible profiles', [profile('fixture-idx-profile-a', 'fixture-integration-idx-a'), profile('fixture-idx-profile-a-duplicate', 'fixture-integration-idx-a', {}, 2)]]
  ])('fails closed with %s before binding resolution', async (_label, profiles) => {
    const runtime = await createIdxFeature004Runtime(prisma, fixture.a, profiles);
    const exchanged = await runtime.exchange('fixture-idx-feature004-profile-negative');
    await expect(runtime.verifier.verify({ authorization: `Bearer ${exchanged.accessToken}`, requestId: 'fixture-idx-feature004-profile-negative' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    expect(runtime.bindingLookup).not.toHaveBeenCalled();
  });

  it('allows an unrelated compatible profile to coexist while retaining the selected IDX integration decision', async () => {
    await prisma.customer.create({ data: { id: 'fixture-unrelated-customer' } });
    await prisma.integrationBinding.create({ data: {
      integrationId: 'fixture-unrelated-integration', customerId: 'fixture-unrelated-customer',
      allowedHostApp: 'fixture-assistant', enabled: true
    } });
    const runtime = await createIdxFeature004Runtime(prisma, fixture.a, [
      profile('fixture-idx-profile-a', fixture.a.config.integrationId as string),
      profile('fixture-idx-profile-unrelated', 'fixture-unrelated-integration')
    ]);
    const exchanged = await runtime.exchange('fixture-idx-feature004-unrelated');
    await expect(runtime.resolver.resolve({ identity: await runtime.verifier.verify({ authorization: `Bearer ${exchanged.accessToken}`, requestId: 'fixture-idx-feature004-unrelated' }), requestId: 'fixture-idx-feature004-unrelated' })).resolves.toMatchObject({ customerId: 'fixture-session-customer-a', integrationId: fixture.a.config.integrationId });
  });

  it('keeps HostApp and enabled binding authority unchanged, and never accepts the native IDX credential as Feature 004 input', async () => {
    const runtime = await createIdxFeature004Runtime(prisma, fixture.a, [profile('fixture-idx-profile-a', fixture.a.config.integrationId as string)]);
    const exchanged = await runtime.exchange('fixture-idx-feature004-binding');
    const verified = await runtime.verifier.verify({ authorization: `Bearer ${exchanged.accessToken}`, requestId: 'fixture-idx-feature004-binding' });
    await expect(runtime.verifier.verify({ authorization: `Bearer ${fixture.a.credential}`, requestId: 'fixture-idx-native-rejected' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    await prisma.integrationBinding.update({ where: { integrationId: fixture.a.config.integrationId as string }, data: { allowedHostApp: 'wrong-host' } });
    await expect(runtime.resolver.resolve({ identity: verified, requestId: 'fixture-idx-host-mismatch' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
    await prisma.integrationBinding.update({ where: { integrationId: fixture.a.config.integrationId as string }, data: { allowedHostApp: 'fixture-assistant', enabled: false } });
    await expect(runtime.resolver.resolve({ identity: verified, requestId: 'fixture-idx-binding-disabled' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
  });

  it('keeps managed exchange limited to its established authority boundary', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/exchange.service.ts'), 'utf8');
    expect(source).toMatch(/ManagedExchangeInput = Readonly<\{ integrationSelector: string; nativeCredential: string; requestId: string \}>/);
    expect(source).not.toMatch(/sessionId|GatewayBackendClient|Feature 004|IntegrationBinding|customerId|customer_id/i);
  });
});

async function createCompatibilityRuntime(prisma: ReturnType<typeof createGatewayPrismaClient>, profiles: readonly ReturnType<typeof profile>[]) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'managed-kid', alg: 'RS256', use: 'sig' } as JWK;
  const wrong = await generateKeyPair('RS256');
  const wrongJwk = { ...(await exportJWK(wrong.publicKey)), kid: 'wrong-kid', alg: 'RS256', use: 'sig' } as JWK;
  await prisma.registeredUpstreamTrustProfile.createMany({ data: [...profiles] as never });
  const managedJwks = new ManagedJwksService({
    issuers: { findEnabledActive: async () => [{ id: 'managed-issuer', issuer, expectedAudience: audience, enabled: true, lifecycle: 'active' }] as never },
    signingKeys: { findJwksVisibleByIssuerId: async () => [{ issuerId: 'managed-issuer', kid: 'managed-kid', publicJwk, status: 'active' }] as never }
  });
  const transport: JwksTransport = { fetch: async (uri) => uri.endsWith('/wrong-key') ? { keys: [wrongJwk] } : await managedJwks.getDocument() as never };
  const profilesRepository = new TrustProfileRepository(prisma);
  const candidateResolver = new CandidateTrustProfileResolver(new TrustProfileCache({ repository: profilesRepository, ttlMilliseconds: 0 }));
  const scoped = new ProfileScopedVerifier({ transport });
  const profileVerify = jest.spyOn(scoped, 'verify');
  const audit = new GatewayIdentityAuditWriter(prisma);
  const verifier = new MultiProfileUpstreamTokenVerifier({ parser: new RoutingMetadataParser(), candidateResolver, profileVerifier: scoped, telemetry: new UpstreamAuthTelemetry(audit), clockToleranceSeconds: 0 });
  const bindings = new IntegrationBindingRepository(prisma);
  const bindingLookup = jest.spyOn(bindings, 'findByIntegrationId');
  const resolver = new CanonicalIdentityResolver(bindings, audit);
  const tokenIssuer = new ManagedUpstreamTokenIssuer({ findActive: async () => Object.freeze({ issuer, audience, kid: 'managed-kid', privateKey }) });
  const issue = async () => (await tokenIssuer.issue(Object.freeze({ integrationId: 'integration-a', subject: 'synthetic-subject', organizationId: 'synthetic-organization', hostApp: 'admin', roles: [] as [], permissionScopes: Object.freeze(['orders:read', 'orders:update']) }))).accessToken;
  return Object.freeze({ verifier, resolver, candidateResolver, profileVerify, bindingLookup, issue, verifyIssued: async () => verifier.verify({ authorization: `Bearer ${await issue()}`, requestId: 'request-managed-a' }) });
}

function profile(id: string, integrationId: string, overrides: Partial<{ expectedIssuer: string; expectedAudience: string; jwksUri: string }> = {}, version = 1) {
  return { id, integrationId, expectedIssuer: issuer, expectedAudience: audience, jwksUri, algorithm: 'RS256', enabled: true, lifecycle: 'active', version, replacesProfileId: null, ...overrides };
}

function decode(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function seedIsolationControlPlane(prisma: ReturnType<typeof createGatewayPrismaClient>): Promise<void> {
  await prisma.managedIdentityProviderInstance.create({ data: {
    id: 'provider-shared', providerType: 'delegated_http' as const, endpointUri: 'https://provider.example.test/verify',
    httpMethod: 'POST' as const, credentialPlacement: 'authorization_bearer' as const, timeoutMilliseconds: 1000,
    responseContractVersion: 'delegated-http/v1', contractConfig: { responseSchema: 'delegated-http/v1' },
    declaredAnchorKinds: ['tenant'], enabled: true, lifecycle: 'active' as const, version: 1, replacesProviderId: null
  } });
  await prisma.managedIntegrationExchangeConfig.createMany({ data: [
    isolationConfig('config-a', 'selector-a', 'integration-a', 1),
    isolationConfig('config-b', 'selector-b', 'integration-b', 1)
  ] });
  await prisma.managedIntegrationAdmissionPolicy.createMany({ data: [
    { id: 'admission-a', integrationConfigId: 'config-a', anchorRequirements: [{ kind: 'tenant', allowedValues: ['tenant-a'] }], enabled: true, lifecycle: 'active', version: 1, replacesPolicyId: null },
    { id: 'admission-b', integrationConfigId: 'config-b', anchorRequirements: [{ kind: 'tenant', allowedValues: ['tenant-b'] }], enabled: true, lifecycle: 'active', version: 1, replacesPolicyId: null }
  ] });
  await prisma.managedPermissionPolicy.createMany({ data: [
    noSourcePolicy('permission-a', 'config-a'), noSourcePolicy('permission-b', 'config-b')
  ] });
}

function isolationConfig(id: string, publicSelector: string, integrationId: string, version: number) {
  return {
    id, publicSelector, integrationId, providerInstanceId: 'provider-shared', canonicalHostApp: 'admin',
    organizationMode: 'verified' as const, fixedOrganizationId: null, enabled: true, lifecycle: 'active' as const, version, replacesConfigId: null
  };
}

function noSourcePolicy(id: string, integrationConfigId: string) {
  return {
    id, integrationConfigId, mode: 'allow_empty' as const, permissionSourceInstanceId: null, normalizerType: null,
    projectionContractVersion: null, projectionContract: Prisma.JsonNull, enabled: true, lifecycle: 'active' as const, version: 1, replacesPolicyId: null
  };
}

async function createIsolationRuntime(prisma: ReturnType<typeof createGatewayPrismaClient>, profiles: readonly ReturnType<typeof profile>[]) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'managed-kid', alg: 'RS256', use: 'sig' } as JWK;
  await prisma.registeredUpstreamTrustProfile.createMany({ data: [...profiles] as never });
  const managedJwks = new ManagedJwksService({
    issuers: { findEnabledActive: async () => [{ id: 'managed-issuer', issuer, expectedAudience: audience, enabled: true, lifecycle: 'active' }] as never },
    signingKeys: { findJwksVisibleByIssuerId: async () => [{ issuerId: 'managed-issuer', kid: 'managed-kid', publicJwk, status: 'active' }] as never }
  });
  const transport: JwksTransport = { fetch: async () => await managedJwks.getDocument() as never };
  const profilesRepository = new TrustProfileRepository(prisma);
  const candidateResolver = new CandidateTrustProfileResolver(new TrustProfileCache({ repository: profilesRepository, ttlMilliseconds: 0 }));
  const scoped = new ProfileScopedVerifier({ transport });
  const profileVerify = jest.spyOn(scoped, 'verify');
  const gatewayAudit = new GatewayIdentityAuditWriter(prisma);
  const verifier = new MultiProfileUpstreamTokenVerifier({ parser: new RoutingMetadataParser(), candidateResolver, profileVerifier: scoped, telemetry: new UpstreamAuthTelemetry(gatewayAudit), clockToleranceSeconds: 0 });
  const bindings = new IntegrationBindingRepository(prisma);
  const bindingLookup = jest.spyOn(bindings, 'findByIntegrationId');
  const resolver = new CanonicalIdentityResolver(bindings, gatewayAudit);

  const adapter = jest.fn(async (input: VerifyNativeCredentialInput) => {
    const tenant = input.nativeCredential === 'credential-a' ? 'tenant-a'
      : input.nativeCredential === 'credential-b' ? 'tenant-b'
        : input.nativeCredential === 'credential-wrong' ? 'tenant-wrong' : null;
    if (!tenant) throw new ManagedExchangeCredentialError();
    return createVerifiedExternalIdentity({ subject: 'shared-subject', organization: 'shared-organization', anchors: [{ kind: 'tenant', value: tenant }] });
  });
  const providerAdapter: IdentityProviderAdapter = Object.freeze({ providerType: 'delegated_http', verify: adapter });
  const providerAdapters = new IdentityProviderAdapterRegistry(
    providerAdapter as unknown as DelegatedHttpV1Adapter,
    new IdxDelegatedVerificationAdapter()
  );
  const configs = new ManagedIntegrationExchangeConfigRepository(prisma);
  const providers = new ManagedIdentityProviderInstanceRepository(prisma);
  const admissions = new ManagedIntegrationAdmissionPolicyRepository(prisma);
  const permissionPolicies = new ManagedPermissionPolicyRepository(prisma);
  const readiness = jest.fn(async (_integrationId: string) => undefined);
  const tokenIssuer = new ManagedUpstreamTokenIssuer({ findActive: async () => Object.freeze({ issuer, audience, kid: 'managed-kid', privateKey }) });
  const issue = jest.spyOn(tokenIssuer, 'issue');
  const service = new ManagedIdentityExchangeService({
    configs, providers, readiness: { assertReady: readiness }, providerAdapters,
    admission: new IntegrationAdmissionService(admissions), permissionPolicies,
    permissions: new ManagedPermissionService({
      permissionSources: new ManagedPermissionSourceInstanceRepository(prisma), permissionAdapters: new PermissionSourceAdapterRegistry([]),
      permissionNormalizers: new PermissionNormalizerRegistry([]), projector: new ManagedPermissionScopeProjector()
    }),
    canonicalizer: new ManagedCanonicalizationService(configs), issuer: tokenIssuer,
    audit: { append: async () => undefined }
  });
  return Object.freeze({
    service, adapter, readiness, issue, verifier, resolver, candidateResolver, profileVerify, bindingLookup,
    exchange: (integrationSelector: string, nativeCredential: string, requestId: string) => service.exchange({ integrationSelector, nativeCredential, requestId }),
    resolve: async (token: string, requestId: string) => resolver.resolve({ identity: await verifier.verify({ authorization: `Bearer ${token}`, requestId }), requestId })
  });
}

function loadIdxReuseFixture(): IdxReuseFixture {
  const target = require('./fixtures/production-idx-two-integration.fixture') as { createProductionIdxTwoIntegrationFixture(): IdxReuseFixture };
  return target.createProductionIdxTwoIntegrationFixture();
}

async function seedIdxReuseControlPlane(prisma: ReturnType<typeof createGatewayPrismaClient>, fixture: IdxReuseFixture): Promise<void> {
  await prisma.customer.create({ data: { id: 'fixture-phase15-db-prerequisite' } });
  await prisma.integrationBinding.createMany({ data: [fixture.a, fixture.b].map((side) => ({
    integrationId: side.config.integrationId as string, customerId: 'fixture-phase15-db-prerequisite',
    allowedHostApp: side.config.canonicalHostApp as string, enabled: true
  })) });
  for (const side of [fixture.a, fixture.b]) {
    await prisma.managedIdentityProviderInstance.create({ data: side.provider as never });
    await prisma.managedIntegrationExchangeConfig.create({ data: side.config as never });
    await prisma.managedIntegrationAdmissionPolicy.create({ data: side.admission as never });
    await prisma.managedPermissionPolicy.create({ data: side.permission as never });
  }
}

async function createIdxReuseRuntime(prisma: ReturnType<typeof createGatewayPrismaClient>, fixture: IdxReuseFixture) {
  const { privateKey } = await generateKeyPair('RS256');
  const responseByEndpoint = new Map([
    [fixture.a.provider.endpointUri, fixture.a.menuDetail],
    [fixture.b.provider.endpointUri, fixture.b.menuDetail]
  ]);
  const transport = jest.fn(async (input: VerifyNativeCredentialInput) => {
    const body = responseByEndpoint.get(input.providerInstancePolicy.endpointUri);
    if (!body) throw new ManagedExchangeInfrastructureError();
    return Object.freeze({ status: 200 as const, contentType: 'application/json' as const, body });
  });
  const idxAdapter = new IdxDelegatedVerificationAdapter({ execute: transport }, new IdxMenuDetailValidator());
  const delegated = new DelegatedHttpV1Adapter({ execute: async () => { throw new ManagedExchangeInfrastructureError(); } });
  const providerAdapters = new IdentityProviderAdapterRegistry(delegated, idxAdapter);
  const registryResolve = jest.spyOn(providerAdapters, 'resolve');
  const configs = new ManagedIntegrationExchangeConfigRepository(prisma);
  const providers = new ManagedIdentityProviderInstanceRepository(prisma);
  const admissionService = new IntegrationAdmissionService(new ManagedIntegrationAdmissionPolicyRepository(prisma));
  const admit = jest.spyOn(admissionService, 'admit');
  const permissionSources = new ManagedPermissionSourceInstanceRepository(prisma);
  const permissionSourceLookup = jest.spyOn(permissionSources, 'findEnabledActiveById');
  const permissionAdapters = new PermissionSourceAdapterRegistry([]);
  const permissionSourceExecute = jest.spyOn(permissionAdapters, 'execute');
  const permissionService = new ManagedPermissionService({
    permissionSources, permissionAdapters,
    permissionNormalizers: new PermissionNormalizerRegistry([new IdxMenuDetailPermissionNormalizer()]),
    projector: new ManagedPermissionScopeProjector()
  });
  const permissions = jest.spyOn(permissionService, 'resolve');
  const canonicalizer = new ManagedCanonicalizationService(configs);
  const canonicalize = jest.spyOn(canonicalizer, 'canonicalize');
  const tokenIssuer = new ManagedUpstreamTokenIssuer({ findActive: async () => Object.freeze({ issuer, audience, kid: 'fixture-managed-kid', privateKey }) });
  const issue = jest.spyOn(tokenIssuer, 'issue');
  const readiness = jest.fn(async (_integrationId: string) => undefined);
  const service = new ManagedIdentityExchangeService({
    configs, providers, readiness: { assertReady: readiness }, providerAdapters, admission: admissionService,
    permissionPolicies: new ManagedPermissionPolicyRepository(prisma), permissions: permissionService,
    canonicalizer, issuer: tokenIssuer, audit: { append: async () => undefined }
  });
  return Object.freeze({
    service, idxAdapter, transport, registryResolve, readiness, admit, permissions, canonicalize, issue,
    permissionSourceLookup, permissionSourceExecute,
    exchange: (side: IdxReuseSide) => service.exchange({ integrationSelector: side.config.publicSelector as string, nativeCredential: side.credential, requestId: `request-idx-${side.name}` })
  });
}

async function seedIdxFeature004ControlPlane(prisma: ReturnType<typeof createGatewayPrismaClient>, side: IdxReuseSide): Promise<void> {
  await prisma.customer.create({ data: { id: 'fixture-session-customer-a' } });
  await prisma.integrationBinding.create({ data: {
    integrationId: side.config.integrationId as string, customerId: 'fixture-session-customer-a',
    allowedHostApp: 'fixture-assistant', enabled: true
  } });
  await prisma.managedIdentityProviderInstance.create({ data: side.provider as never });
  await prisma.managedIntegrationExchangeConfig.create({ data: side.config as never });
  await prisma.managedIntegrationAdmissionPolicy.create({ data: side.admission as never });
  await prisma.managedPermissionPolicy.create({ data: side.permission as never });
}

async function createIdxFeature004Runtime(prisma: ReturnType<typeof createGatewayPrismaClient>, side: IdxReuseSide, profiles: readonly ReturnType<typeof profile>[]) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'managed-kid', alg: 'RS256', use: 'sig' } as JWK;
  await prisma.registeredUpstreamTrustProfile.createMany({ data: [...profiles] as never });
  const managedJwks = new ManagedJwksService({
    issuers: { findEnabledActive: async () => [{ id: 'fixture-idx-managed-issuer', issuer, expectedAudience: audience, enabled: true, lifecycle: 'active' }] as never },
    signingKeys: { findJwksVisibleByIssuerId: async () => [{ issuerId: 'fixture-idx-managed-issuer', kid: 'managed-kid', publicJwk, status: 'active' }] as never }
  });
  const profilesRepository = new TrustProfileRepository(prisma);
  const candidateResolver = new CandidateTrustProfileResolver(new TrustProfileCache({ repository: profilesRepository, ttlMilliseconds: 0 }));
  const verifier = new MultiProfileUpstreamTokenVerifier({
    parser: new RoutingMetadataParser(), candidateResolver,
    profileVerifier: new ProfileScopedVerifier({ transport: { fetch: async () => await managedJwks.getDocument() as never } }),
    telemetry: new UpstreamAuthTelemetry(new GatewayIdentityAuditWriter(prisma)), clockToleranceSeconds: 0
  });
  const bindings = new IntegrationBindingRepository(prisma);
  const bindingLookup = jest.spyOn(bindings, 'findByIntegrationId');
  const resolver = new CanonicalIdentityResolver(bindings, new GatewayIdentityAuditWriter(prisma));
  const transport = jest.fn(async (input: VerifyNativeCredentialInput) => {
    if (input.providerInstancePolicy.endpointUri !== side.provider.endpointUri) throw new ManagedExchangeInfrastructureError();
    return Object.freeze({ status: 200 as const, contentType: 'application/json' as const, body: side.menuDetail });
  });
  const idxAdapter = new IdxDelegatedVerificationAdapter({ execute: transport }, new IdxMenuDetailValidator());
  const permissionSources = new ManagedPermissionSourceInstanceRepository(prisma);
  const permissionSourceLookup = jest.spyOn(permissionSources, 'findEnabledActiveById');
  const permissionAdapters = new PermissionSourceAdapterRegistry([]);
  const permissionSourceExecute = jest.spyOn(permissionAdapters, 'execute');
  const configs = new ManagedIntegrationExchangeConfigRepository(prisma);
  const tokenIssuer = new ManagedUpstreamTokenIssuer({ findActive: async () => Object.freeze({ issuer, audience, kid: 'managed-kid', privateKey }) });
  const service = new ManagedIdentityExchangeService({
    configs, providers: new ManagedIdentityProviderInstanceRepository(prisma), readiness: { assertReady: async () => undefined },
    providerAdapters: new IdentityProviderAdapterRegistry(new DelegatedHttpV1Adapter({ execute: async () => { throw new ManagedExchangeInfrastructureError(); } }), idxAdapter),
    admission: new IntegrationAdmissionService(new ManagedIntegrationAdmissionPolicyRepository(prisma)),
    permissionPolicies: new ManagedPermissionPolicyRepository(prisma),
    permissions: new ManagedPermissionService({ permissionSources, permissionAdapters, permissionNormalizers: new PermissionNormalizerRegistry([new IdxMenuDetailPermissionNormalizer()]), projector: new ManagedPermissionScopeProjector() }),
    canonicalizer: new ManagedCanonicalizationService(configs), issuer: tokenIssuer, audit: { append: async () => undefined }
  });
  return Object.freeze({
    service, verifier, resolver, bindingLookup, transport, permissionSourceLookup, permissionSourceExecute,
    exchange: (requestId: string) => service.exchange({ integrationSelector: side.config.publicSelector as string, nativeCredential: side.credential, requestId })
  });
}
