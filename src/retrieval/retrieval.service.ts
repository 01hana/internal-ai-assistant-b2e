import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { EvidenceSourceType, KnowledgeDocumentStatus, NoAnswerReason, RetrievalStrategy } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { CustomerScope } from '../identity/customer-scope.types';
import { PrismaService } from '../prisma/prisma.service';
import { DeterministicRetrievalProvider } from './deterministic-retrieval.provider';
import { RetrievalCandidate } from './retrieval-provider.interface';

const SELECTED_SCORE_THRESHOLD = 0.35;
const DEFAULT_SELECTED_LIMIT = 2;

export interface RunDocumentRetrievalInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  customerScope: CustomerScope;
  query: string;
  normalizedQuery?: string;
  limit?: number;
}

export interface PersistedRetrievalCandidate {
  id: string;
  retrievalRunId: string;
  chunkId?: string;
  sourceId: string;
  sourceType: EvidenceSourceType;
  score: number;
  rank: number;
  selected: boolean;
  reason?: string;
  title?: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface DocumentRetrievalResult {
  retrievalRunId: string;
  provider: string;
  candidates: PersistedRetrievalCandidate[];
  selectedCandidates: PersistedRetrievalCandidate[];
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly provider: DeterministicRetrievalProvider,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async runDocumentRetrieval(input: RunDocumentRetrievalInput): Promise<DocumentRetrievalResult> {
    const startedAt = Date.now();
    await this.assertVisibleSourceMessage(input.customerScope, input.sessionId, input.messageId);
    const providerResult = await this.provider.retrieve({
      requestId: input.requestId,
      customerScope: input.customerScope,
      query: input.query,
      limit: input.limit
    });
    const selectedLimit = input.limit ?? DEFAULT_SELECTED_LIMIT;
    const candidates = providerResult.candidates.map((candidate, index) => ({
      candidate,
      rank: index + 1,
      selected: candidate.score >= SELECTED_SCORE_THRESHOLD && index < selectedLimit
    }));
    const selectedCandidates = candidates.filter((candidate) => candidate.selected);
    await this.assertCandidateParents(input.customerScope, candidates.map((item) => item.candidate));

    const retrievalRun = await this.prisma.db.retrievalRun.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        messageId: input.messageId,
        query: input.query,
        normalizedQuery: input.normalizedQuery ?? input.query,
        filters: toJsonInput({
          sourceType: 'document_chunk'
        }),
        strategy: RetrievalStrategy.keyword,
        selectedEvidenceRefIds: [],
        noAnswerReason: selectedCandidates.length === 0 ? NoAnswerReason.no_evidence : undefined,
        durationMs: Math.max(0, Date.now() - startedAt)
      }
    });

    const persistedCandidates: PersistedRetrievalCandidate[] = [];
    for (const { candidate, rank, selected } of candidates) {
      const metadata = toRecord(candidate.metadata);
      const record = await this.prisma.db.retrievalCandidate.create({
        data: {
          customerId: input.customerScope.customerId,
          retrievalRunId: retrievalRun.id,
          chunkId: stringOrNull(metadata.chunkId),
          sourceId: candidate.sourceId,
          sourceType: EvidenceSourceType.document_chunk,
          score: candidate.score,
          rank,
          selected,
          reason: selected ? 'keyword_score_above_threshold' : 'below_threshold'
        }
      });

      persistedCandidates.push({
        id: record.id,
        retrievalRunId: record.retrievalRunId,
        chunkId: record.chunkId ?? undefined,
        sourceId: record.sourceId,
        sourceType: record.sourceType,
        score: record.score,
        rank: record.rank,
        selected: record.selected,
        reason: record.reason ?? undefined,
        title: candidate.title,
        content: candidate.content,
        metadata
      });
    }

    await this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'retrieval_run_created',
      metadata: toJsonInput({
        retrievalRunId: retrievalRun.id,
        provider: providerResult.provider,
        candidateCount: persistedCandidates.length,
        selectedChunkIds: persistedCandidates.filter((candidate) => candidate.selected).map((candidate) => candidate.chunkId),
        selectedDocumentIds: persistedCandidates
          .filter((candidate) => candidate.selected)
          .map((candidate) => stringOrNull(candidate.metadata.documentId))
          .filter(Boolean),
        durationMs: retrievalRun.durationMs
      })
    });

    for (const candidate of persistedCandidates.filter((item) => item.selected)) {
      await this.auditWriter.append({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        eventType: 'retrieval_candidate_selected',
        metadata: toJsonInput({
          retrievalRunId: retrievalRun.id,
          retrievalCandidateId: candidate.id,
          chunkId: candidate.chunkId,
          documentId: stringOrNull(candidate.metadata.documentId),
          sourceKey: stringOrNull(candidate.metadata.sourceKey),
          score: candidate.score,
          rank: candidate.rank
        })
      });
    }

    return {
      retrievalRunId: retrievalRun.id,
      provider: providerResult.provider,
      candidates: persistedCandidates,
      selectedCandidates: persistedCandidates.filter((candidate) => candidate.selected)
    };
  }

  async markSelectedEvidence(input: { customerScope: CustomerScope; retrievalRunId: string; evidenceRefIds: string[] }) {
    const evidenceRefIds = normalizeUniqueIds(input.evidenceRefIds);
    const retrievalRun = await this.prisma.db.retrievalRun.findFirst({
      where: {
        customerId: input.customerScope.customerId,
        id: input.retrievalRunId
      }
    });
    if (!retrievalRun) {
      throw this.createNotFoundError();
    }

    if (evidenceRefIds.length > 0) {
      const evidenceRefs = await this.prisma.db.evidenceRef.findMany({
        where: {
          customerId: input.customerScope.customerId,
          messageId: retrievalRun.messageId ?? '__no_visible_message__',
          id: { in: evidenceRefIds }
        }
      });
      if (evidenceRefs.length !== evidenceRefIds.length) {
        throw this.createNotFoundError();
      }
    }

    const result = await this.prisma.db.retrievalRun.updateMany({
      where: {
        customerId: input.customerScope.customerId,
        id: retrievalRun.id
      },
      data: {
        selectedEvidenceRefIds: evidenceRefIds
      }
    });
    if (result.count !== 1) {
      throw this.createNotFoundError();
    }
  }

  private async assertVisibleSourceMessage(customerScope: CustomerScope, sessionId: string, messageId: string): Promise<void> {
    const message = await this.prisma.db.assistantMessage.findFirst({
      where: {
        customerId: customerScope.customerId,
        id: messageId,
        sessionId
      }
    });
    if (!message) {
      throw this.createNotFoundError();
    }
  }

  private async assertCandidateParents(customerScope: CustomerScope, candidates: RetrievalCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      const metadata = toRecord(candidate.metadata);
      const documentId = stringOrNull(metadata.documentId);
      const chunkId = stringOrNull(metadata.chunkId);
      if (!documentId || !chunkId || candidate.sourceId !== chunkId) {
        throw this.createNotFoundError();
      }

      const [document, chunk] = await Promise.all([
        this.prisma.db.knowledgeDocument.findFirst({
          where: {
            customerId: customerScope.customerId,
            id: documentId,
            status: KnowledgeDocumentStatus.active
          }
        }),
        this.prisma.db.knowledgeChunk.findFirst({
          where: {
            customerId: customerScope.customerId,
            id: chunkId,
            documentId,
            enabled: true
          }
        })
      ]);
      if (!document || !chunk) {
        throw this.createNotFoundError();
      }
    }
  }

  private createNotFoundError(): NotFoundException {
    return new NotFoundException({
      error: 'NOT_FOUND',
      message: 'Retrieval resource not found.'
    });
  }
}

function normalizeUniqueIds(value: string[]): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.trim().length === 0)) {
    throw new NotFoundException({ error: 'NOT_FOUND', message: 'Retrieval resource not found.' });
  }
  const normalized = value.map((id) => id.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new NotFoundException({ error: 'NOT_FOUND', message: 'Retrieval resource not found.' });
  }
  return normalized;
}

function toRecord(value: RetrievalCandidate['metadata']): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
