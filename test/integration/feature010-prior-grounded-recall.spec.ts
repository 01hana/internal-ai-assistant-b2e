import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { AssistantPlanningService } from '../../src/assistant/planning/assistant-planning.service';
import { PriorGroundedContextService } from '../../src/assistant/grounding/prior-grounded-context.service';
import { ConversationContextLoaderService } from '../../src/assistant/conversation/conversation-context-loader.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { CUSTOMER_SCOPE_FIXTURES, createCustomerScopeFixtureIdentityContext } from '../support/customer-scope-fixtures';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';

describe('Feature 010 current-authorized prior grounded recall (T066)', () => {
  let previousToolSelection: string | undefined;
  beforeAll(() => {
    previousToolSelection = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'false';
  });
  afterAll(() => {
    if (previousToolSelection === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousToolSelection;
  });
  let app: INestApplication;
  let state: Us1TestState;
  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '核准證據顯示結果。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterEach(async () => app.close());

  it('reuses a complete Hybrid evidence set with zero new lane calls', async () => {
    await send('req-f010-recall-seed', '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式');
    const ids = evidenceIds('req-f010-recall-seed');
    const before = counts();
    const planning = app.get(AssistantPlanningService);
    const planningSpy = jest.spyOn(planning, 'createPlan');
    await send('req-f010-recall', '把剛才的庫存和 SOP 證據再列一次');
    const canonicalPlan = await planningSpy.mock.results.at(-1)?.value;
    expect(canonicalPlan?.groundedRetrievalPlan).toMatchObject({
      mode: 'HYBRID', needs: [{ kind: 'TOOL' }, { kind: 'DOCUMENT' }]
    });
    expect(counts()).toEqual(before);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-recall')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE', evidenceIds: ids }));
  });

  it('reuses complete document-only and Tool-only evidence with zero new lane calls', async () => {
    await send('req-f010-doc-seed', '退貨流程 SOP 怎麼說？');
    let before = counts();
    await send('req-f010-doc-recall', '你剛才引用的文件怎麼說？');
    expect(counts()).toEqual(before);
    expect(metadata('req-f010-doc-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE' }));

    await send('req-f010-tool-seed', '查詢庫存可用量 料號 SKU-DEMO-RED');
    expect(state.queryUnderstandingResults.find((item) => item.requestId === 'req-f010-tool-seed')?.resolvedReferences)
      .toMatchObject({ kind: 'CAPABILITY_FOLLOW_UP_FRAME_ENVELOPE' });
    const loaded = await app.get(ConversationContextLoaderService).load({ scope: {
      customerId: 'customer-a', integrationId: 'integration-erp', sessionId: 'session-owned-001', organizationId: 'org-shared',
      hostApp: 'erp', actorId: 'actor-shared'
    } });
    expect({ exchanges: loaded.exchanges.length, rejectionCodes: loaded.rejectedReasonCodes,
      capabilityFrames: loaded.capabilityFrames?.length }).toEqual({ exchanges: 3, rejectionCodes: [], capabilityFrames: 1 });
    before = counts();
    await send('req-f010-tool-recall', '你剛說庫存是多少？');
    expect(counts()).toEqual(before);
    expect(metadata('req-f010-tool-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE' }));
  });

  it.each([
    ['unknown-metric', '你剛說庫存周轉率是多少？'],
    ['different-metric', '你剛說庫存現量是多少？'],
    ['ambiguous-target', '你剛說的是多少？'],
    ['different-entity', '你剛說 SKU-DEMO-BLUE 庫存是多少？'],
    ['different-company', '你剛說其他公司的庫存是多少？']
  ])('does not reuse prior Tool evidence for %s', async (label, question) => {
    await send(`req-f010-recall-negative-seed-${label}`, '查詢庫存可用量 料號 SKU-DEMO-RED');
    const priorId = state.evidenceRefs.at(-1)?.id;
    const before = counts();
    await send(`req-f010-recall-negative-${label}`, question);
    const decision = metadata(`req-f010-recall-negative-${label}`);
    expect(decision).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
    expect(decision?.evidenceIds ?? []).not.toContain(priorId);
    expect(state.answerDecisions.find((item) => item.requestId === `req-f010-recall-negative-${label}`)?.status).not.toBe('answered');
    expect(counts().tools).toBe(before.tools);
  });

  it('does not recall without a completed exchange or traceable evidence', async () => {
    const emptyBefore = counts();
    await send('req-f010-recall-no-prior', '你剛說庫存是多少？');
    expect(metadata('req-f010-recall-no-prior')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
    expect(counts()).toEqual(emptyBefore);

    await send('req-f010-recall-untraceable-seed', '查詢庫存可用量 料號 SKU-DEMO-RED');
    const refIndex = state.evidenceRefs.findIndex((item) => item.requestId === 'req-f010-recall-untraceable-seed');
    expect(refIndex).toBeGreaterThanOrEqual(0);
    state.evidenceRefs.splice(refIndex, 1);
    const before = counts();
    await send('req-f010-recall-untraceable', '你剛說庫存是多少？');
    expect(metadata('req-f010-recall-untraceable')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
    expect(counts()).toEqual(before);
  });

  it('does not use an old Pack version as the current recall target', async () => {
    await send('req-f010-recall-pack-seed', '查詢庫存可用量 料號 SKU-DEMO-RED');
    const understanding = state.queryUnderstandingResults.find((item) => item.requestId === 'req-f010-recall-pack-seed')!;
    const envelope = understanding.resolvedReferences as Record<string, any>;
    expect(envelope.kind).toBe('CAPABILITY_FOLLOW_UP_FRAME_ENVELOPE');
    understanding.resolvedReferences = { ...envelope,
      capabilityFrame: { ...envelope.capabilityFrame, packVersion: '0.9.0' } };
    const before = counts();
    await send('req-f010-recall-pack-mismatch', '你剛說庫存是多少？');
    expect(metadata('req-f010-recall-pack-mismatch')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
    expect(counts()).toEqual(before);
  });

  it('keeps multiple incompatible prior topics ambiguous when the recall target is omitted', async () => {
    await send('req-f010-recall-multi-document', '退貨流程 SOP 怎麼說？');
    await send('req-f010-recall-multi-tool', '查詢庫存可用量 料號 SKU-DEMO-RED');
    const before = counts();
    await send('req-f010-recall-multi-ambiguous', '你剛說的是多少？');
    expect(metadata('req-f010-recall-multi-ambiguous')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
    expect(counts()).toEqual(before);
  });

  it('re-retrieves document evidence after version change or current access revocation', async () => {
    await send('req-f010-doc-version-seed', '退貨流程 SOP 怎麼說？');
    state.knowledgeDocuments.find((item) => item.id === 'knowledge-document-sop-return-001')!.version = '2.0.0';
    let before = counts();
    await send('req-f010-doc-version', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(before.retrievals + 1);
    expect(metadata('req-f010-doc-version')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));

    await send('req-f010-doc-access-seed', '退貨流程 SOP 怎麼說？');
    state.knowledgeDocuments.find((item) => item.id === 'knowledge-document-sop-return-001')!.requiredPermissionScopes = ['documents:restricted'];
    before = counts();
    await send('req-f010-doc-access', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(before.retrievals + 1);
    expect(metadata('req-f010-doc-access')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  it('does not reuse stale or currently unauthorized Tool evidence', async () => {
    await send('req-f010-tool-stale-seed', '查詢庫存可用量 料號 SKU-DEMO-RED');
    const stale = state.evidenceRefs.find((item) => item.requestId === 'req-f010-tool-stale-seed')!;
    stale.timestamp = new Date('2020-01-01T00:00:00.000Z');
    let before = counts();
    await send('req-f010-tool-stale', '你剛說庫存是多少？');
    expect(counts().tools).toBe(before.tools + 1);
    expect(metadata('req-f010-tool-stale')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));

    await send('req-f010-tool-policy-seed', '查詢庫存可用量 料號 SKU-DEMO-RED');
    state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    before = counts();
    await send('req-f010-tool-policy', '你剛說庫存是多少？');
    expect(counts().tools).toBe(before.tools + 1);
    expect(state.toolCalls.at(-1)).toMatchObject({ status: 'blocked', executionStatus: 'not_started' });
    expect(evidenceIds('req-f010-tool-policy')).toEqual([]);
    expect(metadata('req-f010-tool-policy')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  it('does not reuse evidence for an incompatible semantic need', async () => {
    await send('req-f010-incompatible-seed', '退貨流程 SOP 怎麼說？');
    const priorId = evidenceIds('req-f010-incompatible-seed')[0];
    const before = counts();
    await send('req-f010-incompatible', '公司旅遊補助政策怎麼說？');
    expect(counts().retrievals).toBeGreaterThanOrEqual(before.retrievals);
    expect((metadata('req-f010-incompatible')?.evidenceIds ?? [])).not.toContain(priorId);
    expect(metadata('req-f010-incompatible')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  it('does not reuse a cross-Customer candidate', async () => {
    await send('req-f010-cross-seed', '退貨流程 SOP 怎麼說？');
    state.evidenceRefs.find((item) => item.requestId === 'req-f010-cross-seed')!.customerId = 'customer-b';
    const crossBefore = counts();
    await send('req-f010-cross', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(crossBefore.retrievals + 1);
    expect(metadata('req-f010-cross')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  it('does not treat the same document source type as semantic compatibility for generic unrelated topics', async () => {
    await send('req-f010-generic-topic-seed', '退貨流程 SOP 怎麼說？');
    const prior = state.evidenceRefs.find((item) => item.requestId === 'req-f010-generic-topic-seed')!;
    prior.summary = { ...(prior.summary as Record<string, unknown>), sourceKey: 'security-access-policy' };
    const identityContext = { ...createCustomerScopeFixtureIdentityContext(CUSTOMER_SCOPE_FIXTURES.customerA), requestId: 'req-f010-generic-topic' };
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const result = await app.get(PriorGroundedContextService).resolve({
      plan: { mode: 'RAG', reasonCode: 'DOCUMENT_NEED', resolvedFrame: { topicKey: 'expense-reimbursement-policy',
        resource: { value: 'expenseReimbursement', source: 'inherited', sourceMessageId: 'message-prior', confidence: 1 } },
        needs: [{ id: 'need-expense', kind: 'DOCUMENT', query: 'expense reimbursement policy', topicKey: 'expense-reimbursement-policy' }] },
      context: { scope: { customerId: 'customer-a', integrationId: 'integration-erp', sessionId: 'session-owned-001', organizationId: 'org-001', hostApp: 'erp', actorId: 'actor-001' },
        selectedExchangeIdsNewestFirst: ['exchange-prior'], chronologicalExchangeIds: ['exchange-prior'],
        exchanges: [{ exchangeId: 'exchange-prior', requestId: 'req-f010-generic-topic-seed', userMessageId: 'message-prior',
          assistantMessageId: prior.messageId!, createdAt: prior.timestamp.toISOString(),
          semanticFrame: { topicKey: 'security-access-policy', resource: { value: 'securityAccess', source: 'current_explicit',
            sourceMessageId: 'message-prior', confidence: 1 } }, evidenceRefIds: [prior.id] }],
        semanticFrames: [], evidenceRefs: [{ id: prior.id, messageId: prior.messageId!, sourceType: 'document_chunk', sourceId: prior.sourceId,
          observedAt: prior.timestamp.toISOString() }], evidenceRefIds: [prior.id], rejectedReasonCodes: [] },
      customerScope, identityContext, requestId: 'req-f010-generic-topic', sessionId: 'session-owned-001',
      sourceMessageId: 'message-current-generic', responseMessageId: 'message-response-generic'
    });
    expect(result).toEqual(expect.objectContaining({ complete: false, needResults: [], evidence: [], citations: [] }));
  });

  function counts() { return { tools: state.toolCalls.length, retrievals: state.retrievalRuns.length }; }
  function evidenceIds(requestId: string) { return state.evidenceRefs.filter((item) => item.requestId === requestId).map((item) => item.id); }
  function metadata(requestId: string): any { return state.answerDecisions.find((item) => item.requestId === requestId)?.metadata; }
  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }
});
