import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AssistantMessageRole } from '../../src/generated/prisma/enums';
import { seedActiveExperienceConfig } from '../support/assistant-experience-state.fixture';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer } from '../support/isolated-integration-llm.helper';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

/** Feature 013 US1 (T020, T022, T023): opening Quick Replies and declared-choice execution. */
describe('session opening and Quick Reply selection', () => {
  const fixture = createInternalIdentityJwtFixture();
  const customerA = fixture.canonicalClaims.customerA;
  let app: INestApplication;
  let state: Us1TestState;
  let isolated: ReturnType<typeof isolateIntegrationLlm>;

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks },
      augmentStateBeforeInit: (initial) => { seedActiveExperienceConfig(initial); }
    }));
    isolated = isolateIntegrationLlm(app);
  });
  afterEach(async () => {
    try { await app.close(); jest.restoreAllMocks(); }
    finally { process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'false'; }
  });

  const headers = (requestId: string, permissionScopes: string[] = customerA.permission_scopes, claims = customerA) =>
    createAuthorizedInternalIdentityHeaders(fixture, { claims: { ...claims, permission_scopes: permissionScopes }, requestId });
  const createSession = (requestId: string, pageContext: Record<string, unknown>, permissionScopes?: string[], claims = customerA) =>
    request(app.getHttpServer()).post('/api/v1/assistant/sessions').set(headers(requestId, permissionScopes, claims)).send({ pageContext });
  const send = async (requestId: string, body: Record<string, unknown>, sessionId = 'session-owned-001', claims = customerA) => {
    const before = { messages: state.messages.length, toolCalls: state.toolCalls.length, audit: state.auditEvents.length };
    const response = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headers(requestId, claims.permission_scopes, claims)).send({ pageContext: { module: 'orders' }, ...body });
    const events = response.status === 200 ? parseSseResponse(response.text) : [];
    return { response, finalData: events.find((event) => event.event === 'final')?.data?.data,
      messages: state.messages.slice(before.messages), toolCalls: state.toolCalls.slice(before.toolCalls),
      audit: state.auditEvents.slice(before.audit) };
  };

  describe('opening (T020)', () => {
    it('returns the configured greeting and the Quick Replies this actor may run on this page', async () => {
      const response = await createSession('req-f013-open', { module: 'orders' });
      expect(response.status).toBe(201);
      expect(response.body.data).toEqual(expect.objectContaining({ sessionId: expect.any(String), status: 'active',
        opening: { configVersion: '1.0.0', greeting: '你好，我可以協助查詢訂單資訊。',
          quickReplies: [{ id: 'overview', label: '你能查詢哪些資料？' }, { id: 'order-status-10001', label: '訂單 SO-10001 的狀態' }] } }));
      expect(state.auditEvents.find((event) => event.requestId === 'req-f013-open' && event.eventType === 'session_created')?.metadata)
        .toEqual(expect.objectContaining({ experienceConfigVersion: '1.0.0', quickReplyIds: ['overview', 'order-status-10001'] }));
    });

    it('applies page scope, permission and maxQuickReplies', async () => {
      const ids = async (requestId: string, module: string, scopes: string[]) =>
        (await createSession(requestId, { module }, scopes)).body.data.opening.quickReplies.map((item: { id: string }) => item.id);
      expect(await ids('req-f013-open-other-page', 'inventory', ['orders:read'])).toEqual(['overview']);
      expect(await ids('req-f013-open-both', 'orders', ['orders:read', 'work-orders:read']))
        .toEqual(['overview', 'order-status-10001', 'work-order-progress']);
    });

    it('returns the Core greeting for a Customer without configuration', async () => {
      const response = await createSession('req-f013-open-b', { module: 'inventory' }, undefined, fixture.canonicalClaims.customerB);
      expect(response.body.data.opening).toEqual(expect.objectContaining({ configVersion: null, quickReplies: [] }));
    });
  });

  describe('selection (T022)', () => {
    it.each(['false', 'true'])('runs the declared capability with LLM tool selection=%s and records the choice', async (mode) => {
      process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = mode;
      stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單 SO-10001 狀態為 picking。');
      const result = await send(`req-f013-choice-${mode}`, { choiceId: 'order-status-10001' });
      expect(result.response.status).toBe(200);
      expect(result.finalData).toEqual(expect.objectContaining({ answerDecision: 'answered' }));
      expect(result.messages.find((message) => message.role === AssistantMessageRole.user)?.content).toBe('查詢訂單 SO-10001 狀態');
      expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: 'mock.orders.status.lookup', status: 'success' })]);
      expect(result.audit.find((event) => event.eventType === 'quick_reply_selected')?.metadata)
        .toEqual(expect.objectContaining({ choiceId: 'order-status-10001', experienceConfigVersion: '1.0.0' }));
      expect(result.audit.find((event) => event.eventType === 'capability_resolution_completed')?.metadata)
        .toEqual(expect.objectContaining({ outcome: 'RESOLVED', capabilityKey: 'orders.status', reasonCode: 'DECLARED_CHOICE' }));
      expect(isolated.providerGenerate).not.toHaveBeenCalled();
    });

    it('executes a follow-up choice and records it as a suggestion', async () => {
      stubGroundedIntegrationAnswer(isolated.llm, '"status":"delayed"', '訂單 SO-10002 狀態為 delayed。');
      const result = await send('req-f013-follow-up', { choiceId: 'follow-order-10002' });
      expect(result.finalData).toEqual(expect.objectContaining({ answerDecision: 'answered' }));
      expect(result.toolCalls).toEqual([expect.objectContaining({ toolName: 'mock.orders.status.lookup' })]);
      expect(result.audit.map((event) => event.eventType)).toContain('suggestion_selected');
    });

    it('answers the capability overview choice without any tool call', async () => {
      const result = await send('req-f013-overview', { choiceId: 'overview' });
      expect(result.response.status).toBe(200);
      expect(result.finalData).toEqual(expect.objectContaining({ answerDecision: 'answered' }));
      expect(result.toolCalls).toEqual([]);
    });

    it.each([
      ['unknown ID', 'not-configured'],
      ['a choice the actor may not run', 'work-order-progress']
    ])('rejects %s as no longer available and writes nothing (Feature 016)', async (_label, choiceId) => {
      const result = await send(`req-f013-reject-${choiceId}`, { choiceId });
      expect(result.response.status).toBe(409);
      expect(result.response.body).toMatchObject({ error: { code: 'EXPERIENCE_CHOICE_UNAVAILABLE' } });
      expect(result.messages).toEqual([]);
      expect(result.audit.map((event) => event.eventType)).not.toEqual(expect.arrayContaining(['message_received']));
      expect(result.audit.map((event) => event.eventType)).not.toEqual(expect.arrayContaining(['quick_reply_selected']));
    });

    it.each([
      ['both message and choiceId', { message: '查詢訂單', choiceId: 'overview' }],
      ['neither', {}],
      ['an invalid choiceId', { choiceId: 'Not Valid!' }]
    ])('rejects %s with 400', async (_label, body) => {
      expect((await send('req-f013-invalid', body)).response.status).toBe(400);
    });
  });

  describe('Customer isolation (T023)', () => {
    it('does not accept Customer A choices in a Customer B session', async () => {
      const result = await send('req-f013-cross', { choiceId: 'order-status-10001' }, 'session-hidden-001', fixture.canonicalClaims.customerB);
      // The session is Customer B's own; Customer A's choice is not in Customer B's configuration (Feature 016: 409).
      expect(result.response.status).toBe(409);
      expect(result.messages).toEqual([]);
    });
  });
});
