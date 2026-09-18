import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { RiskLevel } from '../../src/generated/prisma/enums';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { createToolDiscoveryFixtureService } from '../support/tool-discovery.fixture';
import {
  createAuthorizedInternalIdentityHeaders,
  createIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { RetrievalCoverageService } from '../../src/assistant/grounding/retrieval-coverage.service';
import { areDocumentTopicsCompatible } from '../../src/assistant/grounding/prior-grounded-context.service';
import type { GroundedRetrievalNeedResult, RetrievalNeed, RetrievalMode } from '../../src/retrieval/grounded-retrieval.types';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { HybridRetrievalCoordinatorService } from '../../src/assistant/grounding/hybrid-retrieval-coordinator.service';
import { GroundedToolRetrievalService } from '../../src/assistant/grounding/grounded-tool-retrieval.service';
import { GroundedDocumentRetrievalService } from '../../src/retrieval/grounded-document-retrieval.service';

type TestApp = {
  app: INestApplication;
  state: Us1TestState;
};

describe('internal assistant core deterministic eval baseline', () => {
  const hostIntegrationContext = {
    requestId: 'req-eval-query-understanding',
    customerId: 'customer-a',
    integrationId: 'integration-erp',
    organizationId: 'org-001',
    hostApp: 'erp',
    actorId: 'actor-001',
    roles: ['planner'] as const,
    permissionScopes: ['orders:read', 'inventory:read'] as const
  };

  it('query-understanding-routing-and-entities', async () => {
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), createToolDiscoveryFixtureService());

    const structuredInput = {
      requestId: 'req-eval-query-understanding-structured',
      sessionId: 'session-eval',
      messageId: 'message-eval-structured',
      text: '幫我查 SO-10001 的狀態，順便看 SKU-ABC-001 的庫存',
      hostIntegrationContext,
      now: new Date('2026-06-22T00:00:00.000Z'),
      timezone: 'Asia/Taipei'
    };
    const documentInput = {
      requestId: 'req-eval-query-understanding-document',
      sessionId: 'session-eval',
      messageId: 'message-eval-document',
      text: '退貨流程 SOP 怎麼說？',
      hostIntegrationContext,
      now: new Date('2026-06-22T00:00:00.000Z'),
      timezone: 'Asia/Taipei'
    };
    for (const input of [structuredInput, documentInput]) {
      expect(input).not.toHaveProperty('identityContext');
      expect(input).not.toHaveProperty('transientConnectorContext');
      expect(input).not.toHaveProperty('connectorContextRef');
    }

    const structuredResult = await pipeline.understand(structuredInput);
    const documentResult = await pipeline.understand(documentInput);

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

describe('Feature 010 grounded retrieval acceptance matrix (T078)', () => {
  it.each([
    ['RAG COMPLETE', 'RAG', ['DOCUMENT'], ['COVERED'], 'COMPLETE'],
    ['TOOL COMPLETE', 'TOOL', ['TOOL'], ['COVERED'], 'COMPLETE'],
    ['HYBRID COMPLETE', 'HYBRID', ['DOCUMENT', 'TOOL'], ['COVERED', 'COVERED'], 'COMPLETE'],
    ['HYBRID PARTIAL document unavailable', 'HYBRID', ['DOCUMENT', 'TOOL'], ['UNSUPPORTED', 'COVERED'], 'PARTIAL'],
    ['HYBRID PARTIAL Tool denied', 'HYBRID', ['DOCUMENT', 'TOOL'], ['COVERED', 'FAILED'], 'PARTIAL'],
    ['CONTEXT_ONLY document/Tool recall', 'CONTEXT_ONLY', ['DOCUMENT', 'TOOL'], ['COVERED', 'COVERED'], 'COMPLETE'],
    ['INSUFFICIENT no covered lane', 'INSUFFICIENT', ['DOCUMENT', 'TOOL'], ['UNSUPPORTED', 'FAILED'], 'INSUFFICIENT'],
    ['CLARIFY ambiguous request', 'CLARIFY', ['UNSUPPORTED'], ['CLARIFY'], 'CLARIFY']
  ] as const)('%s has deterministic coverage', (_case, mode, kinds, statuses, expected) => {
    const requestedNeeds = kinds.map((kind, index): RetrievalNeed => kind === 'DOCUMENT'
      ? { id: `need-${index + 1}`, kind, query: `topic-${index + 1}` }
      : kind === 'TOOL' ? { id: `need-${index + 1}`, kind, frame: { topicKey: `topic-${index + 1}` } }
        : { id: `need-${index + 1}`, kind, reasonCode: 'CLARIFICATION_REQUIRED' });
    const needResults = statuses.map((status, index): GroundedRetrievalNeedResult => ({ needId: `need-${index + 1}`, status,
      evidenceRefIds: status === 'COVERED' ? [`evidence-${index + 1}`] : [],
      ...(status === 'COVERED' ? {} : { reasonCode: `${status}_REASON` }) }));
    expect(new RetrievalCoverageService().evaluate({ mode: mode as RetrievalMode, requestedNeeds, needResults })).toBe(expected);
  });

  it('uses generic safe semantic/provenance topic identities rather than fixture-specific topic families', () => {
    const current = { topicKey: 'expenseReimbursementPolicy', frame: {
      resource: { value: 'expenseReimbursement', source: 'inherited', sourceMessageId: 'message-current', confidence: 1 },
      metricOrAspect: { value: 'applicationDeadline', source: 'current_explicit', sourceMessageId: 'message-current', confidence: 1 }
    } };
    expect(areDocumentTopicsCompatible(current, { frame: { topicKey: 'expense-reimbursement-policy' }, sourceKey: 'kb/expense-reimbursement-policy' })).toBe(true);
    expect(areDocumentTopicsCompatible(current, { frame: { topicKey: 'security-access-policy' }, sourceKey: 'kb/security-access-policy' })).toBe(false);
    expect(areDocumentTopicsCompatible(
      { frame: { resource: { value: 'expenseReimbursement' }, metricOrAspect: { value: 'applicationDeadline' } } },
      { frame: { resource: { value: 'expenseReimbursement' }, metricOrAspect: { value: 'applicationDeadline' } } }
    )).toBe(true);
  });
});

describe('Feature 010 endpoint orchestration acceptance evals (T078)', () => {
  let fixture: TestApp;
  beforeEach(async () => {
    fixture = await createUs1TestAppWithState();
    fixture.state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001',
      enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterEach(async () => fixture.app.close());

  it('executes document-only, Tool-only, and Hybrid COMPLETE with exact lane deltas and zero LLM calls', async () => {
    const llm = llmSpies();
    let before = counts();
    await send('req-eval-f010-document', '退貨流程 SOP 怎麼說？');
    expect(counts()).toEqual({ retrievals: before.retrievals + 1, tools: before.tools });
    expect(metadata('req-eval-f010-document')).toEqual(expect.objectContaining({ mode: 'RAG', coverage: 'COMPLETE' }));
    before = counts();
    await send('req-eval-f010-tool', '請查 SKU-DEMO-RED 目前庫存');
    expect(counts()).toEqual({ retrievals: before.retrievals, tools: before.tools + 1 });
    expect(metadata('req-eval-f010-tool')).toEqual(expect.objectContaining({ mode: 'TOOL', coverage: 'COMPLETE' }));
    before = counts();
    await send('req-eval-f010-hybrid', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(counts()).toEqual({ retrievals: before.retrievals + 1, tools: before.tools + 1 });
    expect(metadata('req-eval-f010-hybrid')).toEqual(expect.objectContaining({ mode: 'HYBRID', coverage: 'COMPLETE' }));
    expectNoLlm(llm);
  });

  it('evaluates both PARTIAL directions, INSUFFICIENT, CLARIFY, and multi-Tool zero execution', async () => {
    fixture.state.knowledgeDocuments.splice(0); fixture.state.knowledgeChunks.splice(0);
    await send('req-eval-f010-partial-doc', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(metadata('req-eval-f010-partial-doc')).toEqual(expect.objectContaining({ coverage: 'PARTIAL' }));

    fixture = await replaceFixture(fixture);
    fixture.state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    await send('req-eval-f010-partial-tool', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(metadata('req-eval-f010-partial-tool')).toEqual(expect.objectContaining({ coverage: 'PARTIAL' }));
    fixture.state.knowledgeDocuments.splice(0); fixture.state.knowledgeChunks.splice(0);
    await send('req-eval-f010-insufficient', '請查 SKU-DEMO-BLUE 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(metadata('req-eval-f010-insufficient')).toEqual(expect.objectContaining({ coverage: 'INSUFFICIENT' }));
    const beforeClarify = counts();
    await send('req-eval-f010-clarify', '那個呢？');
    expect(counts()).toEqual(beforeClarify);
    expect(metadata('req-eval-f010-clarify')).toEqual(expect.objectContaining({ mode: 'CLARIFY', coverage: 'CLARIFY' }));

    const coordinator = fixture.app.get(HybridRetrievalCoordinatorService);
    const toolSpy = jest.spyOn(fixture.app.get(GroundedToolRetrievalService), 'execute');
    const documentSpy = jest.spyOn(fixture.app.get(GroundedDocumentRetrievalService), 'execute');
    await coordinator.execute({ plan: { mode: 'INSUFFICIENT', reasonCode: 'MULTIPLE_TOOL_NEEDS_UNSUPPORTED', needs: [
      { id: 'need-1', kind: 'TOOL', frame: {} }, { id: 'need-2', kind: 'TOOL', frame: {} }
    ] }, documentInput: {} as never, toolInput: {} as never });
    expect(toolSpy).not.toHaveBeenCalled();
    expect(documentSpy).not.toHaveBeenCalled();
  });

  it('re-enters document/Tool routing for compatible follow-ups and executes nothing for unsupported last month', async () => {
    await send('req-eval-f010-doc-follow-seed', '公司員工旅遊補助規定是什麼？');
    let before = counts();
    await send('req-eval-f010-doc-follow', '那申請期限呢？');
    expect(counts()).toEqual({ retrievals: before.retrievals + 1, tools: before.tools });
    expect(metadata('req-eval-f010-doc-follow')).toEqual(expect.objectContaining({ mode: 'RAG' }));

    fixture = await replaceFixture(fixture);
    await send('req-eval-f010-tool-follow-seed', '請查 SKU-DEMO-RED 目前庫存');
    before = counts();
    await send('req-eval-f010-tool-follow', 'SKU-DEMO-BLUE 呢？');
    expect(counts().tools).toBe(before.tools + 1);

    fixture = await replaceFixture(fixture);
    await send('req-eval-f010-month-seed', '請查這個月新增工單數');
    before = counts();
    await send('req-eval-f010-month', '上個月呢？');
    expect(counts()).toEqual(before);
    expect(metadata('req-eval-f010-month')).toEqual(expect.objectContaining({ coverage: 'CLARIFY' }));
  });

  it('uses CONTEXT_ONLY for eligible document, Tool, and Hybrid evidence, then invalidates current document and Tool authority', async () => {
    await send('req-eval-f010-doc-recall-seed', '退貨流程 SOP 怎麼說？');
    let before = counts();
    await send('req-eval-f010-doc-recall', '你剛才引用的文件怎麼說？');
    expect(counts()).toEqual(before);
    expect(metadata('req-eval-f010-doc-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
    fixture.state.knowledgeDocuments.find((item) => item.id === 'knowledge-document-sop-return-001')!.version = 'version-invalidated';
    before = counts();
    await send('req-eval-f010-doc-version', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(before.retrievals + 1);
    fixture.state.knowledgeDocuments.find((item) => item.id === 'knowledge-document-sop-return-001')!.requiredPermissionScopes = ['documents:restricted'];
    before = counts();
    await send('req-eval-f010-doc-access', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(before.retrievals + 1);

    fixture = await replaceFixture(fixture);
    await send('req-eval-f010-tool-recall-seed', '請查 SKU-DEMO-RED 目前庫存');
    before = counts();
    await send('req-eval-f010-tool-recall', '你剛說庫存是多少？');
    expect(counts()).toEqual(before);
    expect(metadata('req-eval-f010-tool-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));

    fixture = await replaceFixture(fixture);
    await send('req-eval-f010-tool-stale-seed', '請查 SKU-DEMO-RED 目前庫存');
    fixture.state.evidenceRefs.find((item) => item.requestId === 'req-eval-f010-tool-stale-seed')!.timestamp = new Date('2020-01-01T00:00:00.000Z');
    before = counts();
    await send('req-eval-f010-tool-stale', '你剛說庫存是多少？');
    expect(counts().tools).toBe(before.tools + 1);

    fixture = await replaceFixture(fixture);
    await send('req-eval-f010-tool-permission-seed', '請查 SKU-DEMO-RED 目前庫存');
    before = counts();
    await sendWithScopes('req-eval-f010-tool-permission', '你剛說庫存是多少？', ['orders:read']);
    expect(counts().tools).toBe(before.tools + 1);
    expect(fixture.state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'blocked', executionStatus: 'not_started' }));
    expect(metadata('req-eval-f010-tool-permission')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));

    fixture = await replaceFixture(fixture);
    await send('req-eval-f010-tool-policy-seed', '請查 SKU-DEMO-RED 目前庫存');
    fixture.state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    before = counts();
    await send('req-eval-f010-tool-policy', '你剛說庫存是多少？');
    expect(counts().tools).toBe(before.tools + 1);
    expect(fixture.state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'blocked', executionStatus: 'not_started' }));
    expect(metadata('req-eval-f010-tool-policy')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));

    fixture = await replaceFixture(fixture);
    await send('req-eval-f010-hybrid-recall-seed', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    before = counts();
    await send('req-eval-f010-hybrid-recall', '把剛才的庫存和 SOP 證據再列一次');
    expect(counts()).toEqual(before);
    expect(metadata('req-eval-f010-hybrid-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE' }));
  });

  function counts() { return { retrievals: fixture.state.retrievalRuns.length, tools: fixture.state.toolCalls.length }; }
  function metadata(requestId: string): any { return fixture.state.answerDecisions.find((item) => item.requestId === requestId)?.metadata; }
  function llmSpies() { const llm = fixture.app.get(LlmExecutionService, { strict: false }); return [jest.spyOn(llm, 'generateAnswer'), jest.spyOn(llm, 'classifyIntent'), jest.spyOn(llm, 'summarize')] as const; }
  function expectNoLlm(spies: readonly jest.SpyInstance[]) { for (const spy of spies) expect(spy).not.toHaveBeenCalled(); }
  function send(requestId: string, message: string) {
    return sendWithScopes(requestId, message, ['orders:read', 'inventory:read']);
  }
  function sendWithScopes(requestId: string, message: string, permissionScopes: string[]) {
    return request(fixture.app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims: {
        ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: permissionScopes
      }, requestId })).send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED',
        visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }
});

async function replaceFixture(previous: TestApp): Promise<TestApp> {
  await previous.app.close();
  const next = await createUs1TestAppWithState();
  next.state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001',
    enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  return next;
}

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
