import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('US4 permission denied safe response', () => {
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

  it('does not answer from unauthorized evidence and creates a minimized review item', async () => {
    const initialAnswerDecisionCount = state.answerDecisions.length;
    const initialReviewItemCount = state.reviewItems.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        {
          ...createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
            claims: { permission_scopes: ['inventory:read'] },
            requestId: 'req-us4-permission-denied'
          }),
          'x-permission-scopes': 'inventory:read'
        }
      )
      .send({
        message: '請查 SO-10001 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newAnswerDecisions = state.answerDecisions.slice(initialAnswerDecisionCount);
    const newReviewItems = state.reviewItems.slice(initialReviewItemCount);
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);

    expect(eventNames).toEqual(['tool_call_blocked', 'answer_delta', 'final']);
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'permission_denied',
        noAnswerReason: 'permission_denied',
        evidenceRefs: []
      })
    );
    expect(finalEvent?.data?.data.answer).not.toContain('已確認');
    expect(newAnswerDecisions).toEqual([
      expect.objectContaining({
        status: 'permission_denied',
        noAnswerReason: 'permission_denied'
      })
    ]);
    expect(newReviewItems).toEqual([
      expect.objectContaining({
        sourceType: 'permission_mapping_issue',
        sourceId: newAnswerDecisions[0].id,
        suggestedImprovement: expect.objectContaining({
          noAnswerReason: 'permission_denied',
          permissionDeniedReason: 'missing_scope'
        })
      })
    ]);
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'review_item_created',
          metadata: expect.objectContaining({
            reviewItemId: newReviewItems[0].id,
            noAnswerReason: 'permission_denied'
          })
        }),
        expect.objectContaining({
          eventType: 'answer_generated',
          decision: 'permission_denied',
          metadata: expect.objectContaining({
            noAnswerReason: 'permission_denied'
          })
        })
      ])
    );
    expect(JSON.stringify(newReviewItems)).not.toContain('已確認');
    expect(JSON.stringify(newReviewItems)).not.toContain('王小明企業');
    expect(JSON.stringify(newAuditEvents)).not.toContain('rawPayload');
    expect(JSON.stringify(newAuditEvents)).not.toContain('connectorSecret');
  });
});
