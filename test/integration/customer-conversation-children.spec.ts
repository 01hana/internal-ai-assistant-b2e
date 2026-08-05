import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const describeCustomerUs1 = process.env.RUN_CUSTOMER_US1_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs1('Customer parent-owned conversation children', () => {
  const fixture = createInternalIdentityJwtFixture();

  it.each([
    ['customerA', 'session-owned-001', 'customer-a', 'AnswerDecision', 'answerDecisions'],
    ['customerA', 'session-owned-001', 'customer-a', 'ClarificationQuestion', 'clarificationQuestions'],
    ['customerA', 'session-owned-001', 'customer-a', 'GroundingCheck', 'groundingChecks'],
    ['customerA', 'session-owned-001', 'customer-a', 'QueryUnderstandingResult', 'queryUnderstandingResults'],
    ['customerB', 'session-hidden-001', 'customer-b', 'AnswerDecision', 'answerDecisions'],
    ['customerB', 'session-hidden-001', 'customer-b', 'ClarificationQuestion', 'clarificationQuestions'],
    ['customerB', 'session-hidden-001', 'customer-b', 'GroundingCheck', 'groundingChecks'],
    ['customerB', 'session-hidden-001', 'customer-b', 'QueryUnderstandingResult', 'queryUnderstandingResults']
  ] as const)('writes %s for %s only with signed Customer ownership', async (customer, sessionId, customerId, _model, property) => {
    const { app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
    try {
      const requestId = `req-child-${customer}-${property}`;
      const response = await request(app.getHttpServer())
        .post(`/api/v1/assistant/sessions/${sessionId}/messages`)
        .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId }))
        .send({ message: _model === 'ClarificationQuestion' ? '請幫我查' : 'create conversation children' });
      expect(response.status).toBe(200);
      const records = state[property] as Array<{ customerId?: string; requestId?: string }>;
      const created = records.filter((record) => record.requestId === requestId);
      expect(created).not.toHaveLength(0);
      expect(created.every((record) => record.customerId === customerId)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['customerA', 'session-owned-001', 'customer-a'], ['customerB', 'session-hidden-001', 'customer-b']
  ] as const)('keeps ContextState bound to %s session with a Customer-qualified predicate', async (customer, sessionId, customerId) => {
    const { app, state, prismaMock } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks } });
    try {
      await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`).set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId: `req-context-${customer}` })).send({ message: 'context scope' });
      expect(state.contextStates.find((record) => record.sessionId === sessionId)).toMatchObject({ customerId, sessionId });
      expect(prismaMock.assistantContextState.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { customerId, sessionId } })
      );
    } finally { await app.close(); }
  });

  it.each([
    ['customerA', 'session-owned-001', 'customer-a'], ['customerB', 'session-hidden-001', 'customer-b']
  ] as const)('creates ExecutionPlan only for %s parent', async (customer, sessionId, customerId) => {
    const { app, state } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks } });
    try {
      const beforeIds = new Set(state.executionPlans.map((record) => record.id));
      await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`).set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId: `req-plan-${customer}` })).send({ message: 'plan scope' });
      const created = state.executionPlans.filter((record) => !beforeIds.has(record.id));
      expect(created).not.toHaveLength(0);
      expect(created.every((record) => record.customerId === customerId && record.sessionId === sessionId)).toBe(true);
    } finally { await app.close(); }
  });

  it('requires Customer-qualified QueryUnderstandingResult access rather than a bare message ID', async () => {
    const { app, prismaMock } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
    try {
      await request(app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-qu-qualified' }))
        .send({ message: 'query understanding scope' });
      expect(prismaMock.queryUnderstandingResult.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { customerId_messageId: expect.objectContaining({ customerId: 'customer-a' }) }
        })
      );
    } finally {
      await app.close();
    }
  });

  it('treats pageContext Customer data as non-authoritative', async () => {
    const { app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
    try {
      const before = snapshot(state);
      const response = await request(app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-page-context-customer' }))
        .send({ message: 'page context cannot choose Customer', pageContext: { customerId: 'customer-b' } });
      expect(response.status).toBe(400);
      expect(snapshot(state)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['customerA', 'session-hidden-001'],
    ['customerB', 'session-owned-001']
  ] as const)('rejects %s traversal of a foreign parent before child work begins', async (customer, sessionId) => {
    const { app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    });
    try {
      const before = structuredClone({
        sessions: state.sessions, messages: state.messages, contextStates: state.contextStates, executionPlans: state.executionPlans,
        answerDecisions: state.answerDecisions, clarificationQuestions: state.clarificationQuestions, groundingChecks: state.groundingChecks,
        queryUnderstandingResults: state.queryUnderstandingResults, toolCalls: state.toolCalls, evidenceRefs: state.evidenceRefs, auditEvents: state.auditEvents,
        orchestration: state.orchestration.sendMessage.mock.calls.length, sse: state.orchestration.sseEventBuilds.mock.calls.length
      });
      const response = await request(app.getHttpServer())
        .post(`/api/v1/assistant/sessions/${sessionId}/messages`)
        .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId: `req-foreign-parent-child-${customer}` }))
        .send({ message: 'must not traverse Customer B parent' });
      expect(response.status).toBe(404);
      expect({
        sessions: state.sessions, messages: state.messages, contextStates: state.contextStates, executionPlans: state.executionPlans,
        answerDecisions: state.answerDecisions, clarificationQuestions: state.clarificationQuestions, groundingChecks: state.groundingChecks,
        queryUnderstandingResults: state.queryUnderstandingResults, toolCalls: state.toolCalls, evidenceRefs: state.evidenceRefs, auditEvents: state.auditEvents,
        orchestration: state.orchestration.sendMessage.mock.calls.length, sse: state.orchestration.sseEventBuilds.mock.calls.length
      }).toEqual(before);
    } finally {
      await app.close();
    }
  });
});

function snapshot(state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state']) {
  return {
    messages: state.messages.length, contextStates: state.contextStates.length, executionPlans: state.executionPlans.length,
    queryUnderstandingResults: state.queryUnderstandingResults.length, groundingChecks: state.groundingChecks.length,
    answerDecisions: state.answerDecisions.length, clarificationQuestions: state.clarificationQuestions.length,
    toolCalls: state.toolCalls.length, evidenceRefs: state.evidenceRefs.length, auditEvents: state.auditEvents.length,
    orchestration: state.orchestration.sendMessage.mock.calls.length, sse: state.orchestration.sseEventBuilds.mock.calls.length
  };
}
