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
import { createVerifiedExternalIdentity, ManagedExchangeCredentialError, type IdentityProviderAdapter, type VerifyNativeCredentialInput } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { ManagedPermissionScopeProjector } from '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector';
import { ManagedPermissionService } from '../../src/managed-identity-exchange/permissions/managed-permission.service';
import { PermissionSourceAdapterRegistry } from '../../src/managed-identity-exchange/permissions/permission-source-adapter.registry';
import { IdentityProviderAdapterRegistry } from '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';
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
