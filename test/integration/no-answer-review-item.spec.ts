import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('US4 no-answer review item hook', () => {
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

  it('returns no_answer and creates a minimized review item when sanitized evidence is empty', async () => {
    const initialReviewItemCount = state.reviewItems.length;
    const initialEvidenceRefCount = state.evidenceRefs.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us4-no-evidence',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({
        message: '請查 SO-10001 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['notARealVisibleField']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newReviewItems = state.reviewItems.slice(initialReviewItemCount);
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);

    expect(eventNames).toEqual(['tool_call_started', 'tool_call_completed', 'answer_delta', 'final']);
    expect(eventNames).not.toContain('evidence_attached');
    expect(state.evidenceRefs).toHaveLength(initialEvidenceRefCount);
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        noAnswerReason: 'no_evidence',
        evidenceRefs: []
      })
    );
    expect(newReviewItems).toEqual([
      expect.objectContaining({
        sourceType: 'no_answer',
        sourceId: expect.any(String),
        status: 'open',
        summary: expect.stringContaining('no_evidence')
      })
    ]);
    expect(newReviewItems[0].suggestedImprovement).toEqual(
      expect.objectContaining({
        noAnswerReason: 'no_evidence',
        evidenceRefCount: 0
      })
    );
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'review_item_created',
          metadata: expect.objectContaining({
            reviewItemId: newReviewItems[0].id,
            noAnswerReason: 'no_evidence'
          })
        }),
        expect.objectContaining({
          eventType: 'answer_generated',
          decision: 'no_answer',
          metadata: expect.objectContaining({
            noAnswerReason: 'no_evidence'
          })
        })
      ])
    );
    expect(JSON.stringify(newReviewItems)).not.toContain('SO-10001 訂單狀態');
    expect(JSON.stringify(newReviewItems)).not.toContain('128000');
  });
});
