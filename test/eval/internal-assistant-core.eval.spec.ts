import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { RiskLevel } from '../../src/generated/prisma/enums';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import {
  createAuthorizedInternalIdentityHeaders,
  createIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

type TestApp = {
  app: INestApplication;
  state: Us1TestState;
};

describe('internal assistant core deterministic eval baseline', () => {
  const identityContext = {
    requestId: 'req-eval-query-understanding',
    customer: {
      customerId: 'customer-a',
      integrationId: 'integration-erp'
    },
    actor: {
      actorId: 'actor-001',
      roles: ['planner'],
      permissionScopes: ['orders:read', 'inventory:read']
    },
    hostApp: {
      hostApp: 'erp'
    },
    organization: {
      organizationId: 'org-001'
    },
    auth: {
      tokenId: 'jti-eval-query-understanding',
      gatewayIssuer: 'https://gateway.test.internal'
    }
  };

  it('query-understanding-routing-and-entities', async () => {
    const pipeline = new RuleBasedQueryUnderstandingPipeline();

    const structuredResult = await pipeline.understand({
      requestId: 'req-eval-query-understanding-structured',
      sessionId: 'session-eval',
      messageId: 'message-eval-structured',
      text: '幫我查 SO-10001 的狀態，順便看 SKU-ABC-001 的庫存',
      identityContext,
      now: new Date('2026-06-22T00:00:00.000Z'),
      timezone: 'Asia/Taipei'
    });
    const documentResult = await pipeline.understand({
      requestId: 'req-eval-query-understanding-document',
      sessionId: 'session-eval',
      messageId: 'message-eval-document',
      text: '退貨流程 SOP 怎麼說？',
      identityContext,
      now: new Date('2026-06-22T00:00:00.000Z'),
      timezone: 'Asia/Taipei'
    });

    expect(structuredResult.entityCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'orderId', value: 'SO-10001' }),
        expect.objectContaining({ type: 'itemSku', value: 'SKU-ABC-001' })
      ])
    );
    expect(structuredResult.candidateTools.map((tool) => tool.key)).toEqual(
      expect.arrayContaining(['mock.orders.status.lookup', 'mock.inventory.availability.lookup'])
    );
    expect(structuredResult.requiredEvidence).toContain('structured_record');
    expect(structuredResult.subTasks.length).toBeGreaterThanOrEqual(2);
    expect(documentResult.requiredEvidence).toContain('document_chunk');
    expect(documentResult.candidateTools).toEqual([]);
    expect(documentResult.riskLevel).toBe(RiskLevel.low);
  });

  describe('endpoint routing and safety eval cases', () => {
    let testApp: TestApp;

    beforeEach(async () => {
      testApp = await createUs1TestAppWithState();
    });

    afterEach(async () => {
      await testApp.app.close();
    });

    it('live-order-status-uses-tool-not-retrieval', async () => {
      const { response, finalData, eventNames, newState } = await sendAssistantMessage(testApp, {
        requestId: 'req-eval-live-structured',
        headers: { 'x-permission-scopes': 'orders:read' },
        message: '請查 SO-10001 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

      expect(response.status).toBe(200);
      expect(eventNames).toEqual(['tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final']);
      expect(finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'answered',
          evidenceRefs: expect.arrayContaining([expect.any(String)])
        })
      );
      expect(newState.toolCalls).toEqual([
        expect.objectContaining({
          toolName: 'mock.orders.status.lookup',
          status: 'success',
          executionStatus: 'executed'
        })
      ]);
      expect(newState.retrievalRuns).toHaveLength(0);
      expect(newState.evidenceRefs).toEqual([
        expect.objectContaining({
          sourceType: 'structured_record'
        })
      ]);
      expect(newState.auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'evidence_attached' }),
          expect.objectContaining({ eventType: 'answer_generated', decision: 'answered' })
        ])
      );
    });

    it('sop-question-uses-document-retrieval-not-tool', async () => {
      const { response, finalData, eventNames, newState } = await sendAssistantMessage(testApp, {
        requestId: 'req-eval-document-sop',
        message: '退貨流程 SOP 怎麼說？',
        pageContext: {
          module: 'orders',
          visibleColumns: ['status']
        }
      });

      expect(response.status).toBe(200);
      expect(eventNames).toEqual(['answer_delta', 'final']);
      expect(eventNames).not.toContain('tool_call_started');
      expect(finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'answered',
          evidenceRefs: expect.arrayContaining([expect.any(String)])
        })
      );
      expect(newState.toolCalls).toHaveLength(0);
      expect(newState.retrievalRuns).toHaveLength(1);
      expect(newState.evidenceRefs).toEqual([
        expect.objectContaining({
          sourceType: 'document_chunk',
          documentId: 'knowledge-document-sop-return-001'
        })
      ]);
      expect(newState.auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'retrieval_run_created' }),
          expect.objectContaining({ eventType: 'retrieval_candidate_selected' }),
          expect.objectContaining({ eventType: 'answer_generated', decision: 'answered' })
        ])
      );
      expect(JSON.stringify(newState.auditEvents)).not.toContain('connectorSecret');
    });

    it('ambiguous-selected-rows-asks-clarification', async () => {
      const { response, finalData, eventNames, newState } = await sendAssistantMessage(testApp, {
        requestId: 'req-eval-clarification',
        message: '目前狀態？',
        pageContext: {
          module: 'orders',
          screenId: 'order-list',
          selectedRows: [
            { id: 'SO-10001', data: { entityType: 'order' } },
            { id: 'SO-10002', data: { entityType: 'order' } }
          ],
          visibleColumns: ['status', 'customerName']
        }
      });

      expect(response.status).toBe(200);
      expect(eventNames).toEqual(['answer_delta', 'final']);
      expect(eventNames).not.toContain('tool_call_started');
      expect(finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'clarification_required',
          clarificationQuestionId: expect.any(String),
          evidenceRefs: []
        })
      );
      expect(newState.toolCalls).toHaveLength(0);
      expect(newState.retrievalRuns).toHaveLength(0);
      expect(newState.clarificationQuestions).toEqual([
        expect.objectContaining({
          id: finalData.clarificationQuestionId,
          status: 'pending'
        })
      ]);
      expect(newState.auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'clarification_question_created' }),
          expect.objectContaining({ eventType: 'answer_generated', decision: 'clarification_required' })
        ])
      );
    });

    it('no-visible-evidence-does-not-answer', async () => {
      const { response, finalData, eventNames, newState } = await sendAssistantMessage(testApp, {
        requestId: 'req-eval-no-evidence',
        headers: { 'x-permission-scopes': 'orders:read' },
        message: '請查 SO-10001 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['notARealVisibleField']
        }
      });

      expect(response.status).toBe(200);
      expect(eventNames).toEqual(['tool_call_started', 'tool_call_completed', 'answer_delta', 'final']);
      expect(eventNames).not.toContain('evidence_attached');
      expect(finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'no_answer',
          noAnswerReason: 'no_evidence',
          evidenceRefs: []
        })
      );
      expect(newState.reviewItems).toEqual([
        expect.objectContaining({
          customerId: 'customer-a',
          sourceType: 'no_answer',
          suggestedImprovement: expect.objectContaining({
            noAnswerReason: 'no_evidence'
          })
        })
      ]);
      expect(newState.auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventType: 'review_item_created' }),
          expect.objectContaining({ eventType: 'answer_generated', decision: 'no_answer' })
        ])
      );
    });

    it('permission-denied-does-not-answer', async () => {
      const { response, finalData, eventNames, newState } = await sendAssistantMessage(testApp, {
        requestId: 'req-eval-permission-denied',
        headers: createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: {
            ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
            permission_scopes: ['inventory:read'],
            jti: 'jwt-eval-permission-denied'
          },
          requestId: 'req-eval-permission-denied'
        }),
        message: '請查 SO-10001 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

      expect(response.status).toBe(200);
      expect(eventNames).toEqual(['tool_call_blocked', 'answer_delta', 'final']);
      expect(eventNames).not.toContain('tool_call_completed');
      expect(eventNames).not.toContain('evidence_attached');
      expect(finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'permission_denied',
          noAnswerReason: 'permission_denied',
          evidenceRefs: []
        })
      );
      expect(finalData.answer).not.toContain('已確認');
      expect(newState.reviewItems).toEqual([
        expect.objectContaining({
          sourceType: 'permission_mapping_issue',
          suggestedImprovement: expect.objectContaining({
            permissionDeniedReason: 'missing_scope'
          })
        })
      ]);
    });

    it('tool-failure-safe-response', async () => {
      const { response, finalData, eventNames, newState } = await sendAssistantMessage(testApp, {
        requestId: 'req-eval-tool-failure',
        headers: { 'x-permission-scopes': 'orders:read' },
        message: '請查 SO-99999 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-99999',
          visibleColumns: ['status', 'customerName']
        }
      });

      expect(response.status).toBe(200);
      expect(eventNames).toEqual(['tool_call_started', 'tool_call_failed', 'answer_delta', 'final']);
      expect(eventNames).not.toContain('tool_call_completed');
      expect(eventNames).not.toContain('evidence_attached');
      expect(finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'no_answer',
          noAnswerReason: 'tool_failure',
          errorCode: 'NOT_FOUND',
          evidenceRefs: []
        })
      );
      expect(newState.reviewItems).toEqual([
        expect.objectContaining({
          sourceType: 'tool_failure',
          suggestedImprovement: expect.objectContaining({
            toolFailureReason: 'NOT_FOUND'
          })
        })
      ]);
      expect(JSON.stringify(newState.reviewItems)).not.toContain('stack');
    });

    it('evidence-conflict-safe-response', async () => {
      const { response, finalData, eventNames, newState } = await sendAssistantMessage(testApp, {
        requestId: 'req-eval-evidence-conflict',
        headers: { 'x-permission-scopes': 'orders:read' },
        message: '請查 SO-10003 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10003',
          visibleColumns: ['status']
        }
      });

      expect(response.status).toBe(200);
      expect(eventNames).toEqual(['tool_call_started', 'tool_call_completed', 'answer_delta', 'final']);
      expect(eventNames).not.toContain('evidence_attached');
      expect(finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'no_answer',
          noAnswerReason: 'evidence_conflict',
          evidenceRefs: []
        })
      );
      expect(finalData.answer).not.toContain('confirmed');
      expect(finalData.answer).not.toContain('cancelled');
      expect(newState.reviewItems).toEqual([
        expect.objectContaining({
          sourceType: 'missing_evidence',
          suggestedImprovement: expect.objectContaining({
            conflictReason: 'same_field_conflicting_values',
            conflictFieldPaths: ['status']
          })
        })
      ]);
      expect(JSON.stringify(newState.reviewItems)).not.toContain('confirmed');
      expect(JSON.stringify(newState.reviewItems)).not.toContain('cancelled');
    });

    it('medium-high-critical-side-effect-routing', async () => {
      const medium = await sendInIsolatedApp({
        requestId: 'req-eval-medium-side-effect',
        headers: { 'x-permission-scopes': 'orders:read,orders:update' },
        message: '請幫我更新 SO-10001 的訂單狀態為已確認',
        pageContext: {
          module: 'orders',
          route: '/orders/SO-10001',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });
      const high = await sendInIsolatedApp({
        requestId: 'req-eval-high-side-effect',
        headers: { 'x-permission-scopes': 'orders:read,orders:update' },
        message: '請取消 SO-10001 訂單',
        pageContext: {
          module: 'orders',
          route: '/orders/SO-10001',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });
      const critical = await sendInIsolatedApp({
        requestId: 'req-eval-critical-side-effect',
        headers: { 'x-permission-scopes': 'orders:read,orders:update' },
        message: '請緊急升級取消 SO-10001 訂單，這是重大風險操作',
        pageContext: {
          module: 'orders',
          route: '/orders/SO-10001',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

      expect(medium.finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'confirmation_required',
          actionDraftId: expect.any(String)
        })
      );
      expect(medium.eventNames).toContain('confirmation_required');
      expect(high.finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'approval_required',
          approvalRequestId: expect.any(String)
        })
      );
      expect(high.eventNames).toContain('approval_required');
      expect(critical.finalData).toEqual(
        expect.objectContaining({
          answerDecision: 'escalation_required',
          escalationRequestId: expect.any(String),
          evidenceRefs: []
        })
      );
      expect(critical.eventNames).toEqual(['escalation_required', 'final']);
      expect(medium.newState.toolCalls).toHaveLength(0);
      expect(high.newState.toolCalls).toHaveLength(0);
      expect(critical.newState.toolCalls).toHaveLength(0);
      expect(medium.state.actionDrafts).toEqual(expect.arrayContaining([expect.objectContaining({ riskLevel: 'medium' })]));
      expect(high.state.approvalRequests).toEqual(expect.arrayContaining([expect.objectContaining({ riskLevel: 'high' })]));
      expect(critical.state.escalationRequests).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'open' })]));
    });

    it('feedback-review-linkage', async () => {
      const initialFeedbackCount = testApp.state.feedbackEvents.length;
      const initialReviewCount = testApp.state.reviewItems.length;

      const positiveResponse = await request(testApp.app.getHttpServer())
        .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
        .set(createIdentityHeaders({ 'x-request-id': 'req-eval-feedback-positive' }))
        .send({
          rating: 'positive',
          intent: 'other'
        });
      const negativeResponse = await request(testApp.app.getHttpServer())
        .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
        .set(createIdentityHeaders({ 'x-request-id': 'req-eval-feedback-negative-1' }))
        .send({
          rating: 'negative',
          intent: 'not_helpful'
        });
      const duplicateNegativeResponse = await request(testApp.app.getHttpServer())
        .post('/api/v1/assistant/messages/message-owned-assistant-001/feedback')
        .set(createIdentityHeaders({ 'x-request-id': 'req-eval-feedback-negative-2' }))
        .send({
          rating: 'negative',
          intent: 'not_helpful'
        });

      expect(positiveResponse.status).toBe(201);
      expect(negativeResponse.status).toBe(201);
      expect(duplicateNegativeResponse.status).toBe(201);
      expect(positiveResponse.body.data.reviewItemId).toBeNull();
      expect(duplicateNegativeResponse.body.data.reviewItemId).not.toBe(negativeResponse.body.data.reviewItemId);
      expect(testApp.state.feedbackEvents).toHaveLength(initialFeedbackCount + 3);
      const newReviews = testApp.state.reviewItems.slice(initialReviewCount);
      expect(newReviews).toHaveLength(2);
      expect(newReviews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            customerId: 'customer-a',
            sourceType: 'negative_feedback',
            sourceId: negativeResponse.body.data.feedbackEventId
          }),
          expect.objectContaining({
            customerId: 'customer-a',
            sourceType: 'negative_feedback',
            sourceId: duplicateNegativeResponse.body.data.feedbackEventId
          })
        ])
      );
      expect(testApp.state.auditEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'feedback_received',
            metadata: expect.objectContaining({ rating: 'positive' })
          }),
          expect.objectContaining({
            eventType: 'feedback_received',
            metadata: expect.objectContaining({ rating: 'negative', intent: 'not_helpful' })
          })
        ])
      );
      expect(JSON.stringify(testApp.state.auditEvents)).not.toContain('rawPayload');
      expect(JSON.stringify(testApp.state.auditEvents)).not.toContain('connectorSecret');
    });
  });
});

