import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { HybridRetrievalCoordinatorService } from '../../src/assistant/grounding/hybrid-retrieval-coordinator.service';
import { GroundedToolRetrievalService } from '../../src/assistant/grounding/grounded-tool-retrieval.service';
import { GroundedDocumentRetrievalService } from '../../src/retrieval/grounded-document-retrieval.service';

describe('Feature 010 explicit Hybrid coordination (T060)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterEach(async () => app.close());

  it('executes one declared Tool lane and one RAG lane with COMPLETE coverage', async () => {
    const before = counts();
    await send('req-f010-hybrid-complete', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(counts()).toEqual({ tools: before.tools + 1, retrievals: before.retrievals + 1 });
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid-complete').map((item) => item.sourceType).sort())
      .toEqual(['document_chunk', 'structured_record']);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-hybrid-complete')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'HYBRID', coverage: 'COMPLETE' }));
    const audits = state.auditEvents.filter((item) => item.requestId === 'req-f010-hybrid-complete');
    expect(audits.map((item) => item.eventType)).toEqual(expect.arrayContaining([
      'grounded_retrieval_plan_selected', 'grounded_prior_context_evaluated',
      'grounded_retrieval_lane_completed', 'grounded_retrieval_coverage_evaluated', 'grounded_context_bundle_assembled'
    ]));
    expect(JSON.stringify(audits.map((item) => item.metadata))).not.toMatch(/rawResponse|projectedFacts|snippet|toolArguments|credential|permissionSnapshot/i);
  });

  it('keeps document evidence and reports PARTIAL when the Tool lane is denied', async () => {
    state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    const before = counts();
    await send('req-f010-hybrid-tool-denied', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(state.retrievalRuns).toHaveLength(before.retrievals + 1);
    expect(state.toolCalls.length).toBeLessThanOrEqual(before.tools + 1);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-hybrid-tool-denied')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'HYBRID', coverage: 'PARTIAL' }));
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid-tool-denied').map((item) => item.sourceType)).toEqual(['document_chunk']);
  });

  it('reports INSUFFICIENT when all declared lanes are unsupported', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    await send('req-f010-hybrid-none', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-hybrid-none')?.metadata)
      .toEqual(expect.objectContaining({ coverage: 'INSUFFICIENT', evidenceIds: [] }));
  });

  it('runs no lane for blocking ambiguity', async () => {
    const before = counts();
    await send('req-f010-hybrid-clarify', '那個呢？');
    expect(counts()).toEqual(before);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-hybrid-clarify')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'CLARIFY', coverage: 'CLARIFY' }));
  });

  it('pre-scans an invalid multi-Tool plan and executes zero lanes', async () => {
    const coordinator = app.get(HybridRetrievalCoordinatorService);
    const tools = app.get(GroundedToolRetrievalService);
    const documents = app.get(GroundedDocumentRetrievalService);
    const toolSpy = jest.spyOn(tools, 'execute');
    const documentSpy = jest.spyOn(documents, 'execute');
    const result = await coordinator.execute({
      plan: { mode: 'INSUFFICIENT', reasonCode: 'MULTIPLE_TOOL_NEEDS_UNSUPPORTED', needs: [
        { id: 'need-1', kind: 'TOOL', frame: {} }, { id: 'need-2', kind: 'DOCUMENT', query: '退貨 SOP' },
        { id: 'need-3', kind: 'TOOL', frame: {} }
      ] }, documentInput: {} as never, toolInput: {} as never
    });
    expect(toolSpy).not.toHaveBeenCalled();
    expect(documentSpy).not.toHaveBeenCalled();
    expect(result.needResults).toHaveLength(3);
    expect(result.needResults.every((item) => item.reasonCode === 'MULTIPLE_TOOL_NEEDS_UNSUPPORTED')).toBe(true);
  });

  it('keeps Tool evidence and reports PARTIAL when the document lane has no evidence', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    await send('req-f010-hybrid-partial', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    const metadata = state.answerDecisions.find((item) => item.requestId === 'req-f010-hybrid-partial')?.metadata;
    expect(metadata).toEqual(expect.objectContaining({ mode: 'HYBRID', coverage: 'PARTIAL' }));
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid-partial').map((item) => item.sourceType)).toEqual(['structured_record']);
  });

  function counts() { return { tools: state.toolCalls.length, retrievals: state.retrievalRuns.length }; }
  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }
});
