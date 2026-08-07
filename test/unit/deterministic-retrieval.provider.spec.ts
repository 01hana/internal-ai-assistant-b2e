import { KnowledgeDocumentStatus } from '../../src/generated/prisma/enums';
import { CustomerScope } from '../../src/identity/customer-scope.types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { DeterministicRetrievalProvider } from '../../src/retrieval/deterministic-retrieval.provider';
import { installPhase5CustomerRagFixtures, PHASE5_RAG_FIXTURE_IDS } from '../support/customer-rag-phase5-fixtures';
import { createUs1PrismaMockForTest, createUs1TestStateForTest } from '../support/us1-test-app.helper';

describe('deterministic retrieval provider', () => {
  it('passes only Customer-qualified, authorized rows to candidate materialization and ranking', async () => {
    const queryRaw = jest.fn(async () => [
      {
        id: 'chunk-owned',
        customerId: 'customer-a',
        documentId: 'document-owned',
        chunkIndex: 0,
        heading: 'Return SOP',
        content: 'shared return SOP policy for orders',
        title: 'Customer A return SOP',
        sourceKey: 'return-sop'
      }
    ]);
    const provider = new DeterministicRetrievalProvider({ db: { $queryRaw: queryRaw } } as unknown as PrismaService);

    const result = await provider.retrieve({
      requestId: 'req-retrieval-policy',
      customerScope: customerScope(),
      query: 'return SOP',
      limit: 2
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({ sourceId: 'chunk-owned', title: 'Customer A return SOP' })
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(1);

    const [query, customerId, repeatedCustomerId, status, organizationId, permissionScopes] = queryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      string,
      string,
      KnowledgeDocumentStatus,
      string,
      string[]
    ];
    expect(query.join('')).toContain('FROM "KnowledgeChunk" AS chunk');
    expect(query.join('')).toContain('document."requiredPermissionScopes" <@');
    expect(query.join('')).toContain('document."visibility"');
    expect(query.join('')).not.toContain('hostApp');
    expect(customerId).toBe('customer-a');
    expect(repeatedCustomerId).toBe('customer-a');
    expect(status).toBe(KnowledgeDocumentStatus.active);
    expect(organizationId).toBe('org-shared');
    expect(permissionScopes).toEqual(['orders:read', 'returns:read']);
  });

  it('keeps Customer, visibility, ALL-scope, and invalid-policy rows out before candidates materialize', async () => {
    const state = createUs1TestStateForTest();
    installPhase5CustomerRagFixtures(state);
    const prisma = createUs1PrismaMockForTest(state);
    const provider = new DeterministicRetrievalProvider({ db: prisma } as unknown as PrismaService);

    const alternateOrganization = await provider.retrieve({
      requestId: 'req-provider-alt-org',
      customerScope: customerScope({ organizationId: 'org-customer-a-alt' }),
      query: 'shared return SOP policy',
      limit: 10
    });
    expect(alternateOrganization.candidates.map((candidate) => candidate.sourceId)).toContain(PHASE5_RAG_FIXTURE_IDS.customerWide.chunkId);
    expect(alternateOrganization.candidates.map((candidate) => candidate.sourceId)).not.toContain(PHASE5_RAG_FIXTURE_IDS.organizationOnly.chunkId);

    const missingRequiredScope = await provider.retrieve({
      requestId: 'req-provider-missing-scope',
      customerScope: customerScope({ permissionScopes: ['orders:read'] }),
      query: `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.allScopes.marker}`,
      limit: 10
    });
    expect(missingRequiredScope.candidates.map((candidate) => candidate.sourceId)).not.toContain(PHASE5_RAG_FIXTURE_IDS.allScopes.chunkId);

    const invalidPolicy = await provider.retrieve({
      requestId: 'req-provider-invalid-policy',
      customerScope: customerScope(),
      query: `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.invalidLegacy.marker}`,
      limit: 10
    });
    expect(invalidPolicy.candidates.map((candidate) => candidate.sourceId)).not.toContain(PHASE5_RAG_FIXTURE_IDS.invalidLegacy.chunkId);
  });
});

function customerScope(overrides: Partial<Pick<CustomerScope, 'organizationId' | 'permissionScopes'>> = {}): CustomerScope {
  return Object.freeze({
    customerId: 'customer-a',
    integrationId: 'integration-a',
    organizationId: overrides.organizationId ?? 'org-shared',
    hostApp: 'erp',
    actorId: 'actor-shared',
    roles: Object.freeze(['planner']),
    permissionScopes: Object.freeze(overrides.permissionScopes ?? ['orders:read', 'returns:read'])
  }) as CustomerScope;
}
