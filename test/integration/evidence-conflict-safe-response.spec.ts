import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('US4 evidence conflict runtime gate', () => {
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

  it('returns no_answer and review item from endpoint runtime when structured evidence facts conflict', async () => {
    const initialAnswerDecisionCount = state.answerDecisions.length;
    const initialReviewItemCount = state.reviewItems.length;
    const initialAuditCount = state.auditEvents.length;
    const initialToolCallCount = state.toolCalls.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us4-evidence-conflict-runtime',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({
        message: '請查 SO-10003 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10003',
          visibleColumns: ['status']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newToolCalls = state.toolCalls.slice(initialToolCallCount);
    const newAnswerDecisions = state.answerDecisions.slice(initialAnswerDecisionCount);
    const newReviewItems = state.reviewItems.slice(initialReviewItemCount);
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);

    expect(eventNames).toEqual(['tool_call_started', 'tool_call_completed', 'answer_delta', 'final']);
    expect(eventNames).not.toContain('evidence_attached');
    expect(newToolCalls).toEqual([
      expect.objectContaining({
        toolName: 'mock.orders.status.lookup',
        status: 'success',
        executionStatus: 'executed'
      })
    ]);
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        noAnswerReason: 'evidence_conflict',
        evidenceRefs: []
      })
    );
    expect(finalEvent?.data?.data.answer).toContain('evidence');
    expect(finalEvent?.data?.data.answer).not.toContain('confirmed');
    expect(finalEvent?.data?.data.answer).not.toContain('cancelled');
    expect(newAnswerDecisions).toEqual([
      expect.objectContaining({
        status: 'no_answer',
        noAnswerReason: 'evidence_conflict'
      })
    ]);
    expect(newReviewItems).toEqual([
      expect.objectContaining({
        sourceType: 'missing_evidence',
        sourceId: newAnswerDecisions[0].id,
        suggestedImprovement: expect.objectContaining({
          noAnswerReason: 'evidence_conflict',
          conflictReason: 'same_field_conflicting_values',
          conflictFieldPaths: ['status'],
          evidenceRefCount: 1,
          evidenceRefIds: [expect.any(String)]
        })
      })
    ]);
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'review_item_created',
          metadata: expect.objectContaining({
            reviewItemId: newReviewItems[0].id,
            noAnswerReason: 'evidence_conflict',
            conflictReason: 'same_field_conflicting_values',
            conflictFieldPaths: ['status'],
            evidenceRefCount: 1,
            evidenceRefIds: [expect.any(String)]
          })
        }),
        expect.objectContaining({
          eventType: 'answer_generated',
          decision: 'no_answer',
          evidenceRefIds: [],
          metadata: expect.objectContaining({
            noAnswerReason: 'evidence_conflict',
            conflictReason: 'same_field_conflicting_values',
            conflictFieldPaths: ['status'],
            evidenceRefCount: 1,
            evidenceRefIds: [expect.any(String)],
            answerDecisionId: newAnswerDecisions[0].id,
            reviewItemId: newReviewItems[0].id
          })
        })
      ])
    );
    expect(JSON.stringify(newReviewItems)).not.toContain('confirmed');
    expect(JSON.stringify(newReviewItems)).not.toContain('cancelled');
    expect(JSON.stringify(newAuditEvents.filter((event) => event.eventType !== 'tool_call_completed'))).not.toContain('confirmed');
    expect(JSON.stringify(newAuditEvents.filter((event) => event.eventType !== 'tool_call_completed'))).not.toContain('cancelled');
    expect(JSON.stringify(newAuditEvents)).not.toContain('rawPayload');
    expect(JSON.stringify(newAuditEvents)).not.toContain('connectorSecret');
  });
});
