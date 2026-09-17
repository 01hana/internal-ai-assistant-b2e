import { AssistantPlanningService, determinePlanningDecision } from '../../src/assistant/planning/assistant-planning.service';
import { ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QueryUnderstandingService } from '../../src/query-understanding/query-understanding.service';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { HostIntegrationRequestFactory } from '../../src/host-integration/host-integration-request.factory';
import {
  CUSTOMER_SCOPE_FIXTURES,
  createCustomerScopeFixtureIdentityContext,
  createCustomerScopeFixtureScope
} from '../support/customer-scope-fixtures';

describe('AssistantPlanningService', () => {
  const identityContext = createCustomerScopeFixtureIdentityContext(CUSTOMER_SCOPE_FIXTURES.customerA);
  const customerScope = createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA);
  const hostIntegrationContext = new HostIntegrationRequestFactory().createHostContext(identityContext);

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
        candidateTools: [
          {
            key: 'mock.inventory.availability.lookup',
            arguments: {
              entityId: 'SKU-DEMO-RED',
              sql: 'SELECT phase3_planner_secret',
              connectorContextRef: 'ccr_phase3_planner_secret'
            },
            reason: 'inventory availability query',
            operation: 'delete',
            connectorKey: 'attacker-connector'
          }
        ],
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
      hostIntegrationContext
    });

    expect(understandAndPersist).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-a',
          taskType: 'inventory_availability_lookup',
          candidateTools: [
            {
              key: 'mock.inventory.availability.lookup',
              arguments: { entityId: 'SKU-DEMO-RED' },
              reason: 'inventory availability query'
            }
          ],
          decision: ExecutionDecision.continue
        })
      })
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain('phase3_planner_secret');
    expect(JSON.stringify(create.mock.calls)).not.toContain('attacker-connector');
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
      hostIntegrationContext,
      pageContext
    });

    expect(understandAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-plan-002',
        hostIntegrationContext,
        pageContext
      })
    );
    expect(understandAndPersist.mock.calls[0][0]).not.toHaveProperty('identityContext');
    expect(understandAndPersist.mock.calls[0][0]).not.toHaveProperty('customerScope');
  });

  it('passes bounded prior semantic context without turning it into planning authority', async () => {
    const understandAndPersist = jest.fn().mockResolvedValue({
      output: {
        taskType: 'general_lookup', sentences: [], tokens: [], phrases: [], normalizedTerms: [],
        timeRanges: [], resolvedReferences: [], entityCandidates: [], subTasks: [], candidateTools: [],
        riskLevel: RiskLevel.low, confidence: 0.9, clarificationNeeds: [], requiredEvidence: []
      },
      persisted: {
        id: 'qu-context', requestId: 'req-context', messageId: 'message-context', sentences: [], tokens: [],
        phrases: [], normalizedTerms: [], timeRanges: null, resolvedReferences: null, entityCandidates: [],
        subTasks: null, confidence: 0.9, clarificationNeeds: null, createdAt: new Date()
      }
    });
    const create = jest.fn().mockResolvedValue({
      id: 'plan-context', customerId: 'customer-a', sessionId: 'session-001', messageId: 'message-context',
      taskType: 'general_lookup', requiredEvidence: [], candidateTools: [], permissionChecks: [],
      riskAssessment: RiskLevel.low, clarificationNeeds: null, expectedAnswerShape: null,
      requiresMultiStepToolUse: false, decision: ExecutionDecision.continue, createdAt: new Date()
    });
    const context = Object.freeze({
      scope: Object.freeze({ customerId: 'customer-a', sessionId: 'session-001', organizationId: 'org-001', hostApp: 'erp', actorId: 'actor-001' }),
      selectedExchangeIdsNewestFirst: Object.freeze(['exchange-1']), chronologicalExchangeIds: Object.freeze(['exchange-1']),
      exchanges: Object.freeze([]), semanticFrames: Object.freeze([]), evidenceRefs: Object.freeze([]),
      evidenceRefIds: Object.freeze([]), rejectedReasonCodes: Object.freeze([])
    });
    const load = jest.fn().mockResolvedValue(context);
    const recordLoaded = jest.fn().mockResolvedValue(undefined);
    const service = new AssistantPlanningService(
      { understandAndPersist } as unknown as QueryUnderstandingService,
      { db: { executionPlan: { create } } } as unknown as PrismaService,
      { append: jest.fn() } as unknown as AuditWriterService,
      { load } as never,
      { recordLoaded } as never
    );

    await service.createPlan({
      customerScope, requestId: 'req-context', sessionId: 'session-001', messageId: 'message-context',
      text: '那個呢？', hostIntegrationContext
    });

    expect(load).toHaveBeenCalledWith({ scope: {
      customerId: 'customer-a', sessionId: 'session-001', organizationId: customerScope.organizationId,
      hostApp: customerScope.hostApp, actorId: customerScope.actorId
    } });
    expect(understandAndPersist).toHaveBeenCalledWith(expect.objectContaining({ priorConversationContext: context }));
    expect(create.mock.calls[0][0].data.candidateTools).toEqual([]);
    expect(create.mock.calls[0][0].data.permissionChecks).toEqual([expect.objectContaining({
      organizationId: hostIntegrationContext.organizationId,
      actorId: hostIntegrationContext.actorId
    })]);
    expect(JSON.stringify(create.mock.calls[0][0])).not.toMatch(/exchange-1/);
    expect(recordLoaded).toHaveBeenCalledWith(expect.objectContaining({ exchangeCount: 0, evidenceRefCount: 0 }));
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
