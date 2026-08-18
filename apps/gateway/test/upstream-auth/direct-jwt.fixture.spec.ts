import { decodeJwt, decodeProtectedHeader, type JSONWebKeySet } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProfileScopedVerifier, ProfileScopedVerificationError } from '../../src/upstream-auth/profile-scoped-verifier';
import { createDirectJwtFixture, type DirectJwtFixture } from './direct-jwt.fixture';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';

describe('Direct trusted JWT reference fixture (T053/T054)', () => {
  let fixture: DirectJwtFixture;

  beforeAll(async () => { fixture = await createDirectJwtFixture(); });
  afterAll(async () => { await fixture?.close(); });

  it('uses an ephemeral RS256 authority with a nonblank kid and public-only JWKS', async () => {
    const header = decodeProtectedHeader(await fixture.issue());
    const jwks = await (await fetch(fixture.jwksUri)).json() as JSONWebKeySet;

    expect(header).toMatchObject({ alg: 'RS256', kid: fixture.kid });
    expect(fixture.kid.trim()).not.toBe('');
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: fixture.kid, alg: 'RS256', use: 'sig', kty: 'RSA' });
    for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) expect(jwks.keys[0]).not.toHaveProperty(field);
  });

  it('issues a short-lived canonical identity with no Customer or arbitrary claim mapping', async () => {
    const token = await fixture.issue({
      integration_id: 'integration-a', sub: 'actor-a', org_id: 'org-a', host_app: 'admin', roles: ['planner'], permission_scopes: ['orders:read'],
      customer_id: 'customer-attacker', customerId: 'customer-attacker', profile_id: 'attacker-profile', allowedHostApp: 'attacker-host', attacker_extra_claim: 'attacker'
    } as never);
    const payload = decodeJwt(token);

    expect(payload).toMatchObject({
      iss: fixture.issuer, aud: fixture.audience, integration_id: 'integration-a', sub: 'actor-a', org_id: 'org-a', host_app: 'admin',
      roles: ['planner'], permission_scopes: ['orders:read']
    });
    expect(payload.exp).toBeGreaterThan(payload.iat!);
    expect(payload.exp! - payload.iat!).toBe(fixture.ttlSeconds);
    for (const claim of ['customer_id', 'customerId', 'profile_id', 'allowedHostApp', 'attacker_extra_claim']) expect(payload).not.toHaveProperty(claim);
  });

  it('is accepted by the production profile-scoped verifier, including valid empty collections', async () => {
    const verifier = new ProfileScopedVerifier({ transport: new FixtureTransport() });
    await expect(verifier.verify({ profile: profile(fixture), token: await fixture.issue(), clockToleranceSeconds: 0 })).resolves.toMatchObject({ integrationId: 'integration-a' });
    await expect(verifier.verify({
      profile: profile(fixture), token: await fixture.issue({ roles: [], permission_scopes: [] }), clockToleranceSeconds: 0
    })).resolves.toMatchObject({ roles: [], permissionScopes: [] });
  });

  it('fails closed for exact issuer/audience, signature, and canonical-array violations', async () => {
    const verifier = new ProfileScopedVerifier({ transport: new FixtureTransport() });
    const token = await fixture.issue();
    await expectCredential(verifier.verify({ profile: profile(fixture, { expectedIssuer: `${fixture.issuer}/different` }), token, clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(fixture, { expectedAudience: `${fixture.audience}-different` }), token, clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issueInvalidSignature(), clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issue({ roles: [''] }), clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(fixture), token: await fixture.issue({ permission_scopes: [' '] }), clockToleranceSeconds: 0 }));
  });

  it('has no Customer, browser-signing, production-credential, or verifier authority surface', () => {
    const source = readFileSync(resolve(__dirname, './direct-jwt.fixture.ts'), 'utf8');
    expect(source).not.toMatch(/Shinmone|IntegrationBinding|CanonicalIdentityResolver|GatewayBackendClient|RemoteJwksUpstreamTokenVerifier|privateKey|privatePem|customerId|customer_id|browser/i);
    expect(source).not.toMatch(/mapPermissions|mapUser|translateTenant|resolveCustomer|nativeClaims|claimMapping/);
    expect(fixture).not.toHaveProperty('privateKey');
    expect(fixture).not.toHaveProperty('privatePem');
  });
});

function profile(fixture: DirectJwtFixture, overrides: Partial<{ expectedIssuer: string; expectedAudience: string }> = {}) {
  return {
    id: 'direct-jwt-profile', integrationId: 'integration-a', expectedIssuer: fixture.issuer, expectedAudience: fixture.audience,
    jwksUri: fixture.jwksUri, algorithm: 'RS256', ...overrides
  } as const;
}

async function expectCredential(value: Promise<unknown>) {
  await expect(value).rejects.toMatchObject({ category: 'credential' } satisfies Partial<ProfileScopedVerificationError>);
}

class FixtureTransport implements JwksTransport {
  async fetch(uri: string) { return await (await fetch(uri)).json() as JSONWebKeySet; }
}
