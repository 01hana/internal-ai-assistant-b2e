import { INestApplication } from '@nestjs/common';
import { resolve } from 'path';
import request = require('supertest');
import { CapabilityPackLoader } from '../../src/capabilities/capability-pack.loader';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 unified grounded retrieval integration RED (T010)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  let generateAnswer: jest.SpyInstance;

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    generateAnswer = jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '核准證據顯示結果。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    state.customerToolPolicies.push({
      customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true,
      requiredRoles: [], requiredPermissionScopes: []
    });
  });

  afterEach(async () => app.close());

  it('keeps existing document-only retrieval as a GREEN harness proof with zero ToolCalls', async () => {
    const before = counts();
    const response = await send('req-f010-document-proof', '退貨流程 SOP 怎麼說？', { module: 'orders', visibleColumns: ['status'] });
    const final = parseSseResponse(response.text).find((event) => event.event === 'final');
    expect(response.status).toBe(200);
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns + 1);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-document-proof')).toEqual([
      expect.objectContaining({ sourceType: 'document_chunk', documentId: expect.any(String), chunkId: expect.any(String) })
    ]);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    expect(final?.data?.data?.answerDecision).toBe('answered');
  });

  it('keeps existing Tool-only retrieval as a GREEN harness proof with one ToolCall and zero RetrievalRuns', async () => {
    const before = counts();
    const response = await send('req-f010-tool-proof', '請查 SKU-DEMO-RED 庫存可用量', inventoryPage('SKU-DEMO-RED'));
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
    ]);
    expect(state.toolCalls).toHaveLength(before.toolCalls + 1);
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-tool-proof')).toEqual([
      expect.objectContaining({ sourceType: 'structured_record', toolCallId: expect.any(String), fieldPaths: ['availableQuantity', 'incomingQuantity'] })
    ]);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it('executes explicit Hybrid Tool plus RAG with one lane call each and independent evidence', async () => {
    const before = counts();
    await send('req-f010-hybrid', '請查 SKU-DEMO-RED 庫存可用量，並依退貨流程 SOP 說明處理方式', inventoryPage('SKU-DEMO-RED'));
    const evidence = state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid');
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns + 1);
    expect(state.toolCalls).toHaveLength(before.toolCalls + 1);
    expect(evidence.map((item) => item.sourceType).sort()).toEqual(['document_chunk', 'structured_record']);
    expect(new Set(evidence.map((item) => item.id)).size).toBe(2);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it('re-enters RAG for a compatible semantic follow-up', async () => {
    await send('req-f010-followup-seed', '公司旅遊補助政策怎麼說？', { module: 'hr', visibleColumns: [] });
    const before = counts();
    await send('req-f010-followup-rag', '那申請期限呢？', { module: 'hr', visibleColumns: [] });
    const decision = state.answerDecisions.find((item) => item.requestId === 'req-f010-followup-rag');
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns + 1);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
    expect(decision?.metadata).toEqual(expect.objectContaining({
      followUpResolution: expect.objectContaining({ kind: 'REPLACE' }), retrievalMode: 'RAG'
    }));
  });

  it('clarifies ambiguous deixis with zero retrieval or Tool execution', async () => {
    const before = counts();
    const response = await send('req-f010-followup-ambiguous', '那個呢？', { module: 'orders', visibleColumns: [] });
    const final = parseSseResponse(response.text).find((event) => event.event === 'final');
    const decision = state.answerDecisions.find((item) => item.requestId === 'req-f010-followup-ambiguous');
    expect(counts()).toEqual(before);
    expect(final?.data?.data?.answerDecision).toBe('clarification_required');
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(decision?.metadata).toEqual(expect.objectContaining({ followUpResolution: expect.objectContaining({ kind: 'CLARIFY' }) }));
  });

  it('recalls prior document evidence without a new retrieval or ToolCall', async () => {
    await send('req-f010-doc-recall-seed', '退貨流程 SOP 怎麼說？', { module: 'orders', visibleColumns: [] });
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    const priorIds = evidenceIds('req-f010-doc-recall-seed');
    const before = counts();
    await send('req-f010-doc-recall', '你剛才引用的文件怎麼說？', { module: 'orders', visibleColumns: [] });
    expect(counts()).toEqual(before);
    expect(bundleMetadata('req-f010-doc-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', evidenceIds: priorIds }));
    expect(generateAnswer).toHaveBeenCalledTimes(2);
  });

  it('recalls prior Tool evidence without a new retrieval or ToolCall', async () => {
    await send('req-f010-tool-recall-seed', '請查 SKU-DEMO-RED 庫存可用量', inventoryPage('SKU-DEMO-RED'));
    const priorIds = evidenceIds('req-f010-tool-recall-seed');
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-tool-recall-seed')).toEqual([
      expect.objectContaining({ sourceType: 'structured_record', toolCallId: expect.any(String) })
    ]);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    const before = counts();
    await send('req-f010-tool-recall', '你剛說庫存是多少？', inventoryPage('SKU-DEMO-RED'));
    expect(counts()).toEqual(before);
    expect(bundleMetadata('req-f010-tool-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', evidenceIds: priorIds }));
    expect(generateAnswer).toHaveBeenCalledTimes(2);
  });

  it('recalls prior Hybrid evidence item-by-item without new lane calls', async () => {
    await send('req-f010-hybrid-recall-seed', '請查 SKU-DEMO-RED 庫存可用量，並依退貨流程 SOP 說明處理方式', inventoryPage('SKU-DEMO-RED'));
    const priorIds = evidenceIds('req-f010-hybrid-recall-seed');
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid-recall-seed').map((item) => item.sourceType).sort()).toEqual([
      'document_chunk', 'structured_record'
    ]);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
    const before = counts();
    await send('req-f010-hybrid-recall', '把剛才的庫存和 SOP 證據再列一次', inventoryPage('SKU-DEMO-RED'));
    expect(counts()).toEqual(before);
    expect(bundleMetadata('req-f010-hybrid-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE', evidenceIds: priorIds }));
    expect(priorIds).toHaveLength(2);
    expect(generateAnswer).toHaveBeenCalledTimes(2);
  });

  it('resolves valid but unbound last-month follow-up without execution', async () => {
    await app.get(CapabilityPackLoader).loadAndInstall(JSON.stringify([
      resolve('test/fixtures/capability-packs/customer-a-monthly-followup.v1.json')
    ]));
    await send('req-f010-unsupported-seed', '請查這個月新增工單數', { module: 'work-orders', visibleColumns: ['createdAt'] });
    expect(state.auditEvents.find((event) => event.requestId === 'req-f010-unsupported-seed' && event.eventType === 'capability_resolution_completed')?.metadata).toEqual(
      expect.objectContaining({ outcome: 'RESOLVED', capabilityKey: 'work-orders.count' })
    );
    const before = counts();
    const response = await send('req-f010-unsupported', '上個月呢？', { module: 'work-orders', visibleColumns: ['createdAt'] });
    const final = parseSseResponse(response.text).find((event) => event.event === 'final');
    expect(counts()).toEqual(before);
    expect(final?.data?.data?.answerDecision).toBe('no_answer');
    expect(generateAnswer).not.toHaveBeenCalled();
    expect(bundleMetadata('req-f010-unsupported')).toEqual(expect.objectContaining({
      mode: 'INSUFFICIENT', coverage: 'INSUFFICIENT', unsupportedNeeds: [expect.objectContaining({ reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' })]
    }));
  });

  it('persists only the approved safe bundle metadata subset without the transient citation map', async () => {
    await send('req-f010-bundle', '請查 SKU-DEMO-RED 庫存可用量，並依退貨流程 SOP 說明處理方式', inventoryPage('SKU-DEMO-RED'));
    const metadata = bundleMetadata('req-f010-bundle');
    expect(metadata).toEqual(expect.objectContaining({
      bundleVersion: '1', mode: 'HYBRID', coverage: 'COMPLETE',
      requestedNeedIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
      needResults: expect.arrayContaining([expect.objectContaining({ needId: expect.any(String), status: 'COVERED' })]),
      evidenceIds: expect.arrayContaining([expect.any(String), expect.any(String)])
    }));
    expect(metadata).not.toHaveProperty('citations');
    expect(JSON.stringify(metadata)).not.toMatch(/rawResponse|preProjection|token|credential|connectorContextRef|permissionResult/i);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  async function send(requestId: string, message: string, pageContext: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] },
        requestId
      }))
      .send({ message, pageContext });
  }

  function counts() { return { retrievalRuns: state.retrievalRuns.length, toolCalls: state.toolCalls.length }; }
  function evidenceIds(requestId: string) { return state.evidenceRefs.filter((item) => item.requestId === requestId).map((item) => item.id); }
  function bundleMetadata(requestId: string) { return state.answerDecisions.find((item) => item.requestId === requestId)?.metadata; }
});

function inventoryPage(entityId: string) {
  return { module: 'inventory', entityType: 'item', entityId, visibleColumns: ['availableQuantity', 'incomingQuantity'] };
}
