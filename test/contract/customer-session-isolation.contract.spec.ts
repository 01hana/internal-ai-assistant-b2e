import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  Us1TestState
} from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { RequestIdentityContext } from '../../src/identity/identity-context.types';

const describeCustomerUs1 = process.env.RUN_CUSTOMER_US1_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs1('Customer session isolation contract', () => {
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

  afterAll(async () => app?.close());

  it.each(['customerA', 'customerB'] as const)('creates %s sessions from signed Customer identity and rejects payload Customer authority', async (customer) => {
    const before = state.sessions.length;
    const created = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions')
      .set(headersFor(customer, `req-${customer}-create`))
      .send({ pageContext: { module: 'orders' } });

    expect(created.status).toBe(201);
    expect(state.sessions).toHaveLength(before + 1);
    const expectedCustomerId = customer === 'customerA' ? 'customer-a' : 'customer-b';
    expect(state.sessions.at(-1)?.customerId).toBe(expectedCustomerId);
    expect(prismaMock.assistantSession.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: expectedCustomerId }) })
    );

    const payloadAttempt = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions')
      .set(headersFor(customer, `req-${customer}-payload-not-authority`))
      .send({ customerId: 'customer-b' });
    expect(payloadAttempt.status).toBe(400);
    expect(state.sessions).toHaveLength(before + 1);
  });

  it.each([
    ['customerA', 'session-owned-001', 200],
    ['customerB', 'session-hidden-001', 200],
    ['customerA', 'session-hidden-001', 404],
    ['customerB', 'session-owned-001', 404]
  ] as const)('allows only the owner to get %s session %s', async (customer, sessionId, expectedStatus) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/assistant/sessions/${sessionId}`)
      .set(headersFor(customer, `req-${customer}-${sessionId}`));
    expect(response.status).toBe(expectedStatus);
  });

  it('makes foreign and random session IDs externally indistinguishable', async () => {
    const [foreign, missing] = await Promise.all([
      request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-hidden-001').set(headersFor('customerA', 'req-foreign-session')),
      request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-does-not-exist').set(headersFor('customerA', 'req-missing-session'))
    ]);
    expect({ status: foreign.status, code: foreign.body.error?.code, contentType: foreign.headers['content-type'] }).toEqual({
      status: missing.status,
      code: missing.body.error?.code,
      contentType: missing.headers['content-type']
    });
    expect(JSON.stringify(foreign.body)).not.toContain('customer-b');
  });

  it.each([
    ['customerA', 'customer-a', 'session-owned-001', 'session-hidden-001'],
    ['customerB', 'customer-b', 'session-hidden-001', 'session-owned-001']
  ] as const)('lists non-empty active sessions only for %s', async (customer, customerId, ownedId, foreignId) => {
    const { AssistantSessionService } = await import('../../src/assistant/session/assistant-session.service');
    const service = app.get(AssistantSessionService) as unknown as FutureSessionService;
    const sessions = await service.listVisibleSessions(scopeFor(customer));
    expect(sessions).not.toHaveLength(0);
    expect(sessions.every((session) => session.customerId === customerId && session.status === 'active')).toBe(true);
    expect(sessions.map((session) => session.id)).toContain(ownedId);
    expect(sessions.map((session) => session.id)).not.toContain(foreignId);
    expect(prismaMock.assistantSession.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId, status: 'active' }) }));
  });

  it('soft-closes an owned active session without deleting its history or context', async () => {
    const isolated = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks } });
    const { AssistantSessionService } = await import('../../src/assistant/session/assistant-session.service');
    const service = isolated.app.get(AssistantSessionService) as unknown as FutureSessionService;
    const before = snapshotSessionGraph(isolated.state, 'session-owned-001');
    await expect(service.closeVisibleSession({ customerScope: scopeFor('customerA'), sessionId: 'session-owned-001' })).resolves.toBeDefined();
    const after = snapshotSessionGraph(isolated.state, 'session-owned-001');
    expect(after.session).toMatchObject({ customerId: 'customer-a', status: 'closed' });
    expect({ ...after.session, status: before.session?.status, updatedAt: before.session?.updatedAt }).toEqual(before.session);
    expect({ ...after, session: before.session }).toEqual({ ...before, session: before.session });
    expect(isolated.prismaMock.assistantSession.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 'customer-a', id: 'session-owned-001', status: 'active' }) }));
    await isolated.app.close();
  });

  it.each([
    ['customerA', 'session-hidden-001'], ['customerB', 'session-owned-001'], ['customerA', 'session-does-not-exist'], ['customerA', 'session-closed-001'], ['customerA', 'session-expired-001']
  ] as const)('does not close inaccessible or non-active session %s', async (customer, sessionId) => {
    const isolated = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks } });
    const { AssistantSessionService } = await import('../../src/assistant/session/assistant-session.service');
    const service = isolated.app.get(AssistantSessionService) as unknown as FutureSessionService;
    const before = snapshotSessionGraph(isolated.state, sessionId);
    await expect(service.closeVisibleSession({ customerScope: scopeFor(customer), sessionId })).rejects.toMatchObject({ status: 404 });
    expect(snapshotSessionGraph(isolated.state, sessionId)).toEqual(before);
    await isolated.app.close();
  });

  function scopeFor(customer: 'customerA' | 'customerB') {
    const claims = fixture.canonicalClaims[customer];
    return createCustomerScopeFromIdentityContext({
      requestId: `req-scope-${customer}`,
      customer: { customerId: claims.customer_id, integrationId: claims.integration_id },
      organization: { organizationId: claims.org_id },
      hostApp: { hostApp: claims.host_app },
      actor: { actorId: claims.sub, roles: claims.roles, permissionScopes: claims.permission_scopes },
      auth: { tokenId: claims.jti, gatewayIssuer: TEST_GATEWAY_ISSUER }
    } satisfies RequestIdentityContext);
  }
});

type FutureSessionService = {
  listVisibleSessions(customerScope: ReturnType<typeof createCustomerScopeFromIdentityContext>): Promise<Array<{ id: string; customerId: string; status: string }>>;
  closeVisibleSession(input: { customerScope: ReturnType<typeof createCustomerScopeFromIdentityContext>; sessionId: string }): Promise<unknown>;
};

function snapshotSessionGraph(state: Us1TestState, sessionId: string) {
  const messages = state.messages.filter((item) => item.sessionId === sessionId);
  const messageIds = new Set(messages.map((item) => item.id));
  return structuredClone({
    session: state.sessions.find((item) => item.id === sessionId),
    contextStates: state.contextStates.filter((item) => item.sessionId === sessionId), messages,
    executionPlans: state.executionPlans.filter((item) => item.sessionId === sessionId || (!!item.messageId && messageIds.has(item.messageId))),
    toolCalls: state.toolCalls.filter((item) => item.sessionId === sessionId || (!!item.messageId && messageIds.has(item.messageId))),
    evidenceRefs: state.evidenceRefs.filter((item) => !!item.messageId && messageIds.has(item.messageId)),
    groundingChecks: state.groundingChecks.filter((item) => messageIds.has(item.messageId)),
    answerDecisions: state.answerDecisions.filter((item) => messageIds.has(item.messageId)),
    clarificationQuestions: state.clarificationQuestions.filter((item) => messageIds.has(item.messageId)),
    queryUnderstandingResults: state.queryUnderstandingResults.filter((item) => messageIds.has(item.messageId)),
    auditEvents: state.auditEvents.filter((item) => item.sessionId === sessionId)
  });
}
