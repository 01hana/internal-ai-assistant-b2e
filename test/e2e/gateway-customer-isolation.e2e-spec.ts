import request = require('supertest');
import { createGatewayBackendTrustChainHarness, type TrustChainBindingFixture } from '../support/gateway-backend-trust-chain-harness';

const customerA: TrustChainBindingFixture = Object.freeze({ customerId: 'phase8-isolation-customer-a', integrationId: 'phase8-isolation-integration-a', allowedHostApp: 'admin' });
const customerB: TrustChainBindingFixture = Object.freeze({ customerId: 'phase8-isolation-customer-b', integrationId: 'phase8-isolation-integration-b', allowedHostApp: 'admin' });
const lowerIdentity = Object.freeze({ subject: 'phase8-isolation-actor', organizationId: 'phase8-isolation-org', hostApp: 'admin', roles: ['planner'], permissionScopes: ['orders:read'] });

describe('Gateway Customer A/B binding isolation (T072)', () => {
  it('derives distinct persisted Customer ownership only from each explicit IntegrationBinding', async () => {
    const harness = await createGatewayBackendTrustChainHarness({ label: 'gateway-customer-isolation', bindings: [customerA, customerB] });
    try {
      const tokenA = await harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...lowerIdentity });
      const tokenB = await harness.upstreamAuthority.issue({ integrationId: customerB.integrationId, ...lowerIdentity });
      const responseA = await request(harness.gateway.getHttpServer()).post('/api/v1/assistant/sessions').set('authorization', `Bearer ${tokenA}`).set('x-request-id', 'phase8-isolation-a').send({ pageContext: { module: 'orders' } });
      const responseB = await request(harness.gateway.getHttpServer()).post('/api/v1/assistant/sessions').set('authorization', `Bearer ${tokenB}`).set('x-request-id', 'phase8-isolation-b').send({ pageContext: { module: 'orders' } });

      expect(responseA.status).toBe(201);
      expect(responseB.status).toBe(201);
      const [sessionA, sessionB] = await Promise.all([
        harness.prisma.assistantSession.findUniqueOrThrow({ where: { id: responseA.body.data.sessionId } }),
        harness.prisma.assistantSession.findUniqueOrThrow({ where: { id: responseB.body.data.sessionId } })
      ]);
      expect(sessionA).toMatchObject({ customerId: customerA.customerId, organizationId: lowerIdentity.organizationId, actorId: lowerIdentity.subject, hostApp: lowerIdentity.hostApp });
      expect(sessionB).toMatchObject({ customerId: customerB.customerId, organizationId: lowerIdentity.organizationId, actorId: lowerIdentity.subject, hostApp: lowerIdentity.hostApp });
      expect(sessionA.customerId).not.toBe(sessionB.customerId);
      expect(sessionA).not.toMatchObject({ customerId: customerB.customerId });
      expect(sessionB).not.toMatchObject({ customerId: customerA.customerId });
    } finally {
      await harness.dispose();
    }
  });
});
