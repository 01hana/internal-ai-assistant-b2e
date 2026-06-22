import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createIdentityHeaders,
  createUs1TestAppWithState,
  Us1TestState
} from '../support/us1-test-app.helper';

describe('feedback contract', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts feedback for a visible assistant message and returns response envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-contract-success' }))
      .send({
        rating: 'positive',
        intent: 'other',
        reason: 'helpful'
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-feedback-contract-success',
        data: expect.objectContaining({
          feedbackEventId: expect.any(String),
          messageId: 'message-owned-assistant-001',
          rating: 'positive',
          intent: 'other',
          reviewItemId: null
        })
      })
    );
  });

  it('fails closed for invisible assistant messages', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-feedback-contract-invisible',
          'x-actor-id': 'actor-002'
        })
      )
      .send({
        rating: 'negative',
        intent: 'not_helpful'
      });

    expect(response.status).toBe(404);
    expect(response.body.requestId).toBe('req-feedback-contract-invisible');
  });

  it('rejects feedback for user messages', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-user-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-contract-user-message' }))
      .send({
        rating: 'negative',
        intent: 'not_helpful'
      });

    expect(response.status).toBe(400);
  });

  it('rejects feedback for assistant messages without answer decision', async () => {
    state.messages.push({
      id: 'message-assistant-no-decision-001',
      sessionId: 'session-owned-001',
      requestId: 'req-no-decision',
      role: 'assistant' as never,
      content: 'pending',
      answerDecision: null,
      pageContext: null,
      createdAt: new Date('2026-06-16T00:00:40.000Z')
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-assistant-no-decision-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-contract-no-decision' }))
      .send({
        rating: 'negative',
        intent: 'not_helpful'
      });

    expect(response.status).toBe(400);
  });

  it('rejects invalid rating, invalid intent, and unknown fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-contract-invalid' }))
      .send({
        rating: 'bad',
        intent: 'unsupported',
        rawPayload: 'should be rejected'
      });

    expect(response.status).toBe(400);
    expect(response.body.requestId).toBe('req-feedback-contract-invalid');
  });
});
