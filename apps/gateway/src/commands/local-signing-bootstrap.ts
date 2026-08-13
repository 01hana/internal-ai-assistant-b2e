import { calculateJwkThumbprint, exportJWK, type KeyLike } from 'jose';
import { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import { validateGatewayEnvironment, type GatewayEnvironment } from '../config/gateway-config.service';
import { createGatewayPrismaClient } from '../integration-registry/gateway-prisma-client.factory';
import { ActiveSigningKeyResolver } from '../signing/active-signing-key-resolver';
import { GatewaySigningKeyRepository, type GatewaySigningKeyRecord } from '../signing/gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from '../signing/identity-service-unavailable.error';
import { KeyLifecycleService } from '../signing/key-lifecycle.service';
import { KeyRetirementPolicy } from '../signing/key-retirement-policy';
import { LocalJwksPropagationVerifier } from '../signing/local-jwks-propagation-verifier';
import { KeyRotationService } from '../signing/key-rotation.service';
import { SigningKeyProvider } from '../signing/signing-key-provider';
import { RegisterSigningKeyCommand } from './register-signing-key';

export type LocalSigningBootstrapResult = Readonly<{ status: 'activated' | 'already_active'; kid: string }>;

/** Direct local-development command; it is never a GatewayModule provider. */
export async function bootstrapLocalSigningKey(environment: Record<string, unknown> = process.env): Promise<LocalSigningBootstrapResult> {
  const config = validateGatewayEnvironment(environment);
  requireLocalBootstrapBoundary(environment, config);
  const client = createGatewayPrismaClient(requiredDatabaseUrl(environment.DATABASE_URL));

  try {
    const repository = new GatewaySigningKeyRepository(client);
    const provider = new SigningKeyProvider();
    const key = await deriveLocalKey(provider, config.signingKeyReference);
    const policy = localRetirementPolicy();
    const lifecycle = new KeyLifecycleService({ repository, signingKeyProvider: provider, retirementPolicy: policy, now: () => new Date() });
    const propagationVerifier = new LocalJwksPropagationVerifier({ publicJwksUrl: config.publicJwksUrl, fetch: (url) => globalThis.fetch(url) });
    const rotation = new KeyRotationService({
      repository, lifecycle, retirementPolicy: policy, propagationVerifier,
      compensationAuditWriter: new GatewayIdentityAuditWriter(client), now: () => new Date()
    });
    const requestId = `local-signing-bootstrap:${key.kid}`;
    let row = await repository.findByKid(key.kid);
    const wasAlreadyActive = row?.status === 'active';

    if (row) assertMatchingKey(row, key, config.signingKeyReference);
    const active = await repository.findActive();
    if (active && active.kid !== key.kid) throw new IdentityServiceUnavailableError();
    if (!row) {
      await new RegisterSigningKeyCommand(lifecycle).execute({ kid: key.kid, keyReference: config.signingKeyReference, requestId });
      row = await repository.findByKid(key.kid);
    }
    if (!row) throw new IdentityServiceUnavailableError();
    if (row.status === 'new') row = await lifecycle.transition({ kid: key.kid, to: 'published', requestId });
    if (row.status === 'published') {
      await rotation.activatePublished({ kid: key.kid, requestId });
      row = await repository.findByKid(key.kid);
    }
    if (!row || row.status !== 'active') throw new IdentityServiceUnavailableError();

    assertMatchingKey(row, key, config.signingKeyReference);
    await propagationVerifier.verifyPublished({ kid: key.kid, publicJwk: key.publicJwk });
    await propagationVerifier.verifyActivated({ kid: key.kid, publicJwk: key.publicJwk });
    await new ActiveSigningKeyResolver(repository, provider).resolveActiveSigningKey();
    return Object.freeze({ status: wasAlreadyActive ? 'already_active' : 'activated', kid: key.kid });
  } catch {
    throw new IdentityServiceUnavailableError();
  } finally {
    await client.$disconnect();
  }
}

async function deriveLocalKey(provider: SigningKeyProvider, keyReference: string): Promise<Readonly<{ kid: string; publicJwk: Readonly<Record<string, unknown>> }>> {
  return publicJwkFor(await provider.load(keyReference));
}

async function publicJwkFor(handle: KeyLike): Promise<Readonly<{ kid: string; publicJwk: Readonly<Record<string, unknown>> }>> {
  const jwk = await exportJWK(handle);
  if (!nonBlank(jwk.n) || !nonBlank(jwk.e)) throw new IdentityServiceUnavailableError();
  const thumbprintInput = { kty: 'RSA', n: jwk.n, e: jwk.e };
  const kid = await calculateJwkThumbprint(thumbprintInput, 'sha256');
  return Object.freeze({ kid, publicJwk: Object.freeze({ ...thumbprintInput, kid, alg: 'RS256', use: 'sig' }) });
}

function requireLocalBootstrapBoundary(environment: Record<string, unknown>, config: GatewayEnvironment): void {
  if ((environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') || config.localSigningBootstrapEnabled !== true) throw new IdentityServiceUnavailableError();
}

function requiredDatabaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new IdentityServiceUnavailableError();
  return value.trim();
}

function assertMatchingKey(row: GatewaySigningKeyRecord, key: Readonly<{ kid: string; publicJwk: Readonly<Record<string, unknown>> }>, keyReference: string): void {
  if (row.keyReference !== keyReference || row.kid !== key.kid || !samePublicJwk(row.publicJwk, key.publicJwk) || row.status === 'retiring' || row.status === 'retired') throw new IdentityServiceUnavailableError();
}

function samePublicJwk(value: unknown, expected: Readonly<Record<string, unknown>>): boolean {
  if (!isRecord(value)) return false;
  return value.kty === expected.kty && value.kid === expected.kid && value.alg === expected.alg && value.use === expected.use && value.n === expected.n && value.e === expected.e && !['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((field) => field in value);
}

function localRetirementPolicy(): KeyRetirementPolicy {
  return new KeyRetirementPolicy({ finalOldTokenLifetimeSeconds: 300, backendClockToleranceSeconds: 300, remoteJwksCacheSeconds: 600, remoteJwksCooldownSeconds: 30, propagationMarginSeconds: 60, enforcedMinimumOverlapSeconds: 1500, httpCacheControlSeconds: 60 });
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nonBlank(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

if (require.main === module) {
  void bootstrapLocalSigningKey().then(
    (result) => { process.stdout.write(`Gateway local signing bootstrap ${result.status === 'already_active' ? 'already active' : 'completed'}.\n`); },
    () => { process.stderr.write('Gateway local signing bootstrap failed.\n'); process.exitCode = 1; }
  );
}