async function sendInIsolatedApp(input: {
  requestId: string;
  message: string;
  pageContext?: unknown;
  headers?: Partial<Record<string, string>>;
}) {
  const isolated = await createUs1TestAppWithState();
  try {
    const result = await sendAssistantMessage(isolated, input);
    return {
      ...result,
      state: isolated.state
    };
  } finally {
    await isolated.app.close();
  }
}

async function sendAssistantMessage(
  testApp: TestApp,
  input: {
    requestId: string;
    message: string;
    pageContext?: unknown;
    headers?: Partial<Record<string, string>>;
  }
) {
  const before = snapshotState(testApp.state);
  const response = await request(testApp.app.getHttpServer())
    .post('/api/v1/assistant/sessions/session-owned-001/messages')
    .set(createIdentityHeaders({ 'x-request-id': input.requestId, ...input.headers }))
    .send({
      message: input.message,
      pageContext: input.pageContext
    });
  const events = parseSseResponse(response.text);
  const finalEvent = events.find((event) => event.event === 'final');

  return {
    response,
    events,
    eventNames: events.map((event) => event.event),
    finalData: finalEvent?.data?.data,
    newState: {
      toolCalls: testApp.state.toolCalls.slice(before.toolCallCount),
      retrievalRuns: testApp.state.retrievalRuns.slice(before.retrievalRunCount),
      evidenceRefs: testApp.state.evidenceRefs.slice(before.evidenceRefCount),
      reviewItems: testApp.state.reviewItems.slice(before.reviewItemCount),
      clarificationQuestions: testApp.state.clarificationQuestions.slice(before.clarificationQuestionCount),
      auditEvents: testApp.state.auditEvents.slice(before.auditEventCount)
    }
  };
}

function snapshotState(state: Us1TestState) {
  return {
    toolCallCount: state.toolCalls.length,
    retrievalRunCount: state.retrievalRuns.length,
    evidenceRefCount: state.evidenceRefs.length,
    reviewItemCount: state.reviewItems.length,
    clarificationQuestionCount: state.clarificationQuestions.length,
    auditEventCount: state.auditEvents.length
  };
}
