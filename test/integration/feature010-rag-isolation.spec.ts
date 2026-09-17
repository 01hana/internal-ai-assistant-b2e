import { INestApplication } from '@nestjs/common';
import { AssistantMessageRole, KnowledgeDocumentStatus, KnowledgeSourceType, KnowledgeVisibility } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import type { DocumentRetrievalNeed } from '../../src/retrieval/grounded-retrieval.types';
import { CUSTOMER_SCOPE_FIXTURES, createCustomerScopeFixtureIdentityContext } from '../support/customer-scope-fixtures';
import { loadFeature010Export } from '../support/feature010-red-contract.helper';
import { createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';

type DocumentLane = { execute(input: Record<string, unknown>): Promise<any> };
type DocumentLaneConstructor = new (...args: never[]) => DocumentLane;

describe('Feature 010 RAG pre-rank isolation RED (T047)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: any;

  beforeEach(async () => ({ app, state, prismaMock } = await createUs1TestAppWithState()));
  afterEach(async () => app.close());

  it('filters Customer, organization, active/enabled, permission, and normalized policy before ranking', async () => {
    await seedIsolationRows(prismaMock);
    const requestId = 'req-f010-p5-isolation';
    const identityContext = { ...createCustomerScopeFixtureIdentityContext(CUSTOMER_SCOPE_FIXTURES.customerA), requestId };
    identityContext.actor.permissionScopes = ['orders:read'];
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const messageId = 'message-assistant-f010-p5-isolation';
    state.messages.push({ id: messageId, customerId: 'customer-a', sessionId: 'session-owned-001', requestId, role: AssistantMessageRole.assistant, content: '', answerDecision: null, pageContext: null, createdAt: new Date() });
    const result = await lane().execute({ requestId, sessionId: 'session-owned-001', messageId, identityContext, customerScope, need: { id: 'need-1', kind: 'DOCUMENT', query: 'ISOLATION-MARKER policy' } satisfies DocumentRetrievalNeed });

    expect(result.needResult.status).toBe('COVERED');
    expect(state.retrievalCandidates.map((item) => item.chunkId)).toEqual(['shared-chunk-id']);
    expect(result.evidence.map((item: any) => item.documentId)).toEqual(['shared-document-id']);
    expect(result.citations).toHaveLength(1);
    const serialized = JSON.stringify([state.retrievalCandidates, state.evidenceRefs.filter((item) => item.requestId === requestId), result, state.auditEvents.filter((item) => item.requestId === requestId)]);
    expect(serialized).not.toMatch(/customer-b-private|wrong-org|archived-doc|disabled-chunk|missing-scope|invalid-policy/);
  });

  function lane(): DocumentLane {
    const Target = loadFeature010Export<DocumentLaneConstructor>({ taskId: 'T047', fromTestDirectory: __dirname, modulePath: '../../src/retrieval/grounded-document-retrieval.service', exportName: 'GroundedDocumentRetrievalService', capability: 'Customer-scoped pre-rank document retrieval' });
    return app.get(Target);
  }
});

async function seedIsolationRows(prisma: any) {
  const documents = [
    ['shared-document-id', 'customer-a', KnowledgeDocumentStatus.active, KnowledgeVisibility.CUSTOMER, [], [], 'allowed'],
    ['shared-document-id', 'customer-b', KnowledgeDocumentStatus.active, KnowledgeVisibility.CUSTOMER, [], [], 'customer-b-private'],
    ['wrong-org', 'customer-a', KnowledgeDocumentStatus.active, KnowledgeVisibility.ORGANIZATION, ['org-other'], [], 'wrong-org'],
    ['archived-doc', 'customer-a', KnowledgeDocumentStatus.archived, KnowledgeVisibility.CUSTOMER, [], [], 'archived-doc'],
    ['missing-scope', 'customer-a', KnowledgeDocumentStatus.active, KnowledgeVisibility.CUSTOMER, [], ['finance:read'], 'missing-scope'],
    ['invalid-policy', 'customer-a', KnowledgeDocumentStatus.active, KnowledgeVisibility.ORGANIZATION, [' org-shared'], [], 'invalid-policy']
  ] as const;
  for (const [id, customerId, status, visibility, organizationIds, requiredPermissionScopes, marker] of documents) {
    await prisma.knowledgeDocument.create({ data: { id, customerId, title: `ISOLATION-MARKER ${marker}`, sourceType: KnowledgeSourceType.policy, sourceKey: `policy/${marker}`, version: '1', language: 'zh-TW', status, visibility, organizationIds, requiredPermissionScopes } });
    await prisma.knowledgeChunk.create({ data: { id: id === 'shared-document-id' ? 'shared-chunk-id' : `chunk-${marker}`, customerId, documentId: id, chunkIndex: 0, heading: marker, content: `ISOLATION-MARKER policy ${marker}`, tokenCount: 5, enabled: true } });
  }
  await prisma.knowledgeDocument.create({ data: { id: 'disabled-doc', customerId: 'customer-a', title: 'ISOLATION-MARKER disabled-chunk', sourceType: KnowledgeSourceType.policy, sourceKey: 'policy/disabled', version: '1', language: 'zh-TW', status: KnowledgeDocumentStatus.active, visibility: KnowledgeVisibility.CUSTOMER, organizationIds: [], requiredPermissionScopes: [] } });
  await prisma.knowledgeChunk.create({ data: { id: 'disabled-chunk', customerId: 'customer-a', documentId: 'disabled-doc', chunkIndex: 0, heading: 'disabled-chunk', content: 'ISOLATION-MARKER policy disabled-chunk', tokenCount: 5, enabled: false } });
}
