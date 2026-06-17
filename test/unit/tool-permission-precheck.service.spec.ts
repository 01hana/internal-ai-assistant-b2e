import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { ToolPermissionPrecheckService } from '../../src/permissions/tool-permission-precheck.service';

describe('ToolPermissionPrecheckService', () => {
  it('denies missing scopes before execution and writes minimized audit metadata', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new ToolPermissionPrecheckService({ append } as unknown as AuditWriterService);

    await expect(
      service.check({
        requestId: 'req-permission-denied',
        sessionId: 'session-001',
        messageId: 'message-001',
        identityContext: {
          requestId: 'req-permission-denied',
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
        },
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
});
