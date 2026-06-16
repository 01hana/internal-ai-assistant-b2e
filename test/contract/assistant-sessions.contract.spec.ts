import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp } from '../support/us1-test-app.helper';

describe('assistant sessions contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createUs1TestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a session with the standard response envelope and visible context summary', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-session-create' }))
      .send({
        pageContext: {
          module: 'orders',
          route: '/orders/SO-10001',
          screenId: 'order-detail',
          entityType: 'order',
          entityId: 'SO-10001'
        }
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us1-session-create',
        data: expect.objectContaining({
          sessionId: expect.any(String),
          status: 'active'
        })
      })
    );
  });

  it('returns a session summary with assistant context state for the owning identity only', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-session-get' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us1-session-get',
        data: expect.objectContaining({
          sessionId: 'session-owned-001',
          status: expect.any(String),
          contextState: expect.objectContaining({
            taskState: expect.any(String)
          })
        })
      })
    );
  });

  it('rejects non-visible sessions with a consistent error envelope across actor, host app, and organization boundaries', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us1-session-hidden',
          'x-actor-id': 'actor-999',
          'x-host-app': 'crm',
          'x-organization-id': 'org-999'
        })
      );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us1-session-hidden',
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String)
        })
      })
    );
  });
});
