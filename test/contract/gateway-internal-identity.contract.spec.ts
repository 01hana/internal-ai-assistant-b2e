import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
import { IdentityTokenException } from '../../src/identity/identity.errors';
import { RemoteJwksInternalIdentityTokenVerifier } from '../../src/identity/internal-identity-token-verifier';
import { InternalIdentityTokenIssuer } from '../../apps/gateway/src/identity/internal-identity-token-issuer.service';
import { createEphemeralRsaFixture } from '../../apps/gateway/test/signing/ephemeral-rsa.fixture';

describe('Gateway-issued internal identity ↔ Feature 002 verifier contract (T050)', () => {
  let authority: Awaited<ReturnType<typeof createGatewayJwksAuthority>>;

  beforeEach(async () => { authority = await createGatewayJwksAuthority(); });
  afterEach(async () => { await authority.close(); });

  it('accepts a real Gateway-issued Customer A token through the unchanged remote verifier and canonical validator', async () => {
    const token = await createIssuer(authority).issue(canonicalIdentity());
    const verified = await verifierFor(authority).verify({ authorization: `Bearer ${token}` });
    const context = validateVerifiedInternalIdentityClaims(verified);
    const scope = createCustomerScopeFromIdentityContext({ ...context, requestId: 'gateway-contract-request' });
    const header = decodeProtectedHeader(token);
    const payload = decodeJwt(token);

    expect(header).toEqual({ alg: 'RS256', typ: 'JWT', kid: authority.fixture.kid });
    expect(payload).toMatchObject({ iss: authority.issuer, aud: authority.audience });
    expect(payload.exp).toBe((payload.iat as number) + 300);
    expect(payload).not.toHaveProperty('nbf');
    expect(payload.jti).toMatch(uuidPattern());
    expect(context).toMatchObject({
      customer: { customerId: 'customer-a', integrationId: 'integration-a' },
      organization: { organizationId: 'org-shared' },
      hostApp: { hostApp: 'admin' },
      actor: { actorId: 'actor-shared', roles: ['planner'], permissionScopes: ['orders:read'] }
    });
    expect(scope).toMatchObject({ customerId: 'customer-a', integrationId: 'integration-a' });
  });

  it('accepts empty roles and scopes while public customer hints remain non-authoritative', async () => {
    const token = await createIssuer(authority).issue({ ...canonicalIdentity(), roles: [], permissionScopes: [] });
    const verified = await verifierFor(authority).verify({ authorization: `Bearer ${token}` });
    const context = validateVerifiedInternalIdentityClaims(verified);
    const publicHeaders = { 'x-customer-id': 'customer-b' };
    const scope = createCustomerScopeFromIdentityContext({ ...context, requestId: 'gateway-contract-header-conflict' });

    expect(publicHeaders['x-customer-id']).toBe('customer-b');
    expect(context.customer.customerId).toBe('customer-a');
    expect(context.actor).toMatchObject({ roles: [], permissionScopes: [] });
    expect(scope.customerId).toBe('customer-a');
  });

  it.each([
    ['wrong signature', async (input: typeof authority) => signWithOtherKey(input)],
    ['wrong issuer', async (input: typeof authority) => signWith(input.fixture.privateKey, input, { issuer: `${input.issuer}/other` })],
    ['wrong audience', async (input: typeof authority) => signWith(input.fixture.privateKey, input, { audience: 'other-audience' })],
    ['wrong kid', async (input: typeof authority) => signWith(input.fixture.privateKey, input, { kid: 'unknown-kid' })],
    ['wrong algorithm', async (input: typeof authority) => signHs256(input)],
    ['expired token', async (input: typeof authority) => signWith(input.fixture.privateKey, input, { iat: 1, exp: 2 })]
  ])('rejects %s through the unchanged Feature 002 remote verifier', async (_label, issue) => {
    await expect(verifierFor(authority).verify({ authorization: `Bearer ${await issue(authority)}` })).rejects.toBeInstanceOf(IdentityTokenException);
  });

  it('rejects a token with missing customer_id during unchanged canonical claim validation', async () => {
    const token = await signWith(authority.fixture.privateKey, authority, { claims: { integration_id: 'integration-a' } });
    const verified = await verifierFor(authority).verify({ authorization: `Bearer ${token}` });

    expect(() => validateVerifiedInternalIdentityClaims(verified)).toThrow();
  });
});

function canonicalIdentity() {
  return Object.freeze({
    customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-shared', organizationId: 'org-shared', hostApp: 'admin',
    roles: ['planner'], permissionScopes: ['orders:read']
  });
}

function createIssuer(authority: Awaited<ReturnType<typeof createGatewayJwksAuthority>>) {
  return new InternalIdentityTokenIssuer(
    { internalIssuer: authority.issuer, internalAudience: authority.audience, internalTokenTtlSeconds: 300 },
    { resolveActiveSigningKey: async () => ({ kid: authority.fixture.kid, privateKey: authority.fixture.privateKey }) }
  );
}

function verifierFor(authority: Awaited<ReturnType<typeof createGatewayJwksAuthority>>) {
  return new RemoteJwksInternalIdentityTokenVerifier({ issuer: authority.issuer, audience: authority.audience, jwksUri: authority.jwksUri, clockToleranceSeconds: 0 });
}

async function createGatewayJwksAuthority() {
  const fixture = await createEphemeralRsaFixture({ kid: `gateway-contract-${randomUUID()}` });
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [fixture.publicJwk] }));
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Gateway contract JWKS authority did not expose TCP address.');
  const issuer = `http://127.0.0.1:${address.port}`;
  return Object.freeze({ fixture, issuer, audience: 'feature003-gateway-contract', jwksUri: `${issuer}/.well-known/jwks.json`, close: () => close(server) });
}

async function signWith(privateKey: KeyLike, authority: Awaited<ReturnType<typeof createGatewayJwksAuthority>>, input: Readonly<{ issuer?: string; audience?: string; kid?: string; iat?: number; exp?: number; claims?: Record<string, unknown> }> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = input.claims ?? {
    customer_id: 'customer-a', integration_id: 'integration-a', sub: 'actor-shared', org_id: 'org-shared', host_app: 'admin', roles: ['planner'], permission_scopes: ['orders:read'], jti: randomUUID()
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: input.kid ?? authority.fixture.kid })
    .setIssuer(input.issuer ?? authority.issuer)
    .setAudience(input.audience ?? authority.audience)
    .setIssuedAt(input.iat ?? now)
    .setExpirationTime(input.exp ?? now + 300)
    .sign(privateKey);
}

async function signWithOtherKey(authority: Awaited<ReturnType<typeof createGatewayJwksAuthority>>) {
  const { privateKey } = await generateKeyPair('RS256');
  return signWith(privateKey, authority);
}

async function signHs256(authority: Awaited<ReturnType<typeof createGatewayJwksAuthority>>) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ customer_id: 'customer-a', integration_id: 'integration-a', sub: 'actor-shared', org_id: 'org-shared', host_app: 'admin', roles: [], permission_scopes: [], jti: randomUUID() })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: authority.fixture.kid })
    .setIssuer(authority.issuer)
    .setAudience(authority.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(new TextEncoder().encode('test-hmac-key'));
}

function uuidPattern() {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
