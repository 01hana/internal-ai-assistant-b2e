import { Inject, Injectable, Optional } from '@nestjs/common';
import { GatewaySigningKeyRepository, type JwksVisibleSigningKeyRecord } from '../signing/gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from '../signing/identity-service-unavailable.error';

const VISIBLE_STATUSES = new Set(['published', 'active', 'retiring']);
const PUBLIC_JWK_FIELDS = ['kty', 'kid', 'alg', 'use', 'n', 'e'] as const;

export type PublicJwk = Readonly<{ kty: 'RSA'; kid: string; alg: 'RS256'; use: 'sig'; n: string; e: string }>;
export type JwksDocument = Readonly<{ keys: readonly PublicJwk[] }>;

@Injectable()
export class JwksService {
  constructor(
    @Optional()
    @Inject(GatewaySigningKeyRepository)
    private readonly repository?: Pick<GatewaySigningKeyRepository, 'findJwksVisible'>
  ) {}

  async createDocument(rows: readonly JwksVisibleSigningKeyRecord[]): Promise<JwksDocument> {
    try {
      const keys = rows
        .filter((row) => VISIBLE_STATUSES.has(row.status))
        .map((row) => toPublicJwk(row));
      return Object.freeze({ keys: Object.freeze(keys) });
    } catch {
      throw new IdentityServiceUnavailableError();
    }
  }

  async getDocument(): Promise<JwksDocument> {
    try {
      if (!this.repository) throw new IdentityServiceUnavailableError();
      return await this.createDocument(await this.repository.findJwksVisible());
    } catch {
      throw new IdentityServiceUnavailableError();
    }
  }
}

function toPublicJwk(row: JwksVisibleSigningKeyRecord): PublicJwk {
  const publicJwk = row.publicJwk;
  if (!isRecord(publicJwk) || !VISIBLE_STATUSES.has(row.status) || !isNonBlank(row.kid)) {
    throw new IdentityServiceUnavailableError();
  }
  const values = PUBLIC_JWK_FIELDS.map((field) => publicJwk[field]);
  const [kty, kid, alg, use, n, e] = values;
  if (kty !== 'RSA' || kid !== row.kid || alg !== 'RS256' || use !== 'sig' || !isNonBlank(n) || !isNonBlank(e)) {
    throw new IdentityServiceUnavailableError();
  }
  return Object.freeze({ kty, kid, alg, use, n, e });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
