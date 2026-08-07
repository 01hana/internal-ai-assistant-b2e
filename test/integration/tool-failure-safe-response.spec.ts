import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('US4 tool failure safe response gate', () => {
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

  it('returns a safe no-answer response and review item when the connector fails', async () => {
    const initialReviewItemCount = state.reviewItems.length;
    const initialEvidenceRefCount = state.evidenceRefs.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us4-tool-failure',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({
        message: '請查 SO-99999 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-99999',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newReviewItems = state.reviewItems.slice(initialReviewItemCount);
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);

    expect(eventNames).toEqual(['tool_call_started', 'tool_call_failed', 'answer_delta', 'final']);
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(state.evidenceRefs).toHaveLength(initialEvidenceRefCount);
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        noAnswerReason: 'tool_failure',
        errorCode: 'NOT_FOUND',
        evidenceRefs: []
      })
    );
    expect(finalEvent?.data?.data.answer).toEqual(expect.stringContaining('目前無法取得'));
    expect(newReviewItems).toEqual([
      expect.objectContaining({
        sourceType: 'tool_failure',
        summary: expect.stringContaining('tool_failure')
      })
    ]);
    expect(newReviewItems[0].suggestedImprovement).toEqual(
      expect.objectContaining({
        noAnswerReason: 'tool_failure',
        toolFailureReason: 'NOT_FOUND'
      })
    );
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'review_item_created',
          metadata: expect.objectContaining({
            reviewItemId: newReviewItems[0].id,
            noAnswerReason: 'tool_failure'
          })
        })
      ])
    );
    expect(JSON.stringify(newAuditEvents)).not.toContain('Error:');
    expect(JSON.stringify(newReviewItems)).not.toContain('stack');
  });
});
