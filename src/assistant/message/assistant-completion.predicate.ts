import { AnswerDecisionStatus } from '../../generated/prisma/enums';

// These are completed server-owned reply/interaction decisions, not factual-answer statuses.
// Failure states are deliberately excluded even when a future Prisma enum adds new values.
const COMPLETED_REPLY_STATUSES: ReadonlySet<AnswerDecisionStatus> = new Set([
  AnswerDecisionStatus.answered,
  AnswerDecisionStatus.clarification_required,
  AnswerDecisionStatus.no_answer,
  AnswerDecisionStatus.permission_denied,
  AnswerDecisionStatus.approval_required,
  AnswerDecisionStatus.confirmation_required,
  AnswerDecisionStatus.escalation_required
]);

/** A persisted decision, not a streamed delta or the message's default status, is the completion authority. */
export function isCompletedAssistantMessage(
  message: { readonly content: string; readonly answerDecision?: AnswerDecisionStatus | string | null },
  decision: { readonly id?: string; readonly status: AnswerDecisionStatus | string; readonly groundingCheckId?: string | null } | null | undefined
): boolean {
  return Boolean(decision && typeof decision.id === 'string' && decision.id.length > 0 &&
    typeof decision.groundingCheckId === 'string' && decision.groundingCheckId.length > 0 &&
    COMPLETED_REPLY_STATUSES.has(decision.status as AnswerDecisionStatus) &&
    message.answerDecision === decision.status &&
    typeof message.content === 'string' && message.content.trim().length > 0 && message.content.trim() !== 'Pending answer.');
}
