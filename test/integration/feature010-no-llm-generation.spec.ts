import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 predecessor LLM boundaries (T072)', () => {
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

  it.each([
    ['document-only', '退貨流程 SOP 怎麼說？'],
    ['Tool-only', '查詢庫存可用量 料號 SKU-DEMO-RED'],
    ['Hybrid COMPLETE', '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式']
  ])('generates exactly once for covered %s without model semantic authority', async (_case, message) => {
    await expectOneGeneration(() => send(`req-f010-no-llm-${String(_case).replace(/\W/g, '-')}`, message));
  });

  it('permanently keeps factual generation and semantic model authority out of CLARIFY', async () => {
    await expectNoLlm(() => send('req-f010-no-llm-clarify', '那個呢？'));
  });

  it('generates exactly once for independently covered Hybrid PARTIAL without changing coverage', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    await expectOneGeneration(() => send('req-f010-no-llm-partial', '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式'));
    expect(metadata('req-f010-no-llm-partial')).toEqual(expect.objectContaining({ coverage: 'PARTIAL' }));
  });

  it('PERMANENT_ZERO_FACTUAL_GENERATION: keeps Hybrid INSUFFICIENT blocked', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    await expectNoLlm(() => send('req-f010-no-llm-insufficient', '查詢庫存可用量 料號 SKU-DEMO-BLUE，並依退貨流程 SOP 說明處理方式', 'SKU-DEMO-BLUE'));
    expect(metadata('req-f010-no-llm-insufficient')).toEqual(expect.objectContaining({ coverage: 'INSUFFICIENT' }));
  });

  it('generates once for a covered seed and once for its CONTEXT_ONLY follow-up without new lane calls', async () => {
    await expectOneGeneration(() => send('req-f010-no-llm-recall-seed', '退貨流程 SOP 怎麼說？'));
    const retrievalRuns = state.retrievalRuns.length;
    const toolCalls = state.toolCalls.length;
    await expectOneGeneration(() => send('req-f010-no-llm-recall', '你剛才引用的文件怎麼說？'));
    expect(state.retrievalRuns).toHaveLength(retrievalRuns);
    expect(state.toolCalls).toHaveLength(toolCalls);
    expect(metadata('req-f010-no-llm-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  async function expectGenerationCount(action: () => Promise<unknown>, expectedCount: number) {
    const llm = app.get(LlmExecutionService, { strict: false });
    const generate = jest.spyOn(llm, 'generateAnswer');
    generate.mockClear();
    const classify = jest.spyOn(llm, 'classifyIntent');
    const summarize = jest.spyOn(llm, 'summarize');
    await action();
    expect(generate).toHaveBeenCalledTimes(expectedCount);
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  }

  function expectOneGeneration(action: () => Promise<unknown>) { return expectGenerationCount(action, 1); }
  function expectNoLlm(action: () => Promise<unknown>) { return expectGenerationCount(action, 0); }

  function send(requestId: string, message: string, entityId = 'SKU-DEMO-RED') {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      }))
      .send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId, visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }

  function metadata(requestId: string): any { return state.answerDecisions.find((item) => item.requestId === requestId)?.metadata; }
});
