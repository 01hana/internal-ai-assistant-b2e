import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AssistantMessageRole, EvidenceSourceType } from '../../src/generated/prisma/enums';
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('analytics-ready raw event records', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps answered structured lookup records traceable by request, message, tool call, and evidence ref', async () => {
    const requestId = 'req-analytics-structured';
    const result = await sendAssistantMessage({
      requestId,
      message: '請查 SO-10001 訂單狀態',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });

    expect(result.response.status).toBe(200);
    expect(result.finalData).toEqual(expect.objectContaining({ answerDecision: 'answered' }));

    const userMessage = result.records.messages.find((message) => message.role === AssistantMessageRole.user);
    const assistantMessage = result.records.messages.find((message) => message.role === AssistantMessageRole.assistant);
    const executionPlan = result.records.executionPlans[0];
    const toolCall = result.records.toolCalls[0];
    const evidenceRef = result.records.evidenceRefs[0];
    const groundingCheck = result.records.groundingChecks[0];
    const answerDecision = result.records.answerDecisions[0];

    expect(result.records.messages).toHaveLength(2);
    expect(userMessage).toEqual(expect.objectContaining({ requestId, sessionId: 'session-owned-001' }));
    expect(assistantMessage).toEqual(expect.objectContaining({ requestId, sessionId: 'session-owned-001', answerDecision: 'answered' }));
    expect(executionPlan).toEqual(expect.objectContaining({ sessionId: 'session-owned-001', messageId: userMessage?.id }));
    expect(toolCall).toEqual(
      expect.objectContaining({
        requestId,
        sessionId: 'session-owned-001',
        messageId: assistantMessage?.id,
        toolName: 'mock.orders.status.lookup',
        status: 'success',
        executionStatus: 'executed',
        durationMs: expect.any(Number)
      })
    );
    expect(toolCall?.durationMs).toBeGreaterThanOrEqual(0);
    expect(evidenceRef).toEqual(
      expect.objectContaining({
        requestId,
        messageId: assistantMessage?.id,
        toolCallId: toolCall?.id,
        sourceType: EvidenceSourceType.structured_record,
        sourceId: 'SO-10001'
      })
    );
    expect(groundingCheck).toEqual(
      expect.objectContaining({
        requestId,
        messageId: assistantMessage?.id,
        evidenceRefIds: [evidenceRef?.id]
      })
    );
    expect(answerDecision).toEqual(
      expect.objectContaining({
        requestId,
        messageId: assistantMessage?.id,
        status: 'answered',
        groundingCheckId: groundingCheck?.id
      })
    );
    expectAuditEvents(result.records.auditEvents, requestId, [
      'message_received',
      'execution_plan_created',
      'evidence_attached',
      'answer_generated'
    ]);
    expectNoSensitivePayload(result.records);
  });

  it('keeps document retrieval run, candidate, and document evidence records traceable', async () => {
    const requestId = 'req-analytics-retrieval';
    const result = await sendAssistantMessage({
      requestId,
      message: '退貨流程 SOP 怎麼說？',
      pageContext: {
        module: 'orders',
        visibleColumns: ['status']
      }
    });

    expect(result.response.status).toBe(200);
    expect(result.finalData).toEqual(expect.objectContaining({ answerDecision: 'answered' }));

    const retrievalRun = result.records.retrievalRuns[0];
    const selectedCandidate = result.records.retrievalCandidates.find((candidate) => candidate.selected);
    const evidenceRef = result.records.evidenceRefs[0];
    const answerDecision = result.records.answerDecisions[0];

    expect(retrievalRun).toEqual(
      expect.objectContaining({
        requestId,
        messageId: expect.any(String),
        query: '退貨流程 SOP 怎麼說？',
        normalizedQuery: expect.any(String),
        filters: expect.anything(),
        strategy: 'keyword',
        selectedEvidenceRefIds: [evidenceRef?.id],
        durationMs: expect.any(Number)
      })
    );
    expect(selectedCandidate).toEqual(
      expect.objectContaining({
        retrievalRunId: retrievalRun?.id,
        chunkId: expect.any(String),
        sourceId: expect.any(String),
        sourceType: EvidenceSourceType.document_chunk,
        score: expect.any(Number),
        rank: expect.any(Number),
        selected: true,
        reason: 'keyword_score_above_threshold'
      })
    );
    expect(evidenceRef).toEqual(
      expect.objectContaining({
        requestId,
        messageId: answerDecision?.messageId,
        sourceType: EvidenceSourceType.document_chunk,
        sourceId: selectedCandidate?.chunkId,
        documentId: 'knowledge-document-sop-return-001',
        chunkId: selectedCandidate?.chunkId
      })
    );
    expect(answerDecision).toEqual(expect.objectContaining({ requestId, status: 'answered' }));
    expectAuditEvents(result.records.auditEvents, requestId, [
      'retrieval_run_created',
      'retrieval_candidate_selected',
      'evidence_attached',
      'answer_generated'
    ]);

    const selectedChunk = state.knowledgeChunks.find((chunk) => chunk.id === selectedCandidate?.chunkId);
    expect(JSON.stringify(result.records.auditEvents)).not.toContain(selectedChunk?.content ?? '');
    expectNoSensitivePayload(result.records);
  });

  it('keeps failed tool and no-answer review records traceable without raw failure details', async () => {
    const requestId = 'req-analytics-tool-failure';
    const result = await sendAssistantMessage({
      requestId,
      headers: { 'x-permission-scopes': 'orders:read' },
      message: '請查 SO-99999 訂單狀態',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-99999',
        visibleColumns: ['status', 'customerName']
      }
    });

    expect(result.response.status).toBe(200);
    expect(result.finalData).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        noAnswerReason: 'tool_failure',
        evidenceRefs: []
      })
    );

    const toolCall = result.records.toolCalls[0];
    const answerDecision = result.records.answerDecisions[0];
    const reviewItem = result.records.reviewItems[0];

    expect(toolCall).toEqual(
      expect.objectContaining({
        requestId,
        status: 'failed',
        executionStatus: 'failed',
        errorCode: 'NOT_FOUND',
        durationMs: expect.any(Number)
      })
    );
    expect(answerDecision).toEqual(
      expect.objectContaining({
        requestId,
        messageId: toolCall?.messageId,
        status: 'no_answer',
        noAnswerReason: 'tool_failure'
      })
    );
    expect(reviewItem).toEqual(
      expect.objectContaining({
        sourceType: 'tool_failure',
        sourceId: answerDecision?.id,
        suggestedImprovement: expect.objectContaining({
          requestId,
          messageId: answerDecision?.messageId,
          noAnswerReason: 'tool_failure',
          toolCallId: toolCall?.id
        })
      })
    );
    expectAuditEvents(result.records.auditEvents, requestId, ['review_item_created', 'answer_generated']);
    expectNoSensitivePayload(result.records);
  });

  it('keeps medium-risk ActionDraft records minimized and prevents side-effect execution before confirmation', async () => {
    const requestId = 'req-analytics-action-draft';
    const result = await sendAssistantMessage({
      requestId,
      headers: { 'x-permission-scopes': 'orders:read,orders:update' },
      message: '請幫我更新 SO-10001 的訂單狀態為已確認',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });

    const actionDraft = result.records.actionDrafts[0];
    const assistantMessage = result.records.messages.find((message) => message.role === AssistantMessageRole.assistant);
    expect(result.response.status).toBe(200);
    expect(result.finalData).toEqual(expect.objectContaining({ answerDecision: 'confirmation_required' }));
    expect(actionDraft).toEqual(
      expect.objectContaining({
        requestId,
        sessionId: 'session-owned-001',
        messageId: assistantMessage?.id,
        actorId: 'actor-001',
        toolName: 'mock.orders.status.update',
        resource: 'orders',
        operation: 'update',
        riskLevel: 'medium',
        status: 'waiting_confirmation',
        createdAt: expect.any(Date),
        expiresAt: expect.any(Date)
      })
    );
    expect(assistantMessage).toEqual(expect.objectContaining({ requestId, answerDecision: 'confirmation_required' }));
    expect(result.records.toolCalls).toHaveLength(0);
    expectAuditEvents(result.records.auditEvents, requestId, ['action_draft_created', 'answer_generated']);
    expectNoSensitivePayload([actionDraft?.payloadSummary, actionDraft?.preview, result.records.auditEvents]);
  });

  it('keeps high-risk ApprovalRequest and feedback/review records traceable without executing the side effect', async () => {
    const approvalRequestId = 'req-analytics-approval';
    const approvalResult = await sendAssistantMessage({
      requestId: approvalRequestId,
      headers: { 'x-permission-scopes': 'orders:read,orders:update' },
      message: '請取消 SO-10001 訂單',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });

    const approvalRequest = approvalResult.records.approvalRequests[0];
    const approvalAssistantMessage = approvalResult.records.messages.find((message) => message.role === AssistantMessageRole.assistant);
    expect(approvalResult.response.status).toBe(200);
    expect(approvalResult.finalData).toEqual(expect.objectContaining({ answerDecision: 'approval_required' }));
    expect(approvalRequest).toEqual(
      expect.objectContaining({
        requestId: approvalRequestId,
        sessionId: 'session-owned-001',
        messageId: approvalAssistantMessage?.id,
        requesterActorId: 'actor-001',
        riskLevel: 'high',
        status: 'pending',
        actionSummary: expect.anything(),
        payloadSummary: expect.anything(),
        evidenceRefIds: expect.any(Array),
        createdAt: expect.any(Date)
      })
    );
    expect(approvalAssistantMessage).toEqual(expect.objectContaining({ requestId: approvalRequestId, answerDecision: 'approval_required' }));
    expect(approvalResult.records.toolCalls).toHaveLength(0);
    expectAuditEvents(approvalResult.records.auditEvents, approvalRequestId, ['approval_request_created', 'answer_generated']);
    expectNoSensitivePayload([approvalRequest?.actionSummary, approvalRequest?.payloadSummary, approvalResult.records.auditEvents]);

    const answeredResult = await sendAssistantMessage({
      requestId: 'req-analytics-feedback-answer',
      headers: { 'x-permission-scopes': 'orders:read' },
      message: '請查 SO-10001 訂單狀態',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });
    const answeredMessage = answeredResult.records.messages.find((message) => message.role === AssistantMessageRole.assistant);
    const reviewItemCount = state.reviewItems.length;
    const feedbackCount = state.feedbackEvents.length;
    const comment = 'The answer needs a more useful source.';

    const positiveResponse = await request(app.getHttpServer())
      .post(`/api/v1/assistant/messages/${answeredMessage?.id}/feedback`)
      .set(createIdentityHeaders({ 'x-request-id': 'req-analytics-feedback-positive' }))
      .send({ rating: 'positive', intent: 'other', reason: 'clear' });
    const negativeResponse = await request(app.getHttpServer())
      .post(`/api/v1/assistant/messages/${answeredMessage?.id}/feedback`)
      .set(createIdentityHeaders({ 'x-request-id': 'req-analytics-feedback-negative' }))
      .send({ rating: 'negative', intent: 'not_helpful', reason: 'wrong source', comment });

    const newFeedbackEvents = state.feedbackEvents.slice(feedbackCount);
    const newReviewItems = state.reviewItems.slice(reviewItemCount);
    const feedbackAudits = state.auditEvents.filter((event) => event.requestId.startsWith('req-analytics-feedback-'));

    expect(positiveResponse.status).toBe(201);
    expect(negativeResponse.status).toBe(201);
    expect(newFeedbackEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: 'req-analytics-feedback-positive',
          messageId: answeredMessage?.id,
          rating: 'positive',
          intent: 'other',
          answerDecision: 'answered',
          createdAt: expect.any(Date)
        }),
        expect.objectContaining({
          requestId: 'req-analytics-feedback-negative',
          messageId: answeredMessage?.id,
          rating: 'negative',
          intent: 'not_helpful',
          toolCallIds: [answeredResult.records.toolCalls[0]?.id],
          evidenceRefIds: [answeredResult.records.evidenceRefs[0]?.id],
          answerDecision: 'answered',
          createdAt: expect.any(Date)
        })
      ])
    );
    expect(newReviewItems).toHaveLength(1);
    expect(newReviewItems[0]).toEqual(
      expect.objectContaining({
        sourceType: 'negative_feedback',
        suggestedImprovement: expect.objectContaining({
          messageId: answeredMessage?.id,
          answerDecision: 'answered',
          toolCallIds: [answeredResult.records.toolCalls[0]?.id],
          evidenceRefIds: [answeredResult.records.evidenceRefs[0]?.id],
          intent: 'not_helpful',
          reasonProvided: true,
          commentProvided: true
        })
      })
    );
    expectAuditEvents(feedbackAudits, 'req-analytics-feedback-positive', ['feedback_received']);
    expectAuditEvents(feedbackAudits, 'req-analytics-feedback-negative', ['feedback_received', 'review_item_created']);
    expect(JSON.stringify([newReviewItems, feedbackAudits])).not.toContain(comment);
    expectNoSensitivePayload([newFeedbackEvents, newReviewItems, feedbackAudits]);
  });

  async function sendAssistantMessage(input: {
    requestId: string;
    message: string;
    pageContext: Record<string, unknown>;
    headers?: Partial<Record<string, string>>;
  }) {
    const before = snapshotState(state);
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': input.requestId, ...input.headers }))
      .send({ message: input.message, pageContext: input.pageContext });
    const events = parseSseResponse(response.text);
    const finalEvent = events.find((event) => event.event === 'final');

    return {
      response,
      finalData: finalEvent?.data?.data,
      records: {
        messages: state.messages.slice(before.messages),
        toolCalls: state.toolCalls.slice(before.toolCalls),
        evidenceRefs: state.evidenceRefs.slice(before.evidenceRefs),
        auditEvents: state.auditEvents.slice(before.auditEvents),
        executionPlans: state.executionPlans.slice(before.executionPlans),
        groundingChecks: state.groundingChecks.slice(before.groundingChecks),
        answerDecisions: state.answerDecisions.slice(before.answerDecisions),
        reviewItems: state.reviewItems.slice(before.reviewItems),
        actionDrafts: state.actionDrafts.slice(before.actionDrafts),
        approvalRequests: state.approvalRequests.slice(before.approvalRequests),
        retrievalRuns: state.retrievalRuns.slice(before.retrievalRuns),
        retrievalCandidates: state.retrievalCandidates.slice(before.retrievalCandidates)
      }
    };
  }
});

