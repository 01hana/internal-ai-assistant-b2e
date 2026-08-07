import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const describeCustomerUs1 = process.env.RUN_CUSTOMER_US1_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs1('Customer SSE integration isolation', () => {
  it('uses a safe pre-stream not-found contract for foreign, missing, closed, and expired sessions', async () => {
    const fixture = createInternalIdentityJwtFixture();
    const { app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
    try {
      const before = counters(state);
      const headers = (requestId: string) => createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId });
      const [foreign, missing, closed, expired] = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-hidden-001/messages').set(headers('req-sse-foreign')).send({ message: 'no stream' }),
        request(app.getHttpServer()).post('/api/v1/assistant/sessions/no-such-session/messages').set(headers('req-sse-missing')).send({ message: 'no stream' }),
        request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-closed-001/messages').set(headers('req-sse-closed')).send({ message: 'no stream' }),
        request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-expired-001/messages').set(headers('req-sse-expired')).send({ message: 'no stream' })
      ]);
      for (const response of [foreign, missing, closed, expired]) {
        expect(response.status).toBe(404);
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.headers['content-type']).not.toContain('text/event-stream');
        expect(response.body.error?.code).toBe('NOT_FOUND');
        expect(response.text).not.toContain('event:');
      }
      const publicResults = [foreign, missing, closed, expired].map((response) => ({
        status: response.status,
        code: response.body.error?.code,
        type: response.headers['content-type']
      }));
      expect(new Set(publicResults.map((result) => JSON.stringify(result))).size).toBe(1);
      expect(counters(state)).toEqual(before);
    } finally {
      await app.close();
    }
  });
});

function counters(state: { messages: unknown[]; toolCalls: unknown[]; evidenceRefs: unknown[]; auditEvents: unknown[]; orchestration: { sendMessage: jest.Mock; sseEventBuilds: jest.Mock } }) {
  return {
    messages: state.messages.length,
    toolCalls: state.toolCalls.length,
    evidenceRefs: state.evidenceRefs.length,
    auditEvents: state.auditEvents.length,
    orchestration: state.orchestration.sendMessage.mock.calls.length,
    sseEventBuilds: state.orchestration.sseEventBuilds.mock.calls.length
  };
}
