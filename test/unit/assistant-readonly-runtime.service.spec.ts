import { RiskLevel, ExecutionDecision, ToolCallStatus, ToolExecutionStatus, ToolOperation } from '../../src/generated/prisma/enums';
import { AssistantReadonlyRuntimeService } from '../../src/assistant/runtime/assistant-readonly-runtime.service';
import { ToolCallService } from '../../src/assistant/runtime/tool-call.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RegisteredToolDefinition, ToolPermissionDeniedReason } from '../../src/tools/tool-registry.types';

describe('AssistantReadonlyRuntimeService', () => {
  it('starts and completes a tool call, then returns only sanitized connector data', async () => {
    const connectorExecute = jest.fn().mockResolvedValue({
      status: 'succeeded',
      data: {
        orderId: 'SO-10001',
        status: 'picking',
        amount: 128000
      }
    });
    const startToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-001' } });
    const completeToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-001' } });
    const service = createRuntimeService({
      connectorExecute,
      startToolCall,
      completeToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(startToolCall).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'mock.orders.status.lookup' }));
    expect(connectorExecute).toHaveBeenCalledWith(expect.objectContaining({ toolKey: 'mock.orders.status.lookup' }));
    expect(completeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-001',
        sanitizedResult: { status: 'picking' }
      })
    );
    expect(result.toolCallId).toBe('tool-call-001');
    expect(result.toolLifecycle).toBe('completed');
    expect(result.sanitizedResult).toEqual({ status: 'picking' });
    expect(JSON.stringify(result)).not.toContain('128000');
  });

  it.each<ToolPermissionDeniedReason>(['tool_not_registered', 'tool_inactive'])(
    'blocks the tool call and does not call the connector when registry resolution fails with %s',
    async (deniedReason) => {
      const connectorExecute = jest.fn();
      const recordDenied = jest.fn();
      const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-001' } });
      const service = createRuntimeService({
        registryResult: { deniedReason },
        connectorExecute,
        recordDenied,
        blockToolCall
      });

      const result = await service.execute(runtimeInput());

      expect(connectorExecute).not.toHaveBeenCalled();
      expect(recordDenied).toHaveBeenCalledWith(expect.objectContaining({ deniedReason }));
      expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason }));
      expect(result.toolCallId).toBe('tool-call-blocked-001');
      expect(result.toolLifecycle).toBe('blocked');
      expect(result.deniedReason).toBe(deniedReason);
    }
  );

  it('blocks the tool call and does not call the connector when input schema validation fails', async () => {
    const connectorExecute = jest.fn();
    const recordDenied = jest.fn();
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-schema' } });
    const service = createRuntimeService({
      validation: {
        valid: false,
        deniedReason: 'schema_invalid',
        schemaErrorReason: 'missing_required_entityId'
      },
      connectorExecute,
      recordDenied,
      blockToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).not.toHaveBeenCalled();
    expect(recordDenied).toHaveBeenCalledWith(
      expect.objectContaining({
        deniedReason: 'schema_invalid',
        schemaErrorReason: 'missing_required_entityId'
      })
    );
    expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'schema_invalid' }));
    expect(result.toolLifecycle).toBe('blocked');
    expect(result.deniedReason).toBe('schema_invalid');
  });

  it('blocks the tool call and does not call the connector when permission pre-check denies execution', async () => {
    const connectorExecute = jest.fn();
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-permission' } });
    const service = createRuntimeService({
      permission: {
        allowed: false,
        reason: 'missing_scope',
        missingScopes: ['orders:read']
      },
      connectorExecute,
      blockToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).not.toHaveBeenCalled();
    expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'missing_scope' }));
    expect(result.toolLifecycle).toBe('blocked');
    expect(result.deniedReason).toBe('missing_scope');
  });

  it('fails an in-progress tool call when the connector returns a failed result', async () => {
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-001' } });
    const service = createRuntimeService({
      connectorExecute: jest.fn().mockResolvedValue({
        status: 'failed',
        error: { code: 'NOT_FOUND', message: 'Record not found.' }
      }),
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(failToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'NOT_FOUND' }));
    expect(result.toolCallId).toBe('tool-call-failed-001');
    expect(result.toolLifecycle).toBe('failed');
    expect(result.connectorStatus).toBe('failed');
    expect(result.sanitizedResult).toEqual({});
  });

  it.each([
    ['Customer', (input: ReturnType<typeof runtimeInput>) => {
      input.executionPlan.customerId = 'customer-b';
    }],
    ['session', (input: ReturnType<typeof runtimeInput>) => {
      input.executionPlan.sessionId = 'session-hidden-001';
    }],
    ['source message', (input: ReturnType<typeof runtimeInput>) => {
      input.executionPlan.messageId = 'message-hidden-user-001';
    }]
  ])('rejects a mismatched %s execution-plan parent before all runtime downstream work', async (_label, mutate) => {
    const harness = createMismatchRuntimeHarness();
    const input = runtimeInput();
    mutate(input);

    await expect(harness.service.execute(input)).rejects.toMatchObject({
      status: 404,
      response: {
        error: 'NOT_FOUND',
        message: 'Assistant runtime context not found.'
      }
    });

    expect(harness.toolRegistry.resolveToolForCustomer).not.toHaveBeenCalled();
    expect(harness.toolRegistry.validateInput).not.toHaveBeenCalled();
    expect(harness.permissionPrecheck.checkResolvedCustomerTool).not.toHaveBeenCalled();
    expect(harness.permissionPrecheck.recordRuntimeCustomerToolDenied).not.toHaveBeenCalled();
    expect(harness.toolCallService.startToolCall).not.toHaveBeenCalled();
    expect(harness.toolCallService.completeToolCall).not.toHaveBeenCalled();
    expect(harness.toolCallService.failToolCall).not.toHaveBeenCalled();
    expect(harness.toolCallService.blockToolCall).not.toHaveBeenCalled();
    expect(harness.connector.execute).not.toHaveBeenCalled();
  });
});

