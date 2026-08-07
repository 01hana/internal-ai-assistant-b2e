import { PageContextDto } from '../page-context/page-context.dto';
import { AssistantPlanningResult } from '../planning/assistant-planning.types';

export interface UpdateAssistantContextStateInput {
  sessionId: string;
  pageContext?: PageContextDto;
  planningResult: AssistantPlanningResult;
  toolCallIds: string[];
  evidenceRefIds: string[];
  pendingApprovalRequestId?: string;
  pendingEscalationRequestId?: string;
}

export interface MarkWaitingClarificationInput extends UpdateAssistantContextStateInput {
  clarificationQuestionId: string;
  reason: string;
  question: string;
  candidateRefs: unknown[];
  blocking: boolean;
}
