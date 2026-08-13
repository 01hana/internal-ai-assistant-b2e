import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { decodeProtectedHeader, SignJWT, type KeyLike } from 'jose';
import type { Prisma } from '../../apps/gateway/src/generated/prisma/client';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
import { IdentityTokenException } from '../../src/identity/identity.errors';
import { RemoteJwksInternalIdentityTokenVerifier } from '../../src/identity/internal-identity-token-verifier';
import { RegisterSigningKeyCommand } from '../../apps/gateway/src/commands/register-signing-key';
import { GatewayModule } from '../../apps/gateway/src/gateway.module';
import { InternalIdentityTokenIssuer } from '../../apps/gateway/src/identity/internal-identity-token-issuer.service';
import { createGatewayPrismaClient } from '../../apps/gateway/src/integration-registry/gateway-prisma-client.factory';
import { ActiveSigningKeyResolver } from '../../apps/gateway/src/signing/active-signing-key-resolver';
import { GatewaySigningKeyRepository } from '../../apps/gateway/src/signing/gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from '../../apps/gateway/src/signing/identity-service-unavailable.error';
import { KeyLifecycleService } from '../../apps/gateway/src/signing/key-lifecycle.service';
import { KeyRetirementPolicy } from '../../apps/gateway/src/signing/key-retirement-policy';
import { KeyRotationService } from '../../apps/gateway/src/signing/key-rotation.service';
import type { SigningKeyPropagationProofInput, SigningKeyPropagationVerifier } from '../../apps/gateway/src/signing/signing-key-propagation-verifier';
import { SigningKeyProvider } from '../../apps/gateway/src/signing/signing-key-provider';
import { GatewayIdentityAuditWriter } from '../../apps/gateway/src/audit/gateway-identity-audit.writer';
import { createGatewayRegistryDatabase } from '../support/gateway-registry-db.helper';
import { createEphemeralRsaFixture, type EphemeralRsaFixture } from '../../apps/gateway/test/signing/ephemeral-rsa.fixture';

describe('Gateway signing-key rotation ↔ Feature 002 Remote JWKS integration (T061)', () => {
  it('proves registration, publication, activation, overlap, unknown-kid rejection, and retirement visibility through real Gateway JWKS', async () => {
    await withContext('remote-jwks-rotation', async (context) => {
      const old = await context.createActiveOldKey('old-rotation-kid');
      const candidate = await context.registerCandidate('candidate-rotation-kid');
      expect(candidate.status).toBe('new');
      expect(candidate.publicJwk).toMatchObject({ kty: 'RSA', kid: candidate.kid, alg: 'RS256', use: 'sig' });
      expect(JSON.stringify(candidate.publicJwk)).not.toMatch(/"(?:d|p|q|dp|dq|qi|oth)"/);
      expect(candidate.keyReference).toBe(context.candidateFile.fileReference);

      const oldToken = await context.issueNormal();
      expect(decodeProtectedHeader(oldToken).kid).toBe(old.kid);
      await context.verifyBackend(oldToken);

      await context.lifecycle.transition({ kid: candidate.kid, to: 'published', requestId: 'publish-candidate' });
      expect(await context.httpJwksKids()).toEqual([candidate.kid, old.kid].sort());
      expect(decodeProtectedHeader(await context.issueNormal()).kid).toBe(old.kid);

      const propagation = new RealRemoteJwksPropagationVerifier(context, context.candidateFixture);
      const rotation = context.createRotation(propagation);
      await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'activate-candidate' })).resolves.toEqual({ activeKid: candidate.kid });

      const activeCandidate = await context.key(candidate.kid);
      const retiringOld = await context.key(old.kid);
      expect(activeCandidate).toMatchObject({ status: 'active' });
      expect(retiringOld).toMatchObject({ status: 'retiring', retireAfter: new Date(context.activationTime.getTime() + 1_500_000) });
      expect(await context.activeCount()).toBe(1);
      expect(await context.httpJwksKids()).toEqual([candidate.kid, old.kid].sort());

      const newToken = await context.issueNormal();
      expect(decodeProtectedHeader(newToken).kid).toBe(candidate.kid);
      await context.verifyBackend(newToken);
      await context.verifyBackend(oldToken);
      expect(propagation.publishedProbeAccepted).toBe(true);
      expect(propagation.activatedNormalTokenAccepted).toBe(true);

      const unknown = await createEphemeralRsaFixture({ kid: 'unknown-rotation-kid' });
      const unknownToken = await signCanonicalToken(unknown.privateKey, unknown.kid, context);
      await expect(context.verifyBackend(unknownToken)).rejects.toBeInstanceOf(IdentityTokenException);

      context.now = new Date(context.activationTime.getTime() + 1_499_000);
      await expect(rotation.retire({ kid: old.kid, requestId: 'premature-retirement' })).rejects.toBeInstanceOf(IdentityServiceUnavailableError);
      expect(await context.key(old.kid)).toMatchObject({ status: 'retiring' });
      expect(await context.httpJwksKids()).toContain(old.kid);
      await context.verifyBackend(oldToken);

      context.now = new Date(context.activationTime.getTime() + 1_500_000);
      await expect(rotation.retire({ kid: old.kid, requestId: 'eligible-retirement' })).resolves.toMatchObject({ kid: old.kid, status: 'retired' });
      expect(await context.key(old.kid)).toMatchObject({ status: 'retired' });
      expect(await context.key(candidate.kid)).toMatchObject({ status: 'active' });
      expect(await context.httpJwksKids()).toEqual([candidate.kid]);
    });
  });

  it('keeps both public keys remotely verifiable when post-activation proof rolls back to the prior signer', async () => {
    await withContext('remote-jwks-rollback', async (context) => {
      const prior = await context.createActiveOldKey('prior-rollback-kid');
      const candidate = await context.registerCandidate('candidate-rollback-kid');
      const priorToken = await context.issueNormal();
      await context.lifecycle.transition({ kid: candidate.kid, to: 'published', requestId: 'publish-rollback-candidate' });

      const propagation = new RealRemoteJwksPropagationVerifier(context, context.candidateFixture, { failAfterActivatedProof: true });
      const rotation = context.createRotation(propagation);
      await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'activate-then-rollback' })).rejects.toBeInstanceOf(IdentityServiceUnavailableError);

      expect(await context.key(prior.kid)).toMatchObject({ status: 'active', retireAfter: null });
      expect(await context.key(candidate.kid)).toMatchObject({ status: 'retiring', retireAfter: new Date(context.activationTime.getTime() + 1_500_000) });
      expect(await context.activeCount()).toBe(1);
      expect(await context.httpJwksKids()).toEqual([candidate.kid, prior.kid].sort());
      await context.verifyBackend(priorToken);
      await context.verifyBackend(propagation.capturedActivatedToken as string);
      expect(decodeProtectedHeader(await context.issueNormal()).kid).toBe(prior.kid);
    });
  });
});

