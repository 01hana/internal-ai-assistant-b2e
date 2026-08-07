import { AnswerDecisionService } from '../../src/assistant/answer/answer-decision.service';
import { AnswerDecisionStatus, ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AnswerDecisionService', () => {
  it('persists an answered decision when sanitized evidence covers allowed claims', async () => {
    const groundingCreate = jest.fn().mockResolvedValue({ id: 'grounding-001' });
    const answerCreate = jest.fn().mockResolvedValue({ id: 'answer-decision-001' });
    const service = new AnswerDecisionService({
      db: {
        groundingCheck: { create: groundingCreate },
        answerDecision: { create: answerCreate }
      }
    } as unknown as PrismaService);

    const result = await service.decide({
      requestId: 'req-answer',
      messageId: 'message-001',
      executionPlan: createPlan(ExecutionDecision.continue),
      evidenceRefs: [{ id: 'evidence-001', summary: { status: '已確認' } }]
    });

    expect(result.status).toBe(AnswerDecisionStatus.answered);
    expect(result.answer.text).toContain('已確認');
    expect(groundingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          covered: true,
          evidenceRefIds: ['evidence-001']
        })
      })
    );
  });

  it('returns clarification when execution planning says clarify', async () => {
    const service = createService();
    const result = await service.decide({
      requestId: 'req-answer',
      messageId: 'message-001',
      executionPlan: createPlan(ExecutionDecision.clarify),
      evidenceRefs: []
    });

    expect(result.status).toBe(AnswerDecisionStatus.clarification_required);
  });

  it('returns no-answer when evidence is missing', async () => {
    const service = createService();
    const result = await service.decide({
      requestId: 'req-answer',
      messageId: 'message-001',
      executionPlan: createPlan(ExecutionDecision.continue),
      evidenceRefs: []
    });

    expect(result.status).toBe(AnswerDecisionStatus.no_answer);
  });
});

function createService() {
  return new AnswerDecisionService({
    db: {
      groundingCheck: { create: jest.fn().mockResolvedValue({ id: 'grounding-001' }) },
      answerDecision: { create: jest.fn().mockResolvedValue({ id: 'answer-decision-001' }) }
    }
  } as unknown as PrismaService);
}

function createPlan(decision: ExecutionDecision) {
  return {
    id: 'plan-001',
    sessionId: 'session-001',
    messageId: 'message-001',
    taskType: 'order_status_lookup',
    requiredEvidence: [],
    candidateTools: [],
    permissionChecks: [],
    riskAssessment: RiskLevel.low,
    clarificationNeeds: null,
    expectedAnswerShape: {},
    requiresMultiStepToolUse: false,
    decision,
    createdAt: new Date()
  };
}
