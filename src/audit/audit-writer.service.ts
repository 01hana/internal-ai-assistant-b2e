import { Injectable } from '@nestjs/common';
import { redactSecrets } from '../common/logger/redaction.util';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppendAuditEventInput, AppendCustomerToolAuditInput, AppendCustomerWorkflowAuditInput, AuditEventRecord, AuditWriter } from './audit-writer.interface';

@Injectable()
export class AuditWriterService implements AuditWriter {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: AppendAuditEventInput): Promise<AuditEventRecord> {
    const event = await this.prisma.db.auditEvent.create({
      data: {
        requestId: input.requestId,
        organizationId: input.organizationId,
        hostApp: input.hostApp,
        actorId: input.actorId,
        eventType: input.eventType,
        sessionId: input.sessionId,
        messageId: input.messageId,
        decision: input.decision,
        toolCallId: input.toolCallId,
        riskLevel: input.riskLevel,
        permissionResult: input.permissionResult ? toJsonInput(redactSecrets(input.permissionResult)) : undefined,
        evidenceRefIds: input.evidenceRefIds ?? [],
        durationMs: input.durationMs,
        metadata: input.metadata ? toJsonInput(redactSecrets(input.metadata)) : undefined
      }
    });

    return {
      id: event.id,
      timestamp: event.timestamp,
      requestId: event.requestId,
      organizationId: event.organizationId,
      hostApp: event.hostApp,
      actorId: event.actorId,
      eventType: event.eventType,
      sessionId: event.sessionId ?? undefined,
      messageId: event.messageId ?? undefined,
      decision: event.decision ?? undefined,
      toolCallId: event.toolCallId ?? undefined,
      riskLevel: event.riskLevel ?? undefined,
      permissionResult: event.permissionResult as Prisma.InputJsonValue | undefined,
      evidenceRefIds: event.evidenceRefIds,
      durationMs: event.durationMs ?? undefined,
      metadata: event.metadata as Prisma.InputJsonValue | undefined
    };
  }

  async appendCustomerToolEvent(input: AppendCustomerToolAuditInput): Promise<AuditEventRecord> {
    const event = await this.prisma.db.auditEvent.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        organizationId: input.customerScope.organizationId,
        hostApp: input.customerScope.hostApp,
        actorId: input.customerScope.actorId,
        eventType: input.eventType,
        sessionId: input.sessionId,
        messageId: input.messageId,
        toolCallId: input.toolCallId,
        riskLevel: input.riskLevel,
        evidenceRefIds: [],
        durationMs: input.durationMs,
        metadata: input.metadata ? toJsonInput(redactSecrets(input.metadata)) : undefined
      }
    });
    return { id: event.id, timestamp: event.timestamp, requestId: event.requestId, organizationId: event.organizationId, hostApp: event.hostApp, actorId: event.actorId, eventType: event.eventType, sessionId: event.sessionId ?? undefined, messageId: event.messageId ?? undefined, toolCallId: event.toolCallId ?? undefined, riskLevel: event.riskLevel ?? undefined, evidenceRefIds: event.evidenceRefIds, durationMs: event.durationMs ?? undefined, metadata: event.metadata as Prisma.InputJsonValue | undefined };
  }

  async appendCustomerWorkflowEvent(
    input: AppendCustomerWorkflowAuditInput,
    database: Pick<Prisma.TransactionClient, 'assistantSession' | 'assistantMessage' | 'toolCall' | 'auditEvent'> = this.prisma.db
  ): Promise<AuditEventRecord> {
    const { customerScope } = input;
    if (input.sessionId) {
      const session = await database.assistantSession.findFirst({
        where: {
          customerId: customerScope.customerId,
          id: input.sessionId,
          organizationId: customerScope.organizationId,
          hostApp: customerScope.hostApp,
          actorId: customerScope.actorId
        }
      });
      if (!session) throw new Error('Customer workflow audit context not found.');
    }
    if (input.messageId) {
      const message = await database.assistantMessage.findFirst({
        where: {
          customerId: customerScope.customerId,
          id: input.messageId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {})
        }
      });
      if (!message) throw new Error('Customer workflow audit context not found.');
    }
    if (input.toolCallId) {
      const toolCall = await database.toolCall.findFirst({
        where: {
          customerId: customerScope.customerId,
          id: input.toolCallId,
          ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
          ...(input.messageId !== undefined ? { messageId: input.messageId } : {})
        }
      });
      if (!toolCall) throw new Error('Customer workflow audit context not found.');
    }

    const event = await database.auditEvent.create({
      data: {
        customerId: customerScope.customerId,
        requestId: input.requestId,
        organizationId: customerScope.organizationId,
        hostApp: customerScope.hostApp,
        actorId: customerScope.actorId,
        eventType: input.eventType,
        sessionId: input.sessionId,
        messageId: input.messageId,
        toolCallId: input.toolCallId,
        riskLevel: input.riskLevel,
        evidenceRefIds: [],
        metadata: input.metadata ? toJsonInput(redactSecrets(input.metadata)) : undefined
      }
    });
    return { id: event.id, timestamp: event.timestamp, requestId: event.requestId, organizationId: event.organizationId, hostApp: event.hostApp, actorId: event.actorId, eventType: event.eventType, sessionId: event.sessionId ?? undefined, messageId: event.messageId ?? undefined, toolCallId: event.toolCallId ?? undefined, riskLevel: event.riskLevel ?? undefined, evidenceRefIds: event.evidenceRefIds, metadata: event.metadata as Prisma.InputJsonValue | undefined };
  }
}

function toJsonInput(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return value;
}
