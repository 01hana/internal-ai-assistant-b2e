import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { minimizeForLlmInput } from '../../permissions/masking.util';
import { getPageEntityRef, getVisibleColumns } from '../page-context/page-context.mapper';
import { AssistantReadonlyRuntimeInput, AssistantReadonlyRuntimeResult, StructuredOrderRecord } from './runtime.types';

@Injectable()
export class AssistantReadonlyRuntimeService {
  execute(input: AssistantReadonlyRuntimeInput): AssistantReadonlyRuntimeResult {
    const entityRef = getPageEntityRef(input.pageContext);
    const visibleFields = getVisibleColumns(input.pageContext);
    const structuredRecord = this.resolveStructuredRecord(input.executionPlan.taskType, entityRef.entityId);
    const sanitizedResult = structuredRecord ? minimizeForLlmInput(structuredRecord, visibleFields) : {};

    return {
      toolName: firstToolName(input.executionPlan.candidateTools),
      entityRef,
      visibleFields,
      structuredRecord,
      sanitizedResult
    };
  }

  private resolveStructuredRecord(taskType: string, entityId?: string): StructuredOrderRecord | undefined {
    if (taskType === 'order_status_lookup' && entityId === 'SO-10001') {
      return {
        orderId: 'SO-10001',
        status: '已確認',
        customerName: '王小明企業',
        amount: 128000
      };
    }

    return undefined;
  }
}

function firstToolName(candidateTools: Prisma.JsonValue): string {
  if (!Array.isArray(candidateTools) || candidateTools.length === 0) {
    return 'mock.general.lookup';
  }

  const tool = candidateTools[0];
  if (tool && typeof tool === 'object' && 'key' in tool && typeof tool.key === 'string') {
    return tool.key;
  }

  return 'mock.general.lookup';
}
