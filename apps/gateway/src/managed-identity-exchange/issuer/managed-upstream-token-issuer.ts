import { randomUUID } from 'node:crypto';
import { SignJWT, type KeyLike } from 'jose';
import {
  ManagedExchangeInfrastructureError,
  ManagedExchangeIssuanceError,
  type CanonicalManagedIdentity,
  type ManagedSigningKeyProvider,
  type ManagedTokenIssuer
} from '../domain/managed-exchange.domain';

const TTL_SECONDS = 300;
const IDENTITY_KEYS = ['integrationId', 'subject', 'organizationId', 'hostApp', 'roles', 'permissionScopes'] as const;
const SIGNING_KEYS = ['issuer', 'audience', 'kid', 'privateKey'] as const;

/** Signs only validated canonical managed identities with the current managed handle. */
export class ManagedUpstreamTokenIssuer implements ManagedTokenIssuer {
  constructor(private readonly signingKeys: ManagedSigningKeyProvider) {}

  async issue(identity: CanonicalManagedIdentity): Promise<Readonly<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number; jti: string; kid: string }>> {
    const canonical = canonicalIdentity(identity);
    const active = await this.activeKey();
    const iat = Math.floor(Date.now() / 1000);
    const jti = randomUUID();
    try {
      const accessToken = await new SignJWT({
        integration_id: canonical.integrationId,
        sub: canonical.subject,
        org_id: canonical.organizationId,
        host_app: canonical.hostApp,
        roles: [],
        permission_scopes: canonical.permissionScopes
      })
        .setProtectedHeader({ alg: 'RS256', kid: active.kid })
        .setIssuer(active.issuer)
        .setAudience(active.audience)
        .setIssuedAt(iat)
        .setExpirationTime(iat + TTL_SECONDS)
        .setJti(jti)
        .sign(active.privateKey);
      return Object.freeze({ accessToken, tokenType: 'Bearer', expiresIn: TTL_SECONDS, jti, kid: active.kid });
    } catch {
      throw new ManagedExchangeIssuanceError();
    }
  }

  private async activeKey(): Promise<Readonly<{ issuer: string; audience: string; kid: string; privateKey: KeyLike }>> {
    let active: unknown;
    try {
      active = await this.signingKeys.findActive();
    } catch (error) {
      if (error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeIssuanceError();
    }
    try {
      if (!record(active) || !exact(active, SIGNING_KEYS) || !keyHandle(active.privateKey)) throw new ManagedExchangeIssuanceError();
      return Object.freeze({ issuer: text(active.issuer), audience: text(active.audience), kid: text(active.kid), privateKey: active.privateKey });
    } catch {
      throw new ManagedExchangeIssuanceError();
    }
  }
}

function canonicalIdentity(value: unknown): Readonly<{ integrationId: string; subject: string; organizationId: string; hostApp: string; permissionScopes: readonly string[] }> {
  if (!record(value) || !exact(value, IDENTITY_KEYS) || !Array.isArray(value.roles) || value.roles.length !== 0 || !Array.isArray(value.permissionScopes)) {
    throw new ManagedExchangeIssuanceError();
  }
  return Object.freeze({
    integrationId: text(value.integrationId),
    subject: text(value.subject),
    organizationId: text(value.organizationId),
    hostApp: text(value.hostApp),
    permissionScopes: Object.freeze(value.permissionScopes.map(scope))
  });
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeIssuanceError();
  const normalized = value.trim();
  if (!normalized || control(normalized)) throw new ManagedExchangeIssuanceError();
  return normalized;
}

function scope(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim() || !value || control(value)) {
    throw new ManagedExchangeIssuanceError();
  }
  return value;
}

function keyHandle(value: unknown): value is KeyLike {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
