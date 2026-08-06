import {
  AssistantSessionStatus,
  KnowledgeDocumentStatus,
  KnowledgeSourceType,
  KnowledgeVisibility
} from '../../src/generated/prisma/enums';
import { Us1TestState } from './us1-test-app.helper';

export const PHASE5_RAG_FIXTURE_IDS = Object.freeze({
  customerWide: {
    documentId: 'knowledge-document-customer-a-customer-wide-001',
    chunkId: 'knowledge-chunk-customer-a-customer-wide-001',
    marker: 'CUSTOMER_WIDE_CROSS_ORG_RULE'
  },
  organizationOnly: {
    documentId: 'knowledge-document-customer-a-org-only-001',
    chunkId: 'knowledge-chunk-customer-a-org-only-001',
    marker: 'ORGANIZATION_ALLOWLIST_ONLY_RULE'
  },
  allScopes: {
    documentId: 'knowledge-document-customer-a-all-scopes-001',
    chunkId: 'knowledge-chunk-customer-a-all-scopes-001',
    marker: 'REQUIRES_ALL_SCOPES_RULE'
  },
  emptyScopes: {
    documentId: 'knowledge-document-customer-a-empty-scopes-001',
    chunkId: 'knowledge-chunk-customer-a-empty-scopes-001',
    marker: 'EMPTY_SCOPES_ALLOWED_RULE'
  },
  invalidLegacy: {
    documentId: 'knowledge-document-customer-a-legacy-policy-001',
    chunkId: 'knowledge-chunk-customer-a-legacy-policy-001',
    marker: 'LEGACY_INVALID_POLICY_RULE'
  },
  sessions: {
    alternateOrganization: 'session-customer-a-alt-org-001',
    alternateHostApp: 'session-customer-a-alt-host-app-001'
  }
});

/**
 * Adds deterministic Phase 5 fixture rows only. It does not apply any
 * Customer, organization, HostApp, or permission filtering; the production
 * query remains solely responsible for those decisions.
 */
export function installPhase5CustomerRagFixtures(state: Us1TestState): void {
  const createdAt = new Date('2026-08-05T00:00:00.000Z');
  state.sessions.push(
    {
      id: PHASE5_RAG_FIXTURE_IDS.sessions.alternateOrganization,
      customerId: 'customer-a',
      organizationId: 'org-customer-a-alt',
      hostApp: 'erp',
      actorId: 'actor-shared',
      status: AssistantSessionStatus.active,
      createdAt,
      updatedAt: createdAt,
      lastMessageAt: null
    },
    {
      id: PHASE5_RAG_FIXTURE_IDS.sessions.alternateHostApp,
      customerId: 'customer-a',
      organizationId: 'org-shared',
      hostApp: 'warehouse',
      actorId: 'actor-shared',
      status: AssistantSessionStatus.active,
      createdAt,
      updatedAt: createdAt,
      lastMessageAt: null
    }
  );

  const documents = [
    documentFixture(PHASE5_RAG_FIXTURE_IDS.customerWide.documentId, 'Customer-wide Policy Guide', 'customer-wide-policy', KnowledgeVisibility.CUSTOMER, [], [], 'customerWide'),
    documentFixture(PHASE5_RAG_FIXTURE_IDS.organizationOnly.documentId, 'Organization Policy Guide', 'organization-policy', KnowledgeVisibility.ORGANIZATION, ['org-shared'], [], 'organizationOnly'),
    documentFixture(PHASE5_RAG_FIXTURE_IDS.allScopes.documentId, 'All Scopes Policy Guide', 'all-scopes-policy', KnowledgeVisibility.CUSTOMER, [], ['orders:read', 'returns:read'], 'allScopes'),
    documentFixture(PHASE5_RAG_FIXTURE_IDS.emptyScopes.documentId, 'Empty Scopes Policy Guide', 'empty-scopes-policy', KnowledgeVisibility.CUSTOMER, [], [], 'emptyScopes'),
    documentFixture(PHASE5_RAG_FIXTURE_IDS.invalidLegacy.documentId, 'Legacy Invalid Policy Guide', 'legacy-invalid-policy', 'LEGACY_UNKNOWN', ['org-shared'], ['orders:read'], 'invalidLegacy')
  ];
  state.knowledgeDocuments.push(...documents);

  state.knowledgeChunks.push(
    chunkFixture(PHASE5_RAG_FIXTURE_IDS.customerWide.chunkId, PHASE5_RAG_FIXTURE_IDS.customerWide.documentId, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.customerWide.marker}`, 'customerWide'),
    chunkFixture(PHASE5_RAG_FIXTURE_IDS.organizationOnly.chunkId, PHASE5_RAG_FIXTURE_IDS.organizationOnly.documentId, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.organizationOnly.marker}`, 'organizationOnly'),
    chunkFixture(PHASE5_RAG_FIXTURE_IDS.allScopes.chunkId, PHASE5_RAG_FIXTURE_IDS.allScopes.documentId, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.allScopes.marker}`, 'allScopes'),
    chunkFixture(PHASE5_RAG_FIXTURE_IDS.emptyScopes.chunkId, PHASE5_RAG_FIXTURE_IDS.emptyScopes.documentId, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.emptyScopes.marker}`, 'emptyScopes'),
    chunkFixture(PHASE5_RAG_FIXTURE_IDS.invalidLegacy.chunkId, PHASE5_RAG_FIXTURE_IDS.invalidLegacy.documentId, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.invalidLegacy.marker}`, 'invalidLegacy')
  );
}

function documentFixture(
  id: string,
  title: string,
  sourceKey: string,
  visibility: KnowledgeVisibility | 'LEGACY_UNKNOWN',
  organizationIds: string[],
  requiredPermissionScopes: string[],
  fixture: string
) {
  const createdAt = new Date('2026-08-05T00:00:00.000Z');
  return {
    id,
    customerId: 'customer-a',
    title,
    sourceType: KnowledgeSourceType.sop,
    sourceKey,
    version: '1.0.0',
    language: 'en',
    status: KnowledgeDocumentStatus.active,
    visibility,
    organizationIds,
    requiredPermissionScopes,
    metadata: { fixture },
    createdAt,
    updatedAt: createdAt
  };
}

function chunkFixture(id: string, documentId: string, content: string, fixture: string) {
  const createdAt = new Date('2026-08-05T00:00:00.000Z');
  return {
    id,
    customerId: 'customer-a',
    documentId,
    chunkIndex: 0,
    heading: 'Phase 5 RAG policy fixture',
    content,
    tokenCount: content.split(/\s+/).length,
    metadata: { fixture },
    embeddingRef: null,
    vectorId: null,
    enabled: true,
    createdAt,
    updatedAt: createdAt
  };
}
