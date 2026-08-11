import request = require('supertest');
import { generateKeyPair, SignJWT } from 'jose';
import { createGatewayBackendTrustChainHarness, type GatewayBackendTrustChainHarness, type TrustChainBindingFixture } from '../support/gateway-backend-trust-chain-harness';

const customerA: TrustChainBindingFixture = Object.freeze({ customerId: 'phase8-negative-customer-a', integrationId: 'phase8-negative-integration-a', allowedHostApp: 'admin' });
const disabledBinding: TrustChainBindingFixture = Object.freeze({ customerId: 'phase8-negative-customer-disabled', integrationId: 'phase8-negative-integration-disabled', allowedHostApp: 'admin', enabled: false });
const identity = Object.freeze({ subject: 'phase8-negative-actor', organizationId: 'phase8-negative-org', hostApp: 'admin', roles: ['planner'], permissionScopes: ['orders:read'] });

describe('Gateway negative identity E2E (T073)', () => {
  let harness: GatewayBackendTrustChainHarness;
  beforeAll(async () => { harness = await createGatewayBackendTrustChainHarness({ label: 'gateway-identity-negative', bindings: [customerA, disabledBinding] }); });
  afterAll(async () => { await harness.dispose(); });

  it.each([
    ['wrong issuer', 401, 'UPSTREAM_IDENTITY_INVALID', () => harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity }, { issuer: 'http://wrong-issuer.invalid' })],
    ['wrong audience', 401, 'UPSTREAM_IDENTITY_INVALID', () => harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity }, { audience: 'wrong-audience' })],
    ['expired', 401, 'UPSTREAM_IDENTITY_INVALID', () => harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity }, { issuedAt: 1, expiresAt: 2 })],
    ['future iat', 401, 'UPSTREAM_IDENTITY_INVALID', () => harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity }, { issuedAt: 4_000_000_000, expiresAt: 4_000_000_120 })],
    ['future nbf', 401, 'UPSTREAM_IDENTITY_INVALID', () => harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity }, { notBefore: 4_000_000_000 })],
    ['unknown kid', 401, 'UPSTREAM_IDENTITY_INVALID', () => harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity }, { kid: 'phase8-unknown-kid' })],
    ['unknown binding', 403, 'IDENTITY_ISSUANCE_DENIED', () => harness.upstreamAuthority.issue({ integrationId: 'phase8-unbound-integration', ...identity })],
    ['disabled binding', 403, 'IDENTITY_ISSUANCE_DENIED', () => harness.upstreamAuthority.issue({ integrationId: disabledBinding.integrationId, ...identity })],
    ['HostApp mismatch', 403, 'IDENTITY_ISSUANCE_DENIED', () => harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity, hostApp: 'other-host' })]
  ])('fails closed for %s without Backend business work', async (_label, statusCode, code, createToken) => {
    await assertRejectedWithoutSession(harness, await createToken(), statusCode, code);
  });

  it('fails closed for malformed upstream credentials without Backend business work', async () => { await assertRejectedWithoutSession(harness, 'not.a.jwt', 401, 'UPSTREAM_IDENTITY_INVALID'); });

  it('fails closed for an attacker signature using the legitimate issuer, audience, and kid', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ integration_id: customerA.integrationId, sub: identity.subject, org_id: identity.organizationId, host_app: identity.hostApp, roles: [...identity.roles], permission_scopes: [...identity.permissionScopes] })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: harness.upstreamAuthority.kid }).setIssuer(harness.upstreamAuthority.issuer).setAudience(harness.upstreamAuthority.audience).setIssuedAt(now).setExpirationTime(now + 120).sign(privateKey);
    await assertRejectedWithoutSession(harness, token, 401, 'UPSTREAM_IDENTITY_INVALID');
  });

  it('ignores conflicting public identity headers and retains Customer A ownership from the valid token binding', async () => {
    const token = await harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...identity });
    const response = await request(harness.gateway.getHttpServer()).post('/api/v1/assistant/sessions')
      .set('authorization', `Bearer ${token}`).set('x-customer-id', disabledBinding.customerId).set('x-integration-id', disabledBinding.integrationId).set('x-org-id', 'public-org-conflict').set('x-user-id', 'public-user-conflict').set('x-host-app', 'public-host-conflict')
      .set('x-request-id', 'phase8-header-conflict').send({ pageContext: { module: 'orders' } });
    expect(response.status).toBe(201);
    const session = await harness.prisma.assistantSession.findUniqueOrThrow({ where: { id: response.body.data.sessionId } });
    expect(session).toMatchObject({ customerId: customerA.customerId, organizationId: identity.organizationId, actorId: identity.subject, hostApp: identity.hostApp });
  });
});

async function assertRejectedWithoutSession(harness: GatewayBackendTrustChainHarness, token: string, expectedStatus: number, expectedCode: string): Promise<void> {
  const before = await harness.prisma.assistantSession.count();
  const response = await request(harness.gateway.getHttpServer()).post('/api/v1/assistant/sessions').set('authorization', `Bearer ${token}`).set('x-request-id', 'phase8-negative').send({ pageContext: { module: 'orders' } });
  const after = await harness.prisma.assistantSession.count();
  expect(response.status).toBe(expectedStatus);
  expect(response.body).toEqual({ statusCode: expectedStatus, code: expectedCode, message: expectedStatus === 401 ? 'Upstream identity is invalid.' : 'Identity issuance cannot be completed.' });
  expect(JSON.stringify(response.body)).not.toMatch(/phase8-negative-(?:customer|integration)|wrong-issuer|unknown-kid|jwks|signature|binding|private|key/i);
  expect(after).toBe(before);
}
