import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AnswerDecisionStatus, NoAnswerReason } from '../../src/generated/prisma/enums';
import { ReviewItemService } from '../../src/feedback/review-item.service';
import { createIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';

describe('admin review items contract', () => {
  let app: INestApplication;
  let state: Us1TestState;
  let reviewItemService: ReviewItemService;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
    reviewItemService = app.get(ReviewItemService);
  });

  afterAll(async () => {
    await app.close();
  });

  const reviewerHeaders = (requestId: string, overrides?: Partial<Record<string, string>>) =>
    createIdentityHeaders({
      'x-request-id': requestId,
      'x-role': 'admin',
      'x-permission-scopes': 'assistant:review',
      ...overrides
    });

  it('lists visible review items with filters and response envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items?status=open&sourceType=negative_feedback&priority=medium')
      .set(reviewerHeaders('req-review-contract-list'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-review-contract-list',
        data: expect.objectContaining({
          items: [
            expect.objectContaining({
              reviewItemId: 'review-item-open-feedback-001',
              status: 'open',
              sourceType: 'negative_feedback',
              priority: 'medium'
            })
          ]
        })
      })
    );
    expect(JSON.stringify(response.body)).not.toContain('review-item-hidden-org-001');
  });

  it('returns review item detail for reviewers only', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items/review-item-open-feedback-001')
      .set(reviewerHeaders('req-review-contract-detail'));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        reviewItemId: 'review-item-open-feedback-001',
        suggestedImprovement: expect.objectContaining({
          messageId: 'message-owned-assistant-001',
          feedbackEventId: 'feedback-event-seed-001'
        })
      })
    );
    expect(JSON.stringify(response.body)).not.toContain('rawPayload');
    expect(JSON.stringify(response.body)).not.toContain('connectorSecret');
  });

  it('exposes system-created review items through the same organization and hostApp visibility filter', async () => {
    const visibleSystemReviewItem = await reviewItemService.createFromAssistantOutcome({
      requestId: 'req-review-contract-system-visible',
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      identityContext: {
        requestId: 'req-review-contract-system-visible',
        actor: {
          actorId: 'actor-001',
          role: 'planner',
          permissionScopes: ['orders:read']
        },
        hostApp: {
          hostApp: 'erp'
        },
        company: {
          organizationId: 'org-001'
        }
      },
      answerDecisionId: 'answer-decision-system-visible-001',
      answerDecision: AnswerDecisionStatus.no_answer,
      noAnswerReason: NoAnswerReason.no_evidence,
      evidenceRefCount: 0
    });
    const hiddenSystemReviewItem = await reviewItemService.createFromAssistantOutcome({
      requestId: 'req-review-contract-system-hidden',
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      identityContext: {
        requestId: 'req-review-contract-system-hidden',
        actor: {
          actorId: 'actor-hidden',
          role: 'planner',
          permissionScopes: ['orders:read']
        },
        hostApp: {
          hostApp: 'erp'
        },
        company: {
          organizationId: 'org-hidden'
        }
      },
      answerDecisionId: 'answer-decision-system-hidden-001',
      answerDecision: AnswerDecisionStatus.no_answer,
      noAnswerReason: NoAnswerReason.no_evidence,
      evidenceRefCount: 0
    });

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items?status=open&sourceType=no_answer')
      .set(reviewerHeaders('req-review-contract-system-list'));
    const detailResponse = await request(app.getHttpServer())
      .get(`/api/v1/admin/assistant/review-items/${visibleSystemReviewItem.id}`)
      .set(reviewerHeaders('req-review-contract-system-detail'));
    const hiddenDetailResponse = await request(app.getHttpServer())
      .get(`/api/v1/admin/assistant/review-items/${hiddenSystemReviewItem.id}`)
      .set(reviewerHeaders('req-review-contract-system-hidden-detail'));
    const hiddenOrgListResponse = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items?status=open&sourceType=no_answer')
      .set(reviewerHeaders('req-review-contract-system-hidden-list', { 'x-organization-id': 'org-hidden' }));

    expect(listResponse.status).toBe(200);
    expect(JSON.stringify(listResponse.body)).toContain(visibleSystemReviewItem.id);
    expect(JSON.stringify(listResponse.body)).not.toContain(hiddenSystemReviewItem.id);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data).toEqual(
      expect.objectContaining({
        reviewItemId: visibleSystemReviewItem.id,
        suggestedImprovement: expect.objectContaining({
          organizationId: 'org-001',
          hostApp: 'erp',
          noAnswerReason: 'no_evidence'
        })
      })
    );
    expect(hiddenDetailResponse.status).toBe(404);
    expect(JSON.stringify(hiddenOrgListResponse.body)).toContain(hiddenSystemReviewItem.id);
    expect(JSON.stringify(hiddenOrgListResponse.body)).not.toContain(visibleSystemReviewItem.id);
  });

  it('fails closed for non-reviewer list access', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/assistant/review-items')
      .set(createIdentityHeaders({ 'x-request-id': 'req-review-contract-denied', 'x-role': 'planner' }));

    expect(response.status).toBe(403);
    expect(response.body.requestId).toBe('req-review-contract-denied');
  });

  it('resolves a review item and writes minimized audit', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/assistant/review-items/review-item-open-feedback-001/resolve')
      .set(reviewerHeaders('req-review-contract-resolve'))
      .send({ reason: 'fixed in SOP' });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        reviewItemId: 'review-item-open-feedback-001',
        status: 'resolved',
        resolvedAt: expect.any(String)
      })
    );
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'review_item_resolved',
          metadata: expect.objectContaining({
            reviewItemId: 'review-item-open-feedback-001',
            reasonProvided: true
          })
        })
      ])
    );
    expect(JSON.stringify(state.auditEvents)).not.toContain('fixed in SOP');
  });

  it('dismisses a review item and writes minimized audit', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/assistant/review-items/review-item-open-feedback-002/dismiss')
      .set(reviewerHeaders('req-review-contract-dismiss'))
      .send({ reason: 'not actionable' });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        reviewItemId: 'review-item-open-feedback-002',
        status: 'dismissed',
        resolvedAt: expect.any(String)
      })
    );
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'review_item_dismissed',
          metadata: expect.objectContaining({
            reviewItemId: 'review-item-open-feedback-002',
            reasonProvided: true
          })
        })
      ])
    );
  });
});
