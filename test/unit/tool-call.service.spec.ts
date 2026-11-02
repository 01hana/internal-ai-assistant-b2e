import { RiskLevel, ToolCallStatus, ToolExecutionStatus } from '../../src/generated/prisma/enums';
import { ToolCallService } from '../../src/assistant/runtime/tool-call.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SafeProjectedAdapterResult } from '../../src/tools/tool-registry.types';

describe('ToolCallService safe summary boundary', () => {
  it('checks persisted Session Integration before exposing a ToolCall', async () => {
    const sessionLookup = jest.fn(async ({ where }: { where: { integrationId: string } }) =>
      where.integrationId === 'integration-erp' ? { id: 'session-008' } : null);
    const toolLookup = jest.fn().mockResolvedValue({ id: 'tool-call-008', customerId: 'customer-a' });
    const service = new ToolCallService({ db: {
      assistantSession: { findFirst: sessionLookup }, toolCall: { findFirst: toolLookup }
    } } as unknown as PrismaService, { appendCustomerToolEvent: jest.fn() } as never);
    const owner = lifecycleInput();
    const foreign = { ...owner, customerScope: { ...owner.customerScope, integrationId: 'integration-other' },
      toolCallId: 'tool-call-008' };
    await expect(service.getVisibleToolCall(foreign)).rejects.toMatchObject({ status: 404 });
    expect(toolLookup).not.toHaveBeenCalled();
    expect(sessionLookup).toHaveBeenCalledWith({ where: expect.objectContaining({
      customerId: 'customer-a', integrationId: 'integration-other', id: 'session-008'
    }) });
    await expect(service.getVisibleToolCall({ ...owner, toolCallId: 'tool-call-008' }))
      .resolves.toMatchObject({ id: 'tool-call-008' });
  });

  it('persists a closed output summary derived only from SafeProjectedAdapterResult', async () => {
    const create = jest.fn().mockImplementation(async ({ data }) => ({ id: 'tool-call-008', ...data }));
    const findFirst = jest.fn().mockImplementation(async ({ where }) => ({
      id: where.id ?? 'tool-call-008',
      customerId: where.customerId,
      sessionId: where.sessionId,
      messageId: where.messageId
    }));
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const appendCustomerToolEvent = jest.fn().mockResolvedValue({ id: 'audit-008' });
    const service = new ToolCallService(
      {
        db: {
          assistantSession: { findFirst: jest.fn().mockResolvedValue({ id: 'session-008' }) },
          assistantMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'message-008' }) },
          toolCall: { create, findFirst, updateMany }
        }
      } as unknown as PrismaService,
      { appendCustomerToolEvent } as never
    );
    const projectedResult = safeProjectedResult();

    const started = await service.startToolCall({
      ...lifecycleInput(),
      safeInputSummary: {
        canonicalToolKey: 'mock.orders.status.lookup',
        schemaVersion: '1.0.0',
        argumentKeys: ['entityId'],
        argumentCount: 1
      }
    });
    await service.completeToolCall({
      ...lifecycleInput(),
      toolCallId: started.toolCall.id,
      projectedResult,
      durationMs: 4
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        inputSummary: {
          canonicalToolKey: 'mock.orders.status.lookup',
          schemaVersion: '1.0.0',
          argumentKeys: ['entityId'],
          argumentCount: 1
        }
      })
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: ToolCallStatus.success,
        executionStatus: ToolExecutionStatus.executed,
        outputSummary: {
          canonicalToolKey: 'mock.orders.status.lookup',
          schemaVersion: '1.0.0',
          fieldPaths: ['orderId', 'status'],
          fieldCount: 2,
          evidenceProvenanceFields: ['orderId']
        }
      })
    }));
    const persistedAndAudited = JSON.stringify({
      create: create.mock.calls,
      update: updateMany.mock.calls,
      audit: appendCustomerToolEvent.mock.calls
    });
    expect(persistedAndAudited).not.toContain('picking');
    expect(persistedAndAudited).not.toContain('SO-10001');
    expect(persistedAndAudited).not.toContain('RAW_ADAPTER_RESULT_SENTINEL_008');
  });

  it('has compile-time closed start and completion inputs', () => {
    const service = {} as ToolCallService;
    const compileOnly = () => {
      // @ts-expect-error executable starts require the approved safe input summary
      void service.startToolCall(lifecycleInput());
      void service.completeToolCall({
        ...lifecycleInput(),
        toolCallId: 'tool-call-008',
        // @ts-expect-error arbitrary sanitized records are not a ToolCall completion authority
        sanitizedResult: { rawResult: 'RAW_ADAPTER_RESULT_SENTINEL_008' }
      });
    };

    expect(compileOnly).toEqual(expect.any(Function));
  });
});

function safeProjectedResult(): SafeProjectedAdapterResult {
  return Object.freeze({
    kind: 'safe_projected_adapter_result',
    canonicalToolKey: 'mock.orders.status.lookup',
    schemaVersion: '1.0.0',
    facts: Object.freeze({ orderId: 'SO-10001', status: 'picking' }),
    fieldPaths: Object.freeze(['status', 'orderId']),
    evidenceProvenance: Object.freeze({ orderId: 'SO-10001' })
  });
}

function lifecycleInput() {
  const identityContext = {
    requestId: 'req-008',
    customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
    organization: { organizationId: 'org-001' },
    hostApp: { hostApp: 'erp' },
    actor: { actorId: 'actor-001', roles: ['planner'], permissionScopes: ['orders:read'] },
    auth: { tokenId: 'token-008', gatewayIssuer: 'https://gateway.test.internal' }
  };
  return {
    customerScope: createCustomerScopeFromIdentityContext(identityContext),
    requestId: 'req-008',
    sessionId: 'session-008',
    messageId: 'message-008',
    identityContext,
    toolName: 'mock.orders.status.lookup',
    toolVersion: '1.0.0',
    riskLevel: RiskLevel.low,
    entityId: 'SO-RAW-SECRET-008',
    visibleFields: ['status']
  };
}
