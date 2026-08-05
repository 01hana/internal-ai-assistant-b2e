import { AssistantPlanningService, determinePlanningDecision } from '../../src/assistant/planning/assistant-planning.service';
import { ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QueryUnderstandingService } from '../../src/query-understanding/query-understanding.service';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import {
  CUSTOMER_SCOPE_FIXTURES,
  createCustomerScopeFixtureIdentityContext,
  createCustomerScopeFixtureScope
} from '../support/customer-scope-fixtures';

describe('AssistantPlanningService', () => {
  const identityContext = createCustomerScopeFixtureIdentityContext(CUSTOMER_SCOPE_FIXTURES.customerA);
  const customerScope = createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA);

  it('creates an execution plan from query-understanding output rather than raw text parsing', async () => {
    const understandAndPersist = jest.fn().mockResolvedValue({
      output: {
        taskType: 'inventory_availability_lookup',
        sentences: [{ index: 0, text: 'raw text does not matter here' }],
        tokens: [],
        phrases: [],
        normalizedTerms: ['inventory'],
        timeRanges: [],
        resolvedReferences: [],
        entityCandidates: [{ type: 'itemSku', value: 'SKU-DEMO-RED', confidence: 0.95 }],
        subTasks: [{ type: 'inventory_availability_lookup', text: 'raw text does not matter here' }],
        candidateTools: [{ key: 'mock.inventory.availability.lookup', reason: 'inventory availability query' }],
        riskLevel: RiskLevel.low,
        confidence: 0.91,
        clarificationNeeds: [],
        requiredEvidence: ['identity_context', 'structured_record']
      },
      persisted: {
        id: 'qu-001',
        requestId: 'req-plan-001',
        messageId: 'message-001',
        sentences: [],
        tokens: [],
        phrases: [],
        normalizedTerms: [],
        timeRanges: null,
        resolvedReferences: null,
        entityCandidates: [],
        subTasks: null,
        confidence: 0.91,
        clarificationNeeds: null,
        createdAt: new Date('2026-06-15T00:00:00.000Z')
      }
    });
    const create = jest.fn().mockResolvedValue({
      id: 'plan-001',
      customerId: 'customer-a',
      sessionId: 'session-001',
      messageId: 'message-001',
      taskType: 'inventory_availability_lookup',
      requiredEvidence: ['identity_context', 'structured_record'],
      candidateTools: [{ key: 'mock.inventory.availability.lookup', reason: 'inventory availability query' }],
      permissionChecks: [{ scopes: ['orders:read'] }],
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
      customerScope,
      requestId: 'req-plan-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: 'this raw text should not drive taskType directly',
      identityContext
    });

    expect(understandAndPersist).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-a',
          taskType: 'inventory_availability_lookup',
          decision: ExecutionDecision.continue
        })
      })
    );
    expect(result.decision).toBe(ExecutionDecision.continue);
    expect(result.queryUnderstanding.taskType).toBe('inventory_availability_lookup');
  });

  it('passes page context through AssistantPlanningService into QueryUnderstandingService before execution-plan creation', async () => {
    const pageContext = {
      module: 'orders',
      screenId: 'order-detail',
      entityType: 'order',
      entityId: 'SO-10001',
      visibleColumns: ['status', 'customerName']
    };
    const understandAndPersist = jest.fn().mockResolvedValue({
      output: {
        taskType: 'order_status_lookup',
        sentences: [{ index: 0, text: '這張訂單目前狀態？' }],
        tokens: [],
        phrases: [],
        normalizedTerms: ['訂單'],
        timeRanges: [],
        resolvedReferences: ['module', 'entityId'],
        entityCandidates: [{ type: 'orderId', value: 'SO-10001', confidence: 0.92 }],
        subTasks: [{ type: 'order_status_lookup', text: '這張訂單目前狀態？' }],
        candidateTools: [{ key: 'mock.orders.status.lookup', reason: 'order status query' }],
        riskLevel: RiskLevel.low,
        confidence: 0.92,
        clarificationNeeds: [],
        requiredEvidence: ['identity_context', 'structured_record']
      },
      persisted: {
        id: 'qu-002',
        requestId: 'req-plan-002',
        messageId: 'message-002',
        sentences: [],
        tokens: [],
        phrases: [],
        normalizedTerms: [],
        timeRanges: null,
        resolvedReferences: null,
        entityCandidates: [],
        subTasks: null,
        confidence: 0.92,
        clarificationNeeds: null,
        createdAt: new Date('2026-06-15T00:00:00.000Z')
      }
    });
    const create = jest.fn().mockResolvedValue({
      id: 'plan-002',
      customerId: 'customer-a',
      sessionId: 'session-001',
      messageId: 'message-002',
      taskType: 'order_status_lookup',
      requiredEvidence: ['identity_context', 'structured_record'],
      candidateTools: [{ key: 'mock.orders.status.lookup', reason: 'order status query' }],
      permissionChecks: [{ scopes: ['orders:read'] }],
      riskAssessment: RiskLevel.low,
      clarificationNeeds: null,
      expectedAnswerShape: { format: 'text', includesEvidence: true },
      requiresMultiStepToolUse: false,
      decision: ExecutionDecision.continue,
      createdAt: new Date('2026-06-15T00:00:01.000Z')
    });
    const append = jest.fn().mockResolvedValue({
      id: 'audit-002',
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

    await service.createPlan({
      customerScope,
      requestId: 'req-plan-002',
      sessionId: 'session-001',
      messageId: 'message-002',
      text: '這張訂單目前狀態？',
      identityContext,
      pageContext
    });

    expect(understandAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-plan-002',
        customerScope,
        pageContext
      })
    );
  });

  it('maps low-confidence output into clarify decision', () => {
    expect(
      determinePlanningDecision({
        taskType: 'order_status_lookup',
        sentences: [],
        tokens: [],
        phrases: [],
        normalizedTerms: [],
        timeRanges: [],
        resolvedReferences: [],
        entityCandidates: [],
        subTasks: [],
        candidateTools: [],
        riskLevel: RiskLevel.low,
        confidence: 0.42,
        clarificationNeeds: [{ reason: 'low_confidence', question: '請補充查詢目標。' }],
        requiredEvidence: []
      })
    ).toBe(ExecutionDecision.clarify);
  });
});
