import { AnswerDecisionStatus } from '../../src/generated/prisma/enums';
import { isCompletedAssistantMessage } from '../../src/assistant/message/assistant-completion.predicate';

describe('durable Assistant completion status authority', () => {
  const decision = { id: 'decision-1', groundingCheckId: 'grounding-1' };

  it('admits only explicitly completed server-owned decisions', () => {
    for (const status of [
      AnswerDecisionStatus.answered,
      AnswerDecisionStatus.no_answer,
      AnswerDecisionStatus.clarification_required,
      AnswerDecisionStatus.permission_denied,
      AnswerDecisionStatus.approval_required,
      AnswerDecisionStatus.confirmation_required,
      AnswerDecisionStatus.escalation_required
    ]) {
      expect(isCompletedAssistantMessage({ content: '已完成的安全回覆。', answerDecision: status }, { ...decision, status })).toBe(true);
    }
    for (const status of [AnswerDecisionStatus.tool_failed, 'failed', 'cancelled', 'rejected']) {
      expect(isCompletedAssistantMessage({ content: '看似有效但未完成的內容。', answerDecision: status }, { ...decision, status })).toBe(false);
    }
  });
});
