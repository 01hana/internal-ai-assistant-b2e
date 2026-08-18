import { randomUUID } from 'node:crypto';
import { createUpstreamJwksFixture } from './upstream-jwks.fixture';

export type TrustedNativeIdentity = Readonly<{
  principal: string;
  organization: string;
  roles: readonly string[];
  permissionScopes: readonly string[];
}>;

export type TokenExchangeFixture = Readonly<{
  issuer: string;
  audience: string;
  jwksUri: string;
  kid: string;
  ttlSeconds: number;
  issueTrustedNativeCredential(identity?: Partial<TrustedNativeIdentity>): string;
  revokeTrustedNativeCredential(credential: string): void;
  exchange(credential: string): Promise<string>;
  exchangeInvalidSignature(credential: string): Promise<string>;
  issuedTokenCount(): number;
  close(): Promise<void>;
}>;

const TTL_SECONDS = 120;
const INTEGRATION_ID = 'integration-b';
const HOST_APP = 'admin';

/** Test-only server-side native verification and canonical credential projection. */
export async function createTokenExchangeFixture(): Promise<TokenExchangeFixture> {
  const upstream = await createUpstreamJwksFixture({ authorityLabel: 'token-exchange' });
  const credentials = new Map<string, TrustedNativeIdentity>();
  let issued = 0;
  const verify = (credential: string): TrustedNativeIdentity => {
    if (typeof credential !== 'string' || !credential.trim()) throw new TokenExchangeError();
    const identity = credentials.get(credential);
    if (!identity) throw new TokenExchangeError();
    return identity;
  };
  const issue = async (credential: string, invalidSignature: boolean): Promise<string> => {
    const identity = verify(credential);
    issued += 1;
    const canonical = project(identity);
    return invalidSignature
      ? upstream.issueWith('new', canonical, { kid: upstream.oldKid })
      : upstream.issue(canonical);
  };

  return Object.freeze({
    issuer: upstream.issuer,
    audience: upstream.audience,
    jwksUri: upstream.jwksUri,
    kid: upstream.oldKid,
    ttlSeconds: TTL_SECONDS,
    issueTrustedNativeCredential: (identity = {}) => {
      const credential = `native-${randomUUID()}`;
      credentials.set(credential, trusted(identity));
      return credential;
    },
    revokeTrustedNativeCredential: (credential) => { credentials.delete(credential); },
    exchange: (credential) => issue(credential, false),
    exchangeInvalidSignature: (credential) => issue(credential, true),
    issuedTokenCount: () => issued,
    close: async () => {
      credentials.clear();
      await upstream.close();
    }
  });
}

export class TokenExchangeError extends Error {
  constructor() {
    super('Token exchange cannot be completed.');
    this.name = 'TokenExchangeError';
  }
}

function trusted(input: Partial<TrustedNativeIdentity>): TrustedNativeIdentity {
  if (!input || typeof input !== 'object') throw new TokenExchangeError();
  const identity = {
    principal: input.principal ?? 'actor-b',
    organization: input.organization ?? 'org-b',
    roles: input.roles ?? ['planner'],
    permissionScopes: input.permissionScopes ?? ['orders:read']
  };
  if (!isNativeText(identity.principal) || !isNativeText(identity.organization)
    || !isNativeCollection(identity.roles) || !isNativeCollection(identity.permissionScopes)) throw new TokenExchangeError();
  return Object.freeze(identity);
}

function isNativeText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNativeCollection(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNativeText);
}

function project(identity: TrustedNativeIdentity): Record<string, unknown> {
  return {
    integration_id: INTEGRATION_ID,
    sub: identity.principal,
    org_id: identity.organization,
    host_app: HOST_APP,
    roles: identity.roles,
    permission_scopes: identity.permissionScopes
  };
}
