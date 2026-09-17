import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { EvidenceSourceType, KnowledgeDocumentStatus } from '../generated/prisma/enums';
import { CustomerScope } from '../identity/customer-scope.types';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { PrismaService } from '../prisma/prisma.service';
import { SafeProjectedAdapterResult, SafeProjectedScalar } from '../tools/tool-registry.types';

export interface StructuredEvidenceInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  customerScope: CustomerScope;
  projectedResult: SafeProjectedAdapterResult;
}

export interface DocumentChunkEvidenceInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  customerScope: CustomerScope;
  retrievalRunId: string;
  retrievalCandidateId: string;
  documentId: string;
  chunkId: string;
}

export interface AttachedEvidence<TSummary extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  sourceType: EvidenceSourceType;
  sourceId: string;
  entityType?: string;
  entityId?: string;
  fieldPaths: string[];
  summary: TSummary;
}

export type DocumentChunkEvidenceSummary = Readonly<{
  documentId: string;
  chunkId: string;
  documentVersion: string;
  sourceKey: string;
  documentTitle: string;
  heading: string | null;
  snippet: string;
  score: number;
  rank: number;
}> & Record<string, unknown>;

export interface AttachedDocumentEvidence extends AttachedEvidence<DocumentChunkEvidenceSummary> {
  readonly documentId: string;
  readonly chunkId: string;
  readonly observedAt: string;
}

