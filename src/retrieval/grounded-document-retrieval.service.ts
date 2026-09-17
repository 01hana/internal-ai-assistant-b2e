import { Injectable } from '@nestjs/common';
import type { ConversationSemanticFrame } from '../assistant/conversation/conversation.types';
import type { GroundedCitation, GroundedDocumentEvidence } from '../assistant/grounding/grounded-context-bundle.types';
import { EvidenceRefService, AttachedDocumentEvidence } from '../evidence/evidence-ref.service';
import { CustomerScope } from '../identity/customer-scope.types';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { DocumentEvidenceSourceGuard } from './document-evidence-source-guard';
import {
  GroundedDocumentEvidenceNormalizationError,
  GroundedDocumentEvidenceNormalizer
} from './grounded-document-evidence.normalizer';
import { GroundedRetrievalAuditService } from './grounded-retrieval-audit.service';
import {
  DocumentRetrievalNeed,
  GroundedRetrievalNeedResult,
  MAX_DOCUMENT_CHUNKS_PER_NEED
} from './grounded-retrieval.types';
import { PersistedRetrievalCandidate, RetrievalService } from './retrieval.service';

export interface GroundedDocumentRetrievalInput {
  readonly requestId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly identityContext: RequestIdentityContext;
  readonly customerScope: CustomerScope;
  readonly need: DocumentRetrievalNeed;
  readonly resolvedFrame?: ConversationSemanticFrame;
}

export interface GroundedDocumentRetrievalResult {
  readonly retrievalRunId?: string;
  readonly provider?: string;
  readonly needResult: GroundedRetrievalNeedResult;
  readonly evidence: readonly GroundedDocumentEvidence[];
  readonly citations: readonly GroundedCitation[];
}

