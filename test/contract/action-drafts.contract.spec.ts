import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('T059 Customer-scoped action draft contract', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  const headers = (customer: 'customerA' | 'customerB', requestId: string) => createAuthorizedInternalIdentityHeaders(jwt, {
    claims: { ...jwt.canonicalClaims[customer], permission_scopes: ['orders:read', 'orders:update'] }, requestId
  });
  beforeAll(async () => ({ app, state } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks } })));
  afterAll(async () => app?.close());

  it('defines same-Customer get, confirm, cancel, expiry, and duplicate-safe retry contracts', async () => {
    const get = await request(app.getHttpServer()).get('/api/v1/assistant/action-drafts/action-draft-waiting-001').set({ ...headers('customerA', 'req-t059-get'), 'x-customer-id': 'customer-b' });
    expect(get.status).toBe(200);
    const confirm = await request(app.getHttpServer()).post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm').set(headers('customerA', 'req-t059-confirm')).send({ idempotencyKey: 'workflow-shared-idempotency-key', customerId: 'customer-b' });
    expect(confirm.status).toBe(200);
    const retry = await request(app.getHttpServer()).post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm').set(headers('customerA', 'req-t059-retry')).send({ idempotencyKey: 'workflow-shared-idempotency-key' });
    expect(retry.status).toBe(200);
    expect(retry.body.data.duplicateSafe).toBe(true);
    const cancel = await request(app.getHttpServer()).post('/api/v1/assistant/action-drafts/action-draft-draft-001/cancel').set(headers('customerA', 'req-t059-cancel'));
    expect(cancel.status).toBe(200);
    const expired = await request(app.getHttpServer()).post('/api/v1/assistant/action-drafts/action-draft-expired-001/confirm').set(headers('customerA', 'req-t059-expired')).send({ idempotencyKey: 'new-key' });
    expect(expired.status).toBe(409);
  });

  it('requires foreign get/confirm/cancel to fail before connector, ToolCall, audit, or state change', async () => {
    const foreign = state.actionDrafts.find((item) => item.id === 'action-draft-customer-b-waiting-001')!;
    const before = { status: foreign.status, tools: state.toolCalls.length, audits: state.auditEvents.length };
    const get = await request(app.getHttpServer()).get(`/api/v1/assistant/action-drafts/${foreign.id}`).set(headers('customerA', 'req-t059-foreign-get'));
    const confirm = await request(app.getHttpServer()).post(`/api/v1/assistant/action-drafts/${foreign.id}/confirm`).set(headers('customerA', 'req-t059-foreign-confirm')).send({ idempotencyKey: 'workflow-shared-idempotency-key' });
    const cancel = await request(app.getHttpServer()).post(`/api/v1/assistant/action-drafts/${foreign.id}/cancel`).set(headers('customerA', 'req-t059-foreign-cancel'));
    for (const response of [get, confirm, cancel]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(foreign.id);
    }
    expect(foreign.status).toBe(before.status);
    expect(state.toolCalls).toHaveLength(before.tools);
    expect(state.auditEvents).toHaveLength(before.audits);
  });

});
