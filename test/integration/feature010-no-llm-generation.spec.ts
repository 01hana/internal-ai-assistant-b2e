import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 does not generate with an LLM (T072)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterEach(async () => app.close());

  it.each([
    ['document-only', '退貨流程 SOP 怎麼說？'],
    ['Tool-only', '請查 SKU-DEMO-RED 目前庫存'],
    ['Hybrid COMPLETE', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式'],
    ['CLARIFY', '那個呢？']
  ])('keeps LLM invocation count zero for %s', async (_case, message) => {
    await expectNoLlm(() => send(`req-f010-no-llm-${String(_case).replace(/\W/g, '-')}`, message));
  });

  it('keeps LLM invocation count zero for Hybrid PARTIAL and INSUFFICIENT', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    await expectNoLlm(() => send('req-f010-no-llm-partial', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式'));
    expect(metadata('req-f010-no-llm-partial')).toEqual(expect.objectContaining({ coverage: 'PARTIAL' }));

    state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    await expectNoLlm(() => send('req-f010-no-llm-insufficient', '請查 SKU-DEMO-BLUE 目前庫存，並依退貨流程 SOP 說明處理方式'));
    expect(metadata('req-f010-no-llm-insufficient')).toEqual(expect.objectContaining({ coverage: 'INSUFFICIENT' }));
  });

  it('keeps LLM invocation count zero for CONTEXT_ONLY recall', async () => {
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
    expect(generate).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  }

  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      }))
      .send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }

  function metadata(requestId: string): any { return state.answerDecisions.find((item) => item.requestId === requestId)?.metadata; }
});
