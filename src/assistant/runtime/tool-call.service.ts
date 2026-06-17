import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ToolCallStatus, ToolExecutionStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { CompletedToolCallResult, CreateToolCallInput } from './runtime.types';

@Injectable()
export class ToolCallService {
  constructor(private readonly prisma: PrismaService) {}

  async createCompletedToolCall(input: CreateToolCallInput): Promise<CompletedToolCallResult> {
    const toolCall = await this.prisma.db.toolCall.create({
      data: {
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        toolName: input.toolName,
        toolVersion: input.toolVersion ?? 'v1',
        inputSummary: toJsonInput({
          entityId: input.entityId,
          visibleFields: input.visibleFields
        }),
        permissionResult: toJsonInput({
          scopes: input.identityContext.actor.permissionScopes,
          visibleFields: input.visibleFields
        }),
        outputSummary: toJsonInput(input.sanitizedResult),
        status: input.status ?? ToolCallStatus.success,
        executionStatus: input.executionStatus ?? ToolExecutionStatus.executed,
        durationMs: 1,
        executedAt: new Date()
      }
    });

    return { toolCall };
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
