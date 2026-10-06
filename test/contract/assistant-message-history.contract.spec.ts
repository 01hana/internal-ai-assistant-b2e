import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createIdentityHeaders, createUs1TestApp, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('assistant message history contract', () => {
  it('exposes only durable completed Assistant text, never pending or provisional records', async () => {
    const fixture = await createUs1TestAppWithState({ seedCompletedHistoryDecision: true });
    try {
      const seed = fixture.state.messages.find((message) => message.id === 'message-owned-assistant-001')!;
      fixture.state.messages.push(
        { ...seed, id: 'message-history-pending', requestId: 'req-history-pending', content: 'Pending answer.', answerDecision: 'no_answer' },
        { ...seed, id: 'message-history-provisional', requestId: 'req-history-provisional', content: 'provisional streamed text', answerDecision: 'answered' },
        { ...seed, id: 'message-history-failed', requestId: 'req-history-failed', content: 'rejected model text', answerDecision: 'tool_failed' },
        { ...seed, id: 'message-history-partial-transaction', requestId: 'req-history-partial-transaction',
          content: 'uncommitted model text', answerDecision: 'answered' },
        { ...seed, id: 'message-history-completed', requestId: 'req-history-completed', content: 'durable final text', answerDecision: 'answered' }
      );
      fixture.state.answerDecisions.push({ id: 'decision-history-partial', customerId: 'customer-a', requestId: 'req-history-partial-transaction',
        messageId: 'message-history-partial-transaction', status: 'answered', noAnswerReason: null, clarificationQuestionId: null,
        groundingCheckId: null, metadata: null, createdAt: new Date('2026-06-16T00:00:05.000Z') });
      fixture.state.answerDecisions.push({ id: 'decision-history-failed', customerId: 'customer-a', requestId: 'req-history-failed',
        messageId: 'message-history-failed', status: 'tool_failed', noAnswerReason: null, clarificationQuestionId: null,
        groundingCheckId: 'grounding-history-failed', metadata: null, createdAt: new Date('2026-06-16T00:00:05.000Z') });
      fixture.state.answerDecisions.push({ id: 'decision-history-completed', customerId: 'customer-a', requestId: 'req-history-completed',
        messageId: 'message-history-completed', status: 'answered', noAnswerReason: null, clarificationQuestionId: null,
        groundingCheckId: 'grounding-history-completed', metadata: null, createdAt: new Date('2026-06-16T00:00:05.000Z') });
      const response = await request(fixture.app.getHttpServer())
        .get('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createIdentityHeaders({ 'x-request-id': 'req-history-completion-contract' }));
      const ids = response.body.data.messages.map((message: { messageId: string }) => message.messageId);
      expect(ids).toContain('message-history-completed');
      expect(ids).not.toContain('message-history-pending');
      expect(ids).not.toContain('message-history-provisional');
      expect(ids).not.toContain('message-history-failed');
      expect(ids).not.toContain('message-history-partial-transaction');
      const page = await request(fixture.app.getHttpServer())
        .get('/api/v1/assistant/sessions/session-owned-001/messages')
        .query({ limit: 2, cursor: 'message-owned-assistant-001' })
        .set(createIdentityHeaders({ 'x-request-id': 'req-history-completion-page' }));
      expect(page.status).toBe(200);
      expect(page.body.data.messages.map((message: { messageId: string }) => message.messageId))
        .toEqual(['message-history-completed']);
      expect(page.body.data.nextCursor).toBeNull();
      const hiddenCursor = await request(fixture.app.getHttpServer())
        .get('/api/v1/assistant/sessions/session-owned-001/messages')
        .query({ limit: 1, cursor: 'message-history-pending' })
        .set(createIdentityHeaders({ 'x-request-id': 'req-history-pending-cursor' }));
      expect(hiddenCursor.status).toBe(404);
    } finally { await fixture.app.close(); }
  });
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
        {
          ...createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
            claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, sub: 'actor-777', host_app: 'crm', org_id: 'org-777' },
            requestId: 'req-us1-history-hidden'
          }),
          'x-actor-id': 'actor-777',
          'x-host-app': 'crm',
          'x-organization-id': 'org-777'
        }
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