@Injectable()
export class EvidenceRefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async attachStructuredRecordEvidence(
    input: StructuredEvidenceInput
  ): Promise<AttachedEvidence | undefined> {
    const provenance = firstUsableProvenance(input.projectedResult.evidenceProvenance);
    if (Object.keys(input.projectedResult.facts).length === 0 || !provenance) return undefined;
    await this.assertStructuredParents(input.customerScope, input);
    const summary = input.projectedResult.facts;
    const evidenceRef = await this.prisma.db.evidenceRef.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        messageId: input.messageId,
        sourceType: EvidenceSourceType.structured_record,
        sourceId: provenance.value,
        toolCallId: input.toolCallId,
        entityType: input.projectedResult.canonicalToolKey,
        entityId: provenance.value,
        fieldPaths: [...input.projectedResult.fieldPaths],
        permissionSnapshot: toJsonInput({
          provenanceFields: Object.keys(input.projectedResult.evidenceProvenance).sort()
        }),
        summary: toJsonInput({
          fields: summary
        })
      }
    });

    await this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      toolCallId: input.toolCallId,
      eventType: 'evidence_attached',
      evidenceRefIds: [evidenceRef.id],
      metadata: toJsonInput({
        evidenceRefId: evidenceRef.id,
        sourceType: evidenceRef.sourceType,
        entityType: evidenceRef.entityType,
        entityId: evidenceRef.entityId,
        fieldCount: input.projectedResult.fieldPaths.length,
        provenanceFieldCount: Object.keys(input.projectedResult.evidenceProvenance).length
      })
    });

    return {
      id: evidenceRef.id,
      sourceType: evidenceRef.sourceType,
      sourceId: evidenceRef.sourceId,
      entityType: evidenceRef.entityType ?? undefined,
      entityId: evidenceRef.entityId ?? undefined,
      fieldPaths: evidenceRef.fieldPaths,
      summary
    };
  }

  async attachDocumentChunkEvidence(
    input: DocumentChunkEvidenceInput
  ): Promise<AttachedDocumentEvidence> {
    const { document, chunk, candidate } = await this.assertDocumentParents(input.customerScope, input);
    const snippet = toBoundedSnippet(chunk.content);
    const summary: DocumentChunkEvidenceSummary = {
      documentId: document.id,
      chunkId: chunk.id,
      documentVersion: document.version,
      documentTitle: toBoundedText(document.title, 256),
      sourceKey: document.sourceKey,
      heading: chunk.heading ? toBoundedText(chunk.heading, 256) : null,
      snippet,
      score: candidate.score,
      rank: candidate.rank
    };
    const evidenceRef = await this.prisma.db.evidenceRef.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        messageId: input.messageId,
        sourceType: EvidenceSourceType.document_chunk,
        sourceId: input.chunkId,
        documentId: document.id,
        chunkId: chunk.id,
        fieldPaths: [],
        permissionSnapshot: toJsonInput({
          retrievalRunId: input.retrievalRunId,
          retrievalCandidateId: input.retrievalCandidateId
        }),
        summary: toJsonInput(summary)
      }
    });

    await this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'evidence_attached',
      evidenceRefIds: [evidenceRef.id],
      metadata: toJsonInput({
        evidenceRefId: evidenceRef.id,
        sourceType: evidenceRef.sourceType,
        documentId: document.id,
        chunkId: chunk.id,
        sourceKey: document.sourceKey,
        score: candidate.score,
        rank: candidate.rank
      })
    });

    return {
      id: evidenceRef.id,
      sourceType: evidenceRef.sourceType,
      sourceId: evidenceRef.sourceId,
      fieldPaths: evidenceRef.fieldPaths,
      summary,
      documentId: document.id,
      chunkId: chunk.id,
      observedAt: evidenceRef.timestamp.toISOString()
    };
  }

  private async assertStructuredParents(
    customerScope: CustomerScope,
    input: StructuredEvidenceInput
  ): Promise<void> {
    const [message, toolCall] = await Promise.all([
      this.prisma.db.assistantMessage.findFirst({
        where: { customerId: customerScope.customerId, id: input.messageId, sessionId: input.sessionId }
      }),
      this.prisma.db.toolCall.findFirst({
        where: {
          customerId: customerScope.customerId,
          id: input.toolCallId,
          sessionId: input.sessionId,
          messageId: input.messageId
        }
      })
    ]);
    if (!message || !toolCall) {
      throw this.createNotFoundError();
    }
  }

  private async assertDocumentParents(
    customerScope: CustomerScope,
    input: DocumentChunkEvidenceInput
  ) {
    const message = await this.prisma.db.assistantMessage.findFirst({
      where: { customerId: customerScope.customerId, id: input.messageId, sessionId: input.sessionId }
    });
    const retrievalRun = await this.prisma.db.retrievalRun.findFirst({
      where: { customerId: customerScope.customerId, id: input.retrievalRunId, messageId: input.messageId }
    });
    const candidate = await this.prisma.db.retrievalCandidate.findFirst({
      where: {
        customerId: customerScope.customerId,
        id: input.retrievalCandidateId,
        retrievalRunId: input.retrievalRunId,
        chunkId: input.chunkId,
        selected: true
      }
    });
    const [document, chunk] = await Promise.all([
      this.prisma.db.knowledgeDocument.findFirst({
        where: { customerId: customerScope.customerId, id: input.documentId, status: KnowledgeDocumentStatus.active }
      }),
      this.prisma.db.knowledgeChunk.findFirst({
        where: { customerId: customerScope.customerId, id: input.chunkId, documentId: input.documentId, enabled: true }
      })
    ]);
    if (!message || !retrievalRun || !candidate || !document || !chunk || candidate.sourceId !== chunk.id) {
      throw this.createNotFoundError();
    }
    return { document, chunk, candidate };
  }

  private createNotFoundError(): NotFoundException {
    return new NotFoundException({ error: 'NOT_FOUND', message: 'Evidence resource not found.' });
  }
}

function firstUsableProvenance(provenance: Readonly<Record<string, SafeProjectedScalar>>): { fieldPath: string; value: string } | undefined {
  for (const [fieldPath, value] of Object.entries(provenance)) {
    const normalized = value === null ? '' : String(value).trim();
    if (normalized.length > 0) return { fieldPath, value: normalized };
  }
  return undefined;
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toBoundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
}

function toBoundedText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}
