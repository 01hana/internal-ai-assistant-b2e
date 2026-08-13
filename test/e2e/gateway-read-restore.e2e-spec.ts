import request = require('supertest');
import { createGatewayBackendTrustChainHarness, type TrustChainBindingFixture } from '../support/gateway-backend-trust-chain-harness';

const customerA: TrustChainBindingFixture = Object.freeze({ customerId: 'gateway-read-customer-a', integrationId: 'gateway-read-integration-a', allowedHostApp: 'admin' });
const customerB: TrustChainBindingFixture = Object.freeze({ customerId: 'gateway-read-customer-b', integrationId: 'gateway-read-integration-b', allowedHostApp: 'admin' });
const lowerIdentity = Object.freeze({ subject: 'gateway-read-actor', organizationId: 'gateway-read-org', hostApp: 'admin', roles: ['planner'], permissionScopes: ['orders:read'] });

describe('Gateway Assistant read/restore E2E', () => {
  it('restores Customer A session and deterministic history through the real trust chain while Customer B receives the formal safe not-found denial', async () => {
    const harness = await createGatewayBackendTrustChainHarness({ label: 'gateway-read-restore', bindings: [customerA, customerB] });
    try {
      const tokenA = await harness.upstreamAuthority.issue({ integrationId: customerA.integrationId, ...lowerIdentity });
      const tokenB = await harness.upstreamAuthority.issue({ integrationId: customerB.integrationId, ...lowerIdentity });
      const created = await request(harness.gateway.getHttpServer()).post('/api/v1/assistant/sessions')
        .set('authorization', `Bearer ${tokenA}`).set('x-request-id', 'gateway-read-create').send({ pageContext: { module: 'orders' } });
      expect(created.status).toBe(201);
      const sessionId = created.body.data.sessionId as string;

      const message = await fetch(`${harness.gatewayOrigin}/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json', accept: 'text/event-stream', 'x-request-id': 'gateway-read-message' }, body: JSON.stringify({ message: '?' })
      });
      expect(message.status).toBe(200);
      await drain(message.body);

      const restored = await request(harness.gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}`)
        .set('authorization', `Bearer ${tokenA}`).set('x-request-id', 'gateway-read-session');
      const history = await request(harness.gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}/messages`)
        .query({ limit: '1', order: 'asc' }).set('authorization', `Bearer ${tokenA}`).set('x-request-id', 'gateway-read-history');
      expect(restored.status).toBe(200);
      expect(restored.body).toEqual(expect.objectContaining({ requestId: 'gateway-read-session', data: expect.objectContaining({ sessionId }) }));
      expect(history.status).toBe(200);
      expect(history.body).toEqual(expect.objectContaining({ requestId: 'gateway-read-history', data: expect.objectContaining({ sessionId, messages: expect.any(Array) }) }));
      expect(history.body.data.messages).not.toHaveLength(0);

      const [foreignSession, foreignHistory] = await Promise.all([
        request(harness.gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}`).set('authorization', `Bearer ${tokenB}`).set('x-request-id', 'gateway-read-foreign-session'),
        request(harness.gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}/messages`).query({ limit: '1' }).set('authorization', `Bearer ${tokenB}`).set('x-request-id', 'gateway-read-foreign-history')
      ]);
      const [missingSession, missingHistory] = await Promise.all([
        request(harness.gateway.getHttpServer()).get('/api/v1/assistant/sessions/session-does-not-exist').set('authorization', `Bearer ${tokenB}`).set('x-request-id', 'gateway-read-missing-session'),
        request(harness.gateway.getHttpServer()).get('/api/v1/assistant/sessions/session-does-not-exist/messages').query({ limit: '1' }).set('authorization', `Bearer ${tokenB}`).set('x-request-id', 'gateway-read-missing-history')
      ]);
      expect(foreignSession.status).toBe(404);
      expect(foreignHistory.status).toBe(404);
      expect(missingSession.status).toBe(404);
      expect(missingHistory.status).toBe(404);
      expect({ status: foreignSession.status, code: foreignSession.body.error?.code, message: foreignSession.body.error?.message }).toEqual({ status: missingSession.status, code: missingSession.body.error?.code, message: missingSession.body.error?.message });
      expect({ status: foreignHistory.status, code: foreignHistory.body.error?.code, message: foreignHistory.body.error?.message }).toEqual({ status: missingHistory.status, code: missingHistory.body.error?.code, message: missingHistory.body.error?.message });
      expect(JSON.stringify([foreignSession.body, foreignHistory.body])).not.toContain(customerA.customerId);

      const rejectedQuery = await request(harness.gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}/messages`)
        .query({ customerId: customerB.customerId }).set('authorization', `Bearer ${tokenA}`);
      expect(rejectedQuery.status).toBe(400);
    } finally {
      await harness.dispose();
    }
  }, 120_000);
});

async function drain(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) throw new Error('Gateway read/restore expected a real SSE body.');
  const reader = body.getReader();
  while (!(await reader.read()).done) {
    // Existing deterministic Backend message flow provides history evidence.
  }
}
