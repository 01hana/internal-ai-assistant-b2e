import { Injectable } from '@nestjs/common';
import type { GroundedCitation, GroundedDocumentEvidence } from '../assistant/grounding/grounded-context-bundle.types';
import { DocumentEvidenceSourceGuard } from './document-evidence-source-guard';
import { MAX_DOCUMENT_CHUNKS_PER_NEED } from './grounded-retrieval.types';

export interface GroundedDocumentEvidenceCandidate {
  readonly evidenceRefId: string;
  readonly documentId: string;
  readonly chunkId: string;
  readonly documentVersion: string;
  readonly sourceKey: string;
  readonly sourceOrder: number;
  readonly title: string;
  readonly content: string;
  readonly observedAt: string;
}

export class GroundedDocumentEvidenceNormalizationError extends Error {
  constructor(readonly reasonCode: 'DOCUMENT_EVIDENCE_PROVENANCE_INVALID' | 'DOCUMENT_EVIDENCE_SOURCE_REJECTED') {
    super(reasonCode === 'DOCUMENT_EVIDENCE_PROVENANCE_INVALID' ? 'Document evidence provenance is invalid or malformed.' : 'Document evidence source was rejected.');
    this.name = 'GroundedDocumentEvidenceNormalizationError';
  }
}

@Injectable()
export class GroundedDocumentEvidenceNormalizer {
  constructor(private readonly sourceGuard: DocumentEvidenceSourceGuard = new DocumentEvidenceSourceGuard()) {}

  normalize(input: Readonly<{ needId: string; chunks: readonly GroundedDocumentEvidenceCandidate[] }>): readonly GroundedDocumentEvidence[] {
    if (!isBoundedText(input.needId, 128) || !Array.isArray(input.chunks)) throw invalidProvenance();
    const validated = input.chunks.map((chunk) => this.validate(chunk));
    const selected = validated
      .sort((left, right) => left.sourceOrder - right.sourceOrder || left.documentId.localeCompare(right.documentId) || left.chunkId.localeCompare(right.chunkId) || left.evidenceRefId.localeCompare(right.evidenceRefId))
      .slice(0, MAX_DOCUMENT_CHUNKS_PER_NEED)
      .map((chunk) => deepFreeze<GroundedDocumentEvidence>({
        kind: 'DOCUMENT', evidenceRefId: chunk.evidenceRefId, needId: input.needId, content: chunk.content,
        title: chunk.title, documentId: chunk.documentId, chunkId: chunk.chunkId,
        documentVersion: chunk.documentVersion, sourceKey: chunk.sourceKey, observedAt: chunk.observedAt,
        trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE'
      }));
    return Object.freeze(selected);
  }

  createCitations(evidence: readonly GroundedDocumentEvidence[]): readonly GroundedCitation[] {
    return Object.freeze(evidence.map((item, index) => deepFreeze<GroundedCitation>({
      citationId: `citation-${item.needId}-${index + 1}`,
      evidenceRefId: item.evidenceRefId,
      needId: item.needId,
      sourceKind: 'DOCUMENT',
      safeLabel: item.title
    })));
  }

  private validate(chunk: GroundedDocumentEvidenceCandidate): GroundedDocumentEvidenceCandidate {
    if (!isPlainObject(chunk) || !isBoundedText(chunk.evidenceRefId, 256) || !isBoundedText(chunk.documentId, 256) ||
      !isBoundedText(chunk.chunkId, 256) || !isBoundedText(chunk.documentVersion, 256) || !isBoundedText(chunk.sourceKey, 512) ||
      !Number.isSafeInteger(chunk.sourceOrder) || chunk.sourceOrder < 0 || !isBoundedText(chunk.title, 256) ||
      !isBoundedText(chunk.content, 4000) || !validTimestamp(chunk.observedAt)) {
      throw invalidProvenance();
    }
    const guardResult = this.sourceGuard.inspect({
      title: chunk.title,
      content: chunk.content,
      metadata: { documentId: chunk.documentId, chunkId: chunk.chunkId, documentVersion: chunk.documentVersion, sourceKey: chunk.sourceKey }
    });
    if (!guardResult.accepted) throw new GroundedDocumentEvidenceNormalizationError('DOCUMENT_EVIDENCE_SOURCE_REJECTED');
    return { ...chunk };
  }
}

function invalidProvenance() { return new GroundedDocumentEvidenceNormalizationError('DOCUMENT_EVIDENCE_PROVENANCE_INVALID'); }
function isBoundedText(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function validTimestamp(value: unknown): value is string { return isBoundedText(value, 64) && Number.isFinite(Date.parse(value)); }
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
