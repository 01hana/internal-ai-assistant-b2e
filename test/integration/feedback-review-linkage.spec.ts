import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AssistantMessageRole } from '../../src/generated/prisma/enums';
import { createIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';

describe('feedback to review linkage integration', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterAll(async () => {
    await app.close();
  });

  function addAssistantMessage(messageId: string) {
    state.messages.push({
      id: messageId,
      sessionId: 'session-owned-001',
      requestId: `req-${messageId}`,
      role: AssistantMessageRole.assistant,
      content: '這是可回饋的 assistant answer。',
      answerDecision: 'answered',
      pageContext: null,
      createdAt: new Date('2026-06-16T00:00:10.000Z')
    });
  }

  it('records positive feedback without creating review item', async () => {
    const initialFeedbackCount = state.feedbackEvents.length;
    const initialReviewCount = state.reviewItems.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-link-positive' }))
      .send({
        rating: 'positive',
        intent: 'other',
        reason: 'clear'
      });

    expect(response.status).toBe(201);
    expect(state.feedbackEvents).toHaveLength(initialFeedbackCount + 1);
    expect(state.reviewItems).toHaveLength(initialReviewCount);
    expect(response.body.data.reviewItemId).toBeNull();
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'feedback_received',
          metadata: expect.objectContaining({
            feedbackEventId: state.feedbackEvents.at(-1)?.id,
            rating: 'positive',
            intent: 'other'
          })
        })
      ])
    );
  });

  it('creates minimized ReviewItem for negative actionable feedback', async () => {
    addAssistantMessage('message-feedback-negative-001');
    const initialReviewCount = state.reviewItems.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-negative-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-link-negative' }))
      .send({
        rating: 'negative',
        intent: 'not_helpful',
        reason: 'wrong source',
        comment: 'The answer did not use the evidence I expected.'
      });

    expect(response.status).toBe(201);
    const feedbackEvent = state.feedbackEvents.at(-1);
    const reviewItem = state.reviewItems.at(-1);

    expect(state.reviewItems).toHaveLength(initialReviewCount + 1);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        feedbackEventId: feedbackEvent?.id,
        reviewItemId: reviewItem?.id,
        rating: 'negative',
        intent: 'not_helpful'
      })
    );
    expect(feedbackEvent).toEqual(
      expect.objectContaining({
        messageId: 'message-feedback-negative-001',
        answerDecision: 'answered',
        toolCallIds: [],
        evidenceRefIds: []
      })
    );
    expect(reviewItem).toEqual(
      expect.objectContaining({
        sourceType: 'negative_feedback',
        sourceId: feedbackEvent?.id,
        status: 'open',
        priority: 'medium',
        suggestedImprovement: expect.objectContaining({
          feedbackEventId: feedbackEvent?.id,
          requestId: 'req-feedback-link-negative',
          messageId: 'message-feedback-negative-001',
          answerDecision: 'answered',
          toolCallIds: [],
          evidenceRefIds: [],
          rating: 'negative',
          intent: 'not_helpful',
          reasonProvided: true,
          commentProvided: true
        })
      })
    );
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'feedback_received',
          metadata: expect.objectContaining({
            feedbackEventId: feedbackEvent?.id,
            commentProvided: true
          })
        }),
        expect.objectContaining({
          eventType: 'review_item_created',
          metadata: expect.objectContaining({
            reviewItemId: reviewItem?.id,
            feedbackEventId: feedbackEvent?.id,
            toolCallIds: [],
            evidenceRefIds: []
          })
        })
      ])
    );

    const serializedReviewAndAudit = JSON.stringify([reviewItem, state.auditEvents]);
    expect(serializedReviewAndAudit).not.toContain('The answer did not use the evidence I expected.');
    expect(serializedReviewAndAudit).not.toContain('connectorSecret');
    expect(serializedReviewAndAudit).not.toContain('rawPayload');
  });

  it('maps missing evidence feedback to missing_evidence review source', async () => {
    addAssistantMessage('message-feedback-missing-evidence-001');
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-missing-evidence-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-link-missing-evidence' }))
      .send({
        rating: 'neutral',
        intent: 'missing_evidence',
        reason: 'missing SOP'
      });

    expect(response.status).toBe(201);
    expect(state.reviewItems.at(-1)).toEqual(
      expect.objectContaining({
        sourceType: 'missing_evidence',
        priority: 'high'
      })
    );
  });

  it('uses high priority for correction and unsafe feedback', async () => {
    addAssistantMessage('message-feedback-correction-001');
    addAssistantMessage('message-feedback-unsafe-001');

    const correctionResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-correction-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-link-correction' }))
      .send({
        rating: 'negative',
        intent: 'correction',
        reason: 'incorrect answer'
      });
    const unsafeResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-unsafe-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-link-unsafe' }))
      .send({
        rating: 'negative',
        intent: 'unsafe',
        reason: 'unsafe instruction'
      });

    expect(correctionResponse.status).toBe(201);
    expect(unsafeResponse.status).toBe(201);
    expect(state.reviewItems.find((item) => item.id === correctionResponse.body.data.reviewItemId)).toEqual(
      expect.objectContaining({ priority: 'high' })
    );
    expect(state.reviewItems.find((item) => item.id === unsafeResponse.body.data.reviewItemId)).toEqual(
      expect.objectContaining({ priority: 'high' })
    );
  });

  it('dedupes actionable feedback by message answer decision and intent', async () => {
    addAssistantMessage('message-feedback-dedupe-001');
    const initialFeedbackCount = state.feedbackEvents.length;
    const initialReviewCount = state.reviewItems.length;
    const initialReviewCreatedAuditCount = state.auditEvents.filter((event) => event.eventType === 'review_item_created').length;
    const initialFeedbackAuditCount = state.auditEvents.filter((event) => event.eventType === 'feedback_received').length;

    const firstResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-dedupe-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-link-dedupe-1' }))
      .send({
        rating: 'negative',
        intent: 'not_helpful'
      });
    const secondResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-dedupe-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': 'req-feedback-link-dedupe-2' }))
      .send({
        rating: 'negative',
        intent: 'not_helpful'
      });

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(state.feedbackEvents).toHaveLength(initialFeedbackCount + 2);
    expect(state.reviewItems).toHaveLength(initialReviewCount + 1);
    expect(secondResponse.body.data.reviewItemId).toBe(firstResponse.body.data.reviewItemId);
    expect(state.auditEvents.filter((event) => event.eventType === 'review_item_created')).toHaveLength(
      initialReviewCreatedAuditCount + 1
    );
    expect(state.auditEvents.filter((event) => event.eventType === 'feedback_received')).toHaveLength(
      initialFeedbackAuditCount + 2
    );
  });
});
