import { RiskLevel, ExecutionDecision, ToolOperation } from '../../src/generated/prisma/enums';
import { AssistantReadonlyRuntimeService } from '../../src/assistant/runtime/assistant-readonly-runtime.service';
import { ToolCallService } from '../../src/assistant/runtime/tool-call.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RegisteredToolDefinition, ToolPermissionDeniedReason } from '../../src/tools/tool-registry.types';

describe('AssistantReadonlyRuntimeService', () => {
  it('uses registry output and connector data, then minimizes the structured record for downstream use', async () => {
    const connectorExecute = jest.fn().mockResolvedValue({
      status: 'succeeded',
      data: {
        orderId: 'SO-10001',
        status: 'picking',
        amount: 128000
      }
    });
    const service = createRuntimeService({
      connectorExecute
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).toHaveBeenCalledWith(expect.objectContaining({ toolKey: 'mock.orders.status.lookup' }));
    expect(result.toolName).toBe('mock.orders.status.lookup');
    expect(result.sanitizedResult).toEqual({
      status: 'picking'
    });
    expect(JSON.stringify(result.sanitizedResult)).not.toContain('128000');
  });

  it.each<ToolPermissionDeniedReason>(['tool_not_registered', 'tool_inactive'])(
    'does not call the connector when registry resolution fails with %s',
    async (deniedReason) => {
      const connectorExecute = jest.fn();
      const recordDenied = jest.fn();
      const service = createRuntimeService({
        registryResult: { deniedReason },
        connectorExecute,
        recordDenied
      });

      const result = await service.execute(runtimeInput());

      expect(connectorExecute).not.toHaveBeenCalled();
      expect(recordDenied).toHaveBeenCalledWith(expect.objectContaining({ deniedReason }));
      expect(result.deniedReason).toBe(deniedReason);
    }
  );

  it('does not call the connector when input schema validation fails', async () => {
    const connectorExecute = jest.fn();
    const recordDenied = jest.fn();
    const service = createRuntimeService({
      validation: {
        valid: false,
        deniedReason: 'schema_invalid',
        schemaErrorReason: 'missing_required_entityId'
      },
      connectorExecute,
      recordDenied
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).not.toHaveBeenCalled();
    expect(recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        deniedReason: 'schema_invalid',
        schemaErrorReason: 'missing_required_entityId'
      })
    );
    expect(result.deniedReason).toBe('schema_invalid');
  });

  it('does not call the connector when permission pre-check denies execution', async () => {
    const connectorExecute = jest.fn();
    const service = createRuntimeService({
      permission: {
        allowed: false,
        reason: 'missing_scope',
        missingScopes: ['orders:read']
      },
      connectorExecute
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).not.toHaveBeenCalled();
    expect(result.deniedReason).toBe('missing_scope');
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
      identityContext: identityContext(),
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

function createRuntimeService(overrides?: {
  registryResult?: { tool?: RegisteredToolDefinition; deniedReason?: ToolPermissionDeniedReason };
  validation?: { valid: true } | { valid: false; deniedReason: 'schema_invalid'; schemaErrorReason: string };
  permission?: { allowed: true } | { allowed: false; reason: ToolPermissionDeniedReason; missingScopes?: string[] };
  connectorExecute?: jest.Mock;
  recordDenied?: jest.Mock;
}) {
  return new AssistantReadonlyRuntimeService(
    {
      resolveExecutableTool: jest.fn().mockResolvedValue(overrides?.registryResult ?? { tool: registeredTool() }),
      validateInput: jest.fn().mockReturnValue(overrides?.validation ?? { valid: true })
    } as never,
    {
      execute:
        overrides?.connectorExecute ??
        jest.fn().mockResolvedValue({
          status: 'succeeded',
          data: {
            orderId: 'SO-10001',
            status: 'picking',
            amount: 128000
          }
        })
    } as never,
    {
      check: jest.fn().mockResolvedValue(overrides?.permission ?? { allowed: true }),
      recordDenied: overrides?.recordDenied ?? jest.fn()
    } as never
  );
}

function registeredTool(): RegisteredToolDefinition {
  return {
    key: 'mock.orders.status.lookup',
    name: 'mock.orders.status.lookup',
    version: '1.0.0',
    description: 'Lookup mock order status.',
    operation: ToolOperation.read,
    riskLevel: RiskLevel.low,
    active: true,
    connectorKey: 'mock',
    requiredPermissionScopes: ['orders:read'],
    inputSchema: {
      required: ['entityId']
    },
    outputSchema: {
      required: ['orderId', 'status']
    }
  };
}

function runtimeInput() {
  return {
    requestId: 'req-001',
    sessionId: 'session-001',
    messageId: 'message-001',
    identityContext: identityContext(),
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
      visibleColumns: ['status']
    }
  };
}

function identityContext() {
  return {
    requestId: 'req-001',
    actor: { actorId: 'actor-001', role: 'planner', permissionScopes: ['orders:read'] },
    hostApp: { hostApp: 'erp' },
    company: { organizationId: 'org-001' }
  };
}
