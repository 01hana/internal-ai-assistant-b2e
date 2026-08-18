import { NestFactory } from '@nestjs/core';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JSONWebKeySet } from 'jose';
import request from 'supertest';
import type { Prisma } from '../../src/generated/prisma/client';
import { InternalIdentityTokenIssuer } from '../../src/identity/internal-identity-token-issuer.service';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { GatewayModule } from '../../src/gateway.module';
import { JwksService } from '../../src/jwks/jwks.service';
import { ActiveSigningKeyResolver } from '../../src/signing/active-signing-key-resolver';
import { GatewaySigningKeyRepository } from '../../src/signing/gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from '../../src/signing/identity-service-unavailable.error';
import { SigningKeyProvider } from '../../src/signing/signing-key-provider';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';
import { createEphemeralRsaFixture, type EphemeralRsaFixture } from '../signing/ephemeral-rsa.fixture';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('real local signing-key, persisted metadata, and JWKS integration (T051)', () => {
  it('forms a valid real private-file → active metadata → issuer → JWKS verification chain and Gateway runtime smoke', async () => {
    await withContext('local-signing-chain', async ({ database, prisma, fixture, temporaryFile }) => {
      await createKey(prisma, fixture.kid, fixture.publicJwk, temporaryFile.fileReference, 'active');
      await createKey(prisma, 'published-visible', publicJwkFor(fixture, 'published-visible'), 'provider://not-used', 'published');
      await createKey(prisma, 'retiring-visible', publicJwkFor(fixture, 'retiring-visible'), 'provider://not-used', 'retiring');
      await createKey(prisma, 'new-hidden', publicJwkFor(fixture, 'new-hidden'), 'provider://not-used', 'new');
      await createKey(prisma, 'retired-hidden', publicJwkFor(fixture, 'retired-hidden'), 'provider://not-used', 'retired');

      const repository = new GatewaySigningKeyRepository(prisma);
      const resolver = new ActiveSigningKeyResolver(repository, new SigningKeyProvider());
      const issuer = new InternalIdentityTokenIssuer(issuerConfig(), resolver);
      const token = await issuer.issue(canonicalIdentity());
      const document = await new JwksService(repository).getDocument();
      const verified = await jwtVerify(token, createLocalJWKSet(document as JSONWebKeySet), { algorithms: ['RS256'], issuer: 'http://gateway.local.test', audience: 'feature003-local-audience' });

      expect(decodeProtectedHeader(token).kid).toBe(fixture.kid);
      const persistedActiveKey = await prisma.gatewaySigningKey.findUnique({ where: { kid: fixture.kid } });
      expect(persistedActiveKey).toMatchObject({
        kid: fixture.kid,
        publicJwk: expect.objectContaining({ kid: fixture.kid })
      });
      expect(document.keys.map((key) => key.kid)).toEqual([fixture.kid, 'published-visible', 'retiring-visible']);
      expect(JSON.stringify(document)).not.toMatch(/keyreference|notbefore|activatedat|retireafter|retiredat|"(?:d|p|q|dp|dq|qi)"/i);
      expect(verified.payload.customer_id).toBe('customer-a');

      const runtimeProfile = await seedRuntimeReadiness(prisma);
      expect(runtimeProfile).toMatchObject({
        id: 'profile-local-signing-smoke', integrationId: 'integration-local-signing-smoke',
        algorithm: 'RS256', enabled: true, lifecycle: 'active'
      });

      const runtime = await startGatewayRuntime(database.databaseUrl, temporaryFile.fileReference);
      try {
        const response = await request(runtime.app.getHttpServer()).get('/.well-known/jwks.json');
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('public, max-age=60, must-revalidate');
        expect(response.body.keys.map((key: { kid: string }) => key.kid)).toEqual([fixture.kid, 'published-visible', 'retiring-visible']);
      } finally {
        await runtime.app.close();
        runtime.restoreEnvironment();
      }
    });
  });

  it('does not normal-sign when persisted metadata has published-only keys', async () => {
    await withContext('published-only', async ({ prisma, fixture, temporaryFile }) => {
      await createKey(prisma, fixture.kid, fixture.publicJwk, temporaryFile.fileReference, 'published');
      const resolver = new ActiveSigningKeyResolver(new GatewaySigningKeyRepository(prisma), new SigningKeyProvider());

      await expect(resolver.resolveActiveSigningKey()).rejects.toBeInstanceOf(IdentityServiceUnavailableError);
    });
  });

  it('returns an empty document only for a successful real repository query with no visible rows', async () => {
    await withContext('empty-visible', async ({ prisma }) => {
      await expect(new JwksService(new GatewaySigningKeyRepository(prisma)).getDocument()).resolves.toEqual({ keys: [] });
    });
  });

  it('proves a shape-valid persisted public/private mismatch cannot verify as a signer/JWKS trust pair', async () => {
    await withContext('mismatched-association', async ({ prisma, fixture: publicFixture, temporaryFile: publicFile }) => {
      const privateFixture = await createEphemeralRsaFixture({ kid: 'private-key-b' });
      const privateFile = await privateFixture.writeTemporaryPem();
      try {
        await createKey(prisma, publicFixture.kid, publicFixture.publicJwk, privateFile.fileReference, 'active');
        const repository = new GatewaySigningKeyRepository(prisma);
        const token = await new InternalIdentityTokenIssuer(issuerConfig(), new ActiveSigningKeyResolver(repository, new SigningKeyProvider())).issue(canonicalIdentity());
        const document = await new JwksService(repository).getDocument();

        expect(decodeProtectedHeader(token).kid).toBe(publicFixture.kid);
        await expect(jwtVerify(token, createLocalJWKSet(document as JSONWebKeySet), { algorithms: ['RS256'] })).rejects.toThrow();
      } finally {
        await privateFile.dispose();
      }
      expect(publicFile.fileReference).not.toBe(privateFile.fileReference);
    });
  });
});

