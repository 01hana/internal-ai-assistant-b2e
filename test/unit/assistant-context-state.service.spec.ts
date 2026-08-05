import { AssistantContextStateService } from '../../src/assistant/context/assistant-context-state.service';
import { ExecutionDecision, RiskLevel, AssistantTaskState } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CUSTOMER_SCOPE_FIXTURES, createCustomerScopeFixtureScope } from '../support/customer-scope-fixtures';

describe('AssistantContextStateService', () => {
  it('creates an initial context state from page context', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'context-001' });
    const service = new AssistantContextStateService({
      db: {
        assistantContextState: {
          create
        }
      }
    } as unknown as PrismaService);

    await service.createInitialState({
      customerScope: createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA),
      sessionId: 'session-001',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001'
      }
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-a',
          sessionId: 'session-001',
          currentModule: 'orders',
          currentEntityType: 'order',
          currentEntityId: 'SO-10001',
          taskState: AssistantTaskState.idle
        })
      })
    );
  });

  it('updates existing context state after an answered message flow', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({ id: 'context-001' });
    const service = new AssistantContextStateService({
      db: {
        assistantContextState: {
          updateMany,
          findFirst
        }
      }
    } as unknown as PrismaService);

    await service.updateAfterMessageFlow({
      customerScope: createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA),
      sessionId: 'session-001',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001'
      },
      planningResult: createPlanningResult(ExecutionDecision.continue, []),
      toolCallIds: ['tool-call-001'],
      evidenceRefIds: ['evidence-001']
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 'customer-a', sessionId: 'session-001' },
        data: expect.objectContaining({
          currentTask: 'order_status_lookup',
          taskState: AssistantTaskState.completed,
          lastToolCallIds: ['tool-call-001'],
          lastEvidenceRefIds: ['evidence-001']
        })
      })
    );
  });

  it('marks clarification state when planning requires clarification', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({ id: 'context-001' });
    const service = new AssistantContextStateService({
      db: {
        assistantContextState: {
          updateMany,
          findFirst
        }
      }
    } as unknown as PrismaService);

    await service.updateAfterMessageFlow({
      customerScope: createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA),
      sessionId: 'session-001',
      planningResult: createPlanningResult(ExecutionDecision.clarify, [{ reason: 'missing_context', question: '請補充目標。' }]),
      toolCallIds: [],
      evidenceRefIds: []
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskState: AssistantTaskState.waiting_clarification,
          pendingClarification: [{ reason: 'missing_context', question: '請補充目標。' }]
        })
      })
    );
  });
});

function createPlanningResult(decision: ExecutionDecision, clarificationNeeds: Array<{ reason: string; question: string }>) {
  return {
    queryUnderstanding: {
      taskType: 'order_status_lookup',
      sentences: [],
      tokens: [],
      phrases: [],
      normalizedTerms: [],
      timeRanges: [],
      resolvedReferences: [],
      entityCandidates: [{ type: 'orderId' as const, value: 'SO-10001', confidence: 0.95 }],
      subTasks: [],
      candidateTools: [],
      riskLevel: RiskLevel.low,
      confidence: 0.9,
      clarificationNeeds,
      requiredEvidence: []
    },
    persistedQueryUnderstanding: {
      id: 'query-understanding-001',
      requestId: 'request-001',
      messageId: 'message-001',
      sentences: [],
      tokens: [],
      phrases: [],
      normalizedTerms: [],
      timeRanges: null,
      resolvedReferences: null,
      entityCandidates: [],
      subTasks: null,
      confidence: 0.9,
      clarificationNeeds: null,
      createdAt: new Date()
    },
    executionPlan: {
      id: 'plan-001',
      customerId: 'customer-a',
      sessionId: 'session-001',
      messageId: 'message-001',
      taskType: 'order_status_lookup',
      requiredEvidence: [],
      candidateTools: [],
      permissionChecks: [],
      riskAssessment: RiskLevel.low,
      clarificationNeeds,
      expectedAnswerShape: {},
      requiresMultiStepToolUse: false,
      decision,
      createdAt: new Date()
    },
    decision
  };
}
