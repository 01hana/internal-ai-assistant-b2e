import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { RetrievalService } from '../../src/retrieval/retrieval.service';
import { DeterministicRetrievalProvider } from '../../src/retrieval/deterministic-retrieval.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { EvidenceSourceType } from '../../src/generated/prisma/enums';

describe('RetrievalService Customer persistence', () => {
  it('persists a Customer-owned run and candidate only after Customer-qualified parents validate', async () => {
    const createRun = jest.fn().mockResolvedValue({ id: 'run-a', durationMs: 1 });
    const createCandidate = jest.fn().mockResolvedValue({
      id: 'candidate-a', retrievalRunId: 'run-a', chunkId: 'chunk-a', sourceId: 'chunk-a',
      sourceType: EvidenceSourceType.document_chunk, score: 0.9, rank: 1, selected: true, reason: null
    });
    const service = createService({
      assistantMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'message-a' }) },
      knowledgeDocument: { findFirst: jest.fn().mockResolvedValue({ id: 'document-a' }) },
      knowledgeChunk: { findFirst: jest.fn().mockResolvedValue({ id: 'chunk-a' }) },
      retrievalRun: { create: createRun },
      retrievalCandidate: { create: createCandidate }
    });

    await service.runDocumentRetrieval({
      requestId: 'req-a', sessionId: 'session-a', messageId: 'message-a', identityContext: identityContext(),
      customerScope: customerScope(), query: 'return policy'
    });

    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: 'customer-a', messageId: 'message-a' }) }));
    expect(createCandidate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: 'customer-a', retrievalRunId: 'run-a', chunkId: 'chunk-a' }) }));
  });

  it('updates selected evidence only when run and every evidence ID are Customer-qualified to the run message', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findRun = jest.fn()
      .mockResolvedValueOnce({ id: 'run-a', customerId: 'customer-a', messageId: 'message-a' })
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'run-a', customerId: 'customer-a', messageId: 'message-a' });
    const findEvidence = jest.fn()
      .mockResolvedValueOnce([{ id: 'evidence-a', customerId: 'customer-a', messageId: 'message-a' }])
      .mockResolvedValue([]);
    const service = createService({
      retrievalRun: { findFirst: findRun, updateMany },
      evidenceRef: { findMany: findEvidence }
    });
    await service.markSelectedEvidence({ customerScope: customerScope(), retrievalRunId: 'run-a', evidenceRefIds: ['evidence-a'] });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'customer-a', id: 'run-a' } }));
    await expect(service.markSelectedEvidence({ customerScope: customerScope(), retrievalRunId: 'foreign-run', evidenceRefIds: [] })).rejects.toMatchObject({ status: 404 });
    await expect(service.markSelectedEvidence({ customerScope: customerScope(), retrievalRunId: 'run-a', evidenceRefIds: ['foreign-evidence'] })).rejects.toMatchObject({ status: 404 });
    await expect(service.markSelectedEvidence({ customerScope: customerScope(), retrievalRunId: 'run-a', evidenceRefIds: [' ', ' '] })).rejects.toMatchObject({ status: 404 });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

function createService(db: Record<string, unknown>) {
  const provider = {
    retrieve: jest.fn().mockResolvedValue({
      provider: 'deterministic',
      candidates: [{ sourceId: 'chunk-a', sourceType: 'document_chunk', title: 'Return SOP', content: 'Return policy', score: 0.9, metadata: { documentId: 'document-a', chunkId: 'chunk-a' } }]
    })
  } as unknown as DeterministicRetrievalProvider;
  return new RetrievalService(provider, { db } as unknown as PrismaService, { append: jest.fn() } as unknown as AuditWriterService);
}

function identityContext() {
  return { requestId: 'req-a', customer: { customerId: 'customer-a', integrationId: 'integration-a' }, organization: { organizationId: 'org-a' }, hostApp: { hostApp: 'erp' }, actor: { actorId: 'actor-a', roles: [], permissionScopes: [] }, auth: { tokenId: 'token-a', gatewayIssuer: 'https://gateway.test.internal' } };
}

function customerScope() { return createCustomerScopeFromIdentityContext(identityContext()); }
