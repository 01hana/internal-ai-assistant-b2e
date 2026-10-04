import { INestApplication } from '@nestjs/common';
import { resolve } from 'path';
import request = require('supertest');
import { CapabilityPackLoader } from '../../src/capabilities/capability-pack.loader';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState, parseSseResponse } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 012 non-streaming grounded generation (T018 RED)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Awaited<ReturnType<typeof createUs1TestAppWithState>>['prismaMock'];

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState());
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('uses the existing LLM execution entrypoint once for covered document evidence', async () => {
    const llm = app.get(LlmExecutionService, { strict: false });
    const generate = jest.spyOn(llm, 'generateAnswer').mockResolvedValue({
      content: '退貨流程請參考核准文件。',
      finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    const classify = jest.spyOn(llm, 'classifyIntent');
    const summarize = jest.spyOn(llm, 'summarize');

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
        requestId: 'req-f012-grounded-document'
      }))
      .send({ message: '退貨流程 SOP 怎麼說？' });

    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it.each([
    ['Tool-only', '查詢庫存可用量 料號 SKU-DEMO-RED'],
    ['Hybrid', '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式']
  ])('attempts one grounded generation for covered %s', async (name, message) => {
    const llm = app.get(LlmExecutionService, { strict: false });
    const generate = jest.spyOn(llm, 'generateAnswer').mockResolvedValue({
      content: '核准證據顯示有庫存。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] },
        requestId: `req-f012-${name}`
      }))
      .send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity'] } });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not generate a factual answer for an uncovered permission-denied lane', async () => {
    state.customerToolPolicies.find((policy) => policy.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    const model = guardModelEntrypoints();
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
        requestId: 'req-f012-blocked'
      }))
      .send({ message: '查詢庫存可用量 料號 SKU-DEMO-RED', pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED' } });
    expect(response.status).toBe(200);
    expect(finalData(response)?.answerDecision).toBe('permission_denied');
    expectZeroSemanticModelCalls(model);
  });

  it('keeps an ambiguous clarification outside all model entrypoints', async () => {
    const model = guardModelEntrypoints();
    const response = await sendBlocked('req-f012-clarify', '那個呢？');
    expect(response.status).toBe(200);
    expect(finalData(response)?.answerDecision).toBe('clarification_required');
    expectZeroSemanticModelCalls(model);
  });

  it('keeps a valid but unbound capability insufficient without model authority', async () => {
    await app.get(CapabilityPackLoader).loadAndInstall(JSON.stringify([
      resolve('test/fixtures/capability-packs/customer-a-monthly-followup.v1.json')
    ]));
    const model = guardModelEntrypoints();
    await sendBlocked('req-f012-unbound-seed', '請查這個月新增工單數', {
      module: 'work-orders', visibleColumns: ['createdAt']
    });
    expect(state.auditEvents.find((item) => item.requestId === 'req-f012-unbound-seed' &&
      item.eventType === 'capability_resolution_completed')?.metadata).toEqual(
      expect.objectContaining({ outcome: 'RESOLVED', capabilityKey: 'work-orders.count' })
    );
    const response = await sendBlocked('req-f012-unbound', '上個月呢？', {
      module: 'work-orders', visibleColumns: ['createdAt']
    });
    expect(response.status).toBe(200);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f012-unbound')?.metadata).toEqual(
      expect.objectContaining({ coverage: 'INSUFFICIENT', unsupportedNeeds: [
        expect.objectContaining({ reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' })
      ] })
    );
    expectZeroSemanticModelCalls(model);
  });

  it('blocks a request with no covered Document lane before factual generation', async () => {
    state.knowledgeDocuments.splice(0);
    state.knowledgeChunks.splice(0);
    const model = guardModelEntrypoints();
    const response = await sendBlocked('req-f012-no-covered-lane', '退貨流程 SOP 怎麼說？');
    expect(response.status).toBe(200);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f012-no-covered-lane')).toHaveLength(0);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f012-no-covered-lane')?.metadata).toEqual(
      expect.objectContaining({ coverage: 'INSUFFICIENT' })
    );
    expectZeroSemanticModelCalls(model);
  });

  it('keeps deterministic Tool evidence conflict out of factual generation', async () => {
    const model = guardModelEntrypoints();
    const response = await sendBlocked('req-f012-evidence-conflict', '查詢訂單目前狀態 訂單號 SO-10003', {
      module: 'orders', entityType: 'order', entityId: 'SO-10003', visibleColumns: ['status']
    }, ['orders:read']);
    expect(response.status).toBe(200);
    expect(finalData(response)).toEqual(expect.objectContaining({ answerDecision: 'no_answer', noAnswerReason: 'evidence_conflict' }));
    expect(state.toolCalls.filter((item) => item.requestId === 'req-f012-evidence-conflict')).toEqual([
      expect.objectContaining({ status: 'success', executionStatus: 'executed' })
    ]);
    expectZeroSemanticModelCalls(model);
  });

  it('rejects invalid Document grounding provenance from the repository without factual generation', async () => {
    const document = state.knowledgeDocuments.find((item) => item.sourceKey === 'sop-return-process');
    expect(document).toBeDefined();
    document!.sourceKey = '';
    const model = guardModelEntrypoints();
    const response = await sendBlocked('req-f012-invalid-grounding', '退貨流程 SOP 怎麼說？');
    expect(response.status).toBe(200);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f012-invalid-grounding')).toHaveLength(0);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f012-invalid-grounding')?.metadata).toEqual(
      expect.objectContaining({ coverage: 'INSUFFICIENT', needResults: [
        expect.objectContaining({ status: 'FAILED', reasonCode: 'DOCUMENT_EVIDENCE_PROVENANCE_INVALID' })
      ] })
    );
    expect(finalData(response)?.answerDecision).toBe('no_answer');
    expectZeroSemanticModelCalls(model);
  });

  it.each([
    ['confirmation', '請幫我更新 SO-10001 的訂單狀態為已確認', 'confirmation_required'],
    ['approval', '請取消 SO-10001 訂單', 'approval_required']
  ])('keeps %s control-plane decisions outside factual generation', async (name, message, decision) => {
    const model = guardModelEntrypoints();
    const response = await sendBlocked(`req-f012-${name}`, message, {
      module: 'orders', route: '/orders/SO-10001', entityType: 'order', entityId: 'SO-10001',
      visibleColumns: ['status', 'customerName']
    }, ['orders:read', 'orders:update']);
    expect(response.status).toBe(200);
    expect(finalData(response)?.answerDecision).toBe(decision);
    expectZeroSemanticModelCalls(model);
  });

  it('generates only from covered document evidence when the Hybrid Tool lane is denied', async () => {
    state.customerToolPolicies.find((policy) => policy.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    const generate = jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '退貨流程請參考核准文件。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['inventory:read'] },
        requestId: 'req-f012-hybrid-partial'
      }))
      .send({ message: '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式',
        pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED' } });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f012-hybrid-partial')?.metadata).toEqual(
      expect.objectContaining({ coverage: 'PARTIAL' })
    );
    expect(state.messages.find((item) => item.requestId === 'req-f012-hybrid-partial' && item.role === 'assistant')?.content).toContain('未獲證據支持');
  });

  it('generates once for revalidated CONTEXT_ONLY evidence without another retrieval', async () => {
    const generate = jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '退貨流程請參考核准文件。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    const headers = (requestId: string) => createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
      claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId
    });
    await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(headers('req-f012-context-seed')).send({ message: '退貨流程 SOP 怎麼說？' });
    generate.mockClear();
    const retrievalsBefore = state.retrievalRuns.length;
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(headers('req-f012-context-only')).send({ message: '你剛才引用的文件怎麼說？' });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(state.retrievalRuns).toHaveLength(retrievalsBefore);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f012-context-only')?.metadata).toEqual(
      expect.objectContaining({ retrievalMode: 'CONTEXT_ONLY', coverage: 'COMPLETE' })
    );
  });

  it('does not emit successful final or commit a completed decision when core transaction fails', async () => {
    jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '核准答案', finishReason: 'stop', metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    const original = prismaMock.answerDecision.create.getMockImplementation()!;
    prismaMock.answerDecision.create.mockImplementation(async (input: any) => {
      if (input.data.metadata?.generation === 'FEATURE012') throw new Error('test-only core failure');
      return original(input);
    });
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId: 'req-f012-core-failed'
      })).send({ message: '退貨流程 SOP 怎麼說？' });
    expect(parseSseResponse(response.text).map((event) => event.event)).not.toContain('final');
    expect(state.answerDecisions.filter((item) => item.requestId === 'req-f012-core-failed')).toHaveLength(0);
    expect(state.groundingChecks.filter((item) => item.requestId === 'req-f012-core-failed')).toHaveLength(0);
    expect(state.messages.find((item) => item.requestId === 'req-f012-core-failed' && item.role === 'assistant')?.content).toBe('Pending answer.');
  });

  it('does not revoke a committed read-only answer when only the completion audit append throws', async () => {
    jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '核准答案', finishReason: 'stop', metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    const original = prismaMock.auditEvent.create.getMockImplementation()!;
    prismaMock.auditEvent.create.mockImplementation(async (input: any) => {
      if (input.data.eventType === 'llm_generation_completed') throw new Error('test-only audit storage failure');
      return original(input);
    });
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId: 'req-f012-audit-failed'
      })).send({ message: '退貨流程 SOP 怎麼說？' });
    expect(parseSseResponse(response.text).map((event) => event.event)).toContain('final');
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f012-audit-failed')?.status).toBe('answered');
    expect(state.messages.find((item) => item.requestId === 'req-f012-audit-failed' && item.role === 'assistant')?.content).toBe('核准答案');
  });

  function guardModelEntrypoints() {
    const llm = app.get(LlmExecutionService, { strict: false });
    return {
      generate: jest.spyOn(llm, 'generateAnswer').mockRejectedValue(new Error('unexpected factual generation')),
      classify: jest.spyOn(llm, 'classifyIntent').mockRejectedValue(new Error('unexpected model classification')),
      summarize: jest.spyOn(llm, 'summarize').mockRejectedValue(new Error('unexpected model summary'))
    };
  }

  function expectZeroSemanticModelCalls(model: ReturnType<typeof guardModelEntrypoints>) {
    expect(model.generate).not.toHaveBeenCalled();
    expect(model.classify).not.toHaveBeenCalled();
    expect(model.summarize).not.toHaveBeenCalled();
  }

  function sendBlocked(requestId: string, message: string, pageContext?: Record<string, unknown>, permissionScopes?: string[]) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
          ...(permissionScopes ? { permission_scopes: permissionScopes } : {}) }, requestId
      }))
      .send({ message, ...(pageContext ? { pageContext } : {}) });
  }

  function finalData(response: { text: string }) {
    return parseSseResponse(response.text).find((event) => event.event === 'final')?.data?.data;
  }
});
