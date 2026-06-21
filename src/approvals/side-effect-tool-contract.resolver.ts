import { ForbiddenException, Injectable } from '@nestjs/common';
import { getPageEntityRef } from '../assistant/page-context/page-context.mapper';
import { RiskLevel } from '../generated/prisma/enums';
import { RegisteredToolDefinition } from '../tools/tool-registry.types';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { CreateActionDraftInput } from './action-draft.types';
import { CreateApprovalRequestInput } from './approval-request.types';

export type SideEffectToolFlow = 'confirmation' | 'approval';

export interface PersistedSideEffectToolContract {
  toolDefinitionId: string;
  toolName: string;
  toolVersion: string;
  operation: RegisteredToolDefinition['operation'];
  riskLevel: RegisteredToolDefinition['riskLevel'];
  hasSideEffect: boolean;
  requiresConfirmation: boolean;
  requiresApproval: boolean;
}

@Injectable()
export class SideEffectToolContractResolver {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  resolveForActionDraft(input: CreateActionDraftInput): Promise<RegisteredToolDefinition> {
    return this.resolveSelectedSideEffectTool({
      requestedToolName: selectSideEffectToolName(input, 'confirmation'),
      expectedRiskLevel: RiskLevel.medium,
      flow: 'confirmation'
    });
  }

  resolveForApprovalRequest(input: CreateApprovalRequestInput): Promise<RegisteredToolDefinition> {
    return this.resolveSelectedSideEffectTool({
      requestedToolName: selectSideEffectToolName(input, 'approval'),
      expectedRiskLevel: input.executionPlan.riskAssessment,
      flow: 'approval'
    });
  }

  async resolveSelectedSideEffectTool(input: {
    requestedToolName: string;
    expectedRiskLevel: RiskLevel;
    flow: SideEffectToolFlow;
  }): Promise<RegisteredToolDefinition> {
    const result = await this.toolRegistry.resolveRegisteredTool(input.requestedToolName);
    if (!result.tool) {
      throw new ForbiddenException('Side-effect tool is not executable.');
    }

    const tool = result.tool;
    if (!tool.hasSideEffect || tool.riskLevel !== input.expectedRiskLevel) {
      throw new ForbiddenException('Side-effect tool contract mismatch.');
    }

    if (input.flow === 'confirmation' && (!tool.requiresConfirmation || tool.requiresApproval)) {
      throw new ForbiddenException('Side-effect tool contract mismatch.');
    }

    if (input.flow === 'approval' && !tool.requiresApproval) {
      throw new ForbiddenException('Side-effect tool contract mismatch.');
    }

    return tool;
  }
}

export function toPersistedSideEffectToolContract(tool: RegisteredToolDefinition): PersistedSideEffectToolContract {
  return {
    toolDefinitionId: tool.id,
    toolName: tool.key,
    toolVersion: tool.version,
    operation: tool.operation,
    riskLevel: tool.riskLevel,
    hasSideEffect: tool.hasSideEffect,
    requiresConfirmation: tool.requiresConfirmation,
    requiresApproval: tool.requiresApproval
  };
}

function selectSideEffectToolName(input: CreateActionDraftInput | CreateApprovalRequestInput, flow: SideEffectToolFlow): string {
  const entityRef = getPageEntityRef(input.pageContext);
  if (input.pageContext?.module === 'orders' || entityRef.entityType === 'order') {
    return flow === 'confirmation' ? 'mock.orders.status.update' : 'mock.orders.cancel';
  }

  return firstToolName(input.executionPlan.candidateTools);
}

function firstToolName(candidateTools: unknown): string {
  if (!Array.isArray(candidateTools) || candidateTools.length === 0) {
    return 'mock.general.lookup';
  }

  const tool = candidateTools[0];
  if (tool && typeof tool === 'object' && 'key' in tool && typeof tool.key === 'string') {
    return tool.key;
  }

  return 'mock.general.lookup';
}
