import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RiskLevel, ExecutionDecision, ToolCallStatus, ToolExecutionStatus, ToolOperation } from '../../src/generated/prisma/enums';
import { AssistantReadonlyRuntimeService } from '../../src/assistant/runtime/assistant-readonly-runtime.service';
import { AssistantReadonlyRuntimeInput } from '../../src/assistant/runtime/runtime.types';
import { ToolCallService } from '../../src/assistant/runtime/tool-call.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  RegisteredToolDefinition,
  SafeProjectedAdapterResult,
  ToolPermissionDeniedReason
} from '../../src/tools/tool-registry.types';

describe('AssistantReadonlyRuntimeService', () => {
  it('starts before connector execution and completes only from projected connector data', async () => {
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
    const registrySelect = jest.fn().mockResolvedValue({ execute: connectorExecute });
    const projectedResult = safeProjectedResult({ status: 'picking' });
    const service = createRuntimeService({
      connectorExecute,
      registrySelect,
      startToolCall,
      completeToolCall,
      projectorProject: jest.fn().mockReturnValue({ projected: true, result: projectedResult })
    });

    const input = runtimeInput();
    input.executionPlan.candidateTools = [
      {
        key: 'mock.orders.status.lookup',
        arguments: { entityId: 'SO-10002' },
        reason: 'order status query',
        operation: 'mock.orders.cancel'
      }
    ];
    input.transientConnectorContext = Object.freeze({ connectorContextRef: 'ccr_phase5_selected_only' });
    const result = await service.execute(input);

    expect(startToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'mock.orders.status.lookup',
        safeInputSummary: {
          canonicalToolKey: 'mock.orders.status.lookup',
          schemaVersion: '1.0.0',
          argumentKeys: ['entityId'],
          argumentCount: 1
        }
      })
    );
    expect(registrySelect).toHaveBeenCalledWith({
      host: input.hostIntegrationContext,
      tool: registeredTool(),
      operation: {
        canonicalToolKey: 'mock.orders.status.lookup',
        schemaVersion: '1.0.0',
        arguments: { entityId: 'SO-10002' }
      }
    });
    expect(JSON.stringify(registrySelect.mock.calls)).not.toContain('ccr_phase5_selected_only');
    expect(connectorExecute).toHaveBeenCalledWith(expect.objectContaining({
      host: input.hostIntegrationContext,
      operation: expect.objectContaining({
        canonicalToolKey: 'mock.orders.status.lookup',
        arguments: { entityId: 'SO-10002' }
      }),
      transientConnectorContext: input.transientConnectorContext
    }));
    expect(JSON.stringify(startToolCall.mock.calls)).not.toContain('SO-10002');
    expect(JSON.stringify(startToolCall.mock.calls)).not.toContain('mock.orders.cancel');
    expect(startToolCall.mock.invocationCallOrder[0]).toBeLessThan(connectorExecute.mock.invocationCallOrder[0]);
    expect(startToolCall.mock.invocationCallOrder[0]).toBeLessThan(registrySelect.mock.invocationCallOrder[0]);
    expect(registrySelect.mock.invocationCallOrder[0]).toBeLessThan(connectorExecute.mock.invocationCallOrder[0]);
    expect(completeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-001',
        projectedResult
      })
    );
    expect(JSON.stringify(completeToolCall.mock.calls)).not.toContain('128000');
    expect(result.toolCallId).toBe('tool-call-001');
    expect(result.toolLifecycle).toBe('completed');
    expect(result.projectedResult).toBe(projectedResult);
    expect(JSON.stringify(result)).not.toContain('128000');
  });

  it.each<ToolPermissionDeniedReason>(['tool_not_registered', 'tool_inactive'])(
    'blocks the tool call and does not call the connector when registry resolution fails with %s',
    async (deniedReason) => {
      const connectorExecute = jest.fn();
      const registrySelect = jest.fn();
      const recordDenied = jest.fn();
      const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-001' } });
      const service = createRuntimeService({
        registryResult: { deniedReason },
        connectorExecute,
        registrySelect,
        recordDenied,
        blockToolCall
      });

      const result = await service.execute(runtimeInput());

      expect(connectorExecute).not.toHaveBeenCalled();
      expect(registrySelect).not.toHaveBeenCalled();
      expect(recordDenied).toHaveBeenCalledWith(expect.objectContaining({ deniedReason }));
      expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason }));
      expect(result.toolCallId).toBe('tool-call-blocked-001');
      expect(result.toolLifecycle).toBe('blocked');
      expect(result.deniedReason).toBe(deniedReason);
    }
  );

  it('blocks the tool call and does not call the connector when input schema validation fails', async () => {
    const connectorExecute = jest.fn();
    const registrySelect = jest.fn();
    const recordDenied = jest.fn();
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-schema' } });
    const service = createRuntimeService({
      validation: {
        valid: false,
        deniedReason: 'schema_invalid',
        schemaErrorReason: 'missing_required_entityId'
      },
      connectorExecute,
      registrySelect,
      recordDenied,
      blockToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).not.toHaveBeenCalled();
    expect(registrySelect).not.toHaveBeenCalled();
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

  it('blocks malformed candidate arguments before ToolCall start or connector execution', async () => {
    const connectorExecute = jest.fn();
    const registrySelect = jest.fn();
    const startToolCall = jest.fn();
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-unsafe' } });
    const service = createRuntimeService({
      validation: {
        valid: false,
        deniedReason: 'schema_invalid',
        schemaErrorReason: 'prohibited_argument'
      },
      connectorExecute,
      registrySelect,
      startToolCall,
      blockToolCall
    });
    const input = runtimeInput();
    input.executionPlan.candidateTools = [
      {
        key: 'mock.orders.status.lookup',
        arguments: { entityId: 'SO-10001', connectorContextRef: 'ccr_runtime_secret' },
        reason: 'unsafe candidate',
        operation: 'delete'
      }
    ];

    const result = await service.execute(input);

    expect(startToolCall).not.toHaveBeenCalled();
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(registrySelect).not.toHaveBeenCalled();
    expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'schema_invalid' }));
    expect(JSON.stringify(blockToolCall.mock.calls)).not.toContain('ccr_runtime_secret');
    expect(result.toolLifecycle).toBe('blocked');
  });

  it('blocks the tool call and does not call the connector when permission pre-check denies execution', async () => {
    const connectorExecute = jest.fn();
    const registrySelect = jest.fn();
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-permission' } });
    const service = createRuntimeService({
      permission: {
        allowed: false,
        reason: 'missing_scope',
        missingScopes: ['orders:read']
      },
      connectorExecute,
      registrySelect,
      blockToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).not.toHaveBeenCalled();
    expect(registrySelect).not.toHaveBeenCalled();
    expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'missing_scope' }));
    expect(result.toolLifecycle).toBe('blocked');
    expect(result.deniedReason).toBe('missing_scope');
  });

  it('re-resolves a stable explicitly disabled discovery match and creates one blocked ToolCall', async () => {
    const connectorExecute = jest.fn();
    const registrySelect = jest.fn();
    const startToolCall = jest.fn();
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-policy-denied' } });
    const recordDenied = jest.fn();
    const checkResolvedCustomerTool = jest.fn();
    const resolveToolForCustomer = jest.fn().mockResolvedValue({ deniedReason: 'customer_policy_denied' });
    const service = createRuntimeService({
      resolveToolForCustomer,
      checkResolvedCustomerTool,
      connectorExecute,
      registrySelect,
      startToolCall,
      blockToolCall,
      recordDenied
    });
    const input = runtimeInput();
    input.executionPlan.candidateTools = [{
      key: 'mock.orders.status.lookup',
      arguments: { entityId: 'SO-10001' },
      reason: 'metadata_discovery_policy_denied'
    }];

    const result = await service.execute(input);

    expect(resolveToolForCustomer).toHaveBeenCalledWith('mock.orders.status.lookup', input.customerScope);
    expect(checkResolvedCustomerTool).not.toHaveBeenCalled();
    expect(startToolCall).not.toHaveBeenCalled();
    expect(registrySelect).not.toHaveBeenCalled();
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(recordDenied).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'customer_policy_denied' }));
    expect(blockToolCall).toHaveBeenCalledTimes(1);
    expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'customer_policy_denied' }));
    expect(result).toMatchObject({
      toolCallId: 'tool-call-policy-denied',
      toolLifecycle: 'blocked',
      deniedReason: 'customer_policy_denied'
    });
  });

  it('uses the current enabled policy and invokes the existing permission precheck after a denied discovery snapshot', async () => {
    const checkResolvedCustomerTool = jest.fn().mockResolvedValue({
      allowed: false,
      reason: 'missing_scope',
      missingScopes: ['orders:read']
    });
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-current-permission' } });
    const resolveToolForCustomer = jest.fn().mockResolvedValue({
      resolved: {
        tool: registeredTool(),
        requiredRoles: [],
        requiredPermissionScopes: ['orders:read']
      }
    });
    const registrySelect = jest.fn();
    const connectorExecute = jest.fn();
    const service = createRuntimeService({
      resolveToolForCustomer,
      checkResolvedCustomerTool,
      blockToolCall,
      registrySelect,
      connectorExecute
    });
    const input = runtimeInput();
    input.executionPlan.candidateTools = [{
      key: 'mock.orders.status.lookup',
      arguments: { entityId: 'SO-10001' },
      reason: 'metadata_discovery_policy_denied'
    }];

    const result = await service.execute(input);

    expect(resolveToolForCustomer).toHaveBeenCalledWith('mock.orders.status.lookup', input.customerScope);
    expect(checkResolvedCustomerTool).toHaveBeenCalledWith(expect.objectContaining({
      customerScope: input.customerScope,
      resolvedTool: expect.objectContaining({ tool: expect.objectContaining({ key: 'mock.orders.status.lookup' }) })
    }));
    expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'missing_scope' }));
    expect(registrySelect).not.toHaveBeenCalled();
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ toolLifecycle: 'blocked', deniedReason: 'missing_scope' });
  });

  it('fails closed when an originally eligible discovery candidate is disabled before runtime', async () => {
    const connectorExecute = jest.fn();
    const registrySelect = jest.fn();
    const blockToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-latest-policy-denied' } });
    const checkResolvedCustomerTool = jest.fn();
    const resolveToolForCustomer = jest.fn().mockResolvedValue({ deniedReason: 'customer_policy_denied' });
    const service = createRuntimeService({
      resolveToolForCustomer,
      checkResolvedCustomerTool,
      connectorExecute,
      registrySelect,
      blockToolCall
    });
    const input = runtimeInput();
    input.executionPlan.candidateTools = [{
      key: 'mock.orders.status.lookup',
      arguments: { entityId: 'SO-10001' },
      reason: 'metadata_discovery'
    }];

    const result = await service.execute(input);

    expect(resolveToolForCustomer).toHaveBeenCalledWith('mock.orders.status.lookup', input.customerScope);
    expect(checkResolvedCustomerTool).not.toHaveBeenCalled();
    expect(registrySelect).not.toHaveBeenCalled();
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(blockToolCall).toHaveBeenCalledTimes(1);
    expect(blockToolCall).toHaveBeenCalledWith(expect.objectContaining({ deniedReason: 'customer_policy_denied' }));
    expect(result).toMatchObject({ toolLifecycle: 'blocked', deniedReason: 'customer_policy_denied' });
  });

  it('keeps discovery provenance out of runtime policy and permission authority', () => {
    const runtimeSource = readFileSync(
      join(process.cwd(), 'src/assistant/runtime/assistant-readonly-runtime.service.ts'),
      'utf8'
    );

    expect(runtimeSource).not.toContain('POLICY_DENIED_DISCOVERY_REASON');
    expect(runtimeSource).not.toMatch(/candidate\.reason/);
    expect(runtimeSource).toContain('resolveToolForCustomer(toolName, input.customerScope)');
  });

  it('keeps productized transport unreachable until the existing permission precheck succeeds', async () => {
    const transportInvoke = jest.fn();
    const productizedExecute = jest.fn(() => transportInvoke());
    const registrySelect = jest.fn().mockResolvedValue({ execute: productizedExecute });
    const service = createRuntimeService({
      permission: { allowed: false, reason: 'missing_scope', missingScopes: ['inventory:read'] },
      registrySelect,
      connectorExecute: productizedExecute
    });

    const result = await service.execute(runtimeInput());

    expect(registrySelect).not.toHaveBeenCalled();
    expect(productizedExecute).not.toHaveBeenCalled();
    expect(transportInvoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({ toolLifecycle: 'blocked', deniedReason: 'missing_scope' });
  });

  it('fails the started ToolCall with a bounded code when trusted registry selection fails', async () => {
    const connectorExecute = jest.fn();
    const completeToolCall = jest.fn();
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-registry' } });
    const registrySelect = jest.fn().mockRejectedValue(new Error('PRIVATE_ADAPTER_INVENTORY_SENTINEL'));
    const service = createRuntimeService({
      connectorExecute,
      registrySelect,
      completeToolCall,
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(connectorExecute).not.toHaveBeenCalled();
    expect(completeToolCall).not.toHaveBeenCalled();
    expect(failToolCall).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'DATA_ADAPTER_UNAVAILABLE'
    }));
    expect(JSON.stringify({ calls: failToolCall.mock.calls, result })).not.toContain('PRIVATE_ADAPTER_INVENTORY_SENTINEL');
    expect(result).toEqual(expect.objectContaining({
      toolCallId: 'tool-call-failed-registry',
      toolLifecycle: 'failed',
      connectorErrorCode: 'DATA_ADAPTER_UNAVAILABLE'
    }));
  });

  it('fails closed after ToolCall start when the trusted timeout configuration is invalid', async () => {
    const connectorExecute = jest.fn();
    const startToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-invalid-timeout' } });
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-invalid-timeout' } });
    const service = createRuntimeService({
      registryResult: {
        resolved: {
          tool: { ...registeredTool(), timeoutMs: 0 },
          requiredRoles: [],
          requiredPermissionScopes: []
        }
      },
      connectorExecute,
      startToolCall,
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(startToolCall).toHaveBeenCalled();
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(failToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'TOOL_EXECUTION_FAILED' }));
    expect(result).toEqual(expect.objectContaining({
      toolLifecycle: 'failed',
      connectorErrorCode: 'TOOL_EXECUTION_FAILED'
    }));
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
    expect(result.projectedResult).toBeUndefined();
  });

  it('replaces an unknown connector error code with the bounded execution failure code', async () => {
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-bounded' } });
    const service = createRuntimeService({
      connectorExecute: jest.fn().mockResolvedValue({
        status: 'failed',
        error: { code: 'RAW_CUSTOMER_SECRET_008', message: 'RAW_ADAPTER_RESULT_SENTINEL_008' }
      }),
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(failToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'TOOL_EXECUTION_FAILED' }));
    expect(JSON.stringify({ calls: failToolCall.mock.calls, result })).not.toContain('RAW_CUSTOMER_SECRET_008');
    expect(JSON.stringify({ calls: failToolCall.mock.calls, result })).not.toContain('RAW_ADAPTER_RESULT_SENTINEL_008');
    expect(result.connectorErrorCode).toBe('TOOL_EXECUTION_FAILED');
  });

  it('preserves the bounded public connector-unavailable code without releasing connector details', async () => {
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-unavailable' } });
    const service = createRuntimeService({
      connectorExecute: jest.fn().mockResolvedValue({
        status: 'failed',
        error: { code: 'CONNECTOR_UNAVAILABLE', message: 'PRIVATE_CONNECTOR_DETAIL' }
      }),
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(failToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'CONNECTOR_UNAVAILABLE' }));
    expect(result.connectorErrorCode).toBe('CONNECTOR_UNAVAILABLE');
    expect(JSON.stringify({ calls: failToolCall.mock.calls, result })).not.toContain('PRIVATE_CONNECTOR_DETAIL');
  });

  it('fails the started ToolCall with a bounded code when connector execution throws', async () => {
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-throw' } });
    const service = createRuntimeService({
      connectorExecute: jest.fn().mockRejectedValue(new Error('RAW_ADAPTER_RESULT_SENTINEL_008')),
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(failToolCall).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'TOOL_EXECUTION_FAILED' }));
    expect(JSON.stringify(failToolCall.mock.calls)).not.toContain('RAW_ADAPTER_RESULT_SENTINEL_008');
    expect(result).toEqual(expect.objectContaining({
      toolCallId: 'tool-call-failed-throw',
      toolLifecycle: 'failed',
      connectorErrorCode: 'TOOL_EXECUTION_FAILED'
    }));
    expect(result.projectedResult).toBeUndefined();
  });

  it('fails the started ToolCall when projection returns a bounded failure', async () => {
    const completeToolCall = jest.fn();
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-projection' } });
    const service = createRuntimeService({
      projectorProject: jest.fn().mockReturnValue({
        projected: false,
        errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED'
      }),
      completeToolCall,
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(completeToolCall).not.toHaveBeenCalled();
    expect(failToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' })
    );
    expect(result.toolLifecycle).toBe('failed');
    expect(result.projectedResult).toBeUndefined();
  });

  it('fails the started ToolCall without exposing a thrown projection error', async () => {
    const completeToolCall = jest.fn();
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-projection-throw' } });
    const service = createRuntimeService({
      projectorProject: jest.fn(() => {
        throw new Error('RAW_ADAPTER_RESULT_SENTINEL_008');
      }),
      completeToolCall,
      failToolCall
    });

    const result = await service.execute(runtimeInput());

    expect(completeToolCall).not.toHaveBeenCalled();
    expect(failToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' })
    );
    expect(JSON.stringify({ calls: failToolCall.mock.calls, result })).not.toContain('RAW_ADAPTER_RESULT_SENTINEL_008');
    expect(result.projectedResult).toBeUndefined();
  });

  it('fails the started ToolCall when safe output summary completion fails', async () => {
    const failToolCall = jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-summary' } });
    const completeToolCall = jest.fn().mockRejectedValue(new Error('RAW_CUSTOMER_SECRET_008'));
    const service = createRuntimeService({ completeToolCall, failToolCall });

    const result = await service.execute(runtimeInput());

    expect(failToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' })
    );
    expect(JSON.stringify(failToolCall.mock.calls)).not.toContain('RAW_CUSTOMER_SECRET_008');
    expect(result).toEqual(expect.objectContaining({
      toolCallId: 'tool-call-failed-summary',
      toolLifecycle: 'failed',
      connectorErrorCode: 'ADAPTER_RESULT_PROJECTION_FAILED'
    }));
    expect(result.projectedResult).toBeUndefined();
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
    expect(harness.dataAdapterRegistry.select).not.toHaveBeenCalled();
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
      visibleFields: ['status'],
      safeInputSummary: {
        canonicalToolKey: 'mock.orders.status.lookup',
        schemaVersion: '1.0.0',
        argumentKeys: ['entityId'],
        argumentCount: 1
      }
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
      projectedResult: safeProjectedResult({ status: '已確認' }),
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
            canonicalToolKey: 'mock.orders.status.lookup',
            schemaVersion: '1.0.0',
            argumentKeys: ['entityId'],
            argumentCount: 1
          }
        })
      })
    );
    expect(JSON.stringify(create.mock.calls[0])).not.toContain('SO-10001');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ToolCallStatus.success,
          executionStatus: ToolExecutionStatus.executed,
          outputSummary: {
            canonicalToolKey: 'mock.orders.status.lookup',
            schemaVersion: '1.0.0',
            fieldPaths: ['status'],
            fieldCount: 1,
            evidenceProvenanceFields: ['orderId']
          }
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
  resolveToolForCustomer?: jest.Mock;
  checkResolvedCustomerTool?: jest.Mock;
  validation?: { valid: true } | { valid: false; deniedReason: 'schema_invalid'; schemaErrorReason: string };
  permission?: { allowed: true } | { allowed: false; reason: ToolPermissionDeniedReason; missingScopes?: string[] };
  connectorExecute?: jest.Mock;
  registrySelect?: jest.Mock;
  recordDenied?: jest.Mock;
  startToolCall?: jest.Mock;
  completeToolCall?: jest.Mock;
  failToolCall?: jest.Mock;
  blockToolCall?: jest.Mock;
  projectorProject?: jest.Mock;
}) {
  const selectedAdapterExecute = overrides?.connectorExecute ?? jest.fn().mockResolvedValue({
    status: 'succeeded',
    data: {
      orderId: 'SO-10001',
      status: 'picking',
      amount: 128000
    }
  });
  const registrySelect = overrides?.registrySelect ?? jest.fn();
  if (!overrides?.registrySelect) {
    registrySelect.mockResolvedValue({ key: 'mock', execute: selectedAdapterExecute });
  }

  return new AssistantReadonlyRuntimeService(
    {
      resolveToolForCustomer: overrides?.resolveToolForCustomer ?? jest.fn().mockResolvedValue(overrides?.registryResult ?? { resolved: { tool: registeredTool(), requiredRoles: [], requiredPermissionScopes: [] } }),
      resolveResultPolicy: jest.fn().mockReturnValue({
        allowed: true,
        policy: {
          version: '1',
          allowedFieldPaths: ['orderId', 'status'],
          deniedFieldPaths: ['organizationId'],
          permissionMasks: [],
          limits: { maxDepth: 4, maxItems: 100, maxStringLength: 512, maxTotalBytes: 16384 },
          evidenceSafeProvenanceFields: ['orderId']
        }
      }),
      isExecutableReadOnly: jest.fn().mockReturnValue(true),
      validateInput: jest.fn().mockReturnValue(overrides?.validation ?? { valid: true }),
      validateNamedOperation: jest.fn((tool, candidate) => {
        if (overrides?.validation && !overrides.validation.valid) {
          return overrides.validation;
        }
        const argumentsValue = candidate?.arguments ?? {};
        return {
          valid: true,
          operation: {
            canonicalToolKey: tool.key,
            schemaVersion: tool.version,
            arguments: argumentsValue
          },
          safeInputSummary: {
            canonicalToolKey: tool.key,
            schemaVersion: tool.version,
            argumentKeys: Object.keys(argumentsValue).sort(),
            argumentCount: Object.keys(argumentsValue).length
          }
        };
      })
    } as never,
    {
      checkResolvedCustomerTool: overrides?.checkResolvedCustomerTool ?? jest.fn().mockResolvedValue(overrides?.permission ?? { allowed: true }),
      recordRuntimeCustomerToolDenied: overrides?.recordDenied ?? jest.fn()
    } as never,
    {
      startToolCall: overrides?.startToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-001' } }),
      completeToolCall: overrides?.completeToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-001' } }),
      failToolCall: overrides?.failToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-failed-001' } }),
      blockToolCall: overrides?.blockToolCall ?? jest.fn().mockResolvedValue({ toolCall: { id: 'tool-call-blocked-001' } })
    } as never,
    {
      project:
        overrides?.projectorProject ??
        jest.fn().mockReturnValue({ projected: true, result: safeProjectedResult({ status: 'picking' }) })
    } as never,
    { select: registrySelect } as never
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
    timeoutMs: 3000,
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

function runtimeInput(): AssistantReadonlyRuntimeInput {
  const identity = identityContext();

  return {
    customerScope: createCustomerScopeFromIdentityContext(identity),
    requestId: 'req-001',
    sessionId: 'session-001',
    sourceMessageId: 'message-user-001',
    responseMessageId: 'message-001',
    identityContext: identity,
    hostIntegrationContext: Object.freeze({
      customerId: identity.customer.customerId,
      integrationId: identity.customer.integrationId,
      hostApp: identity.hostApp.hostApp,
      organizationId: identity.organization.organizationId,
      actorId: identity.actor.actorId,
      roles: Object.freeze([...identity.actor.roles]),
      permissionScopes: Object.freeze([...identity.actor.permissionScopes]),
      requestId: identity.requestId
    }),
    transientConnectorContext: Object.freeze({}),
    executionPlan: {
      id: 'plan-001',
      customerId: 'customer-a',
      sessionId: 'session-001',
      messageId: 'message-user-001',
      taskType: 'order_status_lookup',
      requiredEvidence: [],
      candidateTools: [
        {
          key: 'mock.orders.status.lookup',
          arguments: { entityId: 'SO-10001' },
          reason: 'order status query'
        }
      ],
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
  const dataAdapterRegistry = { select: jest.fn() };
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
      permissionPrecheck as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[1],
      toolCallService as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[2],
      { project: jest.fn() } as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[3],
      dataAdapterRegistry as unknown as ConstructorParameters<typeof AssistantReadonlyRuntimeService>[4]
    ),
    toolRegistry,
    dataAdapterRegistry,
    permissionPrecheck,
    toolCallService
  };
}

function safeProjectedResult(facts: Readonly<Record<string, unknown>>): SafeProjectedAdapterResult {
  return Object.freeze({
    kind: 'safe_projected_adapter_result',
    canonicalToolKey: 'mock.orders.status.lookup',
    schemaVersion: '1.0.0',
    facts: Object.freeze({ ...facts }),
    fieldPaths: Object.freeze(Object.keys(facts).sort()),
    evidenceProvenance: Object.freeze({ orderId: 'SO-10001' })
  });
}
