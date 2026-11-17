import { AnswerDecisionStatus, RiskLevel } from '../../generated/prisma/enums';
import { SseEventEnvelope } from '../../common/sse/sse-event.types';
import { ToolPermissionDeniedReason } from '../../tools/tool-registry.types';

/** Feature 013: a clickable choice; the client sends `{ choiceId: id }`. */
export interface AssistantSuggestionV1 {
  readonly id: string;
  readonly label: string;
}

export type AssistantToolLifecycle = 'completed' | 'blocked' | 'failed';

export interface AssistantSseBuildInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  toolLifecycle: AssistantToolLifecycle;
  deniedReason?: ToolPermissionDeniedReason;
  errorCode?: string;
  evidenceRefIds: string[];
  answerDelta: string;
  finalData: {
    answerDecision: AnswerDecisionStatus;
    answer: string;
    evidenceRefs: string[];
    actionDraftId?: string;
    noAnswerReason?: string;
    errorCode?: string;
    clarificationQuestionId?: string;
    /** Feature 013: present only when non-empty. */
    suggestions?: readonly AssistantSuggestionV1[];
  };
}

export interface AssistantAnswerOnlyBuildInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  answerDelta: string;
  finalData: {
    answerDecision: AnswerDecisionStatus;
    answer: string;
    evidenceRefs: string[];
    noAnswerReason?: string;
    clarificationQuestionId?: string;
    errorCode?: string;
    /** Feature 013: present only when non-empty. */
    suggestions?: readonly AssistantSuggestionV1[];
  };
}

export interface AssistantConfirmationRequiredBuildInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  actionDraftId: string;
  riskLevel: RiskLevel;
  preview: unknown;
  expiresAt: string | null;
  answer: string;
}

export interface AssistantApprovalRequiredBuildInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  approvalRequestId: string;
  riskLevel: RiskLevel;
  actionSummary: unknown;
  expiresAt: string | null;
  answer: string;
}

export interface AssistantEscalationRequiredBuildInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  escalationRequestId: string;
  riskLevel: RiskLevel;
  reasonCode: string;
  reasonSummary: string;
  actionSummary?: unknown;
  expiresAt: string | null;
  answer: string;
}

export interface AssistantSseEventRecord<TData = unknown> {
  event: string;
  payload: SseEventEnvelope<TData>;
}