describe('ToolCallService', () => {
  it('creates, completes, fails, and blocks tool calls with lifecycle-safe payloads', async () => {
    const create = jest.fn().mockImplementation(async ({ data }) => ({ id: 'tool-call-001', ...data }));
    const findFirst = jest.fn().mockImplementation(async ({ where }) => ({ id: where.id ?? 'tool-call-001', customerId: where.customerId, sessionId: where.sessionId, messageId: where.messageId }));
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const appendCustomerToolEvent = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const customerScope = createCustomerScopeFromIdentityContext(identityContext());
    const service = new ToolCallService(
      {
        db: {
          assistantSession: { findFirst: jest.fn().mockResolvedValue({ id: 'session-001', customerId: 'customer-a' }) },
          assistantMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'message-001', customerId: 'customer-a', sessionId: 'session-001' }) },
          toolCall: {
            create,
            findFirst,
            updateMany
          }
        }
      } as unknown as PrismaService,
      { appendCustomerToolEvent } as never
    );

    const started = await service.startToolCall({
      customerScope,
      requestId: 'req-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      identityContext: identityContext(),
      toolName: 'mock.orders.status.lookup',
      toolVersion: '1.0.0',
      riskLevel: RiskLevel.low,
      entityId: 'SO-10001',
      visibleFields: ['status']
    });

    await service.completeToolCall({
      customerScope,
      requestId: 'req-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      identityContext: identityContext(),
      toolCallId: started.toolCall.id,
      toolName: 'mock.orders.status.lookup',
      toolVersion: '1.0.0',
      riskLevel: RiskLevel.low,
      visibleFields: ['status'],
      sanitizedResult: { status: '已確認' },
      durationMs: 3
    });

    await service.failToolCall({
      customerScope,
      requestId: 'req-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      identityContext: identityContext(),
      toolCallId: started.toolCall.id,
      toolName: 'mock.orders.status.lookup',
      toolVersion: '1.0.0',
      riskLevel: RiskLevel.low,
      errorCode: 'NOT_FOUND',
      durationMs: 3
    });

    await service.blockToolCall({
      customerScope,
      requestId: 'req-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      identityContext: identityContext(),
      toolName: 'mock.orders.status.lookup',
      toolVersion: '1.0.0',
      riskLevel: RiskLevel.low,
      entityId: 'SO-10001',
      visibleFields: ['status'],
      deniedReason: 'missing_scope'
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ToolCallStatus.pending,
          executionStatus: ToolExecutionStatus.in_progress,
          inputSummary: {
            entityId: 'SO-10001',
            visibleFieldCount: 1
          }
        })
      })
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ToolCallStatus.success,
          executionStatus: ToolExecutionStatus.executed,
          outputSummary: { status: '已確認' }
        })
      })
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ToolCallStatus.failed,
          executionStatus: ToolExecutionStatus.failed,
          outputSummary: {},
          errorCode: 'NOT_FOUND'
        })
      })
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ToolCallStatus.blocked,
          executionStatus: ToolExecutionStatus.not_started,
          outputSummary: {},
          errorCode: 'missing_scope'
        })
      })
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain('128000');
    expect(appendCustomerToolEvent).toHaveBeenCalledWith(expect.objectContaining({ customerScope, eventType: 'tool_call_started' }));
    expect(appendCustomerToolEvent).toHaveBeenCalledWith(expect.objectContaining({ customerScope, eventType: 'tool_call_completed' }));
    expect(appendCustomerToolEvent).toHaveBeenCalledWith(expect.objectContaining({ customerScope, eventType: 'tool_call_failed' }));
    expect(appendCustomerToolEvent).toHaveBeenCalledWith(expect.objectContaining({ customerScope, eventType: 'tool_call_blocked' }));
  });

  it('returns an own Customer result only for its exact session/message parent', async () => {
    const owned = { id: 'tool-call-owned', customerId: 'customer-a', sessionId: 'session-001', messageId: 'message-001', outputSummary: { safe: 'visible' }, errorCode: null, status: ToolCallStatus.success };
    const findFirst = jest.fn().mockImplementation(async ({ where }) => (
      where.customerId === 'customer-a' && where.id === owned.id && where.sessionId === owned.sessionId && where.messageId === owned.messageId ? owned : null
    ));
    const scope = createCustomerScopeFromIdentityContext(identityContext());
    const service = new ToolCallService(
      { db: { toolCall: { findFirst } } } as unknown as PrismaService,
      { appendCustomerToolEvent: jest.fn() } as never
    );

    await expect(service.getVisibleToolCall({ customerScope: scope, toolCallId: owned.id, sessionId: owned.sessionId, messageId: owned.messageId })).resolves.toEqual(owned);
  });

  it.each([
    ['foreign Customer', 'customer-b', 'session-001', 'message-001'],
    ['wrong session', 'customer-a', 'session-other', 'message-001'],
    ['wrong message', 'customer-a', 'session-001', 'message-other']
  ])('returns the same safe not-found result for %s', async (_scenario, customerId, sessionId, messageId) => {
    const foreign = { id: 'tool-call-private', customerId: 'customer-b', sessionId: 'session-001', messageId: 'message-001', outputSummary: { secret: 'never-disclose' }, errorCode: 'PRIVATE', status: ToolCallStatus.failed };
    const findFirst = jest.fn().mockResolvedValue(null);
    const scope = createCustomerScopeFromIdentityContext({ ...identityContext(), customer: { customerId, integrationId: 'integration-erp' } });
    const service = new ToolCallService({ db: { toolCall: { findFirst } } } as unknown as PrismaService, { appendCustomerToolEvent: jest.fn() } as never);

    await expect(service.getVisibleToolCall({ customerScope: scope, toolCallId: foreign.id, sessionId, messageId })).rejects.toMatchObject({ status: 404, response: { error: 'NOT_FOUND' } });
    expect(JSON.stringify((await findFirst.mock.results[0].value) ?? {})).not.toContain('never-disclose');
    expect(findFirst).toHaveBeenCalledWith({ where: { customerId, id: foreign.id, sessionId, messageId } });
  });
});

