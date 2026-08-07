import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState
} from '../support/us1-test-app.helper';
import {
  createInternalIdentityJwtFixture,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';

describe('T064 feedback controller identity contract', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
  });
  afterAll(async () => app?.close());

  it('accepts only a verified canonical identity; public Customer headers do not supply identity', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
      .set({
        ...createAuthorizedInternalIdentityHeaders(jwt, {
          claims: jwt.canonicalClaims.customerA,
          requestId: 'req-t064-contract-canonical'
        }),
        'x-customer-id': 'customer-b'
      })
      .send({ rating: 'positive', intent: 'other', reason: 'helpful' });

    // T067 target: the verified Customer A request reaches FeedbackEvent persistence,
    // which currently fails because production does not provide customerId.
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({ messageId: 'message-owned-assistant-001' }));
  });

  it('does not allow legacy public identity headers to authenticate feedback', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
      .set({
        'x-request-id': 'req-t064-contract-legacy',
        'x-customer-id': 'customer-a',
        'x-actor-id': 'actor-shared',
        'x-organization-id': 'org-shared',
        'x-host-app': 'erp'
      })
      .send({ rating: 'positive', intent: 'other' });

    expect(response.status).toBe(401);
  });

  it('keeps DTO validation separate from Customer ownership', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
      .set(createAuthorizedInternalIdentityHeaders(jwt, { claims: jwt.canonicalClaims.customerA }))
      .send({ rating: 'positive', customerId: 'customer-b' });

    expect(response.status).toBe(400);
  });
});
