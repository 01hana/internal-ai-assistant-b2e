import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { seedActiveExperienceConfig } from '../support/assistant-experience-state.fixture';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer } from '../support/isolated-integration-llm.helper';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

/** Feature 013 US3 (T034/T035): follow-ups only after an answered request whose tool completed. */
describe('follow-up suggestions', () => {
  const fixture = createInternalIdentityJwtFixture();
  const customerA = fixture.canonicalClaims.customerA;
  const orderPage = { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] };
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
  afterEach(async () => { await app.close(); jest.restoreAllMocks(); });

  async function send(requestId: string, body: Record<string, unknown>, permissionScopes: string[] = customerA.permission_scopes,
    claims = customerA, sessionId = 'session-owned-001') {
    const response = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: { ...claims, permission_scopes: permissionScopes }, requestId }))
      .send({ pageContext: orderPage, ...body });
    return { response, final: parseSseResponse(response.text).find((event) => event.event === 'final')?.data?.data };
  }

  it('offers configured follow-ups after an answered typed question', async () => {
    stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單 SO-10001 狀態為 picking。');
    const { final } = await send('req-f013-follow-typed', { message: '查詢訂單目前狀態 訂單號 SO-10001' });
    expect(final).toEqual(expect.objectContaining({ answerDecision: 'answered',
      suggestions: [{ id: 'follow-order-10002', label: '看 SO-10002' }] }));
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'success' }));
  });

  it('offers follow-ups after an answered Quick Reply', async () => {
    stubGroundedIntegrationAnswer(isolated.llm, '"status":"picking"', '訂單 SO-10001 狀態為 picking。');
    const { final } = await send('req-f013-follow-choice', { choiceId: 'order-status-10001' });
    expect(final?.suggestions).toEqual([{ id: 'follow-order-10002', label: '看 SO-10002' }]);
  });

  it('does not repeat the request that was just answered', async () => {
    stubGroundedIntegrationAnswer(isolated.llm, '"status":"delayed"', '訂單 SO-10002 狀態為 delayed。');
    const { final } = await send('req-f013-follow-same', { choiceId: 'follow-order-10002' });
    expect(final?.answerDecision).toBe('answered');
    expect(final).not.toHaveProperty('suggestions');
  });

  it('offers nothing when the tool is denied for the actor', async () => {
    const { final } = await send('req-f013-follow-denied', { message: '查詢訂單目前狀態 訂單號 SO-10001' }, []);
    expect(final?.answerDecision).not.toBe('answered');
    expect(final).not.toHaveProperty('suggestions');
  });

  it('offers nothing when the answer is not grounded (generation unavailable)', async () => {
    const { final } = await send('req-f013-follow-no-answer', { message: '查詢訂單目前狀態 訂單號 SO-10001' });
    expect(final?.answerDecision ?? 'error').not.toBe('answered');
    expect(final ?? {}).not.toHaveProperty('suggestions');
  });

  it('offers nothing for a clarification', async () => {
    const { final } = await send('req-f013-follow-clarify', { message: '那個呢？' }, customerA.permission_scopes, customerA);
    expect(final?.answerDecision).toBe('clarification_required');
    expect(final).not.toHaveProperty('suggestions');
  });

  it('keeps the final shape unchanged for a Customer without configuration (T035)', async () => {
    const { final } = await send('req-f013-follow-b', { message: '查詢庫存現量 料號 SKU-B-001', pageContext: {
      module: 'inventory', entityId: 'SKU-B-001', visibleColumns: ['quantity'] } }, ['orders:read', 'inventory:read'],
      fixture.canonicalClaims.customerB, 'session-hidden-001');
    expect(final ?? {}).not.toHaveProperty('suggestions');
  });
});