@Injectable()
export class GroundedDocumentRetrievalService {
  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly evidenceRefService: EvidenceRefService,
    private readonly sourceGuard: DocumentEvidenceSourceGuard,
    private readonly normalizer: GroundedDocumentEvidenceNormalizer,
    private readonly audit: GroundedRetrievalAuditService
  ) {}

  async execute(input: GroundedDocumentRetrievalInput): Promise<GroundedDocumentRetrievalResult> {
    const startedAt = Date.now();
    let retrievalRunId: string | undefined;
    let provider: string | undefined;
    let candidateCount = 0;
    let selectedCount = 0;
    try {
      const retrieval = await this.retrievalService.runDocumentRetrieval({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        identityContext: input.identityContext,
        customerScope: input.customerScope,
        query: buildEffectiveDocumentQuery(input),
        limit: MAX_DOCUMENT_CHUNKS_PER_NEED
      });
      retrievalRunId = retrieval.retrievalRunId;
      provider = retrieval.provider;
      candidateCount = retrieval.candidates.length;
      selectedCount = retrieval.selectedCandidates.length;

      if (selectedCount === 0) {
        return this.complete(input, startedAt, candidateCount, selectedCount, {
          retrievalRunId, provider,
          needResult: needResult(input.need.id, 'UNSUPPORTED', [], 'DOCUMENT_EVIDENCE_NOT_FOUND'),
          evidence: Object.freeze([]), citations: Object.freeze([])
        });
      }

      for (const candidate of retrieval.selectedCandidates) this.assertSelectedSource(candidate);

      const attached: AttachedDocumentEvidence[] = [];
      for (const candidate of retrieval.selectedCandidates) {
        const documentId = requiredMetadataText(candidate, 'documentId');
        if (!candidate.chunkId) throw new GroundedDocumentEvidenceNormalizationError('DOCUMENT_EVIDENCE_PROVENANCE_INVALID');
        attached.push(await this.evidenceRefService.attachDocumentChunkEvidence({
          requestId: input.requestId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          identityContext: input.identityContext,
          customerScope: input.customerScope,
          retrievalRunId,
          retrievalCandidateId: candidate.id,
          documentId,
          chunkId: candidate.chunkId
        }));
      }

      const evidence = this.normalizer.normalize({
        needId: input.need.id,
        chunks: attached.map((item) => ({
          evidenceRefId: item.id,
          documentId: item.documentId,
          chunkId: item.chunkId,
          documentVersion: item.summary.documentVersion,
          sourceKey: item.summary.sourceKey,
          sourceOrder: item.summary.rank,
          title: item.summary.documentTitle,
          content: item.summary.snippet,
          observedAt: item.observedAt
        }))
      });
      const citations = this.normalizer.createCitations(evidence);
      await this.retrievalService.markSelectedEvidence({
        customerScope: input.customerScope,
        retrievalRunId,
        evidenceRefIds: evidence.map((item) => item.evidenceRefId)
      });
      return this.complete(input, startedAt, candidateCount, selectedCount, {
        retrievalRunId, provider,
        needResult: needResult(input.need.id, 'COVERED', evidence.map((item) => item.evidenceRefId)),
        evidence, citations
      });
    } catch (error) {
      const reasonCode = error instanceof GroundedDocumentEvidenceNormalizationError
        ? error.reasonCode
        : 'DOCUMENT_RETRIEVAL_FAILED';
      return this.complete(input, startedAt, candidateCount, selectedCount, {
        ...(retrievalRunId ? { retrievalRunId } : {}),
        ...(provider ? { provider } : {}),
        needResult: needResult(input.need.id, 'FAILED', [], reasonCode),
        evidence: Object.freeze([]), citations: Object.freeze([])
      });
    }
  }

  private assertSelectedSource(candidate: PersistedRetrievalCandidate): void {
    const documentId = requiredMetadataText(candidate, 'documentId');
    const sourceKey = requiredMetadataText(candidate, 'sourceKey');
    const heading = candidate.metadata.heading;
    if (!candidate.chunkId || !candidate.title || (heading !== null && heading !== undefined && (typeof heading !== 'string' || heading.length > 256)) ||
      !Number.isFinite(candidate.score) || !Number.isSafeInteger(candidate.rank) || candidate.rank < 1) {
      throw new GroundedDocumentEvidenceNormalizationError('DOCUMENT_EVIDENCE_PROVENANCE_INVALID');
    }
    const result = this.sourceGuard.inspect({
      title: candidate.title,
      content: candidate.content,
      metadata: { ...candidate.metadata, documentId, chunkId: candidate.chunkId, sourceKey, heading: heading ?? null, score: candidate.score, rank: candidate.rank }
    });
    if (!result.accepted) throw new GroundedDocumentEvidenceNormalizationError('DOCUMENT_EVIDENCE_SOURCE_REJECTED');
  }

  private async complete(
    input: GroundedDocumentRetrievalInput,
    startedAt: number,
    candidateCount: number,
    selectedCount: number,
    result: GroundedDocumentRetrievalResult
  ): Promise<GroundedDocumentRetrievalResult> {
    const frozen = deepFreeze({ ...result });
    await this.audit.recordDocumentLane({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      durationMs: Math.max(0, Date.now() - startedAt),
      result: frozen.needResult,
      candidateCount,
      selectedCount,
      citationCount: frozen.citations.length
    });
    return frozen;
  }
}

const SEMANTIC_QUERY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  travelSubsidyPolicy: '員工旅遊補助',
  policyOverview: '補助規定',
  applicationDeadline: '申請期限'
});

export function buildEffectiveDocumentQuery(input: Pick<GroundedDocumentRetrievalInput, 'need' | 'resolvedFrame'>): string {
  const frame = input.resolvedFrame;
  const values = [frame?.resource?.value, frame?.metricOrAspect?.value, frame?.timeRange?.value, frame?.entity?.value];
  if (!frame?.resource?.value && input.need.topicKey) values.push(input.need.topicKey);
  values.push(input.need.query);
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (typeof value !== 'string') return [];
    const normalized = (SEMANTIC_QUERY_LABELS[value] ?? value).replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > 512 || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  }).join(' ');
}

function requiredMetadataText(candidate: PersistedRetrievalCandidate, key: string): string {
  const value = candidate.metadata[key];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
    throw new GroundedDocumentEvidenceNormalizationError('DOCUMENT_EVIDENCE_PROVENANCE_INVALID');
  }
  return value;
}

function needResult(needId: string, status: GroundedRetrievalNeedResult['status'], evidenceRefIds: readonly string[], reasonCode?: string): GroundedRetrievalNeedResult {
  return deepFreeze({ needId, status, evidenceRefIds: Object.freeze([...evidenceRefIds]), ...(reasonCode ? { reasonCode } : {}) });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
