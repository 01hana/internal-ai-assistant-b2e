import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp } from '../support/us1-test-app.helper';

describe('session history on open integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('restores session summary and message history for the same actor, organization, and host app', async () => {
    const sessionResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-restore-session' }));
    const historyResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 50, order: 'asc' })
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-restore-history' }));

    expect(sessionResponse.status).toBe(200);
    expect(historyResponse.status).toBe(200);
    expect(sessionResponse.body.data).toEqual(
      expect.objectContaining({
        sessionId: 'session-owned-001'
      })
    );
    expect(historyResponse.body.data).toEqual(
      expect.objectContaining({
        sessionId: 'session-owned-001',
        messages: expect.any(Array)
      })
    );
  });

  it('fails closed for closed or expired sessions during restore', async () => {
    for (const sessionId of ['session-closed-001', 'session-expired-001']) {
      const sessionResponse = await request(app.getHttpServer())
        .get(`/api/v1/assistant/sessions/${sessionId}`)
        .set(createIdentityHeaders({ 'x-request-id': `req-us1-restore-${sessionId}` }));
      const historyResponse = await request(app.getHttpServer())
        .get(`/api/v1/assistant/sessions/${sessionId}/messages`)
        .query({ limit: 50, order: 'asc' })
        .set(createIdentityHeaders({ 'x-request-id': `req-us1-history-${sessionId}` }));

      expect(sessionResponse.status).toBe(404);
      expect(historyResponse.status).toBe(404);
      expect(sessionResponse.body.error).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String)
        })
      );
      expect(historyResponse.body.error).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String)
        })
      );
    }
  });
});