async function withContext(label: string, callback: (context: {
  database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  prisma: ReturnType<typeof createGatewayPrismaClient>;
  fixture: EphemeralRsaFixture;
  temporaryFile: Awaited<ReturnType<EphemeralRsaFixture['writeTemporaryPem']>>;
}) => Promise<void>) {
  const database = await createGatewayRegistryDatabase(label);
  const prisma = createGatewayPrismaClient(database.databaseUrl);
  const fixture = await createEphemeralRsaFixture({ kid: `local-active-${label}` });
  const temporaryFile = await fixture.writeTemporaryPem();
  try {
    await callback({ database, prisma, fixture, temporaryFile });
  } finally {
    await temporaryFile.dispose();
    await prisma.$disconnect();
    await database.dispose();
  }
}

function canonicalIdentity() {
  return { customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-shared', organizationId: 'org-shared', hostApp: 'admin', roles: ['planner'], permissionScopes: ['orders:read'] };
}

function issuerConfig() {
  return { internalIssuer: 'http://gateway.local.test', internalAudience: 'feature003-local-audience', internalTokenTtlSeconds: 300 };
}

function publicJwkFor(fixture: EphemeralRsaFixture, kid: string) {
  return { ...fixture.publicJwk, kid };
}

async function createKey(prisma: ReturnType<typeof createGatewayPrismaClient>, kid: string, publicJwk: Record<string, unknown>, keyReference: string, status: 'new' | 'published' | 'active' | 'retiring' | 'retired') {
  await prisma.gatewaySigningKey.create({ data: { kid, publicJwk: publicJwk as Prisma.InputJsonValue, keyReference, status } });
}

async function seedRuntimeReadiness(prisma: ReturnType<typeof createGatewayPrismaClient>) {
  await prisma.customer.create({ data: { id: 'customer-local-signing-smoke' } });
  await prisma.integrationBinding.create({ data: {
    integrationId: 'integration-local-signing-smoke', customerId: 'customer-local-signing-smoke', allowedHostApp: 'admin', enabled: true
  } });
  return prisma.registeredUpstreamTrustProfile.create({ data: {
    id: 'profile-local-signing-smoke', integrationId: 'integration-local-signing-smoke',
    expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-local-signing-smoke',
    jwksUri: 'https://issuer.example.test/.well-known/jwks.json', algorithm: 'RS256',
    enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null
  } });
}

async function startGatewayRuntime(databaseUrl: string, signingKeyReference: string) {
  const environment = {
    DATABASE_URL: databaseUrl,
    GATEWAY_INTERNAL_JWT_ISSUER: 'http://gateway.local.test',
    GATEWAY_INTERNAL_JWT_AUDIENCE: 'feature003-local-audience',
    GATEWAY_PUBLIC_JWKS_URL: 'http://gateway.local.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300',
    GATEWAY_BACKEND_BASE_URL: 'http://backend.local.test',
    GATEWAY_SIGNING_KEY_REFERENCE: signingKeyReference,
    GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001',
    GATEWAY_PORT: '4000'
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const restoreEnvironment = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  try {
    const app = await NestFactory.create(GatewayModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    return { app, restoreEnvironment };
  } catch (error) {
    restoreEnvironment();
    throw error;
  }
}