type RotationContext = Awaited<ReturnType<typeof createContext>>;

async function withContext(label: string, callback: (context: RotationContext) => Promise<void>): Promise<void> {
  const context = await createContext(label);
  try {
    await callback(context);
  } finally {
    await context.dispose();
  }
}

async function createContext(label: string) {
  const database = await createGatewayRegistryDatabase(label);
  const prisma = createGatewayPrismaClient(database.databaseUrl);
  const oldFixture = await createEphemeralRsaFixture({ kid: `${label}-old-${randomUUID()}` });
  const candidateFixture = await createEphemeralRsaFixture({ kid: `${label}-candidate-${randomUUID()}` });
  const oldFile = await oldFixture.writeTemporaryPem();
  const candidateFile = await candidateFixture.writeTemporaryPem();
  const activationTime = new Date('2030-01-01T00:00:00.000Z');
  let now = new Date(activationTime);
  const issuer = `http://gateway-phase6c-${randomUUID()}.test`;
  const audience = 'feature003-phase6c';
  const repository = new GatewaySigningKeyRepository(prisma);
  const policy = retirementPolicy();
  const provider = new SigningKeyProvider();
  const lifecycle = new KeyLifecycleService({ repository, signingKeyProvider: provider, retirementPolicy: policy, now: () => now });
  const command = new RegisterSigningKeyCommand(lifecycle);
  const activeResolver = new ActiveSigningKeyResolver(repository, provider);
  const internalIssuer = new InternalIdentityTokenIssuer({ internalIssuer: issuer, internalAudience: audience, internalTokenTtlSeconds: 300 }, activeResolver);
  const runtime = await startGatewayRuntime(database.databaseUrl, oldFile.fileReference);

  const context = {
    database,
    prisma,
    oldFixture,
    candidateFixture,
    oldFile,
    candidateFile,
    activationTime,
    get now() { return now; },
    set now(value: Date) { now = value; },
    issuer,
    audience,
    lifecycle,
    issueNormal: () => internalIssuer.issue(canonicalIdentity()),
    async createActiveOldKey(_label: string) {
      const row = await prisma.gatewaySigningKey.create({
        data: { kid: oldFixture.kid, publicJwk: oldFixture.publicJwk as Prisma.InputJsonValue, keyReference: oldFile.fileReference, status: 'active', activatedAt: activationTime }
      });
      return row;
    },
    async registerCandidate(_label: string) {
      return command.execute({ kid: candidateFixture.kid, keyReference: candidateFile.fileReference, requestId: `register-${label}` });
    },
    async key(kid: string) {
      return prisma.gatewaySigningKey.findUniqueOrThrow({ where: { kid } });
    },
    activeCount() {
      return prisma.gatewaySigningKey.count({ where: { status: 'active' } });
    },
    async httpJwksDocument() {
      const response = await fetch(runtime.jwksUri);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
      return response.json() as Promise<{ keys: Array<Record<string, unknown>> }>;
    },
    async httpJwksKids() {
      const document = await this.httpJwksDocument();
      expect(JSON.stringify(document)).not.toMatch(/keyreference|status|notbefore|activatedat|retireafter|retiredat|"(?:d|p|q|dp|dq|qi|oth)"/i);
      return document.keys.map((key) => String(key.kid)).sort();
    },
    async verifyBackend(token: string) {
      const verified = await new RemoteJwksInternalIdentityTokenVerifier({ issuer, audience, jwksUri: runtime.jwksUri, clockToleranceSeconds: 0 }).verify({ authorization: `Bearer ${token}` });
      return validateVerifiedInternalIdentityClaims(verified);
    },
    createRotation(propagationVerifier: SigningKeyPropagationVerifier) {
      return new KeyRotationService({
        repository,
        lifecycle,
        retirementPolicy: policy,
        propagationVerifier,
        compensationAuditWriter: new GatewayIdentityAuditWriter(prisma),
        now: () => now
      });
    },
    async dispose() {
      await runtime.app.close();
      runtime.restoreEnvironment();
      await oldFile.dispose();
      await candidateFile.dispose();
      await prisma.$disconnect();
      await database.dispose();
    }
  };

  expect((await stat(filePathFromReference(oldFile.fileReference))).mode & 0o777).toBe(0o600);
  expect((await stat(filePathFromReference(candidateFile.fileReference))).mode & 0o777).toBe(0o600);
  return context;
}

