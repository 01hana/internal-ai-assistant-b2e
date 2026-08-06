import { AnswerDecisionStatus, AssistantMessageRole, ToolCallStatus } from '../../generated/prisma/enums';
import { AssistantHistorySanitizer } from './assistant-history.sanitizer';
import { AssistantHistoryMessage } from './assistant-history.types';

/**
 * Evidence reaches this mapper only after the history service applies the
 * Customer-qualified message predicate. Mapping is intentionally not an
 * authorization layer and must not perform a second, application-side filter.
 */
export interface CustomerScopedHistoryEvidenceRef {
  id: string;
  customerId: string;
  messageId: string | null;
  fieldPaths?: string[];
  permissionSnapshot?: unknown;
  summary?: unknown;
}

export function mapAssistantHistoryMessage(
  message: {
    id: string;
    role: AssistantMessageRole;
    content: string;
    createdAt: Date;
    answerDecision: AnswerDecisionStatus | null;
  },
  toolCalls: Array<{
    id: string;
    status: ToolCallStatus;
  }>,
  evidenceRefs: CustomerScopedHistoryEvidenceRef[],
  permissionScopes: string[]
): AssistantHistoryMessage {
  const response: AssistantHistoryMessage = {
    messageId: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt.toISOString()
  };

  if (message.role === AssistantMessageRole.assistant) {
    const artifacts = new AssistantHistorySanitizer().sanitizeAssistantArtifacts({
      toolCalls,
      evidenceRefs,
      permissionScopes
    });

    response.answerDecision = message.answerDecision ?? AnswerDecisionStatus.answered;
    response.evidenceRefs = artifacts.evidenceRefs;
    response.toolSummary = artifacts.toolSummary;
  }

  return response;
}
