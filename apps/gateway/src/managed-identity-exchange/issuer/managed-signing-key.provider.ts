import type { KeyLike } from 'jose';
import { SigningKeyProvider } from '../../signing/signing-key-provider';
import { ManagedExchangeInfrastructureError, type ManagedSigningKeyProvider } from '../domain/managed-exchange.domain';
import type {
  ManagedUpstreamIssuerRepository,
  ManagedUpstreamIssuerRecord,
  ManagedUpstreamSigningKeyRepository
} from '../persistence/managed-exchange.repository';

type Issuer = Pick<ManagedUpstreamIssuerRecord, 'id' | 'issuer' | 'expectedAudience' | 'enabled' | 'lifecycle'>;
type Key = Readonly<{ issuerId: string; kid: string; keyReference: string }>;

const PRIVATE_JWK_MEMBERS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']);

/** Selects and loads exactly one active managed signing handle per invocation. */
export class ManagedSigningKeyRuntimeProvider implements ManagedSigningKeyProvider {
  constructor(private readonly dependencies: Readonly<{
    issuers: Pick<ManagedUpstreamIssuerRepository, 'findEnabledActive'>;
    signingKeys: Pick<ManagedUpstreamSigningKeyRepository, 'findEnabledActiveByIssuerId'>;
    keyLoader: Pick<SigningKeyProvider, 'load'>;
  }>) {}

  async findActive(): Promise<Readonly<{ issuer: string; audience: string; kid: string; privateKey: KeyLike }>> {
    try {
      const issuers = await this.dependencies.issuers.findEnabledActive();
      if (issuers.length !== 1) throw new ManagedExchangeInfrastructureError();
      const issuer = activeIssuer(issuers[0]);

      const keys = await this.dependencies.signingKeys.findEnabledActiveByIssuerId(issuer.id);
      if (keys.length !== 1) throw new ManagedExchangeInfrastructureError();
      const key = activeKey(keys[0], issuer.id);
      const privateKey = await this.dependencies.keyLoader.load(key.keyReference);
      return Object.freeze({ issuer: issuer.issuer, audience: issuer.expectedAudience, kid: key.kid, privateKey });
    } catch {
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function activeIssuer(value: unknown): Issuer {
  if (!record(value) || value.enabled !== true || value.lifecycle !== 'active') throw new ManagedExchangeInfrastructureError();
  return Object.freeze({ id: text(value.id), issuer: text(value.issuer), expectedAudience: text(value.expectedAudience), enabled: true, lifecycle: 'active' });
}

function activeKey(value: unknown, issuerId: string): Key {
  if (!record(value) || value.enabled !== true || value.lifecycle !== 'active' || value.status !== 'active' || value.issuerId !== issuerId) {
    throw new ManagedExchangeInfrastructureError();
  }
  const kid = text(value.kid);
  const keyReference = text(value.keyReference);
  publicRsa(value.publicJwk);
  return Object.freeze({ issuerId, kid, keyReference });
}

function publicRsa(value: unknown): void {
  if (!record(value) || value.kty !== 'RSA' || !textOrFalse(value.n) || !textOrFalse(value.e) ||
    Reflect.ownKeys(value).some((key) => typeof key === 'string' && PRIVATE_JWK_MEMBERS.has(key)) ||
    (value.alg !== undefined && value.alg !== 'RS256') || (value.use !== undefined && value.use !== 'sig')) {
    throw new ManagedExchangeInfrastructureError();
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeInfrastructureError();
  const normalized = value.trim();
  if (!normalized || control(normalized)) throw new ManagedExchangeInfrastructureError();
  return normalized;
}

function textOrFalse(value: unknown): boolean {
  try { text(value); return true; } catch { return false; }
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
