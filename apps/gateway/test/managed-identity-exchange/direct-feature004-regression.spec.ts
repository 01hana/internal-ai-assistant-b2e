import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JSONWebKeySet } from 'jose';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import { IdentityResolutionError, CanonicalIdentityResolver } from '../../src/integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileCache } from '../../src/integration-registry/trust-profile-cache';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { MultiProfileUpstreamTokenVerifier } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../src/upstream-auth/routing-metadata.parser';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import { UpstreamAuthTelemetry } from '../../src/upstream-auth/upstream-auth-telemetry';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { createDirectJwtFixture, type DirectJwtFixture } from '../upstream-auth/direct-jwt.fixture';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeRegistry('Direct Feature 004 path remains independent of Feature 005 (T043)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let direct: DirectJwtFixture;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('direct-feature004-regression');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    direct = await createDirectJwtFixture();
    await prisma.customer.create({ data: { id: 'customer-direct' } });
    await prisma.integrationBinding.create({ data: { integrationId: 'integration-direct', customerId: 'customer-direct', allowedHostApp: 'admin', enabled: true } });
    await prisma.registeredUpstreamTrustProfile.create({ data: profile('profile-direct', direct) });
  });

  afterEach(async () => {
    await direct?.close();
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('verifies the exact Direct JWT through Feature 004 and derives Customer only from IntegrationBinding', async () => {
    const runtime = createRuntime(prisma, direct);
    const token = await direct.issue({
      integration_id: 'integration-direct', sub: 'direct-subject', org_id: 'direct-org', host_app: 'admin', roles: [], permission_scopes: ['orders:read']
    });
    const verified = await runtime.verifier.verify({ authorization: `Bearer ${token}`, requestId: 'request-direct' });
    const canonical = await runtime.resolver.resolve({ identity: verified, requestId: 'request-direct' });

    expect(runtime.profileVerify).toHaveBeenCalledWith(expect.objectContaining({ token }));
    expect(verified).toMatchObject({ integrationId: 'integration-direct', subject: 'direct-subject', organizationId: 'direct-org', hostApp: 'admin', roles: [], permissionScopes: ['orders:read'] });
    expect(canonical).toEqual(expect.objectContaining({ customerId: 'customer-direct', integrationId: 'integration-direct', subject: 'direct-subject', organizationId: 'direct-org', hostApp: 'admin', roles: [], permissionScopes: ['orders:read'] }));
    expect(await managedRecordCounts(prisma)).toEqual({ configs: 0, providers: 0, admissions: 0, permissions: 0, issuers: 0, keys: 0, audits: 0 });
    expect(await prisma.gatewayIdentityAuditEvent.count({ where: { requestId: 'request-direct' } })).toBeGreaterThan(0);
    expect(JSON.stringify(token)).not.toContain('customer-direct');
    expect(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))).not.toHaveProperty('customer_id');
  });

  it('runs the real handler direct path without an exchange selector, native credential, or managed composition', async () => {
    const runtime = createRuntime(prisma, direct);
    const token = await direct.issue({ integration_id: 'integration-direct', sub: 'direct-subject', org_id: 'direct-org', host_app: 'admin', roles: [], permission_scopes: ['orders:read'] });
    const result = await runtime.handler.createSession({ authorization: `Bearer ${token}`, requestId: 'request-direct-handler', pageContext: {} });

    expect(runtime.backendCreate).toHaveBeenCalledTimes(1);
    expect(runtime.backendCreate).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'customer-direct', integrationId: 'integration-direct' }), expect.objectContaining({ requestId: 'request-direct-handler' }));
    expect(result).toEqual({ accepted: true });
    expect(runtime.profileVerify).toHaveBeenCalledWith(expect.objectContaining({ token }));
    expect(await prisma.managedExchangeAuditEvent.count()).toBe(0);
  });

  it.each([
    ['wrong audience', async () => {
      await prisma.registeredUpstreamTrustProfile.update({ where: { id: 'profile-direct' }, data: { expectedAudience: 'wrong-audience' } });
      return direct.issue();
    }],
    ['invalid signature', () => direct.issueInvalidSignature()]
  ])('fails closed for Direct %s without a managed fallback', async (_label, issue) => {
    const runtime = createRuntime(prisma, direct);
    const token = await issue();
    await expect(runtime.verifier.verify({ authorization: `Bearer ${token}`, requestId: 'request-direct-negative' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    expect(runtime.backendCreate).not.toHaveBeenCalled();
    expect(await prisma.managedExchangeAuditEvent.count()).toBe(0);
    expect(await managedRecordCounts(prisma)).toEqual({ configs: 0, providers: 0, admissions: 0, permissions: 0, issuers: 0, keys: 0, audits: 0 });
  });

  it('fails closed for an unknown Direct issuer without selecting a provider or selector', async () => {
    const unknown = await createDirectJwtFixture();
    try {
      const runtime = createRuntime(prisma, direct);
      await expect(runtime.verifier.verify({ authorization: `Bearer ${await unknown.issue({ integration_id: 'integration-direct' })}`, requestId: 'request-direct-unknown' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
      expect(runtime.profileVerify).not.toHaveBeenCalled();
      expect(await prisma.managedExchangeAuditEvent.count()).toBe(0);
    } finally {
      await unknown.close();
    }
  });

  it('retains HostApp admission at the binding after successful direct verification', async () => {
    const runtime = createRuntime(prisma, direct);
    const identity = await runtime.verifier.verify({ authorization: `Bearer ${await direct.issue({ integration_id: 'integration-direct', host_app: 'admin', roles: [], permission_scopes: ['orders:read'] })}`, requestId: 'request-direct-host' });
    await prisma.integrationBinding.update({ where: { integrationId: 'integration-direct' }, data: { allowedHostApp: 'another-host' } });
    await expect(runtime.resolver.resolve({ identity, requestId: 'request-direct-host' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' } satisfies Partial<IdentityResolutionError>);
    expect(await prisma.managedExchangeAuditEvent.count()).toBe(0);
  });

  it('keeps a direct profile isolated when a non-matching managed-compatible profile coexists', async () => {
    await prisma.registeredUpstreamTrustProfile.create({ data: {
      id: 'profile-managed-compatible', integrationId: 'integration-direct', expectedIssuer: 'https://managed-unavailable.example.test',
      expectedAudience: 'managed-audience', jwksUri: 'https://managed-unavailable.example.test/jwks', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 2, replacesProfileId: null
    } });
    const runtime = createRuntime(prisma, direct);
    const candidates = await runtime.candidates.resolve({ issuerHint: direct.issuer });
    await expect(runtime.verifier.verify({ authorization: `Bearer ${await direct.issue({ integration_id: 'integration-direct' })}`, requestId: 'request-direct-coexist' })).resolves.toMatchObject({ integrationId: 'integration-direct' });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('profile-direct');
    expect(runtime.profileVerify).toHaveBeenCalledTimes(1);
  });

  it('keeps direct fixtures, Feature 004 sources, and Gateway wiring free of managed-path fallback authority', () => {
    const directFixture = source('../upstream-auth/direct-jwt.fixture.ts');
    expect(directFixture).not.toMatch(/ManagedIdentityExchange|ManagedUpstreamTokenIssuer|ManagedJwksService|publicSelector|nativeCredential|customerId|customer_id|IntegrationBinding|CanonicalIdentityResolver/);

    const feature004 = [
      source('../../src/upstream-auth/multi-profile-upstream-token-verifier.ts'), source('../../src/upstream-auth/profile-scoped-verifier.ts'),
      source('../../src/upstream-auth/routing-metadata.parser.ts'), source('../../src/integration-registry/candidate-trust-profile.resolver.ts'),
      source('../../src/integration-registry/canonical-identity-resolver.service.ts'), source('../../src/backend-client/gateway-trust-chain.handler.ts')
    ].join('\n');
    expect(feature004).not.toMatch(/ManagedIdentityExchange(?:Controller|Service)|managed-identity-exchange|\/api\/v1\/identity\/exchange|publicSelector|providerInstanceId|fallback\s+to\s+exchange|exchange\s+on\s+auth\s+failure|managed\s+retry/i);

    const gatewayModule = source('../../src/gateway.module.ts');
    expect(gatewayModule).toContain('ManagedIdentityExchangeModule');
    expect(gatewayModule).toContain('MultiProfileUpstreamTokenVerifier');
    expect(gatewayModule).toContain('CanonicalIdentityResolver');
    expect(gatewayModule).toContain('GatewayTrustChainHandler');
  });
});

function createRuntime(prisma: ReturnType<typeof createGatewayPrismaClient>, direct: DirectJwtFixture) {
  const profiles = new TrustProfileRepository(prisma);
  const candidates = new CandidateTrustProfileResolver(new TrustProfileCache({ repository: profiles, ttlMilliseconds: 0 }));
  const scoped = new ProfileScopedVerifier({ transport: new DirectFixtureTransport() });
  const profileVerify = jest.spyOn(scoped, 'verify');
  const audit = new GatewayIdentityAuditWriter(prisma);
  const verifier = new MultiProfileUpstreamTokenVerifier({ parser: new RoutingMetadataParser(), candidateResolver: candidates, profileVerifier: scoped, telemetry: new UpstreamAuthTelemetry(audit), clockToleranceSeconds: 0 });
  const resolver = new CanonicalIdentityResolver(new IntegrationBindingRepository(prisma), audit);
  const backendCreate = jest.fn(async () => ({ accepted: true }));
  const handler = new GatewayTrustChainHandler({ upstreamTokenVerifier: verifier, canonicalIdentityResolver: resolver, gatewayBackendClient: { createSession: backendCreate } as never });
  return Object.freeze({ verifier, resolver, candidates, profileVerify, backendCreate, handler, direct });
}

function profile(id: string, fixture: DirectJwtFixture) {
  return { id, integrationId: 'integration-direct', expectedIssuer: fixture.issuer, expectedAudience: fixture.audience, jwksUri: fixture.jwksUri, algorithm: 'RS256' as const, enabled: true, lifecycle: 'active' as const, version: 1, replacesProfileId: null };
}

async function managedRecordCounts(prisma: ReturnType<typeof createGatewayPrismaClient>) {
  const [configs, providers, admissions, permissions, issuers, keys, audits] = await Promise.all([
    prisma.managedIntegrationExchangeConfig.count(), prisma.managedIdentityProviderInstance.count(), prisma.managedIntegrationAdmissionPolicy.count(),
    prisma.managedPermissionPolicy.count(), prisma.managedUpstreamIssuer.count(), prisma.managedUpstreamSigningKey.count(), prisma.managedExchangeAuditEvent.count()
  ]);
  return { configs, providers, admissions, permissions, issuers, keys, audits };
}

function source(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

class DirectFixtureTransport implements JwksTransport {
  async fetch(uri: string): Promise<JSONWebKeySet> {
    return await (await fetch(uri)).json() as JSONWebKeySet;
  }
}
