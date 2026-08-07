import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const describeCustomerUs1 = process.env.RUN_CUSTOMER_US1_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs1('Customer session isolation integration', () => {
  it('records the current global-ID visibility leak as an expected-red T038 contract without mutating Customer B', async () => {
    const fixture = createInternalIdentityJwtFixture();
    const { app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
    try {
      const beforeForeign = { ...state.sessions.find((session) => session.id === 'session-hidden-001') };
      const beforeAuditCount = state.auditEvents.length;
      const response = await request(app.getHttpServer())
        .get('/api/v1/assistant/sessions/session-hidden-001')
        .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-global-id-leak' }));
      expect(response.status).toBe(404);
      expect(state.sessions.find((session) => session.id === 'session-hidden-001')).toEqual(beforeForeign);
      expect(state.auditEvents).toHaveLength(beforeAuditCount);
    } finally {
      await app.close();
    }
  });
});
