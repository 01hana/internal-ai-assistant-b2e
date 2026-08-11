import request = require('supertest');
import { createGatewayBackendTrustChainHarness } from '../support/gateway-backend-trust-chain-harness';

const customerA = Object.freeze({ customerId: 'phase8-customer-a', integrationId: 'phase8-integration-a', allowedHostApp: 'admin' });
const compactJwtValue = /"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/;

describe('Gateway → Backend real trust-chain foundation (T071)', () => {
  it('accepts a real upstream JWT only through Gateway binding, signing, JWKS, and Backend CustomerScope', async () => {
    const harness = await createGatewayBackendTrustChainHarness({ label: 'gateway-backend-trust-chain', bindings: [customerA] });
    try {
      const upstreamToken = await harness.upstreamAuthority.issue({
        integrationId: customerA.integrationId,
        subject: 'phase8-actor-shared',
        organizationId: 'phase8-org-shared',
        hostApp: customerA.allowedHostApp,
        roles: ['planner'],
        permissionScopes: ['orders:read']
      });
      const jwksResponse = await fetch(`${harness.gatewayOrigin}/.well-known/jwks.json`);
      expect(jwksResponse.status).toBe(200);
      const jwks = await jwksResponse.json() as { keys: Array<Record<string, unknown>> };
      expect(jwks.keys).toEqual([expect.objectContaining({ kid: harness.signingFixture.kid, kty: 'RSA', alg: 'RS256', use: 'sig' })]);
      expect(JSON.stringify(jwks)).not.toMatch(/"(?:d|p|q|dp|dq|qi|oth)"/);

      const response = await request(harness.gateway.getHttpServer())
        .post('/api/v1/assistant/sessions')
        .set('authorization', `Bearer ${upstreamToken}`)
        .set('x-request-id', 'phase8-happy-create')
        .send({ pageContext: { module: 'orders' } });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ requestId: 'phase8-happy-create', data: { sessionId: expect.any(String), status: 'active' } });
      const serializedResponse = JSON.stringify(response.body);
      expect(serializedResponse).not.toContain(upstreamToken);
      expect(serializedResponse).not.toContain(harness.signingFixture.privatePem);
      expect(serializedResponse).not.toMatch(/"(?:d|p|q|dp|dq|qi)"/);
      expect(serializedResponse).not.toMatch(compactJwtValue);

      const session = await harness.prisma.assistantSession.findUniqueOrThrow({ where: { id: response.body.data.sessionId } });
      expect(session.customerId).toBe(customerA.customerId);
      expect(session.organizationId).toBe('phase8-org-shared');
      expect(session.actorId).toBe('phase8-actor-shared');
      expect(session.hostApp).toBe(customerA.allowedHostApp);
    } finally {
      await harness.dispose();
    }
  });
});
