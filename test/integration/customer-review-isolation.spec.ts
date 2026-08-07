import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { ReviewItemService } from '../../src/feedback/review-item.service';
import { ReviewItemStatus } from '../../src/generated/prisma/enums';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  Us1TestState
} from '../support/us1-test-app.helper';
import {
  createInternalIdentityJwtFixture,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';

describe('T065 Customer A/B ReviewItem isolation expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  const headers = (customer: 'customerA' | 'customerB', requestId: string) =>
    createAuthorizedInternalIdentityHeaders(jwt, {
      claims: { ...jwt.canonicalClaims[customer], roles: ['admin'], permission_scopes: ['assistant:review'] },
      requestId
    });

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
  });
  afterEach(async () => app?.close());

  it('lists no Customer B record for Customer A when organization, actor, hostApp, filters, and source key match', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items?status=open&sourceType=negative_feedback&priority=medium')
      .set({ ...headers('customerA', 'req-t065-list'), 'x-customer-id': 'customer-b' });

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain('review-item-customer-b-shared-001');
  });

  it('returns safe not-found and makes no state or audit mutation for foreign resolve', async () => {
    const foreign = state.reviewItems.find((item) => item.id === 'review-item-customer-b-shared-001')!;
    const before = { status: foreign.status, resolvedAt: foreign.resolvedAt, audits: state.auditEvents.length };
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/assistant/review-items/${foreign.id}/resolve`)
      .set(headers('customerA', 'req-t065-foreign-resolve'))
      .send({ reason: 'foreign' });

    expect(response.status).toBe(404);
    expect(foreign.status).toBe(before.status);
    expect(foreign.resolvedAt).toBe(before.resolvedAt);
    expect(state.auditEvents).toHaveLength(before.audits);
  });

  it('fails closed when a same-Customer record points at a foreign source relation', async () => {
    state.reviewItems.push({
      ...state.reviewItems.find((item) => item.id === 'review-item-open-feedback-001')!,
      id: 'review-item-a-foreign-source-001',
      customerId: 'customer-a',
      sourceId: 'feedback-event-hidden-001',
      status: ReviewItemStatus.open
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items/review-item-a-foreign-source-001')
      .set(headers('customerA', 'req-t065-cross-source'));

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('feedback-event-hidden-001');
    expect(app.get(ReviewItemService)).toBeDefined();
  });

  it('rolls back a same-Customer transition when its lifecycle audit fails', async () => {
    const reviewItem = state.reviewItems.find((item) => item.id === 'review-item-customer-a-shared-001')!;
    const before = { status: reviewItem.status, resolvedAt: reviewItem.resolvedAt, audits: state.auditEvents.length };
    state.workflowAuditFailureEventTypes.push('review_item_resolved');

    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/assistant/review-items/${reviewItem.id}/resolve`)
      .set(headers('customerA', 'req-t068-transition-audit-rollback'))
      .send({ reason: 'fixed' });

    expect(response.status).toBe(500);
    const reloaded = state.reviewItems.find((item) => item.id === reviewItem.id)!;
    expect({ status: reloaded.status, resolvedAt: reloaded.resolvedAt, audits: state.auditEvents.length }).toEqual(before);
  });
});
