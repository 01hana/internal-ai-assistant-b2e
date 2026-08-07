import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const describeCustomerUs1 = process.env.RUN_CUSTOMER_US1_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs1('Customer message global-ID integration contract', () => {
  it('records the current foreign-history disclosure as an expected-red T039 contract without changing Customer B records', async () => {
    const fixture = createInternalIdentityJwtFixture();
    const { app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
    try {
      const beforeForeignMessages = state.messages.filter((message) => message.customerId === 'customer-b').map((message) => ({ ...message }));
      const beforeCounts = { toolCalls: state.toolCalls.length, evidenceRefs: state.evidenceRefs.length, auditEvents: state.auditEvents.length };
      const response = await request(app.getHttpServer())
        .get('/api/v1/assistant/sessions/session-hidden-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-global-message-leak' }));
      expect(response.status).toBe(404);
      expect(state.messages.filter((message) => message.customerId === 'customer-b')).toEqual(beforeForeignMessages);
      expect({ toolCalls: state.toolCalls.length, evidenceRefs: state.evidenceRefs.length, auditEvents: state.auditEvents.length }).toEqual(beforeCounts);
      expect(JSON.stringify(response.body)).not.toContain('message-hidden-assistant-001');
    } finally {
      await app.close();
    }
  });
});
