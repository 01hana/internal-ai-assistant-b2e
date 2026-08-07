import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp, parseSseResponse } from '../support/us1-test-app.helper';

describe('authorized evidence-grounded answer integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns an answered final SSE event with traceable evidence refs for an authorized query', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-authorized-answer' }))
      .send({
        message: '請幫我查 SO-10001 訂單目前狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const finalEvent = events.find((event) => event.event === 'final');
    const evidenceEvent = events.find((event) => event.event === 'evidence_attached');

    expect(evidenceEvent?.data).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          evidenceRefs: expect.arrayContaining([expect.any(String)])
        })
      })
    );
    expect(finalEvent?.data).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          answerDecision: 'answered'
        })
      })
    );
  });
});
