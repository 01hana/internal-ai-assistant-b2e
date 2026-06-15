import { AssistantPlanningService } from '../../src/assistant/assistant-planning.service';
import { RiskLevel, ExecutionDecision } from '../../src/generated/prisma/enums';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QueryUnderstandingService } from '../../src/query-understanding/query-understanding.service';

describe('assistant planning integration', () => {
  it('creates and persists an ExecutionPlan aligned with the Prisma schema', async () => {
    const understandAndPersist = jest.fn().mockResolvedValue({
      output: {
        taskType: 'order_status_lookup',
        sentences: [{ index: 0, text: '查 SO-10001 訂單狀態' }],
        tokens: [],
        phrases: [],
        normalizedTerms: ['so-10001'],
        timeRanges: [],
        resolvedReferences: [],
        entityCandidates: [{ type: 'orderId', value: 'SO-10001', confidence: 0.95 }],
        subTasks: [{ type: 'order_status_lookup', text: '查 SO-10001 訂單狀態' }],
        candidateTools: [{ key: 'mock.orders.status.lookup', reason: 'order status query' }],
        riskLevel: RiskLevel.low,
        confidence: 0.9,
        clarificationNeeds: [],
        requiredEvidence: ['identity_context', 'structured_record']
      },
      persisted: {
        id: 'qu-001',
        requestId: 'req-plan-int',
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
        createdAt: new Date('2026-06-15T00:00:00.000Z')
      }
    });
    const create = jest.fn().mockResolvedValue({
      id: 'plan-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      taskType: 'order_status_lookup',
      requiredEvidence: ['identity_context', 'structured_record'],
      candidateTools: [{ key: 'mock.orders.status.lookup', reason: 'order status query' }],
      permissionChecks: [{ actorId: 'actor-001', scopes: ['orders:read'] }],
      riskAssessment: RiskLevel.low,
      clarificationNeeds: null,
      expectedAnswerShape: { format: 'text', includesEvidence: true },
      requiresMultiStepToolUse: false,
      decision: ExecutionDecision.continue,
      createdAt: new Date('2026-06-15T00:00:01.000Z')
    });
    const append = jest.fn().mockResolvedValue({
      id: 'audit-001',
      timestamp: new Date('2026-06-15T00:00:01.500Z')
    });
    const service = new AssistantPlanningService(
      { understandAndPersist } as unknown as QueryUnderstandingService,
      {
        db: {
          executionPlan: {
            create
          }
        }
      } as unknown as PrismaService,
      { append } as unknown as AuditWriterService
    );

    const result = await service.createPlan({
      requestId: 'req-plan-int',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '查 SO-10001 訂單狀態',
      identityContext: {
        requestId: 'req-plan-int',
        actor: {
          actorId: 'actor-001',
          role: 'planner',
          permissionScopes: ['orders:read']
        },
        hostApp: {
          hostApp: 'erp'
        },
        company: {
          organizationId: 'org-001'
        }
      }
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'session-001',
          taskType: 'order_status_lookup',
          riskAssessment: RiskLevel.low,
          decision: ExecutionDecision.continue
        })
      })
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'execution_plan_created',
        messageId: 'message-001'
      })
    );
    expect(result.executionPlan.taskType).toBe('order_status_lookup');
  });
});
