import { SideEffectExecutionGuardService } from '../../src/approvals/side-effect-execution-guard.service';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { RiskLevel, ToolCallStatus, ToolExecutionStatus, ToolOperation } from '../../src/generated/prisma/enums';
import { ToolPermissionPrecheckService } from '../../src/permissions/tool-permission-precheck.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';

const describeUs3 = process.env.RUN_CUSTOMER_US3_TESTS === 'true' ? describe : describe.skip;

describeUs3('Customer-scoped side-effect idempotency contract', () => {
  it('replays a same-Customer key only after parent, tool, policy, permission, and contract rechecks', async () => {
    const harness = createHarness('customer-a', { id: 'tool-call-a', customerId: 'customer-a', sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001' });

    const result = await harness.service.execute(sideEffectInput('customer-a'));

    expect(result).toMatchObject({ toolCallId: 'tool-call-a', duplicateSafe: true, idempotencyStatus: 'duplicate' });
    expect(harness.sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: 'customer-a', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared' }) }));
    expect(harness.toolRegistry.resolveToolForCustomer).toHaveBeenCalled();
    expect(harness.precheck.checkResolvedCustomerTool).toHaveBeenCalled();
    expect(harness.toolCallFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'customer-a', idempotencyKey: 'shared-tool-idempotency-key' } }));
    expect(harness.connector.execute).not.toHaveBeenCalled();
    expect(harness.toolCallCreate).not.toHaveBeenCalled();
  });

  it('allows a different Customer to execute the same key independently', async () => {
    const harness = createHarness('customer-b', null);

    const result = await harness.service.execute(sideEffectInput('customer-b'));

    expect(result).toMatchObject({ duplicateSafe: false, idempotencyStatus: 'executed' });
    expect(harness.toolCallFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'customer-b', idempotencyKey: 'shared-tool-idempotency-key' } }));
    expect(harness.toolCallCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: 'customer-b', idempotencyKey: 'shared-tool-idempotency-key' }) }));
    expect(harness.connector.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a bad repository returns a foreign duplicate row', async () => {
    const harness = createHarness('customer-a', { id: 'tool-call-b', customerId: 'customer-b', sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001' });

    await expect(harness.service.execute(sideEffectInput('customer-a'))).rejects.toMatchObject({ status: 404 });
    expect(harness.connector.execute).not.toHaveBeenCalled();
    expect(harness.toolCallCreate).not.toHaveBeenCalled();
    expect(harness.audit.appendCustomerToolEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['missing or foreign session', null, { id: 'message-owned-assistant-001', customerId: 'customer-a', sessionId: 'session-owned-001' }],
    ['missing or foreign message', validSession('customer-a'), null]
  ])('fails before lookup, audit, connector, or writes for %s', async (_scenario, session, message) => {
    const harness = createHarness('customer-a', null, session, message);

    await expect(harness.service.execute(sideEffectInput('customer-a'))).rejects.toMatchObject({ status: 404 });
    expect(harness.toolCallFindFirst).not.toHaveBeenCalled();
    expect(harness.toolCallCreate).not.toHaveBeenCalled();
    expect(harness.audit.appendCustomerToolEvent).not.toHaveBeenCalled();
    expect(harness.connector.execute).not.toHaveBeenCalled();
  });
});

function createHarness(
  customerId: string,
  duplicate: Record<string, unknown> | null,
  session: Record<string, unknown> | null = validSession(customerId),
  message: Record<string, unknown> | null = { id: 'message-owned-assistant-001', customerId, sessionId: 'session-owned-001' }
) {
  const sessionFindFirst = jest.fn().mockResolvedValue(session);
  const messageFindFirst = jest.fn().mockResolvedValue(message);
  const toolCallFindFirst = jest.fn().mockResolvedValue(duplicate);
  const toolCallCreate = jest.fn().mockImplementation(async ({ data }) => ({ id: 'tool-call-created', ...data }));
  const toolCallUpdate = jest.fn().mockImplementation(async ({ data }) => ({ id: 'tool-call-created', customerId, sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001', executionStatus: data.executionStatus, ...data }));
  const connector = { execute: jest.fn().mockResolvedValue({ status: 'succeeded', data: {} }) };
  const audit = { appendCustomerToolEvent: jest.fn().mockResolvedValue({ id: 'audit-tool-001' }) };
  const toolRegistry = { resolveToolForCustomer: jest.fn().mockResolvedValue({ resolved: { tool: sideEffectTool(), requiredRoles: [], requiredPermissionScopes: [] } }) };
  const precheck = { checkResolvedCustomerTool: jest.fn().mockResolvedValue({ allowed: true }) };
  const service = new SideEffectExecutionGuardService(
    { db: { assistantSession: { findFirst: sessionFindFirst }, assistantMessage: { findFirst: messageFindFirst }, toolCall: { findFirst: toolCallFindFirst, create: toolCallCreate, update: toolCallUpdate } } } as unknown as PrismaService,
    audit as unknown as AuditWriterService,
    toolRegistry as unknown as ToolRegistryService,
    precheck as unknown as ToolPermissionPrecheckService,
    connector as unknown as MockConnectorAdapter
  );
  return { service, sessionFindFirst, toolCallFindFirst, toolCallCreate, connector, audit, toolRegistry, precheck };
}

function validSession(customerId: string) {
  return { id: 'session-owned-001', customerId, organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared' };
}

function sideEffectTool(): RegisteredToolDefinition {
  return { id: 'tool-definition-orders-001', key: 'mock.orders.status.update', name: 'mock.orders.status.update', version: '1.0.0', description: 'test', operation: ToolOperation.update, riskLevel: RiskLevel.medium, active: true, connectorKey: 'mock', requiredPermissionScopes: ['orders:update'], inputSchema: { required: [] }, outputSchema: { required: [] }, hasSideEffect: true, requiresConfirmation: true, requiresApproval: false };
}

function sideEffectInput(customerId: string) {
  return {
    requestId: 'req-us3-idempotency-a', sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001',
    identityContext: {
      requestId: 'req-us3-idempotency-a', customer: { customerId, integrationId: 'integration-erp' },
      organization: { organizationId: 'org-shared' }, hostApp: { hostApp: 'erp' },
      actor: { actorId: 'actor-shared', roles: ['planner'], permissionScopes: ['orders:update'] }, auth: { tokenId: 'jwt-a', gatewayIssuer: 'https://gateway.test.internal' }
    },
    sourceType: 'action_draft' as const, sourceId: 'draft-a', requesterActorId: 'actor-shared', toolName: 'mock.orders.status.update',
    resource: 'orders', operation: ToolOperation.update, riskLevel: RiskLevel.medium, entityId: 'SO-10001',
    idempotencyKey: 'shared-tool-idempotency-key', requiresConfirmation: true, requiresApproval: false
  };
}
