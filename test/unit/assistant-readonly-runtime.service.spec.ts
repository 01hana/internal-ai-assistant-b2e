import { RiskLevel, ExecutionDecision } from '../../src/generated/prisma/enums';
import { AssistantReadonlyRuntimeService } from '../../src/assistant/runtime/assistant-readonly-runtime.service';
import { ToolCallService } from '../../src/assistant/runtime/tool-call.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AssistantReadonlyRuntimeService', () => {
  it('resolves deterministic structured records from execution-plan output instead of raw message text', () => {
    const service = new AssistantReadonlyRuntimeService();

    const result = service.execute({
      executionPlan: {
        id: 'plan-001',
        sessionId: 'session-001',
        taskType: 'order_status_lookup',
        requiredEvidence: [],
        candidateTools: [{ key: 'mock.orders.status.lookup', reason: 'order status query' }],
        permissionChecks: [],
        riskAssessment: RiskLevel.low,
        clarificationNeeds: null,
        expectedAnswerShape: {},
        requiresMultiStepToolUse: false,
        decision: ExecutionDecision.continue,
        createdAt: new Date()
      },
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });

    expect(result.toolName).toBe('mock.orders.status.lookup');
    expect(result.sanitizedResult).toEqual({
      status: '已確認',
      customerName: '王小明企業'
    });
    expect(JSON.stringify(result.sanitizedResult)).not.toContain('128000');
  });
});

describe('ToolCallService', () => {
  it('creates a completed tool call with the existing stable payload shape', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'tool-call-001', toolName: 'mock.orders.status.lookup' });
    const service = new ToolCallService({
      db: {
        toolCall: {
          create
        }
      }
    } as unknown as PrismaService);

    const result = await service.createCompletedToolCall({
      requestId: 'req-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      identityContext: {
        requestId: 'req-001',
        actor: { actorId: 'actor-001', role: 'planner', permissionScopes: ['orders:read'] },
        hostApp: { hostApp: 'erp' },
        company: { organizationId: 'org-001' }
      },
      toolName: 'mock.orders.status.lookup',
      entityId: 'SO-10001',
      visibleFields: ['status', 'customerName'],
      sanitizedResult: {
        status: '已確認',
        customerName: '王小明企業'
      }
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolName: 'mock.orders.status.lookup',
          outputSummary: {
            status: '已確認',
            customerName: '王小明企業'
          }
        })
      })
    );
    expect(result.toolCall.id).toBe('tool-call-001');
  });
});
