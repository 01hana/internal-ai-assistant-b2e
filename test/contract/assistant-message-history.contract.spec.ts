import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp } from '../support/us1-test-app.helper';

describe('assistant message history contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ascending session history with requestId, sessionId, answerDecision, evidence summary, and cursor metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 50, order: 'asc' })
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-history-contract' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us1-history-contract',
        data: expect.objectContaining({
          sessionId: 'session-owned-001',
          messages: expect.arrayContaining([
            expect.objectContaining({
              messageId: expect.any(String),
              role: expect.stringMatching(/user|assistant|system|tool/),
              content: expect.any(String),
              createdAt: expect.any(String)
            })
          ]),
          nextCursor: expect.anything()
        })
      })
    );

    const assistantMessages = response.body.data.messages.filter((message: { role: string }) => message.role === 'assistant');
    expect(assistantMessages[0]).toEqual(
      expect.objectContaining({
        answerDecision: expect.any(String),
        evidenceRefs: expect.any(Array)
      })
    );
  });

  it('rejects cross-boundary history reads with the shared error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 20, order: 'asc' })
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us1-history-hidden',
          'x-actor-id': 'actor-777',
          'x-host-app': 'crm',
          'x-organization-id': 'org-777'
        })
      );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us1-history-hidden',
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String)
        })
      })
    );
  });
});
