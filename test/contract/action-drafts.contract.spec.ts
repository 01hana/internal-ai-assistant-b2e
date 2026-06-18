import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';

describe('US3 action drafts contract baseline', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an action draft preview with the standard response envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/action-drafts/action-draft-waiting-001')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-action-draft-get' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-action-draft-get',
        data: expect.objectContaining({
          actionDraftId: 'action-draft-waiting-001',
          status: 'waiting_confirmation',
          riskLevel: 'medium',
          toolName: expect.any(String),
          resource: expect.any(String),
          operation: expect.any(String),
          preview: expect.anything(),
          expiresAt: expect.any(String),
          requestId: expect.any(String),
          messageId: expect.any(String)
        })
      })
    );
  });

  it('confirms a waiting action draft only through the confirmation flow and keeps duplicate confirm duplicate-safe', async () => {
    const firstResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-action-draft-confirm-1' }))
      .send({
        idempotencyKey: 'idem-action-draft-confirm-001'
      });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-action-draft-confirm-1',
        data: expect.objectContaining({
          actionDraftId: 'action-draft-waiting-001',
          status: expect.stringMatching(/confirmed|executed/)
        })
      })
    );

    const duplicateResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-action-draft-confirm-2' }))
      .send({
        idempotencyKey: 'idem-action-draft-confirm-001'
      });

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateResponse.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-action-draft-confirm-2',
        data: expect.objectContaining({
          actionDraftId: 'action-draft-waiting-001',
          duplicateSafe: true,
          recheck: expect.objectContaining({
            idempotency: 'duplicate',
            permission: 'pending_execution_guard',
            toolContract: 'pending_execution_guard'
          })
        })
      })
    );
  });

  it.each([
    ['action-draft-expired-001', 'expired'],
    ['action-draft-cancelled-001', 'cancelled'],
    ['action-draft-executed-001', 'executed']
  ])('rejects confirming %s because status is %s', async (draftId, status) => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/assistant/action-drafts/${draftId}/confirm`)
      .set(createIdentityHeaders({ 'x-request-id': `req-us3-action-draft-${draftId}` }))
      .send({
        idempotencyKey: `idem-${draftId}`
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: `req-us3-action-draft-${draftId}`,
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.stringContaining(status)
        })
      })
    );
  });

  it('cancels a pending action draft with the standard response envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-draft-001/cancel')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-action-draft-cancel' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-action-draft-cancel',
        data: expect.objectContaining({
          actionDraftId: 'action-draft-draft-001',
          status: 'cancelled'
        })
      })
    );
  });
});
