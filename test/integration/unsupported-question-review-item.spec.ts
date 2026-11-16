import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { seedActiveExperienceConfig } from '../support/assistant-experience-state.fixture';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer } from '../support/isolated-integration-llm.helper';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

const metadata = { provider: 'openai', model: 'isolated-integration-test', fallbackUsed: false };
const UNSUPPORTED = 'unsupported_question';

/** Feature 013 US5 (T046–T047): questions no capability recognizes are collected as ReviewItems. */
describe('unsupported question ReviewItems', () => {
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

  async function send(requestId: string, body: Record<string, unknown>) {
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: customerA, requestId }))
      .send({ pageContext: { module: 'inventory' }, ...body });
    expect(response.status).toBe(200);
    return parseSseResponse(response.text).find((event) => event.event === 'final')?.data?.data;
  }

  const unsupportedItems = () => state.reviewItems.filter((item) => item.sourceType === UNSUPPORTED);
  const reviewerHeaders = (customer: 'customerA' | 'customerB', requestId: string) => createAuthorizedInternalIdentityHeaders(fixture, {
    claims: { ...fixture.canonicalClaims[customer], roles: ['admin'], permission_scopes: ['assistant:review'] }, requestId });

  it('records a question deterministic resolution does not recognize, linked to the user message without copying it', async () => {
    const question = '幫我看一下明天的天氣';
    await send('req-f013-unsupported-det', { message: question });

    const userMessage = state.messages.find((message) => message.requestId === 'req-f013-unsupported-det' && message.role === 'user');
    expect(userMessage?.content).toBe(question);
    expect(unsupportedItems()).toEqual([expect.objectContaining({ customerId: 'customer-a', sourceId: userMessage?.id,
      status: 'open', suggestedImprovement: { reasonCode: 'CAPABILITY_NOT_RECOGNIZED', module: 'inventory' } })]);
    expect(JSON.stringify(unsupportedItems())).not.toContain('天氣');
    const audit = state.auditEvents.find((event) => event.requestId === 'req-f013-unsupported-det' && event.eventType === 'review_item_created');
    expect(audit?.metadata).toEqual(expect.objectContaining({ sourceType: UNSUPPORTED, reasonCode: 'CAPABILITY_NOT_RECOGNIZED' }));
    expect(JSON.stringify(audit)).not.toContain('天氣');
  });

  it('records a question the model matches to no capability (LLM_NO_MATCH)', async () => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    jest.spyOn(isolated.llm, 'generateAnswer').mockResolvedValue(
      { content: JSON.stringify({ decision: 'none' }), finishReason: 'stop', metadata } as never);
    await send('req-f013-unsupported-llm', { message: '幫我看一下明天的天氣' });
    expect(unsupportedItems()).toEqual([expect.objectContaining({
      suggestedImprovement: { reasonCode: 'LLM_NO_MATCH', module: 'inventory' } })]);
  });

  it('records every occurrence of the same question', async () => {
    await send('req-f013-unsupported-1', { message: '幫我看一下明天的天氣' });
    await send('req-f013-unsupported-2', { message: '幫我看一下明天的天氣' });
    expect(unsupportedItems()).toHaveLength(2);
    expect(new Set(unsupportedItems().map((item) => item.sourceId)).size).toBe(2);
  });

  it.each([
    ['a greeting', 'req-f013-not-unsupported-greeting', { message: '你好' }],
    ['a capability question', 'req-f013-not-unsupported-overview', { message: '你能查詢哪些資料？' }],
    ['a clicked Quick Reply', 'req-f013-not-unsupported-choice', { choiceId: 'overview' }]
  ])('does not record %s', async (_label, requestId, body) => {
    await send(requestId, body);
    expect(unsupportedItems()).toEqual([]);
  });

  it('does not record an answered question', async () => {
    stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單 SO-10001 狀態為 picking。');
    const final = await send('req-f013-answered', { message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: {
      module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] } });
    expect(final?.answerDecision).toBe('answered');
    expect(unsupportedItems()).toEqual([]);
  });

  it('can be filtered by sourceType in the review-items API and stays within the Customer (T047)', async () => {
    await send('req-f013-unsupported-api', { message: '幫我看一下明天的天氣' });
    const [item] = unsupportedItems();

    const listA = await request(app.getHttpServer()).get(`/api/v1/admin/assistant/review-items?sourceType=${UNSUPPORTED}`)
      .set(reviewerHeaders('customerA', 'req-f013-review-list-a'));
    expect(listA.status).toBe(200);
    const itemsA = (listA.body.data?.items ?? listA.body.items) as Array<{ reviewItemId: string; sourceType: string }>;
    expect(itemsA.map((entry) => entry.reviewItemId)).toEqual([item.id]);
    expect(itemsA.every((entry) => entry.sourceType === UNSUPPORTED)).toBe(true);
    expect(JSON.stringify(listA.body)).not.toContain('天氣');

    const listB = await request(app.getHttpServer()).get(`/api/v1/admin/assistant/review-items?sourceType=${UNSUPPORTED}`)
      .set(reviewerHeaders('customerB', 'req-f013-review-list-b'));
    expect(listB.status).toBe(200);
    expect(JSON.stringify(listB.body)).not.toContain(item.id);

    const getB = await request(app.getHttpServer()).get(`/api/v1/admin/assistant/review-items/${item.id}`)
      .set(reviewerHeaders('customerB', 'req-f013-review-get-b'));
    expect(getB.status).toBe(404);
  });

  it('rejects an unknown sourceType filter', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/assistant/review-items?sourceType=unsupported')
      .set(reviewerHeaders('customerA', 'req-f013-review-bad-filter'));
    expect(response.status).toBe(400);
  });
});
