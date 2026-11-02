import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { Prisma, ToolCall } from '../../generated/prisma/client';
import { RiskLevel, ToolCallStatus, ToolExecutionStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BlockToolCallInput,
  CompletedToolCallResult,
  CompleteToolCallInput,
  CreateToolCallInput,
  FailToolCallInput,
  StartToolCallInput,
  VisibleToolCallInput
} from './runtime.types';
import { SafeProjectedAdapterResult, SafeToolInputSummary } from '../../tools/tool-registry.types';

interface SafeToolOutputSummary {
  readonly canonicalToolKey: string;
  readonly schemaVersion: string;
  readonly fieldPaths: readonly string[];
  readonly fieldCount: number;
  readonly evidenceProvenanceFields: readonly string[];
}

@Injectable()
export class ToolCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async startToolCall(input: StartToolCallInput): Promise<{ toolCall: ToolCall }> {
    await this.assertCustomerParents(input);
    const toolCall = await this.prisma.db.toolCall.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? 'unknown',
        inputSummary: toJsonInput(createSafeToolInputSummary(input.safeInputSummary)),
        permissionResult: toJsonInput({
          scopes: input.identityContext.actor.permissionScopes,
          visibleFields: input.visibleFields
        }),
        outputSummary: toJsonInput({}),
        status: ToolCallStatus.pending,
        executionStatus: ToolExecutionStatus.in_progress,
        durationMs: null,
        executedAt: null
      }
    });

    await this.appendToolAudit(input, {
      eventType: 'tool_call_started',
      toolCallId: toolCall.id,
      metadata: {
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? 'unknown',
        riskLevel: input.riskLevel ?? RiskLevel.low,
        operation: 'read',
        visibleFieldCount: input.visibleFields.length
      }
    });

    return { toolCall };
  }

  async completeToolCall(input: CompleteToolCallInput): Promise<{ toolCall: ToolCall }> {
    const safeOutputSummary = createSafeToolOutputSummary(input.projectedResult);
    const toolCall = await this.transition(input, {
        outputSummary: toJsonInput(safeOutputSummary),
        status: ToolCallStatus.success,
        executionStatus: ToolExecutionStatus.executed,
        durationMs: input.durationMs ?? 1,
        executedAt: new Date()
    });

    await this.appendToolAudit(input, {
      eventType: 'tool_call_completed',
      toolCallId: toolCall.id,
      durationMs: input.durationMs ?? 1,
      metadata: {
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? 'unknown',
        riskLevel: input.riskLevel ?? RiskLevel.low,
        operation: 'read',
        durationMs: input.durationMs ?? 1,
        visibleFieldCount: input.visibleFields.length,
        outputFieldCount: safeOutputSummary.fieldCount
      }
    });

    return { toolCall };
  }

  async failToolCall(input: FailToolCallInput): Promise<{ toolCall: ToolCall }> {
    const toolCall = await this.transition(input, {
        outputSummary: toJsonInput({}),
        status: ToolCallStatus.failed,
        executionStatus: ToolExecutionStatus.failed,
        durationMs: input.durationMs ?? 1,
        errorCode: input.errorCode,
        executedAt: new Date()
    });

    await this.appendToolAudit(input, {
      eventType: 'tool_call_failed',
      toolCallId: toolCall.id,
      durationMs: input.durationMs ?? 1,
      metadata: {
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? 'unknown',
        riskLevel: input.riskLevel ?? RiskLevel.low,
        operation: 'read',
        errorCode: input.errorCode,
        durationMs: input.durationMs ?? 1
      }
    });

    return { toolCall };
  }

  async blockToolCall(input: BlockToolCallInput): Promise<{ toolCall: ToolCall }> {
    await this.assertCustomerParents(input);
    const toolCall = await this.prisma.db.toolCall.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? 'unknown',
        inputSummary: toJsonInput({
          entityId: input.entityId,
          visibleFieldCount: input.visibleFields.length
        }),
        permissionResult: toJsonInput({
          deniedReason: input.deniedReason,
          visibleFields: input.visibleFields
        }),
        outputSummary: toJsonInput({}),
        status: ToolCallStatus.blocked,
        executionStatus: ToolExecutionStatus.not_started,
        durationMs: 0,
        errorCode: input.deniedReason,
        executedAt: null
      }
    });

    await this.appendToolAudit(input, {
      eventType: 'tool_call_blocked',
      toolCallId: toolCall.id,
      metadata: {
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? 'unknown',
        riskLevel: input.riskLevel ?? RiskLevel.low,
        operation: 'read',
        deniedReason: input.deniedReason,
        visibleFieldCount: input.visibleFields.length
      }
    });

    return { toolCall };
  }

  async createCompletedToolCall(input: CreateToolCallInput): Promise<CompletedToolCallResult> {
    const { toolCall: startedToolCall } = await this.startToolCall(input);
    const { toolCall } = await this.completeToolCall({
      ...input,
      toolCallId: startedToolCall.id,
      projectedResult: input.projectedResult
    });

    return { toolCall };
  }

  async getVisibleToolCall(input: VisibleToolCallInput): Promise<ToolCall> {
    await this.assertVisibleSession(input);
    const where = this.visibleToolCallWhere(input);
    const toolCall = await this.prisma.db.toolCall.findFirst({ where });
    if (!toolCall || toolCall.customerId !== input.customerScope.customerId) {
      throw new NotFoundException({ error: 'NOT_FOUND', message: 'Tool call not found.' });
    }
    return toolCall;
  }

  private async appendToolAudit(
    input: StartToolCallInput | CompleteToolCallInput | FailToolCallInput | BlockToolCallInput,
    event: {
      eventType: string;
      toolCallId: string;
      durationMs?: number;
      metadata: Record<string, unknown>;
    }
  ) {
    await this.auditWriter.appendCustomerToolEvent({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      toolCallId: event.toolCallId,
      eventType: event.eventType,
      riskLevel: input.riskLevel,
      durationMs: event.durationMs,
      metadata: toJsonInput(event.metadata)
    });
  }

  private async assertCustomerParents(input: StartToolCallInput | BlockToolCallInput): Promise<void> {
    await this.assertVisibleSession(input);
    const scope = input.customerScope;
    const message = await this.prisma.db.assistantMessage.findFirst({ where: { customerId: scope.customerId, id: input.messageId, sessionId: input.sessionId } });
    if (!message) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Tool call context not found.' });
  }

  private async assertVisibleSession(input: Pick<VisibleToolCallInput, 'customerScope' | 'sessionId'>): Promise<void> {
    const scope = input.customerScope;
    const session = await this.prisma.db.assistantSession.findFirst({ where: {
      customerId: scope.customerId, integrationId: scope.integrationId, id: input.sessionId,
      organizationId: scope.organizationId, hostApp: scope.hostApp, actorId: scope.actorId
    } });
    if (!session) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Tool call context not found.' });
  }

  private async transition(input: CompleteToolCallInput | FailToolCallInput, data: Prisma.ToolCallUpdateManyMutationInput): Promise<ToolCall> {
    const where = this.visibleToolCallWhere(input);
    await this.getVisibleToolCall(input);
    const updated = await this.prisma.db.toolCall.updateMany({ where, data });
    if (updated.count !== 1) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Tool call not found.' });
    const toolCall = await this.prisma.db.toolCall.findFirst({ where });
    if (!toolCall || toolCall.customerId !== input.customerScope.customerId) throw new NotFoundException({ error: 'NOT_FOUND', message: 'Tool call not found.' });
    return toolCall;
  }

  private visibleToolCallWhere(input: VisibleToolCallInput) {
    return {
      customerId: input.customerScope.customerId,
      id: input.toolCallId,
      sessionId: input.sessionId,
      messageId: input.messageId
    };
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function createSafeToolInputSummary(summary: SafeToolInputSummary): SafeToolInputSummary {
  return Object.freeze({
    canonicalToolKey: summary.canonicalToolKey,
    schemaVersion: summary.schemaVersion,
    argumentKeys: Object.freeze([...new Set(summary.argumentKeys)].sort()),
    argumentCount: summary.argumentCount
  });
}

function createSafeToolOutputSummary(projectedResult: SafeProjectedAdapterResult): SafeToolOutputSummary {
  if (projectedResult.kind !== 'safe_projected_adapter_result') {
    throw new Error('Invalid safe projected adapter result.');
  }

  const fieldPaths = Object.freeze([...new Set(projectedResult.fieldPaths)].sort());
  const evidenceProvenanceFields = Object.freeze(Object.keys(projectedResult.evidenceProvenance).sort());
  return Object.freeze({
    canonicalToolKey: projectedResult.canonicalToolKey,
    schemaVersion: projectedResult.schemaVersion,
    fieldPaths,
    fieldCount: fieldPaths.length,
    evidenceProvenanceFields
  });
}
