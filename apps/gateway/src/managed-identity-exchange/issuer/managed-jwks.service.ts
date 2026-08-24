import { ManagedExchangeInfrastructureError } from '../domain/managed-exchange.domain';
import type {
  ManagedJwksVisibleSigningKeyRecord,
  ManagedUpstreamIssuerRepository,
  ManagedUpstreamSigningKeyRepository
} from '../persistence/managed-exchange.repository';

const VISIBLE_STATUSES = new Set(['published', 'active', 'retiring']);
const PRIVATE_JWK_MEMBERS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);

export type ManagedPublicJwk = Readonly<{ kty: 'RSA'; kid: string; alg: 'RS256'; use: 'sig'; n: string; e: string }>;
export type ManagedJwksDocument = Readonly<{ keys: readonly ManagedPublicJwk[] }>;

/** Publishes persisted managed public metadata only; it never loads signing material. */
export class ManagedJwksService {
  constructor(private readonly dependencies: Readonly<{
    issuers: Pick<ManagedUpstreamIssuerRepository, 'findEnabledActive'>;
    signingKeys: Pick<ManagedUpstreamSigningKeyRepository, 'findJwksVisibleByIssuerId'>;
  }>) {}

  async getDocument(): Promise<ManagedJwksDocument> {
    try {
      const issuers = await this.dependencies.issuers.findEnabledActive();
      if (issuers.length !== 1) throw new ManagedExchangeInfrastructureError();
      const issuer = activeIssuer(issuers[0]);
      const rows = await this.dependencies.signingKeys.findJwksVisibleByIssuerId(issuer.id);
      const keys = rows
        .filter((row) => VISIBLE_STATUSES.has(row.status))
        .map((row) => publicJwk(row, issuer.id))
        .sort((left, right) => left.kid.localeCompare(right.kid));
      if (new Set(keys.map((key) => key.kid)).size !== keys.length) throw new ManagedExchangeInfrastructureError();
      return Object.freeze({ keys: Object.freeze(keys) });
    } catch {
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function activeIssuer(value: unknown): Readonly<{ id: string }> {
  if (!record(value) || value.enabled !== true || value.lifecycle !== 'active') throw new ManagedExchangeInfrastructureError();
  return Object.freeze({ id: text(value.id) });
}

function publicJwk(row: ManagedJwksVisibleSigningKeyRecord, issuerId: string): ManagedPublicJwk {
  if (!record(row) || row.issuerId !== issuerId || !VISIBLE_STATUSES.has(row.status) || !record(row.publicJwk)) {
    throw new ManagedExchangeInfrastructureError();
  }
  const value = row.publicJwk;
  if (value.kty !== 'RSA' || (value.alg !== undefined && value.alg !== 'RS256') || (value.use !== undefined && value.use !== 'sig') ||
    Reflect.ownKeys(value).some((key) => typeof key === 'string' && PRIVATE_JWK_MEMBERS.has(key))) {
    throw new ManagedExchangeInfrastructureError();
  }
  const kid = text(row.kid);
  if (value.kid !== undefined && value.kid !== kid) throw new ManagedExchangeInfrastructureError();
  return Object.freeze({ kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: text(value.n), e: text(value.e) });
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeInfrastructureError();
  const normalized = value.trim();
  if (!normalized || control(normalized)) throw new ManagedExchangeInfrastructureError();
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
