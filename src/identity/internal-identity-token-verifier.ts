import {
  CompactVerifyGetKey,
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeProtectedHeader,
  JSONWebKeySet,
  jwtVerify,
  JWTVerifyGetKey
} from 'jose';
import { IdentityTokenException } from './identity.errors';
import {
  InternalIdentityConfig,
  InternalIdentityTokenVerifier,
  StaticInternalIdentityVerificationInput,
  validateInternalIdentityConfig,
  validateInternalIdentityVerificationConfig,
  VerifiedInternalIdentityToken
} from './identity-token.types';

const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function parseBearerToken(authorization: string | undefined): string {
  if (typeof authorization !== 'string') {
    throw new IdentityTokenException('missing_token');
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || !COMPACT_JWT_PATTERN.test(match[1])) {
    throw new IdentityTokenException('malformed_bearer');
  }

  return match[1];
}

export class RemoteJwksInternalIdentityTokenVerifier implements InternalIdentityTokenVerifier {
  private readonly keySet: JWTVerifyGetKey;

  constructor(private readonly config: InternalIdentityConfig) {
    this.config = validateInternalIdentityConfig(config);
    this.keySet = createRemoteJWKSet(new URL(this.config.jwksUri));
  }

  verify(input: { authorization?: string }): Promise<VerifiedInternalIdentityToken> {
    return verifyInternalIdentityToken({
      authorization: input.authorization,
      issuer: this.config.issuer,
      audience: this.config.audience,
      keySet: this.keySet,
      clockToleranceSeconds: this.config.clockToleranceSeconds
    });
  }
}

export const internalIdentityTokenVerifierForTest = {
  async verify(input: StaticInternalIdentityVerificationInput): Promise<VerifiedInternalIdentityToken> {
    const config = validateInternalIdentityVerificationConfig({
      issuer: input.issuer,
      audience: input.audience,
      clockToleranceSeconds: input.clockToleranceSeconds ?? 0
    });
    const keySet = createLocalJWKSet(input.jwks as unknown as JSONWebKeySet);
    return verifyInternalIdentityToken({
      authorization: input.authorization,
      issuer: config.issuer,
      audience: config.audience,
      keySet,
      clockToleranceSeconds: config.clockToleranceSeconds
    });
  }
};

export function createStaticInternalIdentityTokenVerifier(config: Omit<StaticInternalIdentityVerificationInput, 'authorization'>): InternalIdentityTokenVerifier {
  const validatedConfig = validateInternalIdentityVerificationConfig({
    issuer: config.issuer,
    audience: config.audience,
    clockToleranceSeconds: config.clockToleranceSeconds ?? 0
  });
  const keySet = createLocalJWKSet(config.jwks as unknown as JSONWebKeySet);
  return {
    verify: (input) =>
      verifyInternalIdentityToken({
        authorization: input.authorization,
        issuer: validatedConfig.issuer,
        audience: validatedConfig.audience,
        keySet,
        clockToleranceSeconds: validatedConfig.clockToleranceSeconds
      })
  };
}

async function verifyInternalIdentityToken(input: {
  authorization?: string;
  issuer: string;
  audience: string;
  keySet: CompactVerifyGetKey | JWTVerifyGetKey;
  clockToleranceSeconds: number;
}): Promise<VerifiedInternalIdentityToken> {
  try {
    const token = parseBearerToken(input.authorization);
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'RS256') {
      throw new IdentityTokenException('invalid_algorithm');
    }
    if (typeof header.kid !== 'string' || header.kid.trim().length === 0) {
      throw new IdentityTokenException('unknown_kid');
    }

    const { payload } = await jwtVerify(token, input.keySet, {
      algorithms: ['RS256'],
      issuer: input.issuer,
      audience: input.audience,
      clockTolerance: input.clockToleranceSeconds
    });
    validateRegisteredClaims(payload, input.clockToleranceSeconds);
    return { claims: payload as Record<string, unknown>, issuer: input.issuer };
  } catch (error) {
    if (error instanceof IdentityTokenException) {
      throw error;
    }
    throw new IdentityTokenException('token_verification_failed');
  }
}

function validateRegisteredClaims(
  claims: { iat?: unknown; exp?: unknown; nbf?: unknown },
  clockToleranceSeconds: number
): void {
  const now = Math.floor(Date.now() / 1000);
  if (!isFiniteNumericDate(claims.iat) || claims.iat > now + clockToleranceSeconds) {
    throw new IdentityTokenException('invalid_iat');
  }
  if (!isFiniteNumericDate(claims.exp) || claims.exp <= now - clockToleranceSeconds) {
    throw new IdentityTokenException('token_expired');
  }
  if (claims.nbf !== undefined && (!isFiniteNumericDate(claims.nbf) || claims.nbf > now + clockToleranceSeconds)) {
    throw new IdentityTokenException('token_not_active');
  }
}

function isFiniteNumericDate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
