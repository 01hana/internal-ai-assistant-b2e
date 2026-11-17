import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';

/** Feature 013 T041: public response shapes of the session list and archive endpoints. */
describe('assistant session list and archive contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    }));
  });
  afterAll(async () => { await app.close(); });

  const headers = (requestId: string) =>
    createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId });

  it('returns the standard envelope with sessions and nextCursor', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/assistant/sessions').set(headers('req-f013-contract-list'));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ requestId: 'req-f013-contract-list',
      data: { sessions: expect.any(Array), nextCursor: null } }));
  });

  it('returns the standard error envelope for an invalid cursor and an unknown session', async () => {
    const badCursor = await request(app.getHttpServer()).get('/api/v1/assistant/sessions?cursor=%25%25').set(headers('req-f013-contract-bad'));
    expect(badCursor.status).toBe(400);
    expect(badCursor.body).toEqual(expect.objectContaining({ requestId: 'req-f013-contract-bad' }));
    const missing = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/missing-session/archive')
      .set(headers('req-f013-contract-missing')).send();
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(expect.objectContaining({ requestId: 'req-f013-contract-missing' }));
  });

  it('returns the standard envelopes for the archived list, unarchive and delete', async () => {
    const archived = await request(app.getHttpServer()).get('/api/v1/assistant/sessions?status=archived').set(headers('req-f013-contract-archived'));
    expect(archived.status).toBe(200);
    expect(archived.body).toEqual(expect.objectContaining({ requestId: 'req-f013-contract-archived',
      data: { sessions: expect.any(Array), nextCursor: null } }));
    for (const [method, path] of [['post', '/api/v1/assistant/sessions/missing-session/unarchive'], ['delete', '/api/v1/assistant/sessions/missing-session']] as const) {
      const response = await request(app.getHttpServer())[method](path).set(headers(`req-f013-contract-${method}`)).send();
      expect(response.status).toBe(404);
      expect(response.body).toEqual(expect.objectContaining({ requestId: `req-f013-contract-${method}`, error: expect.objectContaining({ code: 'NOT_FOUND' }) }));
    }
  });
});
