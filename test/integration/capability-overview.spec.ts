import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { seedActiveExperienceConfig } from '../support/assistant-experience-state.fixture';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer } from '../support/isolated-integration-llm.helper';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

const metadata = { provider: 'openai', model: 'isolated-integration-test', fallbackUsed: false };

/** Feature 013 US2 (T027–T030): capability overview content, suggestions and the unrecognized fallback. */
describe('capability overview and suggestions', () => {
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

  async function send(requestId: string, body: Record<string, unknown>, permissionScopes: string[] = customerA.permission_scopes,
    claims = customerA, sessionId = 'session-owned-001') {
    const before = state.toolCalls.length;
    const response = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: { ...claims, permission_scopes: permissionScopes }, requestId }))
      .send({ pageContext: { module: 'inventory' }, ...body });
    const final = parseSseResponse(response.text).find((event) => event.event === 'final')?.data?.data;
    return { response, final, toolCalls: state.toolCalls.slice(before) };
  }

  it.each(['false', 'true'])('answers an overview the same way with LLM tool selection=%s and offers runnable Quick Replies', async (mode) => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = mode;
    const result = await send(`req-f013-overview-${mode}`, { message: '請問你可以幫我查哪些東西？' });
    expect(result.response.status).toBe(200);
    expect(result.final).toEqual(expect.objectContaining({ answerDecision: 'answered',
      answer: expect.stringContaining('依目前權限可使用的查詢功能'),
      // page scope is ignored for suggestions; work-order-progress needs work-orders:read
      suggestions: [{ id: 'order-status-10001', label: '訂單 SO-10001 的狀態' }] }));
    expect(result.toolCalls).toEqual([]);
    expect(isolated.providerGenerate).not.toHaveBeenCalled();
  });

  it('returns identical overview text for both flag values', async () => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'false';
    const off = await send('req-f013-overview-same-off', { message: '你能查詢哪些資料？' });
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    const on = await send('req-f013-overview-same-on', { message: '你能查詢哪些資料？' });
    expect(on.final?.answer).toBe(off.final?.answer);
  });

  it('lists different capabilities for actors with different permissions', async () => {
    const ordersOnly = await send('req-f013-overview-orders', { message: '你能查詢哪些資料？' }, ['orders:read']);
    const both = await send('req-f013-overview-both', { message: '你能查詢哪些資料？' }, ['orders:read', 'work-orders:read']);
    expect(ordersOnly.final?.answer).not.toBe(both.final?.answer);
    expect(both.final?.suggestions).toEqual([
      { id: 'order-status-10001', label: '訂單 SO-10001 的狀態' }, { id: 'work-order-progress', label: '工單 WO-20001 進度' }]);
  });

  it('explains how to get access and offers nothing when no capability is available', async () => {
    const result = await send('req-f013-overview-none', { message: '你能查詢哪些資料？' }, []);
    expect(result.final?.answer).toBe('目前沒有可使用的查詢功能。如需使用，請向系統管理者申請權限。');
    expect(result.final).not.toHaveProperty('suggestions');
  });

  it('omits suggestions for a Customer without an experience configuration', async () => {
    const result = await send('req-f013-overview-b', { message: '你能查詢哪些資料？' }, ['inventory:read'],
      fixture.canonicalClaims.customerB, 'session-hidden-001');
    expect(result.final).toEqual(expect.objectContaining({ answerDecision: 'answered' }));
    expect(result.final).not.toHaveProperty('suggestions');
  });

  it('attaches suggestions to the capability_overview Quick Reply', async () => {
    const result = await send('req-f013-overview-choice', { choiceId: 'overview' });
    expect(result.final?.suggestions).toEqual([{ id: 'order-status-10001', label: '訂單 SO-10001 的狀態' }]);
  });

  it('routes a model capability_discovery decision to the overview without a second model call', async () => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    const generate = jest.spyOn(isolated.llm, 'generateAnswer').mockResolvedValue(
      { content: JSON.stringify({ decision: 'capability_discovery' }), finishReason: 'stop', metadata } as never);
    const result = await send('req-f013-llm-discovery', { message: '請介紹一下你的用途' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.final).toEqual(expect.objectContaining({ answerDecision: 'answered',
      answer: expect.stringContaining('依目前權限可使用的查詢功能'), suggestions: expect.any(Array) }));
    expect(result.toolCalls).toEqual([]);
  });

  it('offers Quick Replies when the model finds no matching capability (LLM_NO_MATCH)', async () => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    jest.spyOn(isolated.llm, 'generateAnswer').mockResolvedValue(
      { content: JSON.stringify({ decision: 'none' }), finishReason: 'stop', metadata } as never);
    const result = await send('req-f013-llm-none', { message: '幫我看一下明天的天氣' });
    expect(result.final?.suggestions).toEqual([{ id: 'order-status-10001', label: '訂單 SO-10001 的狀態' }]);
    expect(result.toolCalls).toEqual([]);
  });

  it('offers Quick Replies when deterministic resolution does not recognize the question', async () => {
    const result = await send('req-f013-not-recognized', { message: '幫我看一下明天的天氣' });
    expect(result.final?.answerDecision).toMatch(/clarification_required|no_answer/);
    expect(result.final?.suggestions).toEqual([{ id: 'order-status-10001', label: '訂單 SO-10001 的狀態' }]);
  });

  // Phase 4 (US3) adds configured follow-ups after an answered question; Quick Replies are never offered there.
  it('offers follow-ups rather than Quick Replies after an ordinary answered question', async () => {
    stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單 SO-10001 狀態為 picking。');
    const result = await send('req-f013-plain', { message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: {
      module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] } });
    expect(result.final).toEqual(expect.objectContaining({ answerDecision: 'answered',
      suggestions: [{ id: 'follow-order-10002', label: '看 SO-10002' }] }));
  });
});
