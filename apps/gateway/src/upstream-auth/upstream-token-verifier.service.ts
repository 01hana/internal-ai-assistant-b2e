import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { GatewayUpstreamVerificationConfig } from '../config/gateway-config.service';
import { UpstreamAuthenticationError, type UpstreamAuthReasonCode } from './upstream-auth.error';
import { createVerifiedUpstreamIdentity, type VerifiedUpstreamIdentity } from './verified-upstream-identity';
import { registeredTimeFailure } from './upstream-time-policy';
import { parseBearerToken } from './bearer-token.parser';

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
      const timeFailure = registeredTimeFailure(payload, this.config.clockToleranceSeconds);
      if (timeFailure) throw new UpstreamAuthenticationError(timeFailure);
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
