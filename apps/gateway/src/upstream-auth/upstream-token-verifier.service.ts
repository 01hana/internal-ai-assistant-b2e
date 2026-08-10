import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { GatewayUpstreamVerificationConfig } from '../config/gateway-config.service';
import { UpstreamAuthenticationError, type UpstreamAuthReasonCode } from './upstream-auth.error';
import { createVerifiedUpstreamIdentity, type VerifiedUpstreamIdentity } from './verified-upstream-identity';

const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface UpstreamTokenVerifier {
  verify(input: Readonly<{ authorization?: string }>): Promise<VerifiedUpstreamIdentity>;
}

/** Pure verification boundary: it has no registry, Customer, Prisma, or signing dependency. */
export class RemoteJwksUpstreamTokenVerifier implements UpstreamTokenVerifier {
  private readonly keySet: JWTVerifyGetKey;

  constructor(private readonly config: GatewayUpstreamVerificationConfig) {
    this.config = validateConfig(config);
    this.keySet = createRemoteJWKSet(new URL(this.config.jwksUri));
  }

  async verify(input: Readonly<{ authorization?: string }>): Promise<VerifiedUpstreamIdentity> {
    try {
      const token = parseBearerToken(input.authorization);
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'RS256') throw new UpstreamAuthenticationError('invalid_algorithm');
      if (typeof header.kid !== 'string' || !header.kid.trim()) throw new UpstreamAuthenticationError('invalid_kid');
      const { payload } = await jwtVerify(token, this.keySet, {
        algorithms: ['RS256'], issuer: this.config.issuer, audience: this.config.audience, clockTolerance: this.config.clockToleranceSeconds
      });
      validateRegisteredTimes(payload, this.config.clockToleranceSeconds);
      return createVerifiedUpstreamIdentity(payload as Record<string, unknown>);
    } catch (error) {
      if (error instanceof UpstreamAuthenticationError) throw error;
      throw new UpstreamAuthenticationError(classifyJoseFailure(error));
    }
  }
}

function validateConfig(config: GatewayUpstreamVerificationConfig): GatewayUpstreamVerificationConfig {
  if (!config || !config.issuer || !config.audience || !config.jwksUri || !Number.isInteger(config.clockToleranceSeconds) || config.clockToleranceSeconds < 0 || config.clockToleranceSeconds > 300) {
    throw new UpstreamAuthenticationError('invalid_claim_shape');
  }
  return Object.freeze({ ...config });
}

function parseBearerToken(authorization: string | undefined): string {
  if (typeof authorization !== 'string') throw new UpstreamAuthenticationError('missing_or_malformed_token');
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || !COMPACT_JWT_PATTERN.test(match[1])) throw new UpstreamAuthenticationError('missing_or_malformed_token');
  return match[1];
}

function validateRegisteredTimes(claims: { iat?: unknown; exp?: unknown; nbf?: unknown }, clockToleranceSeconds: number): void {
  const now = Math.floor(Date.now() / 1000);
  if (!numericDate(claims.iat) || claims.iat > now + clockToleranceSeconds) throw new UpstreamAuthenticationError('invalid_iat');
  if (!numericDate(claims.exp) || claims.exp <= now - clockToleranceSeconds) throw new UpstreamAuthenticationError('token_expired');
  if (claims.nbf !== undefined && (!numericDate(claims.nbf) || claims.nbf > now + clockToleranceSeconds)) throw new UpstreamAuthenticationError('token_not_yet_valid');
}

function numericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function classifyJoseFailure(error: unknown): UpstreamAuthReasonCode {
  const details = joseErrorDetails(error);
  if (details.code === 'ERR_JWT_EXPIRED') return 'token_expired';
  if (details.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    if (details.claim === 'iss') return 'issuer_mismatch';
    if (details.claim === 'aud') return 'audience_mismatch';
    if (details.claim === 'nbf') return 'token_not_yet_valid';
    if (details.claim === 'exp') return 'token_expired';
  }
  if (details.code === 'ERR_JWKS_NO_MATCHING_KEY' || details.code === 'ERR_JWKS_INVALID' || details.code === 'ERR_JWK_INVALID') return 'invalid_kid';
  return 'invalid_signature';
}

function joseErrorDetails(error: unknown): Readonly<{ code?: string; claim?: string }> {
  if (typeof error !== 'object' || error === null) return Object.freeze({});
  const candidate = error as Readonly<{ code?: unknown; claim?: unknown }>;
  return Object.freeze({
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    claim: typeof candidate.claim === 'string' ? candidate.claim : undefined
  });
}