function snapshotState(state: Us1TestState) {
  return {
    messages: state.messages.length,
    toolCalls: state.toolCalls.length,
    evidenceRefs: state.evidenceRefs.length,
    auditEvents: state.auditEvents.length,
    executionPlans: state.executionPlans.length,
    groundingChecks: state.groundingChecks.length,
    answerDecisions: state.answerDecisions.length,
    reviewItems: state.reviewItems.length,
    actionDrafts: state.actionDrafts.length,
    approvalRequests: state.approvalRequests.length,
    retrievalRuns: state.retrievalRuns.length,
    retrievalCandidates: state.retrievalCandidates.length
  };
}

function expectAuditEvents(events: Array<{ requestId: string; eventType: string }>, requestId: string, eventTypes: string[]) {
  const requestEvents = events.filter((event) => event.requestId === requestId);
  expect(requestEvents).toEqual(
    expect.arrayContaining(eventTypes.map((eventType) => expect.objectContaining({ requestId, eventType })))
  );
}

function expectNoSensitivePayload(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const forbiddenValue of [
    'placeholder-openai-api-key',
    'connectorSecret',
    'DATABASE_URL',
    'postgresql://',
    'database-password',
    'rawPayload',
    'stack'
  ]) {
    expect(serialized).not.toContain(forbiddenValue);
  }
}
