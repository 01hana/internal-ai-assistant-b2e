import { Injectable } from '@nestjs/common';

export interface GatewayClientRegistration {
  hostApp: string;
}

@Injectable()
export class GatewayConfigService {
  readonly port = readPort('GATEWAY_PORT', 4000);
  readonly externalJwtIssuer = required('GATEWAY_EXTERNAL_JWT_ISSUER');
  readonly externalJwtAudience = required('GATEWAY_EXTERNAL_JWT_AUDIENCE');
  readonly externalJwksUri = requiredUrl('GATEWAY_EXTERNAL_JWKS_URI');
  readonly internalJwtIssuer = required('GATEWAY_INTERNAL_JWT_ISSUER');
  readonly internalJwtAudience = required('GATEWAY_INTERNAL_JWT_AUDIENCE');
  readonly internalJwtKeyId = required('GATEWAY_INTERNAL_JWT_KEY_ID');
  readonly internalJwtPrivateKeyBase64 = required('GATEWAY_INTERNAL_JWT_PRIVATE_KEY_BASE64');
  readonly backendBaseUrl = requiredUrl('GATEWAY_BACKEND_001_BASE_URL');
  readonly clientRegistry = readClientRegistry(required('GATEWAY_CLIENT_REGISTRY_JSON'));
  readonly internalTokenTtlSeconds = readPositiveInteger('GATEWAY_INTERNAL_JWT_TTL_SECONDS', 300);

  get internalPrivateKeyPem(): string {
    return Buffer.from(this.internalJwtPrivateKeyBase64, 'base64').toString('utf8');
  }
}

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required Gateway configuration: ${key}`);
  return value;
}

function requiredUrl(key: string): string {
  const value = required(key);
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`Gateway configuration ${key} must be an absolute URL.`);
  }
}

function readPort(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Gateway configuration ${key} must be a valid port.`);
  return port;
}

function readPositiveInteger(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`Gateway configuration ${key} must be a positive integer.`);
  return number;
}

function readClientRegistry(value: string): Readonly<Record<string, GatewayClientRegistration>> {
  try {
    const parsed = JSON.parse(value) as Record<string, GatewayClientRegistration>;
    if (
      !parsed ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((registration) => !registration || typeof registration.hostApp !== 'string' || !registration.hostApp.trim())
    ) {
      throw new Error('invalid registry');
    }
    return Object.fromEntries(Object.entries(parsed).map(([clientId, registration]) => [clientId, { hostApp: registration.hostApp.trim() }]));
  } catch {
    throw new Error('Gateway configuration GATEWAY_CLIENT_REGISTRY_JSON must be a JSON object mapping client IDs to non-empty hostApp values.');
  }
}
