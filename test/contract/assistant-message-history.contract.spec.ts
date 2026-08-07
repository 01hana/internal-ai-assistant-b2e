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
          ])
        })
      })
    );
    expect(typeof response.body.data.nextCursor === 'string' || response.body.data.nextCursor === null).toBe(true);

    const assistantMessages = response.body.data.messages.filter((message: { role: string }) => message.role === 'assistant');
    expect(assistantMessages[0]).toEqual(
      expect.objectContaining({
        answerDecision: expect.any(String),
        evidenceRefs: expect.any(Array)
      })
    );
  });

  it('returns cursor pagination without duplicating the previous page', async () => {
    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 1, order: 'asc' })
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-history-page-1' }));

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.messages).toHaveLength(1);
    expect(firstPage.body.data.nextCursor).toEqual(expect.any(String));
    expect(firstPage.body.data.nextCursor).toBe(firstPage.body.data.messages[0].messageId);

    const secondPage = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 1, order: 'asc', cursor: firstPage.body.data.nextCursor })
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-history-page-2' }));

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.data.messages).toHaveLength(1);
    expect(secondPage.body.data.messages[0].messageId).not.toBe(firstPage.body.data.nextCursor);
    expect(secondPage.body.data.messages[0].messageId).not.toBe(firstPage.body.data.messages[0].messageId);
    expect(secondPage.body.data.nextCursor).toBeNull();
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
