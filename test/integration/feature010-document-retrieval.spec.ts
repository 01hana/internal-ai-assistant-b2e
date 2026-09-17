import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { AssistantMessageRole, KnowledgeDocumentStatus, KnowledgeSourceType, KnowledgeVisibility } from '../../src/generated/prisma/enums';
import { AssistantPlanningService } from '../../src/assistant/planning/assistant-planning.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { HostIntegrationRequestFactory } from '../../src/host-integration/host-integration-request.factory';
import type { DocumentRetrievalNeed } from '../../src/retrieval/grounded-retrieval.types';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import { CUSTOMER_SCOPE_FIXTURES, createCustomerScopeFixtureIdentityContext } from '../support/customer-scope-fixtures';
import { loadFeature010Export } from '../support/feature010-red-contract.helper';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

type DocumentLane = { execute(input: Record<string, unknown>): Promise<any> };
type DocumentLaneConstructor = new (...args: never[]) => DocumentLane;

describe('Feature 010 grounded document retrieval RED (T044)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: any;

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState());
    await seedTravelPolicy(prismaMock);
  });

  afterEach(async () => app.close());

  it('plans and executes standalone travel policy through one canonical RAG lane with zero ToolCalls', async () => {
    const before = counts();
    const { plan, result } = await planAndRun('req-f010-p5-travel', '公司的員工旅遊補助規定是什麼？');
    expect(plan.groundedRetrievalPlan).toMatchObject({ mode: 'RAG' });
    expect(counts()).toEqual({ retrievalRuns: before.retrievalRuns + 1, toolCalls: before.toolCalls });
    expect(result.needResult).toMatchObject({ status: 'COVERED', evidenceRefIds: expect.any(Array) });
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeLessThanOrEqual(2);
    expect(result.citations).toHaveLength(result.evidence.length);
    expect(result.evidence.every((item: any) => item.trustClass === 'UNTRUSTED_DOCUMENT_EVIDENCE')).toBe(true);
    const audit = state.auditEvents.find((item) => item.requestId === 'req-f010-p5-travel' && item.eventType === 'grounded_document_retrieval_completed');
    expect(audit?.metadata).toEqual(expect.objectContaining({ needId: 'need-1', status: 'COVERED', citationCount: result.citations.length }));
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/員工旅遊|content|query|score|permission|connector/i);
  });

  it('persists the resolved travel topic and application-deadline aspect in the follow-up retrieval query', async () => {
    await send('req-f010-p5-seed', '公司的員工旅遊補助規定是什麼？');
    const before = counts();
    const { plan, result } = await planAndRun('req-f010-p5-followup', '那申請期限呢？');
    expect(plan.groundedRetrievalPlan).toMatchObject({ mode: 'RAG', resolvedFrame: expect.any(Object) });
    expect(result.needResult.status).toBe('COVERED');
    expect(counts()).toEqual({ retrievalRuns: before.retrievalRuns + 1, toolCalls: before.toolCalls });
    const query = state.retrievalRuns.at(-1)?.query ?? '';
    expect(query).toContain('員工旅遊補助');
    expect(query).toContain('申請期限');
    expect(query).not.toBe('那申請期限呢？');
  });

  it('keeps the existing return-SOP answer compatible with zero ToolCalls', async () => {
    const before = counts();
    const response = await send('req-f010-p5-sop', '退貨流程 SOP 怎麼說？');
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).at(-1)?.data?.data?.answerDecision).toBe('answered');
    expect(counts()).toEqual({ retrievalRuns: before.retrievalRuns + 1, toolCalls: before.toolCalls });
  });

  it('returns an unsupported need with no evidence or citations when no selected document exists', async () => {
    state.knowledgeDocuments.splice(0);
    state.knowledgeChunks.splice(0);
    const { result } = await planAndRun('req-f010-p5-none', '公司的員工旅遊補助規定是什麼？');
    expect(result).toMatchObject({
      needResult: { status: 'UNSUPPORTED', reasonCode: 'DOCUMENT_EVIDENCE_NOT_FOUND', evidenceRefIds: [] },
      evidence: [], citations: []
    });
  });

  it('fails the complete need when a selected source contains secret material', async () => {
    state.knowledgeDocuments.splice(0);
    state.knowledgeChunks.splice(0);
    await prismaMock.knowledgeDocument.create({ data: {
      id: 'knowledge-document-secret-001', customerId: 'customer-a', title: '員工旅遊補助辦法', sourceType: KnowledgeSourceType.policy,
      sourceKey: 'policy/travel-secret', version: '1', language: 'zh-TW', status: KnowledgeDocumentStatus.active,
      visibility: KnowledgeVisibility.CUSTOMER, organizationIds: [], requiredPermissionScopes: []
    } });
    await prismaMock.knowledgeChunk.create({ data: {
      id: 'knowledge-chunk-secret-001', customerId: 'customer-a', documentId: 'knowledge-document-secret-001', chunkIndex: 0,
      heading: '補助規定', content: '員工旅遊補助規定 Authorization: Bearer abcdefghijklmnop', tokenCount: 10, enabled: true
    } });
    const { result } = await planAndRun('req-f010-p5-secret', '公司的員工旅遊補助規定是什麼？');
    expect(result).toMatchObject({ needResult: { status: 'FAILED', reasonCode: 'DOCUMENT_EVIDENCE_SOURCE_REJECTED', evidenceRefIds: [] }, evidence: [], citations: [] });
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-p5-secret')).toHaveLength(0);
  });

  it('returns a failed need when canonical retrieval throws', async () => {
    jest.spyOn(app.get(RetrievalService), 'runDocumentRetrieval').mockRejectedValueOnce(new Error('test-only retrieval failure'));
    const { result } = await planAndRun('req-f010-p5-failure', '公司的員工旅遊補助規定是什麼？');
    expect(result).toMatchObject({ needResult: { status: 'FAILED', reasonCode: 'DOCUMENT_RETRIEVAL_FAILED', evidenceRefIds: [] }, evidence: [], citations: [] });
    expect(state.auditEvents.find((item) => item.requestId === 'req-f010-p5-failure' && item.eventType === 'grounded_document_retrieval_rejected')?.metadata)
      .toEqual(expect.objectContaining({ status: 'FAILED', reasonCode: 'DOCUMENT_RETRIEVAL_FAILED' }));
  });

  async function planAndRun(requestId: string, text: string) {
    const identityContext = { ...createCustomerScopeFixtureIdentityContext(CUSTOMER_SCOPE_FIXTURES.customerA), requestId };
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const userMessageId = `message-user-${requestId}`;
    const assistantMessageId = `message-assistant-${requestId}`;
    state.messages.push({ id: userMessageId, customerId: 'customer-a', sessionId: 'session-owned-001', requestId, role: AssistantMessageRole.user, content: text, answerDecision: null, pageContext: { module: 'hr' }, createdAt: new Date() });
    const plan = await app.get(AssistantPlanningService).createPlan({
      customerScope, requestId, sessionId: 'session-owned-001', messageId: userMessageId, text,
      hostIntegrationContext: new HostIntegrationRequestFactory().createHostContext(identityContext),
      pageContext: { module: 'hr' }
    });
    state.messages.push({ id: assistantMessageId, customerId: 'customer-a', sessionId: 'session-owned-001', requestId, role: AssistantMessageRole.assistant, content: '', answerDecision: null, pageContext: null, createdAt: new Date() });
    const need = plan.groundedRetrievalPlan?.needs.find((candidate): candidate is DocumentRetrievalNeed => candidate.kind === 'DOCUMENT');
    expect(need).toBeDefined();
    const result = await documentLane().execute({ requestId, sessionId: 'session-owned-001', messageId: assistantMessageId, identityContext, customerScope, need, resolvedFrame: plan.groundedRetrievalPlan?.resolvedFrame });
    return { plan, result };
  }

  function documentLane(): DocumentLane {
    const Target = loadFeature010Export<DocumentLaneConstructor>({ taskId: 'T044', fromTestDirectory: __dirname, modulePath: '../../src/retrieval/grounded-document-retrieval.service', exportName: 'GroundedDocumentRetrievalService', capability: 'canonical per-need document retrieval' });
    return app.get(Target);
  }

  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'hr', visibleColumns: [] } });
  }

  function counts() { return { retrievalRuns: state.retrievalRuns.length, toolCalls: state.toolCalls.length }; }
});

async function seedTravelPolicy(prisma: any) {
  await prisma.knowledgeDocument.create({ data: {
    id: 'knowledge-document-travel-001', customerId: 'customer-a', title: '員工旅遊補助辦法', sourceType: KnowledgeSourceType.policy,
    sourceKey: 'policy/travel-subsidy', version: '3.0.0', language: 'zh-TW', status: KnowledgeDocumentStatus.active,
    visibility: KnowledgeVisibility.CUSTOMER, organizationIds: [], requiredPermissionScopes: []
  } });
  for (const [index, heading, content] of [
    [0, '補助規定', '員工旅遊補助規定：正職員工每年可依辦法申請旅遊補助。'],
    [1, '申請期限', '員工旅遊補助申請期限為旅遊結束後三十日內。'],
    [2, '申請文件', '員工旅遊補助需檢附收據與申請表。']
  ] as const) {
    await prisma.knowledgeChunk.create({ data: { id: `knowledge-chunk-travel-${index + 1}`, customerId: 'customer-a', documentId: 'knowledge-document-travel-001', chunkIndex: index, heading, content, tokenCount: 30, enabled: true } });
  }
}