function createRuntimeService(overrides?: {
  registryResult?: { resolved?: { tool: RegisteredToolDefinition; requiredRoles: readonly string[]; requiredPermissionScopes: readonly string[] }; deniedReason?: ToolPermissionDeniedReason };
  validation?: { valid: true } | { valid: false; deniedReason: 'schema_invalid'; schemaErrorReason: string };
  permission?: { allowed: true } | { allowed: false; reason: ToolPermissionDeniedReason; missingScopes?: string[] };
  connectorExecute?: jest.Mock;
  recordDenied?: jest.Mock;
  startToolCall?: jest.Mock;
  completeToolCall?: jest.Mock;
  failToolCall?: jest.Mock;
  blockToolCall?: jest.Mock;
}) {
  return new AssistantReadonlyRuntimeService(
    {
      resolveToolForCustomer: jest.fn().mockResolvedValue(overrides?.registryResult ?? { resolved: { tool: registeredTool(), requiredRoles: [], requiredPermissionScopes: [] } }),
      isExecutableReadOnly: jest.fn().mockReturnValue(true),
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
      checkResolvedCustomerTool: jest.fn().mockResolvedValue(overrides?.permission ?? { allowed: true }),
      recordRuntimeCustomerToolDenied: overrides?.recordDenied ?? jest.fn()
    } as never,
    {
      startToolCall: overrides?.startToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-001' } }),
      completeToolCall: overrides?.completeToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-001' } }),
      failToolCall: overrides?.failToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-001' } }),
      blockToolCall: overrides?.blockToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-001' } })
    } as never,
    {
      sanitize: jest.fn(({ record, visibleFields }) => ({
        sanitized: Object.fromEntries(Object.entries(record).filter(([field]) => visibleFields.includes(field))),
        visibleFields,
        removedFieldCount: Object.keys(record).filter((field) => !visibleFields.includes(field)).length
      }))
    } as never
  );
}

