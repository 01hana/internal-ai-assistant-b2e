import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { ToolPermissionPrecheckService } from '../../src/permissions/tool-permission-precheck.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';

describe('ToolPermissionPrecheckService', () => {
  it('denies missing scopes before execution and writes minimized audit metadata', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new ToolPermissionPrecheckService({ append, appendCustomerToolEvent: jest.fn().mockResolvedValue({ id: 'audit-001' }) } as unknown as AuditWriterService);

    await expect(
      service.check({
        requestId: 'req-permission-denied',
        sessionId: 'session-001',
        messageId: 'message-001',
        identityContext: identityContext(['orders:read']),
        toolName: 'mock.inventory.availability.lookup',
        operation: 'read',
        requiredPermissionScopes: ['inventory:read']
      })
    ).resolves.toEqual({
      allowed: false,
      reason: 'missing_scope',
      missingScopes: ['inventory:read']
    });

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'tool_permission_denied',
        metadata: {
          toolName: 'mock.inventory.availability.lookup',
          operation: 'read',
          deniedReason: 'missing_scope',
          missingScopeCount: 1
        }
      })
    );
  });

  it('keeps valid empty authorization arrays distinct from an unverified identity', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new ToolPermissionPrecheckService({ append, appendCustomerToolEvent: jest.fn().mockResolvedValue({ id: 'audit-001' }) } as unknown as AuditWriterService);
    await expect(service.check({ requestId: 'req-empty', sessionId: 'session-a', messageId: 'message-a', identityContext: identityContext([]), toolName: 'tool', operation: 'read', requiredPermissionScopes: ['orders:read'] })).resolves.toEqual(expect.objectContaining({ allowed: false, reason: 'missing_scope' }));
  });

  it('applies policy roles as ANY and global plus Customer scopes as ALL before execution', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new ToolPermissionPrecheckService({ append, appendCustomerToolEvent: jest.fn().mockResolvedValue({ id: 'audit-001' }) } as unknown as AuditWriterService);
    const resolvedTool = {
      tool: {
        id: 'tool-orders', key: 'mock.orders.status.lookup', name: 'mock.orders.status.lookup', version: '1', description: 'tool',
        operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true, connectorKey: 'mock',
        requiredPermissionScopes: ['orders:read'], inputSchema: { required: [] }, outputSchema: { required: [] },
        hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
      },
      requiredRoles: ['planner', 'approver'],
      requiredPermissionScopes: ['orders:export']
    };
    const context = identityContext(['orders:read', 'orders:export']);
    const allowed = await service.checkResolvedCustomerTool({
      requestId: 'req-composition', sessionId: 'session-a', messageId: 'message-a', identityContext: context,
      customerScope: createCustomerScopeFromIdentityContext(context), resolvedTool
    });
    expect(allowed).toEqual({ allowed: true });

    const missingPolicyScope = await service.checkResolvedCustomerTool({
      requestId: 'req-composition-denied', sessionId: 'session-a', messageId: 'message-a', identityContext: identityContext(['orders:read']),
      customerScope: createCustomerScopeFromIdentityContext(identityContext(['orders:read'])), resolvedTool
    });
    expect(missingPolicyScope).toEqual(expect.objectContaining({ allowed: false, reason: 'missing_scope', missingScopes: ['orders:export'] }));

    const roleDeniedContext = { ...context, actor: { ...context.actor, roles: [], permissionScopes: ['orders:read', 'orders:export'] } };
    await expect(service.checkResolvedCustomerTool({
      requestId: 'req-role-denied', sessionId: 'session-a', messageId: 'message-a', identityContext: roleDeniedContext,
      customerScope: createCustomerScopeFromIdentityContext(roleDeniedContext), resolvedTool
    })).resolves.toEqual({ allowed: false, reason: 'role_denied' });
  });
});

function identityContext(permissionScopes: string[]) {
  return {
    requestId: 'req-permission-denied', customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
    organization: { organizationId: 'org-shared' }, hostApp: { hostApp: 'erp' },
    actor: { actorId: 'actor-shared', roles: ['planner'], permissionScopes }, auth: { tokenId: 'jwt-a', gatewayIssuer: 'https://gateway.test.internal' }
  };
}
