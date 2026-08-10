import type { KeyLike } from 'jose';
import { GatewaySigningKeyRepository, type ActiveSigningKeyRecord } from './gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from './identity-service-unavailable.error';
import { SigningKeyProvider } from './signing-key-provider';

export type ActiveSigningKey = Readonly<{ kid: string; privateKey: KeyLike }>;

export class ActiveSigningKeyResolver {
  constructor(
    private readonly repository: Pick<GatewaySigningKeyRepository, 'findActive'>,
    private readonly provider: Pick<SigningKeyProvider, 'load'>
  ) {}

  async resolveActiveSigningKey(): Promise<ActiveSigningKey> {
    try {
      const row = await this.repository.findActive();
      if (!isValidActiveSigningKey(row)) throw new IdentityServiceUnavailableError();
      const privateKey = await this.provider.load(row.keyReference);
      return Object.freeze({ kid: row.kid, privateKey });
    } catch {
      throw new IdentityServiceUnavailableError();
    }
  }
}

function isValidActiveSigningKey(row: ActiveSigningKeyRecord | null): row is ActiveSigningKeyRecord {
  if (!row || row.status !== 'active' || !isNonBlank(row.kid) || !isNonBlank(row.keyReference)) return false;
  if (!isRecord(row.publicJwk)) return false;
  return row.publicJwk.kty === 'RSA'
    && row.publicJwk.kid === row.kid
    && row.publicJwk.alg === 'RS256'
    && row.publicJwk.use === 'sig'
    && isNonBlank(row.publicJwk.n)
    && isNonBlank(row.publicJwk.e);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
