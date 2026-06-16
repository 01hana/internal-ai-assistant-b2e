import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp } from '../support/us1-test-app.helper';

describe('session history permission boundary integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies history access for a different actor, host app, or organization before any history payload is returned', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 50, order: 'asc' })
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us1-history-boundary',
          'x-actor-id': 'actor-222',
          'x-host-app': 'wms',
          'x-organization-id': 'org-222'
        })
      );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us1-history-boundary',
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String)
        })
      })
    );
  });
});
