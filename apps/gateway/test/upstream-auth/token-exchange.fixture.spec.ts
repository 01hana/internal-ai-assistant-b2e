import { decodeJwt, decodeProtectedHeader, type JSONWebKeySet } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProfileScopedVerifier, ProfileScopedVerificationError } from '../../src/upstream-auth/profile-scoped-verifier';
import { createDirectJwtFixture, type DirectJwtFixture } from './direct-jwt.fixture';
import { createTokenExchangeFixture, TokenExchangeError, type TokenExchangeFixture } from './token-exchange.fixture';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';

describe('Trusted server-side Token Exchange reference fixture (T055/T056)', () => {
  let exchange: TokenExchangeFixture;

  beforeAll(async () => { exchange = await createTokenExchangeFixture(); });
  afterAll(async () => { await exchange?.close(); });

  it('validates an opaque trusted native credential before issuing a short canonical JWT', async () => {
    const credential = exchange.issueTrustedNativeCredential({ principal: 'actor-b', organization: 'org-b', roles: ['planner'], permissionScopes: ['orders:read'] });
    const token = await exchange.exchange(credential);
    const payload = decodeJwt(token);
    const header = decodeProtectedHeader(token);

    expect(exchange.issuedTokenCount()).toBe(1);
    expect(header).toMatchObject({ alg: 'RS256', kid: exchange.kid });
    expect(payload).toMatchObject({
      iss: exchange.issuer, aud: exchange.audience, integration_id: 'integration-b', sub: 'actor-b', org_id: 'org-b', host_app: 'admin',
      roles: ['planner'], permission_scopes: ['orders:read']
    });
    expect(payload.exp! - payload.iat!).toBe(exchange.ttlSeconds);
    for (const claim of ['native_principal', 'native_organization', 'native_roles', 'native_permissions', 'native_credential', 'customer_id', 'customerId', 'tenant']) expect(payload).not.toHaveProperty(claim);
  });

  it('rejects malformed, unknown, revoked, tampered, and browser-shaped inputs before signing', async () => {
    const credential = exchange.issueTrustedNativeCredential();
    exchange.revokeTrustedNativeCredential(credential);
    const before = exchange.issuedTokenCount();
    for (const value of ['', 'unknown-native-credential', `${credential}-tampered`, credential, {
      nativeCredential: credential, integration_id: 'integration-attacker', sub: 'attacker', org_id: 'org-attacker', host_app: 'evil', roles: ['admin'], permission_scopes: ['*'], customer_id: 'customer-attacker'
    }] as unknown[]) {
      await expect(exchange.exchange(value as never)).rejects.toEqual(new TokenExchangeError());
    }
    expect(exchange.issuedTokenCount()).toBe(before);
  });

  it.each([
    ['blank principal', { principal: '' }],
    ['whitespace principal', { principal: '   ' }],
    ['blank organization', { organization: '' }],
    ['whitespace organization', { organization: '   ' }],
    ['blank role', { roles: [''] }],
    ['whitespace role', { roles: [' '] }],
    ['blank scope', { permissionScopes: [''] }],
    ['whitespace scope', { permissionScopes: [' '] }]
  ])('rejects %s at trusted native registration before signing', (_label, identity) => {
    const before = exchange.issuedTokenCount();
    expect(() => exchange.issueTrustedNativeCredential(identity as never)).toThrow(TokenExchangeError);
    expect(exchange.issuedTokenCount()).toBe(before);
    expect(JSON.stringify(new TokenExchangeError())).not.toMatch(/principal|organization|roles|scope|native/i);
  });

  it('publishes public-only JWKS and verifies canonical output through the production verifier', async () => {
    const credential = exchange.issueTrustedNativeCredential({ roles: [], permissionScopes: [] });
    const token = await exchange.exchange(credential);
    const jwks = await (await fetch(exchange.jwksUri)).json() as JSONWebKeySet;
    const verifier = new ProfileScopedVerifier({ transport: new FixtureTransport() });

    expect(jwks.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: exchange.kid });
    for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) expect(jwks.keys[0]).not.toHaveProperty(field);
    const exchangeProfile = profile(exchange, 'integration-b');
    expect(exchangeProfile.integrationId).toBe('integration-b');
    await expect(verifier.verify({ profile: exchangeProfile, token, clockToleranceSeconds: 0 })).resolves.toMatchObject({
      integrationId: 'integration-b', subject: 'actor-b', organizationId: 'org-b', hostApp: 'admin', roles: [], permissionScopes: []
    });
    await expectCredential(verifier.verify({ profile: profile(exchange, 'integration-b', { expectedIssuer: `${exchange.issuer}/wrong` }), token, clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(exchange, 'integration-b', { expectedAudience: `${exchange.audience}-wrong` }), token, clockToleranceSeconds: 0 }));
    await expectCredential(verifier.verify({ profile: profile(exchange, 'integration-b'), token: await exchange.exchangeInvalidSignature(exchange.issueTrustedNativeCredential()), clockToleranceSeconds: 0 }));
  });

  it('uses an independent authority yet the same verified identity contract as Direct JWT', async () => {
    const direct = await createDirectJwtFixture();
    try {
      const exchangeToken = await exchange.exchange(exchange.issueTrustedNativeCredential());
      const directToken = await direct.issue();
      const verifier = new ProfileScopedVerifier({ transport: new FixtureTransport() });
      const exchangeProfile = profile(exchange, 'integration-b');
      const directProfile = profile(direct, 'integration-a');
      const exchangeIdentity = await verifier.verify({ profile: exchangeProfile, token: exchangeToken, clockToleranceSeconds: 0 });
      const directIdentity = await verifier.verify({ profile: directProfile, token: directToken, clockToleranceSeconds: 0 });

      expect(exchange.issuer).not.toBe(direct.issuer);
      expect(exchange.jwksUri).not.toBe(direct.jwksUri);
      expect(exchange.kid).not.toBe(direct.kid);
      expect(exchangeProfile.integrationId).toBe('integration-b');
      expect(directProfile.integrationId).toBe('integration-a');
      await expectCredential(verifier.verify({ profile: directProfile, token: exchangeToken, clockToleranceSeconds: 0 }));
      await expectCredential(verifier.verify({ profile: exchangeProfile, token: directToken, clockToleranceSeconds: 0 }));
      expect(Object.keys(exchangeIdentity).sort()).toEqual(Object.keys(directIdentity).sort());
    } finally {
      await direct.close();
    }
  });

  it('has no Customer, binding, browser-signing, production-exchange, or secret authority surface', () => {
    const source = readFileSync(resolve(__dirname, './token-exchange.fixture.ts'), 'utf8');
    expect(source).not.toMatch(/Shinmone|IntegrationBinding|CanonicalIdentityResolver|GatewayBackendClient|GatewayIdentityAuditWriter|customerId|customer_id|privateKey|privatePem|browser|POST\s*\(|oauth|production/i);
    expect(source).not.toMatch(/resolveCustomer|uuid.*mapping|permissionIds|companyCode|userInfo/);
    expect(exchange).not.toHaveProperty('privateKey');
    expect(exchange).not.toHaveProperty('privatePem');
  });
});

function profile(fixture: Pick<TokenExchangeFixture | DirectJwtFixture, 'issuer' | 'audience' | 'jwksUri'>, integrationId: string, overrides: Partial<{ expectedIssuer: string; expectedAudience: string }> = {}) {
  return { id: `profile-${integrationId}`, integrationId, expectedIssuer: fixture.issuer, expectedAudience: fixture.audience, jwksUri: fixture.jwksUri, algorithm: 'RS256', ...overrides } as const;
}

async function expectCredential(value: Promise<unknown>) {
  await expect(value).rejects.toMatchObject({ category: 'credential' } satisfies Partial<ProfileScopedVerificationError>);
}

class FixtureTransport implements JwksTransport {
  async fetch(uri: string) { return await (await fetch(uri)).json() as JSONWebKeySet; }
}
