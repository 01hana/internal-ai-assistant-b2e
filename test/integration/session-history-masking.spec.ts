import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp } from '../support/us1-test-app.helper';

describe('session history masking integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns minimized evidence and tool summaries in message history for the current actor permissions', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 50, order: 'asc' })
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us1-history-masking',
          'x-permission-scopes': 'orders:read'
        })
      );

    expect(response.status).toBe(200);

    const assistantMessages = response.body.data.messages.filter((message: { role: string }) => message.role === 'assistant');

    expect(assistantMessages[0]).toEqual(
      expect.objectContaining({
        evidenceRefs: expect.any(Array),
        toolSummary: expect.objectContaining({
          status: expect.any(String),
          toolCallIds: expect.any(Array)
        })
      })
    );
    expect(JSON.stringify(assistantMessages[0])).not.toContain('permissionResult');
    expect(JSON.stringify(assistantMessages[0])).not.toContain('inputSummary');
    expect(JSON.stringify(assistantMessages[0])).not.toContain('outputSummary');
  });
});
