import { Injectable } from '@nestjs/common';

export const MAX_GATEWAY_CLOCK_TOLERANCE_SECONDS = 300;
export const INTERNAL_GATEWAY_TOKEN_TTL_SECONDS = 300;

export interface GatewayEnvironment {
  internalIssuer: string;
  internalAudience: string;
  publicJwksUrl: string;
  upstreamIssuer: string;
  upstreamAudience: string;
  upstreamJwksUri: string;
  upstreamClockToleranceSeconds: number;
  internalTokenTtlSeconds: number;
  backendBaseUrl: string;
  signingKeyReference: string;
  port: number;
}

export type GatewayUpstreamVerificationConfig = Readonly<{
  issuer: string;
  audience: string;
  jwksUri: string;
  clockToleranceSeconds: number;
}>;

export class GatewayConfigurationError extends Error {
  constructor() {
    super('Invalid Gateway configuration.');
  }
}

@Injectable()
export class GatewayConfigService {
  constructor(private readonly environment: GatewayEnvironment) {}

  get config(): Readonly<GatewayEnvironment> {
    return this.environment;
  }

  get upstreamVerification(): GatewayUpstreamVerificationConfig {
    return Object.freeze({
      issuer: this.environment.upstreamIssuer,
      audience: this.environment.upstreamAudience,
      jwksUri: this.environment.upstreamJwksUri,
      clockToleranceSeconds: this.environment.upstreamClockToleranceSeconds
    });
  }
}

export function validateGatewayEnvironment(input: Record<string, unknown>): GatewayEnvironment {
  return {
    internalIssuer: requireIssuer(input.GATEWAY_INTERNAL_JWT_ISSUER),
    internalAudience: requireNonBlankString(input.GATEWAY_INTERNAL_JWT_AUDIENCE),
    publicJwksUrl: requireUrl(input.GATEWAY_PUBLIC_JWKS_URL),
    upstreamIssuer: requireIssuer(input.GATEWAY_UPSTREAM_JWT_ISSUER),
    upstreamAudience: requireNonBlankString(input.GATEWAY_UPSTREAM_JWT_AUDIENCE),
    upstreamJwksUri: requireUrl(input.GATEWAY_UPSTREAM_JWKS_URI),
    upstreamClockToleranceSeconds: requireIntegerInRange(
      input.GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS,
      0,
      MAX_GATEWAY_CLOCK_TOLERANCE_SECONDS
    ),
    internalTokenTtlSeconds: requireExactInteger(input.GATEWAY_INTERNAL_JWT_TTL_SECONDS, INTERNAL_GATEWAY_TOKEN_TTL_SECONDS),
    backendBaseUrl: requireUrl(input.GATEWAY_BACKEND_BASE_URL),
    signingKeyReference: requireSigningKeyReference(input.GATEWAY_SIGNING_KEY_REFERENCE),
    port: requireIntegerInRange(input.GATEWAY_PORT ?? 4000, 1, 65_535)
  };
}

function requireNonBlankString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GatewayConfigurationError();
  }
  return value.trim();
}

function requireUrl(value: unknown): string {
  const normalized = requireNonBlankString(value);
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new GatewayConfigurationError();
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof GatewayConfigurationError) throw error;
    throw new GatewayConfigurationError();
  }
}

/** JWT issuers are exact string identifiers, not normalized network endpoints. */
function requireIssuer(value: unknown): string {
  const issuer = requireNonBlankString(value);
  try {
    const parsed = new URL(issuer);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new GatewayConfigurationError();
    }
    return issuer;
  } catch (error) {
    if (error instanceof GatewayConfigurationError) throw error;
    throw new GatewayConfigurationError();
  }
}

function requireIntegerInRange(value: unknown, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GatewayConfigurationError();
  }
  return parsed;
}

function requireExactInteger(value: unknown, expected: number): number {
  const parsed = requireIntegerInRange(value, expected, expected);
  return parsed;
}

function requireSigningKeyReference(value: unknown): string {
  const normalized = requireNonBlankString(value);
  if (
    containsControlCharacter(normalized) ||
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i.test(normalized) ||
    /^Bearer\s+\S+/i.test(normalized) ||
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(normalized)
  ) {
    throw new GatewayConfigurationError();
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
