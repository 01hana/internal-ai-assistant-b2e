import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { EvidenceSourceType } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { minimizeForLlmInput } from '../permissions/masking.util';
import { PrismaService } from '../prisma/prisma.service';

export interface StructuredEvidenceInput<TRecord extends Record<string, unknown>> {
  requestId: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  identityContext: RequestIdentityContext;
  entityType: string;
  entityId: string;
  record: TRecord;
  visibleFields: string[];
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
    const sanitizedSummary = minimizeForLlmInput(input.record, input.visibleFields);
    const evidenceRef = await this.prisma.db.evidenceRef.create({
      data: {
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
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
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
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
