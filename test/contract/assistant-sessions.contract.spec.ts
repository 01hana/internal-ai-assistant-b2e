import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createLegacyPublicIdentityHeaders,
  createUs1TestAppWithState,
  Us1TestState
} from '../support/us1-test-app.helper';
import {
  createInternalIdentityJwtFixture,
  InternalTokenClaims,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';

describe('assistant sessions contract', () => {
  const identityFixture = createInternalIdentityJwtFixture();
  const ownedClaims: Partial<InternalTokenClaims> = {
    sub: 'actor-001',
    org_id: 'org-001',
    host_app: 'erp'
  };
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState({
      internalIdentity: {
        issuer: TEST_GATEWAY_ISSUER,
        audience: TEST_BACKEND_AUDIENCE,
        jwks: identityFixture.jwks
      }
    });
    app = testApp.app;
    state = testApp.state;
    expect(state.internalIdentity).toEqual({
      issuer: TEST_GATEWAY_ISSUER,
      audience: TEST_BACKEND_AUDIENCE,
      jwks: identityFixture.jwks
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a session with the standard response envelope and visible context summary', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions')
      .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-us1-session-create' }))
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
      .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-us1-session-get' }));

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
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: 'req-us1-session-get',
          sessionId: 'session-owned-001',
          eventType: 'session_resumed',
          metadata: {
            hasContextState: true,
            taskState: 'completed',
            currentModule: 'orders',
            currentEntityType: 'order',
            currentEntityId: 'SO-10001'
          }
        })
      ])
    );
  });

  it('rejects non-visible sessions with a consistent error envelope across actor, host app, and organization boundaries', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001')
      .set(
        createAuthorizedInternalIdentityHeaders(identityFixture, {
          claims: { ...ownedClaims, sub: 'actor-999', host_app: 'crm', org_id: 'org-999' },
          requestId: 'req-us1-session-hidden'
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
    expect(
      state.auditEvents.some(
        (event) => event.requestId === 'req-us1-session-hidden' && event.eventType === 'session_resumed'
      )
    ).toBe(false);
  });

  it.each(['session-closed-001', 'session-expired-001'])(
    'does not write session_resumed audit for inactive session %s',
    async (sessionId) => {
      const requestId = `req-us1-session-${sessionId}`;
      const response = await request(app.getHttpServer())
        .get(`/api/v1/assistant/sessions/${sessionId}`)
        .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId }));

      expect(response.status).toBe(404);
      expect(response.body).toEqual(
        expect.objectContaining({
          requestId,
          error: expect.objectContaining({
            code: expect.any(String),
            message: expect.any(String)
          })
        })
      );
      expect(state.auditEvents.some((event) => event.requestId === requestId && event.eventType === 'session_resumed')).toBe(false);
    }
  );

  it.each([
    ['missing token', {}, 401, 'IDENTITY_TOKEN_INVALID'],
    ['malformed token', { authorization: 'Bearer broken.token' }, 401, 'IDENTITY_TOKEN_INVALID'],
    ['verified-token invalid canonical claims', createAuthorizedInternalIdentityHeaders(identityFixture, { claims: { customer_id: '' } }), 403, 'IDENTITY_CONTEXT_INVALID']
  ])('rejects %s before session business work using the standard JSON envelope', async (_name, headers, status, code) => {
    const beforeAuditCount = state.auditEvents.length;
    const beforeSessionCount = state.sessions.length;
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions').set(headers).send({});

    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toEqual(expect.objectContaining({ error: expect.objectContaining({ code }) }));
    expect(state.auditEvents).toHaveLength(beforeAuditCount);
    expect(state.sessions).toHaveLength(beforeSessionCount);
    expect(JSON.stringify(response.body)).not.toContain('JWKS');
    expect(JSON.stringify(response.body)).not.toContain('Bearer ');
  });

  it('does not allow public identity headers to create a session without a verified JWT', async () => {
    const beforeSessionCount = state.sessions.length;
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions')
      .set(createLegacyPublicIdentityHeaders({ 'x-request-id': 'req-header-not-authority' }))
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('IDENTITY_TOKEN_INVALID');
    expect(state.sessions).toHaveLength(beforeSessionCount);
  });
});
