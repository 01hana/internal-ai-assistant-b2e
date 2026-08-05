import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { RequestIdentityContext } from '../../src/identity/identity-context.types';

const describeCustomerUs1 = process.env.RUN_CUSTOMER_US1_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs1('Customer message and history contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  const headersFor = (customer: 'customerA' | 'customerB', requestId: string) =>
    createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId });
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Awaited<ReturnType<typeof createUs1TestAppWithState>>['prismaMock'];

  beforeAll(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    }));
  });
  afterAll(async () => app.close());

  it.each([
    ['customerA', 'session-owned-001', 200],
    ['customerB', 'session-hidden-001', 200],
    ['customerA', 'session-hidden-001', 404],
    ['customerB', 'session-owned-001', 404]
  ] as const)('keeps history for %s and %s inside its Customer namespace', async (customer, sessionId, expectedStatus) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headersFor(customer, `req-history-${customer}-${sessionId}`));
    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) {
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(customer === 'customerA' ? 'Customer B private' : '王小明企業');
    }
  });

  it('does not append to a foreign session or materialize message-flow state', async () => {
    const before = snapshot(state);
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-hidden-001/messages')
      .set(headersFor('customerA', 'req-foreign-message-append'))
      .send({ message: 'must not enter Customer B' });
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(snapshot(state)).toEqual(before);
  });

  it('rejects a foreign history cursor without returning a foreign message ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages?cursor=message-hidden-user-001')
      .set(headersFor('customerA', 'req-foreign-cursor'));
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('message-hidden-user-001');
  });

  it('requires Customer-first message, tool, and evidence predicates before history materializes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(headersFor('customerA', 'req-history-predicate'));

    expect(prismaMock.assistantMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: 'customer-a', sessionId: 'session-owned-001' }) })
    );
    expect(prismaMock.toolCall.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: 'customer-a', sessionId: 'session-owned-001' }) })
    );
    expect(prismaMock.evidenceRef.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: 'customer-a' }) })
    );
  });

  it.each([
    ['customerA', 'message-owned-assistant-001', 'customer-a'],
    ['customerB', 'message-hidden-assistant-001', 'customer-b']
  ] as const)('reads %s own direct message through customerId_id', async (customer, messageId, customerId) => {
    const { AssistantMessageRepository } = await import('../../src/assistant/message/assistant-message.repository');
    const repository = app.get(AssistantMessageRepository) as unknown as FutureMessageRepository;
    const message = await repository.getVisibleMessage({ customerScope: scopeFor(customer), messageId });
    expect(message).toMatchObject({ id: messageId, customerId });
    expect(prismaMock.assistantMessage.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { customerId_id: { customerId, id: messageId } } }));
  });

  it('completes an owned assistant message without changing the foreign Customer message', async () => {
    const { AssistantMessageRepository } = await import('../../src/assistant/message/assistant-message.repository');
    const repository = app.get(AssistantMessageRepository) as unknown as FutureMessageRepository;
    const foreign = { ...state.messages.find((message) => message.id === 'message-hidden-assistant-001') };
    await expect(repository.completeAssistantMessage({ customerScope: scopeFor('customerA'), messageId: 'message-owned-assistant-001', content: 'updated own content', answerDecision: 'answered' })).resolves.toMatchObject({ customerId: 'customer-a', content: 'updated own content', answerDecision: 'answered' });
    expect(state.messages.find((message) => message.id === 'message-hidden-assistant-001')).toEqual(foreign);
    expect(prismaMock.assistantMessage.update).toHaveBeenLastCalledWith(expect.objectContaining({ where: { customerId_id: { customerId: 'customer-a', id: 'message-owned-assistant-001' } } }));
  });

  it.each([
    ['customerA', 'customer-a', 'message-hidden-assistant-001'], ['customerB', 'customer-b', 'message-owned-assistant-001'], ['customerA', 'customer-a', 'message-does-not-exist']
  ] as const)('does not read or complete inaccessible message %s', async (customer, expectedCustomerId, messageId) => {
    const { AssistantMessageRepository } = await import('../../src/assistant/message/assistant-message.repository');
    const repository = app.get(AssistantMessageRepository) as unknown as FutureMessageRepository;
    const scope = scopeFor(customer);
    const beforeMessages = structuredClone(state.messages);
    await expect(repository.getVisibleMessage({ customerScope: scope, messageId })).rejects.toMatchObject({ status: 404 });
    await expect(repository.completeAssistantMessage({ customerScope: scope, messageId, content: 'must not write', answerDecision: 'answered' })).rejects.toMatchObject({ status: 404 });
    expect(state.messages).toEqual(beforeMessages);
    expect(prismaMock.assistantMessage.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ where: { customerId_id: { customerId: expectedCustomerId, id: messageId } } }));
  });

  function scopeFor(customer: 'customerA' | 'customerB') {
    const claims = fixture.canonicalClaims[customer];
    return createCustomerScopeFromIdentityContext({
      requestId: `req-message-scope-${customer}`,
      customer: { customerId: claims.customer_id, integrationId: claims.integration_id },
      organization: { organizationId: claims.org_id }, hostApp: { hostApp: claims.host_app },
      actor: { actorId: claims.sub, roles: claims.roles, permissionScopes: claims.permission_scopes },
      auth: { tokenId: claims.jti, gatewayIssuer: TEST_GATEWAY_ISSUER }
    } satisfies RequestIdentityContext);
  }
});

type FutureMessageRepository = {
  getVisibleMessage(input: { customerScope: ReturnType<typeof createCustomerScopeFromIdentityContext>; messageId: string }): Promise<unknown>;
  completeAssistantMessage(input: { customerScope: ReturnType<typeof createCustomerScopeFromIdentityContext>; messageId: string; content: string; answerDecision: string }): Promise<unknown>;
};

function snapshot(state: Us1TestState) {
  return {
    sessions: state.sessions.length,
    messages: state.messages.length,
    contextStates: state.contextStates.length,
    executionPlans: state.executionPlans.length,
    queryUnderstandingResults: state.queryUnderstandingResults.length,
    toolCalls: state.toolCalls.length,
    evidenceRefs: state.evidenceRefs.length,
    auditEvents: state.auditEvents.length
  };
}
