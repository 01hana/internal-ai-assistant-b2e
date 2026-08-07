import { AnswerDecisionStatus, AssistantMessageRole, ToolCallStatus } from '../../generated/prisma/enums';
import { AssistantHistorySanitizer } from './assistant-history.sanitizer';
import { AssistantHistoryMessage } from './assistant-history.types';

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
  evidenceRefs: Array<{
    id: string;
    fieldPaths?: string[];
    permissionSnapshot?: unknown;
    summary?: unknown;
  }>,
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
