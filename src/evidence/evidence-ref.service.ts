import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { EvidenceSourceType, KnowledgeDocumentStatus } from '../generated/prisma/enums';
import { CustomerScope } from '../identity/customer-scope.types';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { minimizeForLlmInput } from '../permissions/masking.util';
import { PrismaService } from '../prisma/prisma.service';

export interface StructuredEvidenceInput<TRecord extends Record<string, unknown>> {
  requestId: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  identityContext: RequestIdentityContext;
  customerScope: CustomerScope;
  entityType: string;
  entityId: string;
  record: TRecord;
  visibleFields: string[];
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

@Injectable()
export class EvidenceRefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async attachStructuredRecordEvidence<TRecord extends Record<string, unknown>>(
    input: StructuredEvidenceInput<TRecord>
  ): Promise<AttachedEvidence<Partial<TRecord>>> {
    await this.assertStructuredParents(input.customerScope, input);
    const sanitizedSummary = minimizeForLlmInput(input.record, input.visibleFields);
    const evidenceRef = await this.prisma.db.evidenceRef.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        messageId: input.messageId,
        sourceType: EvidenceSourceType.structured_record,
        sourceId: input.entityId,
        toolCallId: input.toolCallId,
        entityType: input.entityType,
        entityId: input.entityId,
        fieldPaths: input.visibleFields,
        permissionSnapshot: toJsonInput({
          visibleFields: input.visibleFields
        }),
        summary: toJsonInput({
          fields: sanitizedSummary
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
        fieldCount: input.visibleFields.length
      })
    });

    return {
      id: evidenceRef.id,
      sourceType: evidenceRef.sourceType,
      sourceId: evidenceRef.sourceId,
      entityType: evidenceRef.entityType ?? undefined,
      entityId: evidenceRef.entityId ?? undefined,
      fieldPaths: evidenceRef.fieldPaths,
      summary: sanitizedSummary
    };
  }

  async attachDocumentChunkEvidence(
    input: DocumentChunkEvidenceInput
  ): Promise<AttachedEvidence<Record<string, unknown>>> {
    const { document, chunk, candidate } = await this.assertDocumentParents(input.customerScope, input);
    const snippet = toBoundedSnippet(chunk.content);
    const summary = {
      documentTitle: document.title,
      sourceKey: document.sourceKey,
      heading: chunk.heading,
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
      summary
    };
  }

  private async assertStructuredParents<TRecord extends Record<string, unknown>>(
    customerScope: CustomerScope,
    input: StructuredEvidenceInput<TRecord>
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

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toBoundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
}
