import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmObservabilityService } from '../../src/llm/llm-observability.service';
import { LlmProvider } from '../../src/llm/llm-provider.interface';
import { LlmProviderService } from '../../src/llm/llm-provider.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('non-functional safety boundaries', () => {
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

  it('reports readiness degradation and database unavailability with safe dependency reasons', async () => {
    state.toolDefinitions.length = 0;
    const degradedResponse = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-nonfunctional-readiness-degraded');

    expect(degradedResponse.status).toBe(200);
    expect(degradedResponse.body).toEqual(
      expect.objectContaining({
        requestId: 'req-nonfunctional-readiness-degraded',
        data: expect.objectContaining({
          status: 'degraded',
          dependencies: expect.objectContaining({
            connector: expect.objectContaining({ status: 'degraded', reason: 'connector_registry_empty' })
          })
        })
      })
    );

    const prisma = app.get(PrismaService) as unknown as { db: { $queryRaw: jest.Mock } };
    prisma.db.$queryRaw.mockRejectedValueOnce(new Error('postgresql://user:database-password@db.internal/assistant'));
    const unavailableResponse = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-nonfunctional-readiness-unavailable');

    expect(unavailableResponse.status).toBe(200);
    expect(unavailableResponse.body).toEqual(
      expect.objectContaining({
        requestId: 'req-nonfunctional-readiness-unavailable',
        data: expect.objectContaining({
          status: 'unavailable',
          dependencies: expect.objectContaining({
            database: expect.objectContaining({ status: 'unavailable', reason: 'database_unreachable' })
          })
        })
      })
    );
    expectNoSensitivePayload([degradedResponse.body, unavailableResponse.body]);
  });

  it('returns a safe no-answer when document retrieval fails', async () => {
    const retrievalService = app.get(RetrievalService);
    jest
      .spyOn(retrievalService, 'runDocumentRetrieval')
      .mockRejectedValueOnce(new Error('connectorSecret retrieval stack postgresql://user:database-password@db.internal/assistant'));

    const result = await sendAssistantMessage({
      requestId: 'req-nonfunctional-retrieval-failure',
      message: '退貨流程 SOP 怎麼說？',
      pageContext: { module: 'orders', visibleColumns: ['status'] }
    });

    expect(result.response.status).toBe(200);
    expect(result.eventNames).toEqual(['answer_delta', 'final']);
    expect(result.finalData).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        noAnswerReason: 'tool_failure',
        evidenceRefs: []
      })
    );
    expect(result.records.evidenceRefs).toHaveLength(0);
    expect(result.records.answerDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'no_answer',
          noAnswerReason: 'tool_failure',
          metadata: expect.objectContaining({ retrievalFailureReason: 'retrieval_unavailable' })
        })
      ])
    );
    expect(result.records.reviewItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'tool_failure',
          suggestedImprovement: expect.objectContaining({ toolFailureReason: 'retrieval_unavailable' })
        })
      ])
    );
    expect(result.records.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'answer_generated',
          decision: 'no_answer',
          metadata: expect.objectContaining({ retrievalFailureReason: 'retrieval_unavailable' })
        })
      ])
    );
    expectNoSensitivePayload([result.response.text, result.records]);
  });

  it('returns a safe no-answer when the connector fails without attaching structured evidence', async () => {
    const connector = app.get(MockConnectorAdapter);
    jest.spyOn(connector, 'execute').mockResolvedValueOnce({
      toolKey: 'mock.orders.status.lookup',
      status: 'failed',
      error: {
        code: 'CONNECTOR_UNAVAILABLE',
        message: 'connectorSecret stack raw connector output'
      }
    });

    const result = await sendAssistantMessage({
      requestId: 'req-nonfunctional-connector-failure',
      headers: { 'x-permission-scopes': 'orders:read' },
      message: '請查 SO-10001 訂單狀態',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });

    expect(result.response.status).toBe(200);
    expect(result.eventNames).toEqual(['tool_call_started', 'tool_call_failed', 'answer_delta', 'final']);
    expect(result.finalData).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        noAnswerReason: 'tool_failure',
        errorCode: 'CONNECTOR_UNAVAILABLE',
        evidenceRefs: []
      })
    );
    expect(result.records.evidenceRefs).toHaveLength(0);
    expect(result.records.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'failed', executionStatus: 'failed', errorCode: 'CONNECTOR_UNAVAILABLE' })
      ])
    );
    expect(result.records.answerDecisions).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'no_answer', noAnswerReason: 'tool_failure' })])
    );
    expect(result.records.reviewItems).toEqual(expect.arrayContaining([expect.objectContaining({ sourceType: 'tool_failure' })]));
    expectNoSensitivePayload([result.response.text, result.records]);
  });

  it('records an LLM provider fallback without exposing prompts, responses, or API keys', async () => {
    const provider: LlmProvider = {
      key: 'openai',
      getMetadata: jest.fn(),
      generateAnswer: jest.fn().mockResolvedValue({
        content: '',
        finishReason: 'error',
        metadata: {
          provider: 'openai',
          model: 'local-placeholder-model',
          fallbackUsed: true,
          fallbackReason: 'provider_error',
          requestId: 'req-nonfunctional-llm-fallback'
        }
      }),
      classifyIntent: jest.fn(),
      summarize: jest.fn()
    };
    const recordProviderDecision = jest.fn().mockResolvedValue({ id: 'audit-llm-fallback' });
    const service = new LlmExecutionService(
      { getSelectedProvider: jest.fn(() => provider) } as unknown as LlmProviderService,
      { recordProviderDecision } as unknown as LlmObservabilityService
    );

    const result = await service.generateAnswer(
      {
        requestId: 'req-nonfunctional-llm-fallback',
        messages: [{ role: 'user', content: 'raw prompt placeholder-openai-api-key' }],
        evidence: [{ id: 'evidence-1', sourceType: 'tool_result', summary: 'raw model response connectorSecret' }]
      },
      {
        identityContext: {
          requestId: 'req-nonfunctional-llm-fallback',
          actor: { actorId: 'actor-001', role: 'planner', permissionScopes: ['orders:read'] },
          hostApp: { hostApp: 'erp' },
          company: { organizationId: 'org-001' }
        }
      }
    );

    expect(result.metadata).toEqual(
      expect.objectContaining({ fallbackUsed: true, fallbackReason: 'provider_error' })
    );
    expect(recordProviderDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ fallbackUsed: true, fallbackReason: 'provider_error' })
      })
    );
    expectNoSensitivePayload(recordProviderDecision.mock.calls);
  });

  it('keeps medium-risk SSE retries waiting for confirmation without executing a side effect', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const first = await sendAssistantMessage({
      requestId: 'req-nonfunctional-medium-first',
      headers: { 'x-permission-scopes': 'orders:read,orders:update' },
      message: '請幫我更新 SO-10001 的訂單狀態為已確認',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });
    const retry = await sendAssistantMessage({
      requestId: 'req-nonfunctional-medium-retry',
      headers: { 'x-permission-scopes': 'orders:read,orders:update' },
      message: '請幫我更新 SO-10001 的訂單狀態為已確認',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });

    expect(first.response.status).toBe(200);
    expect(first.finalData).toEqual(expect.objectContaining({ answerDecision: 'confirmation_required' }));
    expect(retry.response.status).toBe(200);
    expect(retry.finalData).toEqual(expect.objectContaining({ answerDecision: 'confirmation_required' }));
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);
    expect(state.actionDrafts.filter((draft) => draft.requestId.startsWith('req-nonfunctional-medium-'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'waiting_confirmation' })]
      )
    );
  });

  it('bounds confirm and approve retries through the existing idempotency guard', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const actionHeaders = createIdentityHeaders({
      'x-request-id': 'req-nonfunctional-confirm-first',
      'x-permission-scopes': 'orders:read,orders:update'
    });
    const firstConfirm = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(actionHeaders)
      .send({ idempotencyKey: 'idem-nonfunctional-confirm' });
    const duplicateConfirm = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(createIdentityHeaders({ 'x-request-id': 'req-nonfunctional-confirm-retry', 'x-permission-scopes': 'orders:read,orders:update' }))
      .send({ idempotencyKey: 'idem-nonfunctional-confirm' });

    const approverHeaders = createIdentityHeaders({
      'x-request-id': 'req-nonfunctional-approve-first',
      'x-actor-id': 'approver-001',
      'x-role': 'approver',
      'x-permission-scopes': 'orders:read,orders:approve'
    });
    const firstApprove = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(approverHeaders)
      .send({ idempotencyKey: 'idem-nonfunctional-approve' });
    const duplicateApprove = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-nonfunctional-approve-retry',
          'x-actor-id': 'approver-001',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      )
      .send({ idempotencyKey: 'idem-nonfunctional-approve' });

    expect(firstConfirm.status).toBe(200);
    expect(duplicateConfirm.body.data).toEqual(expect.objectContaining({ duplicateSafe: true }));
    expect(firstApprove.status).toBe(200);
    expect(duplicateApprove.body.data).toEqual(expect.objectContaining({ duplicateSafe: true }));
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(2);
    expect(state.auditEvents.filter((event) => event.eventType === 'side_effect_execution_skipped_duplicate')).toHaveLength(2);
    expectNoSensitivePayload(state.auditEvents);
  });

  it('documents MVP queue and backpressure assumptions without creating background work or readiness audits', async () => {
    const assumptions = {
      backgroundQueueEnabled: false,
      redisRequired: false,
      sideEffectExecution: 'confirm_or_approve_guarded',
      retryProtection: 'idempotency_and_status_transition'
    };
    const initialAuditCount = state.auditEvents.length;

    const responses = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        request(app.getHttpServer())
          .get('/api/v1/readiness')
          .set('x-request-id', `req-nonfunctional-readiness-${index}`)
      )
    );

    expect(assumptions).toEqual({
      backgroundQueueEnabled: false,
      redisRequired: false,
      sideEffectExecution: 'confirm_or_approve_guarded',
      retryProtection: 'idempotency_and_status_transition'
    });
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(state.auditEvents).toHaveLength(initialAuditCount);
  });

  async function sendAssistantMessage(input: {
    requestId: string;
    message: string;
    pageContext: Record<string, unknown>;
    headers?: Partial<Record<string, string>>;
  }) {
    const before = {
      answerDecisions: state.answerDecisions.length,
      evidenceRefs: state.evidenceRefs.length,
      reviewItems: state.reviewItems.length,
      toolCalls: state.toolCalls.length,
      auditEvents: state.auditEvents.length
    };
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': input.requestId, ...input.headers }))
      .send({ message: input.message, pageContext: input.pageContext });
    const events = parseSseResponse(response.text);
    const finalEvent = events.find((event) => event.event === 'final');

    return {
      response,
      eventNames: events.map((event) => event.event),
      finalData: finalEvent?.data?.data,
      records: {
        answerDecisions: state.answerDecisions.slice(before.answerDecisions),
        evidenceRefs: state.evidenceRefs.slice(before.evidenceRefs),
        reviewItems: state.reviewItems.slice(before.reviewItems),
        toolCalls: state.toolCalls.slice(before.toolCalls),
        auditEvents: state.auditEvents.slice(before.auditEvents)
      }
    };
  }
});

function expectNoSensitivePayload(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    'placeholder-openai-api-key',
    'connectorSecret',
    'DATABASE_URL',
    'postgresql://',
    'database-password',
    'rawPayload',
    'stack',
    'OPENAI_API_KEY'
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
}
