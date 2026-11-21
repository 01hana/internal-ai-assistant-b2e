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
      customerId: 'customer-a',
      sessionId: 'session-owned-001',
      requestId: `req-${messageId}`,
      role: AssistantMessageRole.assistant,
      content: '這是可回饋的 assistant answer。',
      answerDecision: 'answered',
      pageContext: null,
      createdAt: new Date('2026-06-16T00:00:10.000Z')
    });
    state.answerDecisions.push({
      id: `answer-${messageId}`,
      customerId: 'customer-a',
      requestId: `req-${messageId}`,
      messageId,
      status: 'answered',
      noAnswerReason: null,
      clarificationQuestionId: null,
      groundingCheckId: null,
      metadata: null,
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

  it('keeps one feedback and one review item per answer, following later ratings and reasons', async () => {
    addAssistantMessage('message-feedback-dedupe-001');
    const initialFeedbackCount = state.feedbackEvents.length;
    const initialReviewCount = state.reviewItems.length;
    const send = (requestId: string, body: Record<string, unknown>) => request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-dedupe-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': requestId }))
      .send(body);

    const negative = await send('req-feedback-once-1', { rating: 'negative' });
    const withReason = await send('req-feedback-once-2', { rating: 'negative', intent: 'not_helpful', reason: '答案不正確', comment: '數字和報表不同' });
    expect([negative.status, withReason.status]).toEqual([201, 201]);
    expect(state.feedbackEvents).toHaveLength(initialFeedbackCount + 1);
    expect(state.reviewItems).toHaveLength(initialReviewCount + 1);
    expect(withReason.body.data.feedbackEventId).toBe(negative.body.data.feedbackEventId);
    expect(withReason.body.data.reviewItemId).toBe(negative.body.data.reviewItemId);
    const feedback = state.feedbackEvents.at(-1);
    expect(feedback).toEqual(expect.objectContaining({ rating: 'negative', intent: 'not_helpful', reason: '答案不正確', comment: '數字和報表不同', requestId: 'req-feedback-once-2' }));
    const review = () => state.reviewItems.find((item) => item.id === negative.body.data.reviewItemId);
    expect(review()).toEqual(expect.objectContaining({ sourceType: 'negative_feedback', sourceId: feedback?.id, status: 'open' }));

    // Changed to positive: the untouched review item is dismissed, the reason is cleared.
    const positive = await send('req-feedback-once-3', { rating: 'positive' });
    expect(positive.body.data).toEqual(expect.objectContaining({ feedbackEventId: feedback?.id, rating: 'positive', reviewItemId: null }));
    expect(state.feedbackEvents.at(-1)).toEqual(expect.objectContaining({ rating: 'positive', reason: null, comment: null }));
    expect(review()).toEqual(expect.objectContaining({ status: 'dismissed', note: '使用者改為正面評價' }));

    // Negative again: the same review item opens again.
    const again = await send('req-feedback-once-4', { rating: 'negative' });
    expect(again.body.data.reviewItemId).toBe(negative.body.data.reviewItemId);
    expect(review()).toEqual(expect.objectContaining({ status: 'open', resolvedAt: null, note: '使用者再次給予負面評價' }));
    expect(state.feedbackEvents).toHaveLength(initialFeedbackCount + 1);
    expect(state.reviewItems).toHaveLength(initialReviewCount + 1);
    expect(state.auditEvents.filter((event) => event.eventType === 'feedback_received').at(-1)?.metadata)
      .toEqual(expect.objectContaining({ rating: 'negative', previousRating: 'positive' }));
  });

  it('leaves a review item someone is handling when the rating turns positive', async () => {
    addAssistantMessage('message-feedback-handled-001');
    const send = (requestId: string, body: Record<string, unknown>) => request(app.getHttpServer())
      .post('/api/v1/assistant/messages/message-feedback-handled-001/feedback')
      .set(createIdentityHeaders({ 'x-request-id': requestId }))
      .send(body);
    const negative = await send('req-feedback-handled-1', { rating: 'negative' });
    const item = state.reviewItems.find((entry) => entry.id === negative.body.data.reviewItemId)!;
    item.status = 'in_review' as never;
    await send('req-feedback-handled-2', { rating: 'positive' });
    expect(item.status).toBe('in_review');
  });
});
