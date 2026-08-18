import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JSONWebKeySet } from 'jose';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { IdentityResolutionError, CanonicalIdentityResolver } from '../../src/integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileCache } from '../../src/integration-registry/trust-profile-cache';
import { TrustProfileRepository, type TrustProfileRecord } from '../../src/integration-registry/trust-profile.repository';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../src/upstream-auth/routing-metadata.parser';
import { MultiProfileUpstreamTokenVerifier, MultiProfileInfrastructureError } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import { UpstreamAuthTelemetry } from '../../src/upstream-auth/upstream-auth-telemetry';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { createDirectJwtFixture, type DirectJwtFixture } from '../upstream-auth/direct-jwt.fixture';
import { createTokenExchangeFixture, type TokenExchangeFixture } from '../upstream-auth/token-exchange.fixture';
import { createUpstreamJwksFixture } from '../upstream-auth/upstream-jwks.fixture';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('Feature 004 multi-profile A/B trust chain (T057/T060)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let direct: DirectJwtFixture;
  let exchange: TokenExchangeFixture;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('multi-profile-trust-chain');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    direct = await createDirectJwtFixture();
    exchange = await createTokenExchangeFixture();
    await prisma.customer.createMany({ data: [{ id: 'customer-a' }, { id: 'customer-b' }] });
    await prisma.integrationBinding.createMany({ data: [
      { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true },
      { integrationId: 'integration-b', customerId: 'customer-b', allowedHostApp: 'admin', enabled: true }
    ] });
    await prisma.registeredUpstreamTrustProfile.createMany({ data: [
      profile('profile-a', 'integration-a', direct, 1), profile('profile-b', 'integration-b', exchange, 1)
    ] });
  });

  afterEach(async () => {
    await direct?.close();
    await exchange?.close();
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('resolves independent Direct A and Token Exchange B through the same real trust chain', async () => {
    const runtime = createRuntime(prisma);
    const directResult = await resolveCanonical(runtime, await direct.issue({ integration_id: 'integration-a', sub: 'actor-a', org_id: 'org-a', host_app: 'admin' }));
    const exchangeResult = await resolveCanonical(runtime, await exchange.exchange(exchange.issueTrustedNativeCredential({ principal: 'actor-b', organization: 'org-b' })));
    const a = await prisma.registeredUpstreamTrustProfile.findUniqueOrThrow({ where: { id: 'profile-a' } });
    const b = await prisma.registeredUpstreamTrustProfile.findUniqueOrThrow({ where: { id: 'profile-b' } });

    expect(a.expectedIssuer).not.toBe(b.expectedIssuer);
    expect(a.jwksUri).not.toBe(b.jwksUri);
    expect(direct.kid).not.toBe(exchange.kid);
    expect(directResult).toMatchObject({ integrationId: 'integration-a', customerId: 'customer-a', hostApp: 'admin' });
    expect(exchangeResult).toMatchObject({ integrationId: 'integration-b', customerId: 'customer-b', hostApp: 'admin' });
  });

  it('fails closed for wrong audience and verified integration/profile mismatch without resolver fallback', async () => {
    await prisma.registeredUpstreamTrustProfile.update({ where: { id: 'profile-a' }, data: { expectedAudience: 'wrong-audience' } });
    const wrongAudience = createRuntime(prisma);
    await expect(wrongAudience.verifier.verify({ authorization: `Bearer ${await direct.issue()}`, requestId: 'wrong-audience' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);

    await prisma.registeredUpstreamTrustProfile.update({ where: { id: 'profile-a' }, data: { expectedAudience: direct.audience } });
    const mismatch = createRuntime(prisma);
    await expect(mismatch.verifier.verify({ authorization: `Bearer ${await direct.issue({ integration_id: 'integration-b' })}`, requestId: 'profile-anchor-mismatch' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
  });

  it('keeps Customer-like and browser/public identity inputs non-authoritative', async () => {
    const runtime = createRuntime(prisma);
    const identity = await runtime.verifier.verify({ authorization: `Bearer ${await direct.issue({ customer_id: 'customer-b', customerId: 'customer-b', tenant: 'customer-b' } as never)}`, requestId: 'customer-like-claims' });
    const canonical = await runtime.resolver.resolve({
      identity, requestId: 'customer-like-inputs', headers: { 'x-customer-id': 'customer-b', 'x-integration-id': 'integration-b', 'x-host-app': 'other-app' },
      body: { customerId: 'customer-b' }, query: { customerId: 'customer-b' }, pageContext: { customerId: 'customer-b' }, metadata: { customerId: 'customer-b' }
    } as never);
    expect(canonical).toMatchObject({ integrationId: 'integration-a', customerId: 'customer-a' });
  });

  it('keeps HostApp admission in the resolver after successful profile verification', async () => {
    const runtime = createRuntime(prisma);
    const identity = await runtime.verifier.verify({ authorization: `Bearer ${await direct.issue({ host_app: 'other-app' })}`, requestId: 'host-app-mismatch' });
    await expect(runtime.resolver.resolve({ identity, requestId: 'host-app-mismatch' })).rejects.toBeInstanceOf(IdentityResolutionError);
  });

  it('separates disabled profile acceptance from disabled binding admission', async () => {
    await prisma.registeredUpstreamTrustProfile.update({ where: { id: 'profile-a' }, data: { enabled: false, lifecycle: 'disabled' } });
    const profileDisabled = createRuntime(prisma);
    await expect(profileDisabled.verifier.verify({ authorization: `Bearer ${await direct.issue()}`, requestId: 'profile-disabled' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    await expect(resolveCanonical(profileDisabled, await exchange.exchange(exchange.issueTrustedNativeCredential()))).resolves.toMatchObject({ customerId: 'customer-b' });
    await expect(prisma.integrationBinding.findUniqueOrThrow({ where: { integrationId: 'integration-a' } })).resolves.toMatchObject({ enabled: true });

    await prisma.registeredUpstreamTrustProfile.update({ where: { id: 'profile-a' }, data: { enabled: true, lifecycle: 'active' } });
    await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { enabled: false } });
    const bindingDisabled = createRuntime(prisma);
    const identity = await bindingDisabled.verifier.verify({ authorization: `Bearer ${await direct.issue()}`, requestId: 'binding-disabled' });
    await expect(bindingDisabled.resolver.resolve({ identity, requestId: 'binding-disabled' })).rejects.toBeInstanceOf(IdentityResolutionError);
    await expect(resolveCanonical(bindingDisabled, await exchange.exchange(exchange.issueTrustedNativeCredential()))).resolves.toMatchObject({ customerId: 'customer-b' });
  });

  it('fails closed for zero candidates without invoking resolver or legacy fallback', async () => {
    const unknown = await createUpstreamJwksFixture({ authorityLabel: 'unknown-candidate' });
    try {
      const runtime = createRuntime(prisma);
      await expect(runtime.verifier.verify({ authorization: `Bearer ${await unknown.issue()}`, requestId: 'zero-candidate' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    } finally {
      await unknown.close();
    }
  });

  it('evaluates shared issuer/JWKS/key candidates without merging profiles and fails closed on ambiguity', async () => {
    await prisma.registeredUpstreamTrustProfile.create({ data: profile('profile-shared-b', 'integration-b', direct, 2) });
    const shared = createRuntime(prisma);
    await expect(shared.candidates.resolve({ issuerHint: direct.issuer })).resolves.toHaveLength(2);
    await expect(resolveCanonical(shared, await direct.issue({ integration_id: 'integration-b', sub: 'actor-shared', org_id: 'org-shared', roles: [], permission_scopes: [] }))).resolves.toMatchObject({ customerId: 'customer-b', integrationId: 'integration-b' });

    await prisma.registeredUpstreamTrustProfile.create({ data: profile('profile-ambiguous-a', 'integration-a', direct, 2) });
    const ambiguous = createRuntime(prisma);
    await expect(ambiguous.verifier.verify({ authorization: `Bearer ${await direct.issue({ integration_id: 'integration-a' })}`, requestId: 'ambiguous' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
  });

  it('resolves identical lower-level A/B identities only through their verified integration bindings', async () => {
    const runtime = createRuntime(prisma);
    const a = await resolveCanonical(runtime, await direct.issue({ sub: 'actor-shared', org_id: 'org-shared', host_app: 'admin', roles: [], permission_scopes: [] }));
    const b = await resolveCanonical(runtime, await exchange.exchange(exchange.issueTrustedNativeCredential({ principal: 'actor-shared', organization: 'org-shared', roles: [], permissionScopes: [] })));
    expect(a).toMatchObject({ customerId: 'customer-a', integrationId: 'integration-a' });
    expect(b).toMatchObject({ customerId: 'customer-b', integrationId: 'integration-b' });
  });

  it('aborts as infrastructure when an adversarial candidate transport fails before another candidate can succeed', async () => {
    await prisma.registeredUpstreamTrustProfile.create({ data: { ...profile('profile-infra-a', 'integration-a', direct, 2), jwksUri: 'https://fixture.invalid/jwks' } });
    await prisma.registeredUpstreamTrustProfile.create({ data: profile('profile-shared-b', 'integration-b', direct, 2) });
    const runtime = createRuntime(prisma, ['https://fixture.invalid/jwks']);
    await expect(runtime.verifier.verify({ authorization: `Bearer ${await direct.issue({ integration_id: 'integration-b' })}`, requestId: 'infrastructure-abort' })).rejects.toBeInstanceOf(MultiProfileInfrastructureError);
  });

  it('locks profile, verifier, candidate, fixture, and legacy-fallback authority boundaries', () => {
    const schema = readFileSync(resolve(__dirname, '../../../../prisma/schema.prisma'), 'utf8');
    const profileModel = schema.match(/model RegisteredUpstreamTrustProfile \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(profileModel).not.toMatch(/customerId|allowedHostApp/);
    const multi = source('../../src/upstream-auth/multi-profile-upstream-token-verifier.ts');
    const candidate = source('../../src/integration-registry/candidate-trust-profile.resolver.ts');
    const directFixture = source('../upstream-auth/direct-jwt.fixture.ts');
    const exchangeFixture = source('../upstream-auth/token-exchange.fixture.ts');
    expect(multi).not.toMatch(/IntegrationBinding|CanonicalIdentityResolver|CanonicalGatewayIdentity|Customer|RemoteJwksUpstreamTokenVerifier|GATEWAY_UPSTREAM_JWT_(?:ISSUER|AUDIENCE|JWKS_URI)/);
    expect(candidate).not.toMatch(/Customer|IntegrationBinding|CanonicalIdentityResolver|fetch\s*\(|pageContext|request\.body|request\.query/);
    expect(`${directFixture}\n${exchangeFixture}`).not.toMatch(/IntegrationBinding|CanonicalIdentityResolver|GatewayBackendClient|resolveCustomer|Shinmone/);
    const production = [multi, source('../../src/gateway.module.ts'), source('../../src/backend-client/gateway-trust-chain.handler.ts')].join('\n');
    expect(production).not.toMatch(/\bcustomer-a\b|\bcustomer-b\b|\bintegration-a\b|\bintegration-b\b|Shinmone/);
  });
});

function createRuntime(prisma: ReturnType<typeof createGatewayPrismaClient>, failingUris: readonly string[] = []) {
  const profiles = new TrustProfileRepository(prisma);
  const cache = new TrustProfileCache({ repository: profiles });
  const candidates = new CandidateTrustProfileResolver(cache);
  const transport = new LocalFixtureTransport(failingUris);
  const profileVerifier = new ProfileScopedVerifier({ transport });
  const audit = new GatewayIdentityAuditWriter(prisma);
  const telemetry = new UpstreamAuthTelemetry(audit);
  const verifier = new MultiProfileUpstreamTokenVerifier({ parser: new RoutingMetadataParser(), candidateResolver: candidates, profileVerifier, telemetry, clockToleranceSeconds: 0 });
  const resolver = new CanonicalIdentityResolver(new IntegrationBindingRepository(prisma), audit);
  return { verifier, resolver, candidates };
}

async function resolveCanonical(runtime: ReturnType<typeof createRuntime>, token: string) {
  const identity = await runtime.verifier.verify({ authorization: `Bearer ${token}`, requestId: `integration-${Math.random()}` });
  return runtime.resolver.resolve({ identity, requestId: `resolver-${Math.random()}` });
}

function profile(id: string, integrationId: string, fixture: Pick<DirectJwtFixture | TokenExchangeFixture, 'issuer' | 'audience' | 'jwksUri'>, version: number): TrustProfileRecord {
  return { id, integrationId, expectedIssuer: fixture.issuer, expectedAudience: fixture.audience, jwksUri: fixture.jwksUri, algorithm: 'RS256', enabled: true, lifecycle: 'active', version, replacesProfileId: null };
}

function source(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf8');
}

class LocalFixtureTransport implements JwksTransport {
  constructor(private readonly failingUris: readonly string[]) {}
  async fetch(uri: string): Promise<JSONWebKeySet> {
    if (this.failingUris.includes(uri)) throw new Error('fixture transport failure');
    return await (await fetch(uri)).json() as JSONWebKeySet;
  }
}
