import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp, parseSseResponse } from '../support/us1-test-app.helper';

describe('field masking before LLM integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('never exposes denied fields to the LLM path or the final answer when only partial field access is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us1-masking-before-llm',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({
        message: '請說明這張訂單的客戶名稱和金額',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const finalPayload = events.find((event) => event.event === 'final')?.data;

    expect(finalPayload).toEqual(
      expect.objectContaining({
        data: expect.not.objectContaining({
          llmInput: expect.stringContaining('amount')
        })
      })
    );
    expect(JSON.stringify(finalPayload)).not.toContain('amount');
  });
});
