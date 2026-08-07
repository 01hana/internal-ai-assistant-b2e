import { AnswerDecisionStatus, AssistantMessageRole, ToolCallStatus } from '../../generated/prisma/enums';
import { RequestIdentityContext } from '../../identity/identity-context.types';

export interface ListAssistantMessagesInput {
  requestId: string;
  sessionId: string;
  identityContext: RequestIdentityContext;
  limit?: number;
  cursor?: string;
  order?: 'asc';
}

export interface AssistantHistoryMessage {
  messageId: string;
  role: AssistantMessageRole;
  content: string;
  createdAt: string;
  answerDecision?: AnswerDecisionStatus;
  evidenceRefs?: string[];
  toolSummary?: {
    status: ToolCallStatus | 'completed';
    toolCallIds: string[];
  };
}

export interface AssistantHistoryResult {
  sessionId: string;
  messages: AssistantHistoryMessage[];
  nextCursor: string | null;
}
