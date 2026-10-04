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
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterEach(async () => app.close());

  it.each([
    ['document-only', '退貨流程 SOP 怎麼說？'],
    ['Tool-only', '查詢庫存可用量 料號 SKU-DEMO-RED'],
    ['Hybrid COMPLETE', '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式']
  ])('keeps the legacy covered-path zero-generateAnswer assertion for %s until Feature 012 Phase C', async (_case, message) => {
    await expectNoLlm(() => send(`req-f010-no-llm-${String(_case).replace(/\W/g, '-')}`, message));
  });

  it('permanently keeps factual generation and semantic model authority out of CLARIFY', async () => {
    await expectNoLlm(() => send('req-f010-no-llm-clarify', '那個呢？'));
  });

  it('FUTURE_SUPERSEDED_IN_FEATURE012_PHASE_C: keeps zero generation for Hybrid PARTIAL until cutover', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    await expectNoLlm(() => send('req-f010-no-llm-partial', '查詢庫存可用量 料號 SKU-DEMO-RED，並依退貨流程 SOP 說明處理方式'));
    expect(metadata('req-f010-no-llm-partial')).toEqual(expect.objectContaining({ coverage: 'PARTIAL' }));
  });

  it('PERMANENT_ZERO_FACTUAL_GENERATION: keeps Hybrid INSUFFICIENT blocked', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    await expectNoLlm(() => send('req-f010-no-llm-insufficient', '查詢庫存可用量 料號 SKU-DEMO-BLUE，並依退貨流程 SOP 說明處理方式', 'SKU-DEMO-BLUE'));
    expect(metadata('req-f010-no-llm-insufficient')).toEqual(expect.objectContaining({ coverage: 'INSUFFICIENT' }));
  });

  it('keeps the legacy covered-path zero-generateAnswer assertion for CONTEXT_ONLY until Feature 012 Phase C', async () => {
    await send('req-f010-no-llm-recall-seed', '退貨流程 SOP 怎麼說？');
    await expectNoLlm(() => send('req-f010-no-llm-recall', '你剛才引用的文件怎麼說？'));
    expect(metadata('req-f010-no-llm-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  async function expectNoLlm(action: () => Promise<unknown>) {
    const llm = app.get(LlmExecutionService, { strict: false });
    const generate = jest.spyOn(llm, 'generateAnswer');
    const classify = jest.spyOn(llm, 'classifyIntent');
    const summarize = jest.spyOn(llm, 'summarize');
    await action();
    // Future superseded target: covered grounded paths may generate in Feature 012 Phase C.
    // For blocked outcomes, the same zero factual-generation assertion remains permanent.
    expect(generate).not.toHaveBeenCalled();
    // Permanent invariants: neither classifier nor summarizer owns production semantics.
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  }

  function send(requestId: string, message: string, entityId = 'SKU-DEMO-RED') {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      }))
      .send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId, visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }

  function metadata(requestId: string): any { return state.answerDecisions.find((item) => item.requestId === requestId)?.metadata; }
});
