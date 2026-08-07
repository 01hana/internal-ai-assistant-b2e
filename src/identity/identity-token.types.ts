export interface InternalIdentityConfig {
  issuer: string;
  audience: string;
  jwksUri: string;
  clockToleranceSeconds: number;
}

export interface VerifiedInternalIdentityToken {
  claims: Record<string, unknown>;
  issuer: string;
}

export interface InternalIdentityTokenVerifier {
  verify(input: { authorization?: string }): Promise<VerifiedInternalIdentityToken>;
}

export interface StaticInternalIdentityVerificationInput {
  authorization?: string;
  issuer: string;
  audience: string;
  jwks: { readonly keys: ReadonlyArray<Readonly<Record<string, unknown>>> };
  clockToleranceSeconds?: number;
}

export const INTERNAL_IDENTITY_CONFIG = Symbol('INTERNAL_IDENTITY_CONFIG');
export const INTERNAL_IDENTITY_TOKEN_VERIFIER = Symbol('INTERNAL_IDENTITY_TOKEN_VERIFIER');

export class InternalIdentityConfigurationError extends Error {
  constructor() {
    super('Invalid internal identity configuration.');
  }
}

export function validateInternalIdentityVerificationConfig(input: {
  issuer: unknown;
  audience: unknown;
  clockToleranceSeconds: unknown;
}): Pick<InternalIdentityConfig, 'issuer' | 'audience' | 'clockToleranceSeconds'> {
  const issuer = requireNonBlankString(input.issuer);
  const audience = requireNonBlankString(input.audience);
  const clockToleranceSeconds = input.clockToleranceSeconds;
  if (
    typeof clockToleranceSeconds !== 'number' ||
    !Number.isFinite(clockToleranceSeconds) ||
    !Number.isInteger(clockToleranceSeconds) ||
    clockToleranceSeconds < 0 ||
    clockToleranceSeconds > MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS
  ) {
    throw new InternalIdentityConfigurationError();
  }

  return { issuer, audience, clockToleranceSeconds };
}

export function validateInternalIdentityConfig(input: InternalIdentityConfig): InternalIdentityConfig {
  const base = validateInternalIdentityVerificationConfig(input);
  const jwksUri = requireHttpUrl(input.jwksUri);
  return { ...base, jwksUri };
}

function requireNonBlankString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InternalIdentityConfigurationError();
  }
  return value.trim();
}

function requireHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InternalIdentityConfigurationError();
  }

  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      throw new InternalIdentityConfigurationError();
    }
    return url.toString();
  } catch (error) {
    if (error instanceof InternalIdentityConfigurationError) {
      throw error;
    }
    throw new InternalIdentityConfigurationError();
  }
}
import { MAX_INTERNAL_IDENTITY_CLOCK_TOLERANCE_SECONDS } from '../common/config/env.validation';