function registeredTool(): RegisteredToolDefinition {
  return {
    id: 'tool-definition-orders-001',
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
    },
    hasSideEffect: false,
    requiresConfirmation: false,
    requiresApproval: false
  };
}

function runtimeInput() {
  return {
    customerScope: createCustomerScopeFromIdentityContext(identityContext()),
    requestId: 'req-001',
    sessionId: 'session-001',
    sourceMessageId: 'message-user-001',
    responseMessageId: 'message-001',
    identityContext: identityContext(),
    executionPlan: {
      id: 'plan-001',
      customerId: 'customer-a',
      sessionId: 'session-001',
      messageId: 'message-user-001',
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
    customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
    organization: { organizationId: 'org-001' },
    hostApp: { hostApp: 'erp' },
    actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
    auth: { tokenId: 'token-001', gatewayIssuer: 'https://gateway.test.internal' }
  };
}

function createMismatchRuntimeHarness() {
  const toolRegistry = {
    resolveToolForCustomer: jest.fn(),
    isExecutableReadOnly: jest.fn(),
    validateInput: jest.fn()
  };
  const connector = { execute: jest.fn() };
  const permissionPrecheck = {
    checkResolvedCustomerTool: jest.fn(),
    recordRuntimeCustomerToolDenied: jest.fn()
  };
  const toolCallService = {
    startToolCall: jest.fn(),
    completeToolCall: jest.fn(),
    failToolCall: jest.fn(),
    blockToolCall: jest.fn()
  };

  return {
    service: new AssistantReadonlyRuntimeService(
      toolRegistry as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[0],
      connector as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[1],
      permissionPrecheck as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[2],
      toolCallService as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[3],
      { sanitize: jest.fn() } as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[4]
    ),
    toolRegistry,
    connector,
    permissionPrecheck,
    toolCallService
  };
}
