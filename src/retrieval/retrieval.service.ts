import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { EvidenceSourceType, NoAnswerReason, RetrievalStrategy } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
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
    const providerResult = await this.provider.retrieve({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
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

    const retrievalRun = await this.prisma.db.retrievalRun.create({
      data: {
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
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
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
        requestId: input.requestId,
        organizationId: input.identityContext.company.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
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

  async markSelectedEvidence(input: { retrievalRunId: string; evidenceRefIds: string[] }) {
    await this.prisma.db.retrievalRun.update({
      where: { id: input.retrievalRunId },
      data: {
        selectedEvidenceRefIds: input.evidenceRefIds
      }
    });
  }
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
