import { createUpstreamJwksFixture } from './upstream-jwks.fixture';

export type DirectJwtIdentity = Readonly<{
  integration_id: string;
  sub: string;
  org_id: string;
  host_app: string;
  roles: readonly string[];
  permission_scopes: readonly string[];
}>;

export type DirectJwtFixture = Readonly<{
  issuer: string;
  audience: string;
  jwksUri: string;
  kid: string;
  ttlSeconds: number;
  issue(identity?: Partial<DirectJwtIdentity>): Promise<string>;
  issueInvalidSignature(): Promise<string>;
  close(): Promise<void>;
}>;

const TTL_SECONDS = 120;

/** Test-only direct canonical issuer with a deliberately narrow issuance surface. */
export async function createDirectJwtFixture(): Promise<DirectJwtFixture> {
  const upstream = await createUpstreamJwksFixture({ authorityLabel: 'direct-jwt' });
  return Object.freeze({
    issuer: upstream.issuer,
    audience: upstream.audience,
    jwksUri: upstream.jwksUri,
    kid: upstream.oldKid,
    ttlSeconds: TTL_SECONDS,
    issue: (identity = {}) => upstream.issue(canonical(identity)),
    issueInvalidSignature: () => upstream.issueWith('new', canonical({}), { kid: upstream.oldKid }),
    close: () => upstream.close()
  });
}

function canonical(identity: Partial<DirectJwtIdentity>): Record<string, unknown> {
  return {
    integration_id: identity.integration_id ?? 'integration-a',
    sub: identity.sub ?? 'actor-a',
    org_id: identity.org_id ?? 'org-a',
    host_app: identity.host_app ?? 'admin',
    roles: identity.roles ?? ['planner'],
    permission_scopes: identity.permission_scopes ?? ['orders:read']
  };
}
