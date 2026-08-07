import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp, parseSseResponse } from '../support/us1-test-app.helper';

describe('assistant message SSE contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('streams the message flow as SSE events only, with the required event sequence and metadata envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-sse-success' }))
      .send({
        message: '這張訂單目前狀態？',
        pageContext: {
          module: 'orders',
          screenId: 'order-detail',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = parseSseResponse(response.text);

    expect(events.map((event) => event.event)).toEqual([
      'tool_call_started',
      'tool_call_completed',
      'evidence_attached',
      'answer_delta',
      'final'
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            requestId: 'req-us1-sse-success',
            sessionId: 'session-owned-001',
            messageId: expect.any(String),
            eventType: expect.any(String),
            sequence: expect.any(Number)
          })
        })
      ])
    );
    expect(events.at(-1)?.data).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          answerDecision: expect.any(String)
        })
      })
    );
  });

  it('returns an SSE error event instead of a synchronous JSON body when the message flow fails', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-hidden-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us1-sse-error',
          'x-actor-id': 'actor-999'
        })
      )
      .send({
        message: '請幫我查這張訂單'
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = parseSseResponse(response.text);

    expect(events).toEqual([
      expect.objectContaining({
        event: 'error',
        data: expect.objectContaining({
          requestId: 'req-us1-sse-error',
          sessionId: 'session-hidden-001',
          eventType: 'error',
          sequence: 1,
          data: expect.objectContaining({
            code: expect.any(String),
            message: expect.any(String)
          })
        })
      })
    ]);
  });
});
