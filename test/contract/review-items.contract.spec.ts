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

describe('T065 review-item controller Customer contract', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  const reviewerHeaders = (customer: 'customerA' | 'customerB', requestId: string) =>
    createAuthorizedInternalIdentityHeaders(jwt, {
      claims: {
        ...jwt.canonicalClaims[customer],
        roles: ['admin'],
        permission_scopes: ['assistant:review']
      },
      requestId
    });

  beforeAll(async () => {
    ({ app } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
  });
  afterAll(async () => app?.close());

  it('lists only canonical caller Customer records even when Customer B shares organization and hostApp', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items?status=open&sourceType=negative_feedback&priority=medium')
      .set({ ...reviewerHeaders('customerA', 'req-t065-contract-list'), 'x-customer-id': 'customer-b' });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain('review-item-customer-a-shared-001');
    expect(JSON.stringify(response.body)).not.toContain('review-item-customer-b-shared-001');
  });

  it('returns safe not-found for a foreign global review ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items/review-item-customer-b-shared-001')
      .set(reviewerHeaders('customerA', 'req-t065-contract-foreign-get'));

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('customer-b review');
  });

  it('does not authenticate an admin from legacy public identity headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items')
      .set({ 'x-role': 'admin', 'x-permission-scopes': 'assistant:review' });

    expect(response.status).toBe(401);
  });
});