class RealRemoteJwksPropagationVerifier implements SigningKeyPropagationVerifier {
  publishedProbeAccepted = false;
  activatedNormalTokenAccepted = false;
  capturedActivatedToken: string | undefined;

  constructor(
    private readonly context: RotationContext,
    private readonly candidate: EphemeralRsaFixture,
    private readonly options: Readonly<{ failAfterActivatedProof?: boolean }> = {}
  ) {}

  async verifyPublished(input: SigningKeyPropagationProofInput): Promise<void> {
    const document = await this.context.httpJwksDocument();
    const published = document.keys.find((key) => key.kid === input.kid);
    if (!published || !samePublicJwk(published, input.publicJwk)) throw new Error('candidate was not published by Gateway JWKS');
    const probe = await signCanonicalToken(this.candidate.privateKey, this.candidate.kid, this.context);
    await this.context.verifyBackend(probe);
    this.publishedProbeAccepted = true;
  }

  async verifyActivated(input: SigningKeyPropagationProofInput): Promise<void> {
    const token = await this.context.issueNormal();
    if (decodeProtectedHeader(token).kid !== input.kid) throw new Error('normal Gateway issuer did not select the active candidate');
    await this.context.verifyBackend(token);
    this.capturedActivatedToken = token;
    this.activatedNormalTokenAccepted = true;
    if (this.options.failAfterActivatedProof) throw new Error('test-only post-activation proof failure');
  }
}

function canonicalIdentity() {
  return Object.freeze({
    customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-shared', organizationId: 'org-shared', hostApp: 'admin', roles: ['planner'], permissionScopes: ['orders:read']
  });
}

function retirementPolicy() {
  return new KeyRetirementPolicy({
    finalOldTokenLifetimeSeconds: 300,
    backendClockToleranceSeconds: 300,
    remoteJwksCacheSeconds: 600,
    remoteJwksCooldownSeconds: 30,
    propagationMarginSeconds: 60,
    enforcedMinimumOverlapSeconds: 1500,
    httpCacheControlSeconds: 60
  });
}

async function signCanonicalToken(privateKey: KeyLike, kid: string, context: Pick<RotationContext, 'issuer' | 'audience'>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    customer_id: 'customer-a', integration_id: 'integration-a', sub: 'actor-shared', org_id: 'org-shared', host_app: 'admin', roles: ['planner'], permission_scopes: ['orders:read'], jti: randomUUID()
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
    .setIssuer(context.issuer)
    .setAudience(context.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function startGatewayRuntime(databaseUrl: string, signingKeyReference: string) {
  const environment = {
    DATABASE_URL: databaseUrl,
    GATEWAY_INTERNAL_JWT_ISSUER: 'http://gateway-phase6c-runtime.test',
    GATEWAY_INTERNAL_JWT_AUDIENCE: 'feature003-phase6c',
    GATEWAY_PUBLIC_JWKS_URL: 'http://gateway-phase6c-runtime.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_ISSUER: 'http://upstream-phase6c.test',
    GATEWAY_UPSTREAM_JWT_AUDIENCE: 'phase6c-upstream',
    GATEWAY_UPSTREAM_JWKS_URI: 'http://upstream-phase6c.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300',
    GATEWAY_BACKEND_BASE_URL: 'http://backend-phase6c.test',
    GATEWAY_SIGNING_KEY_REFERENCE: signingKeyReference,
    GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001',
    GATEWAY_PORT: '4000'
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try {
    const app = await NestFactory.create(GatewayModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('Gateway JWKS runtime did not expose a TCP listener.');
    return {
      app,
      jwksUri: `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
      restoreEnvironment() {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    };
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    throw error;
  }
}

function filePathFromReference(reference: string): string {
  return fileURLToPath(new URL(reference));
}

function samePublicJwk(actual: Record<string, unknown>, expected: unknown): boolean {
  if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) return false;
  return ['kty', 'kid', 'alg', 'use', 'n', 'e'].every((field) => actual[field] === (expected as Record<string, unknown>)[field]);
}
