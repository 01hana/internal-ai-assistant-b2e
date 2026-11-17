import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { seedActiveExperienceConfig } from '../support/assistant-experience-state.fixture';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer } from '../support/isolated-integration-llm.helper';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

/**
 * Feature 013 acceptance (T051): two actors with different permissions walk through
 * opening → Quick Reply → follow-up → capability overview → session list → archive.
 * SC-001: every choice an actor is shown can be run by that actor; every choice not shown cannot.
 */
describe('Feature 013 acceptance', () => {
  const fixture = createInternalIdentityJwtFixture();
  const base = fixture.canonicalClaims.customerA;
  const actors = {
    ordersOnly: { ...base, sub: 'actor-f013-orders', permission_scopes: ['orders:read'] },
    planner: { ...base, sub: 'actor-f013-planner', permission_scopes: ['orders:read', 'work-orders:read'] }
  };
  type Actor = keyof typeof actors;
  const configuredCapabilityChoices = ['order-status-10001', 'work-order-progress'];
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

  const headers = (actor: Actor, requestId: string) => createAuthorizedInternalIdentityHeaders(fixture, { claims: actors[actor], requestId });
  const http = () => request(app.getHttpServer());

  async function open(actor: Actor) {
    const response = await http().post('/api/v1/assistant/sessions').set(headers(actor, `req-f013-acc-open-${actor}`))
      .send({ pageContext: { module: 'orders' } });
    expect(response.status).toBe(201);
    return response.body.data as { sessionId: string; opening: { greeting: string; quickReplies: Array<{ id: string }> } };
  }

  async function send(actor: Actor, sessionId: string, requestId: string, body: Record<string, unknown>) {
    const response = await http().post(`/api/v1/assistant/sessions/${sessionId}/messages`).set(headers(actor, requestId))
      .send({ pageContext: { module: 'orders' }, ...body });
    const final = response.status === 200 ? parseSseResponse(response.text).find((event) => event.event === 'final')?.data?.data : undefined;
    const resolution = state.auditEvents.find((event) => event.requestId === requestId && event.eventType === 'capability_resolution_completed');
    return { status: response.status, final, resolution: resolution?.metadata as Record<string, unknown> | undefined };
  }

  async function list(actor: Actor, requestId: string) {
    const response = await http().get('/api/v1/assistant/sessions').set(headers(actor, requestId));
    expect(response.status).toBe(200);
    return response.body.data.sessions as Array<{ sessionId: string; title: string | null }>;
  }

  it.each([
    ['ordersOnly', ['overview', 'order-status-10001']],
    ['planner', ['overview', 'order-status-10001', 'work-order-progress']]
  ] as const)('%s: shown choices run, hidden choices do not (SC-001)', async (actor, expectedIds) => {
    const { sessionId, opening } = await open(actor);
    expect(opening.greeting).toBe('你好，我可以協助查詢訂單資訊。');
    const shown = opening.quickReplies.map((item) => item.id);
    expect(shown).toEqual(expectedIds);

    for (const choiceId of configuredCapabilityChoices) {
      const result = await send(actor, sessionId, `req-f013-acc-${actor}-${choiceId}`, { choiceId });
      if (shown.includes(choiceId)) {
        expect(result.status).toBe(200);
        expect(result.resolution).toEqual(expect.objectContaining({ outcome: 'RESOLVED', reasonCode: 'DECLARED_CHOICE' }));
      } else {
        expect(result.status).toBe(404);
        expect(result.resolution).toBeUndefined();
      }
    }
  });

  it('walks the full journey for one actor without exposing it to the other', async () => {
    const { sessionId } = await open('ordersOnly');

    // Quick Reply → answered with a configured follow-up
    stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單 SO-10001 狀態為 picking。');
    const quickReply = await send('ordersOnly', sessionId, 'req-f013-acc-qr', { choiceId: 'order-status-10001' });
    expect(quickReply.final).toEqual(expect.objectContaining({ answerDecision: 'answered',
      suggestions: [{ id: 'follow-order-10002', label: '看 SO-10002' }] }));

    // Follow-up → answered
    stubGroundedIntegrationAnswer(isolated.llm, '"status":"delayed"', '訂單 SO-10002 狀態為 delayed。');
    const followUp = await send('ordersOnly', sessionId, 'req-f013-acc-follow', { choiceId: 'follow-order-10002' });
    expect(followUp.final).toEqual(expect.objectContaining({ answerDecision: 'answered' }));

    // Capability overview → only what this actor can run
    const overview = await send('ordersOnly', sessionId, 'req-f013-acc-overview', { message: '你能查詢哪些資料？' });
    expect(overview.final).toEqual(expect.objectContaining({ answerDecision: 'answered',
      suggestions: [{ id: 'order-status-10001', label: '訂單 SO-10001 的狀態' }] }));

    // Session list → titled from the first message; invisible to another actor
    expect(await list('ordersOnly', 'req-f013-acc-list')).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId, title: '查詢訂單 SO-10001 狀態' })]));
    expect((await list('planner', 'req-f013-acc-list-other')).map((item) => item.sessionId)).not.toContain(sessionId);

    // Another actor can neither use nor archive it
    expect((await send('planner', sessionId, 'req-f013-acc-foreign-send', { message: '你好' })).status).toBe(404);
    expect((await http().post(`/api/v1/assistant/sessions/${sessionId}/archive`).set(headers('planner', 'req-f013-acc-foreign-archive'))).status).toBe(404);

    // Archive → gone from the list and closed to further messages
    const archived = await http().post(`/api/v1/assistant/sessions/${sessionId}/archive`).set(headers('ordersOnly', 'req-f013-acc-archive'));
    expect(archived.status).toBe(200);
    expect((await list('ordersOnly', 'req-f013-acc-list-after')).map((item) => item.sessionId)).not.toContain(sessionId);
    expect((await send('ordersOnly', sessionId, 'req-f013-acc-after-archive', { message: '你好' })).status).toBe(404);

    const auditTypes = state.auditEvents.filter((event) => event.sessionId === sessionId).map((event) => event.eventType);
    expect(auditTypes).toEqual(expect.arrayContaining(['session_created', 'quick_reply_selected', 'suggestion_selected', 'session_archived']));
  });
});
