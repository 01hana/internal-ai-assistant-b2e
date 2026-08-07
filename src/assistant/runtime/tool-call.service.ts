import { Injectable } from '@nestjs/common';
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
  StartToolCallInput
} from './runtime.types';

@Injectable()
export class ToolCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async startToolCall(input: StartToolCallInput): Promise<{ toolCall: ToolCall }> {
    const toolCall = await this.prisma.db.toolCall.create({
      data: {
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
    const toolCall = await this.prisma.db.toolCall.update({
      where: {
        id: input.toolCallId
      },
      data: {
        outputSummary: toJsonInput(input.sanitizedResult),
        status: ToolCallStatus.success,
        executionStatus: ToolExecutionStatus.executed,
        durationMs: input.durationMs ?? 1,
        executedAt: new Date()
      }
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
        outputFieldCount: Object.keys(input.sanitizedResult).length
      }
    });

    return { toolCall };
  }

  async failToolCall(input: FailToolCallInput): Promise<{ toolCall: ToolCall }> {
    const toolCall = await this.prisma.db.toolCall.update({
      where: {
        id: input.toolCallId
      },
      data: {
        outputSummary: toJsonInput({}),
        status: ToolCallStatus.failed,
        executionStatus: ToolExecutionStatus.failed,
        durationMs: input.durationMs ?? 1,
        errorCode: input.errorCode,
        executedAt: new Date()
      }
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
    const toolCall = await this.prisma.db.toolCall.create({
      data: {
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
      sanitizedResult: input.sanitizedResult
    });

    return { toolCall };
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
    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      toolCallId: event.toolCallId,
      eventType: event.eventType,
      riskLevel: input.riskLevel,
      durationMs: event.durationMs,
      metadata: toJsonInput(event.metadata)
    });
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
