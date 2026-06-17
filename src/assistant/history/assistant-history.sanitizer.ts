import { ToolCallStatus } from '../../generated/prisma/enums';

export interface HistoryToolSummaryInput {
  id: string;
  status: ToolCallStatus;
}

export interface HistoryEvidenceRefInput {
  id: string;
  fieldPaths?: string[];
  permissionSnapshot?: unknown;
  summary?: unknown;
}

export interface SanitizedHistoryAssistantArtifacts {
  evidenceRefs: string[];
  toolSummary: {
    status: ToolCallStatus | 'completed';
    toolCallIds: string[];
  };
}

export class AssistantHistorySanitizer {
  sanitizeAssistantArtifacts(input: {
    toolCalls: HistoryToolSummaryInput[];
    evidenceRefs: HistoryEvidenceRefInput[];
    permissionScopes: string[];
  }): SanitizedHistoryAssistantArtifacts {
    const canReadOrders = input.permissionScopes.includes('orders:read');
    const evidenceRefs = canReadOrders ? input.evidenceRefs.map((evidenceRef) => evidenceRef.id) : [];

    return {
      evidenceRefs,
      toolSummary: {
        status: input.toolCalls.some((toolCall) => toolCall.status === ToolCallStatus.success) ? 'completed' : ToolCallStatus.pending,
        toolCallIds: canReadOrders ? input.toolCalls.map((toolCall) => toolCall.id) : []
      }
    };
  }
}
