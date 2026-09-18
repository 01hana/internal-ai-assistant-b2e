import { INestApplication } from '@nestjs/common';
import request = require('supertest');
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

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState());
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
    expect(final?.data?.data?.answerDecision).toBe('answered');
  });

  it('keeps existing Tool-only retrieval as a GREEN harness proof with one ToolCall and zero RetrievalRuns', async () => {
    const before = counts();
    const response = await send('req-f010-tool-proof', '請查 SKU-DEMO-RED 目前庫存', inventoryPage('SKU-DEMO-RED'));
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
    ]);
    expect(state.toolCalls).toHaveLength(before.toolCalls + 1);
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-tool-proof')).toEqual([
      expect.objectContaining({ sourceType: 'structured_record', toolCallId: expect.any(String), fieldPaths: ['availableQuantity', 'incomingQuantity'] })
    ]);
  });

  it('executes explicit Hybrid Tool plus RAG with one lane call each and independent evidence [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
    const before = counts();
    await send('req-f010-hybrid', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式', inventoryPage('SKU-DEMO-RED'));
    const evidence = state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid');
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns + 1);
    expect(state.toolCalls).toHaveLength(before.toolCalls + 1);
    expect(evidence.map((item) => item.sourceType).sort()).toEqual(['document_chunk', 'structured_record']);
    expect(new Set(evidence.map((item) => item.id)).size).toBe(2);
  });

  it('re-enters RAG for a compatible semantic follow-up [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
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

  it('clarifies ambiguous deixis with zero retrieval or Tool execution [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
    const before = counts();
    const response = await send('req-f010-followup-ambiguous', '那個呢？', { module: 'orders', visibleColumns: [] });
    const final = parseSseResponse(response.text).find((event) => event.event === 'final');
    const decision = state.answerDecisions.find((item) => item.requestId === 'req-f010-followup-ambiguous');
    expect(counts()).toEqual(before);
    expect(final?.data?.data?.answerDecision).toBe('clarification_required');
    expect(decision?.metadata).toEqual(expect.objectContaining({ followUpResolution: expect.objectContaining({ kind: 'CLARIFY' }) }));
  });

  it('recalls prior document evidence without a new retrieval or ToolCall [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
    await send('req-f010-doc-recall-seed', '退貨流程 SOP 怎麼說？', { module: 'orders', visibleColumns: [] });
    const priorIds = evidenceIds('req-f010-doc-recall-seed');
    const before = counts();
    await send('req-f010-doc-recall', '你剛才引用的文件怎麼說？', { module: 'orders', visibleColumns: [] });
    expect(counts()).toEqual(before);
    expect(bundleMetadata('req-f010-doc-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', evidenceIds: priorIds }));
  });

  it('recalls prior Tool evidence without a new retrieval or ToolCall [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
    await send('req-f010-tool-recall-seed', '請查 SKU-DEMO-RED 目前庫存', inventoryPage('SKU-DEMO-RED'));
    const priorIds = evidenceIds('req-f010-tool-recall-seed');
    const before = counts();
    await send('req-f010-tool-recall', '你剛說庫存是多少？', inventoryPage('SKU-DEMO-RED'));
    expect(counts()).toEqual(before);
    expect(bundleMetadata('req-f010-tool-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', evidenceIds: priorIds }));
  });

  it('recalls prior Hybrid evidence item-by-item without new lane calls [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
    await send('req-f010-hybrid-recall-seed', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式', inventoryPage('SKU-DEMO-RED'));
    const priorIds = evidenceIds('req-f010-hybrid-recall-seed');
    const before = counts();
    await send('req-f010-hybrid-recall', '把剛才的庫存和 SOP 證據再列一次', inventoryPage('SKU-DEMO-RED'));
    expect(counts()).toEqual(before);
    expect(bundleMetadata('req-f010-hybrid-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE', evidenceIds: priorIds }));
    expect(priorIds).toHaveLength(2);
  });

  it('resolves unsupported last-month follow-up but performs zero execution [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
    await send('req-f010-unsupported-seed', '請查這個月新增工單數', { module: 'work-orders', visibleColumns: ['createdAt'] });
    const before = counts();
    const response = await send('req-f010-unsupported', '上個月呢？', { module: 'work-orders', visibleColumns: ['createdAt'] });
    const final = parseSseResponse(response.text).find((event) => event.event === 'final');
    expect(counts()).toEqual(before);
    expect(final?.data?.data?.answerDecision).toBe('clarification_required');
    expect(bundleMetadata('req-f010-unsupported')).toEqual(expect.objectContaining({
      mode: 'CLARIFY', coverage: 'CLARIFY', unsupportedNeeds: [expect.objectContaining({ reasonCode: 'UNSUPPORTED_TIME_RANGE' })]
    }));
  });

  it('persists only the approved safe bundle metadata subset without the transient citation map [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', async () => {
    await send('req-f010-bundle', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式', inventoryPage('SKU-DEMO-RED'));
    const metadata = bundleMetadata('req-f010-bundle');
    expect(metadata).toEqual(expect.objectContaining({
      bundleVersion: '1', mode: 'HYBRID', coverage: 'COMPLETE',
      requestedNeedIds: expect.arrayContaining([expect.any(String), expect.any(String)]),
      needResults: expect.arrayContaining([expect.objectContaining({ needId: expect.any(String), status: 'COVERED' })]),
      evidenceIds: expect.arrayContaining([expect.any(String), expect.any(String)])
    }));
    expect(metadata).not.toHaveProperty('citations');
    expect(JSON.stringify(metadata)).not.toMatch(/rawResponse|preProjection|token|credential|connectorContextRef|permissionResult/i);
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
