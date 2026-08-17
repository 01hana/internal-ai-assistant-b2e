import { Injectable } from '@nestjs/common';

export const MAX_GATEWAY_CLOCK_TOLERANCE_SECONDS = 300;
export const INTERNAL_GATEWAY_TOKEN_TTL_SECONDS = 300;

export interface GatewayEnvironment {
  internalIssuer: string;
  internalAudience: string;
  publicJwksUrl: string;
  bootstrapUpstreamIssuer?: string;
  bootstrapUpstreamAudience?: string;
  bootstrapUpstreamJwksUri?: string;
  upstreamClockToleranceSeconds: number;
  internalTokenTtlSeconds: number;
  backendBaseUrl: string;
  signingKeyReference: string;
  allowedOrigins: readonly string[];
  localSigningBootstrapEnabled: boolean;
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

  get bootstrapUpstreamVerification(): GatewayUpstreamVerificationConfig {
    const issuer = this.environment.bootstrapUpstreamIssuer;
    const audience = this.environment.bootstrapUpstreamAudience;
    const jwksUri = this.environment.bootstrapUpstreamJwksUri;
    return Object.freeze({
      issuer: requireIssuer(issuer),
      audience: requireNonBlankString(audience),
      jwksUri: requireUrl(jwksUri),
      clockToleranceSeconds: this.environment.upstreamClockToleranceSeconds
    });
  }
}

export function validateGatewayEnvironment(input: Record<string, unknown>): GatewayEnvironment {
  return {
    internalIssuer: requireIssuer(input.GATEWAY_INTERNAL_JWT_ISSUER),
    internalAudience: requireNonBlankString(input.GATEWAY_INTERNAL_JWT_AUDIENCE),
    publicJwksUrl: requireUrl(input.GATEWAY_PUBLIC_JWKS_URL),
    ...optionalBootstrapUpstreamPolicy(input),
    upstreamClockToleranceSeconds: requireIntegerInRange(
      input.GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS,
      0,
      MAX_GATEWAY_CLOCK_TOLERANCE_SECONDS
    ),
    internalTokenTtlSeconds: requireExactInteger(input.GATEWAY_INTERNAL_JWT_TTL_SECONDS, INTERNAL_GATEWAY_TOKEN_TTL_SECONDS),
    backendBaseUrl: requireUrl(input.GATEWAY_BACKEND_BASE_URL),
    signingKeyReference: requireSigningKeyReference(input.GATEWAY_SIGNING_KEY_REFERENCE),
    allowedOrigins: requireAllowedOrigins(input.GATEWAY_ALLOWED_ORIGINS),
    localSigningBootstrapEnabled: optionalBoolean(input.GATEWAY_LOCAL_SIGNING_BOOTSTRAP_ENABLED, false),
    port: requireIntegerInRange(input.GATEWAY_PORT ?? 4000, 1, 65_535)
  };
}

function optionalBootstrapUpstreamPolicy(input: Record<string, unknown>): Pick<GatewayEnvironment, 'bootstrapUpstreamIssuer' | 'bootstrapUpstreamAudience' | 'bootstrapUpstreamJwksUri'> {
  const issuer = input.GATEWAY_UPSTREAM_JWT_ISSUER;
  const audience = input.GATEWAY_UPSTREAM_JWT_AUDIENCE;
  const jwksUri = input.GATEWAY_UPSTREAM_JWKS_URI;
  if (issuer === undefined && audience === undefined && jwksUri === undefined) return {};
  return {
    bootstrapUpstreamIssuer: typeof issuer === 'string' ? issuer : undefined,
    bootstrapUpstreamAudience: typeof audience === 'string' ? audience : undefined,
    bootstrapUpstreamJwksUri: typeof jwksUri === 'string' ? jwksUri : undefined
  };
}

function requireAllowedOrigins(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new GatewayConfigurationError();
  const origins = value.split(',').map((origin) => origin.trim());
  if (origins.length === 0 || origins.some((origin) => origin.length === 0 || origin === '*')) {
    throw new GatewayConfigurationError();
  }
  const normalized = origins.map((origin) => {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new GatewayConfigurationError();
      }
      return parsed.origin;
    } catch (error) {
      if (error instanceof GatewayConfigurationError) throw error;
      throw new GatewayConfigurationError();
    }
  });
  return Object.freeze([...new Set(normalized)]);
}

function optionalBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new GatewayConfigurationError();
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
