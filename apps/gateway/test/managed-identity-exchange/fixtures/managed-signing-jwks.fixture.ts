import { exportJWK, generateKeyPair, type KeyLike } from 'jose';
import { ManagedSigningKeyRuntimeProvider } from '../../../src/managed-identity-exchange/issuer/managed-signing-key.provider';
import { ManagedJwksService } from '../../../src/managed-identity-exchange/issuer/managed-jwks.service';

export type ManagedKeyStatus = 'new' | 'published' | 'active' | 'retiring' | 'retired';
type KeyState = {
  kid: string;
  status: ManagedKeyStatus;
  enabled: boolean;
  lifecycle: 'draft' | 'active' | 'disabled' | 'replaced';
  keyReference: string;
  publicJwk: Record<string, unknown>;
  privateKey: KeyLike;
};

/** Test-only mutable lifecycle view shared by the managed signer and JWKS reader. */
export async function createManagedSigningJwksFixture(initial: Readonly<{ keys: readonly Readonly<{ kid: string; status: ManagedKeyStatus }>[], issuerEnabled?: boolean; issuerLifecycle?: string }> ) {
  const keys = new Map<string, KeyState>();
  for (const entry of initial.keys) {
    const pair = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(pair.publicKey);
    keys.set(entry.kid, {
      kid: entry.kid,
      status: entry.status,
      ...state(entry.status),
      keyReference: `managed-ref-${entry.kid}`,
      publicJwk: { ...publicJwk, kid: entry.kid, alg: 'RS256', use: 'sig' },
      privateKey: pair.privateKey as KeyLike
    });
  }
  const issuer = { id: 'issuer-a', issuer: 'https://managed.example.test', expectedAudience: 'managed-audience', enabled: initial.issuerEnabled ?? true, lifecycle: initial.issuerLifecycle ?? 'active' };
  const findIssuers = jest.fn(async () => issuer.enabled === true && issuer.lifecycle === 'active' ? [issuer] : []);
  const findActiveKeys = jest.fn(async (issuerId: string) => [...keys.values()]
    .filter((key) => issuerId === issuer.id && key.status === 'active' && key.enabled === true && key.lifecycle === 'active')
    .map((key) => ({ issuerId, kid: key.kid, keyReference: key.keyReference, publicJwk: key.publicJwk, status: key.status, enabled: key.enabled, lifecycle: key.lifecycle })));
  const findVisibleKeys = jest.fn(async (issuerId: string) => [...keys.values()]
    .filter((key) => issuerId === issuer.id && ['published', 'active', 'retiring'].includes(key.status))
    .map((key) => ({ issuerId, kid: key.kid, publicJwk: key.publicJwk, status: key.status })));
  const load = jest.fn(async (reference: string) => {
    const key = [...keys.values()].find((candidate) => candidate.keyReference === reference);
    if (!key) throw new Error('missing managed key');
    return key.privateKey;
  });
  return {
    provider: new ManagedSigningKeyRuntimeProvider({
      issuers: { findEnabledActive: findIssuers } as never,
      signingKeys: { findEnabledActiveByIssuerId: findActiveKeys } as never,
      keyLoader: { load } as never
    }),
    jwks: new ManagedJwksService({
      issuers: { findEnabledActive: findIssuers } as never,
      signingKeys: { findJwksVisibleByIssuerId: findVisibleKeys } as never
    }),
    findIssuers,
    findActiveKeys,
    findVisibleKeys,
    load,
    setStatus(kid: string, status: ManagedKeyStatus) {
      const key = keys.get(kid);
      if (!key) throw new Error('missing managed key');
      Object.assign(key, { status, ...state(status) });
    },
    publicKey(kid: string) {
      const key = keys.get(kid);
      if (!key) throw new Error('missing managed key');
      return key.publicJwk;
    }
  };
}

function state(status: ManagedKeyStatus): Pick<KeyState, 'enabled' | 'lifecycle'> {
  if (status === 'active') return { enabled: true, lifecycle: 'active' };
  if (status === 'retired') return { enabled: false, lifecycle: 'disabled' };
  if (status === 'retiring') return { enabled: false, lifecycle: 'disabled' };
  return { enabled: false, lifecycle: 'draft' };
}
