import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Customer-scoped tool audit', () => {
  it.each([
    'tool_permission_denied',
    'tool_call_blocked',
    'tool_call_started',
    'tool_call_completed',
    'tool_call_failed',
    'side_effect_execution_denied',
    'side_effect_execution_skipped_duplicate',
    'action_draft_executed',
    'action_draft_failed'
  ])('writes %s with caller-owned identity and redacted nested metadata', async (eventType) => {
    const create = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'audit-tool-001', timestamp: new Date(), evidenceRefIds: [], ...data
    }));
    const writer = new AuditWriterService({ db: { auditEvent: { create } } } as unknown as PrismaService);
    const scope = createCustomerScopeFromIdentityContext({
      requestId: 'req-audit', customer: { customerId: 'customer-a', integrationId: 'integration-erp' },
      organization: { organizationId: 'org-shared' }, hostApp: { hostApp: 'erp' },
      actor: { actorId: 'actor-shared', roles: ['planner'], permissionScopes: ['orders:update'] },
      auth: { tokenId: 'jwt-token-id', gatewayIssuer: 'https://gateway.test.internal' }
    });

    await writer.appendCustomerToolEvent({
      customerScope: scope, requestId: 'req-audit', sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001', toolCallId: 'tool-call-a', eventType,
      metadata: {
        safe: 'visible', idempotencyKey: 'raw-idempotency-key', authorization: 'Bearer raw.jwt.token',
        nested: { claims: 'raw-claims', jwks: 'private-key', connectorOutput: 'secret-output', signature: 'sig' }
      }
    });

    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ customerId: 'customer-a', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared', sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001', toolCallId: 'tool-call-a', eventType });
    const serialized = JSON.stringify(data.metadata);
    for (const forbidden of ['raw-idempotency-key', 'Bearer raw.jwt.token', 'raw-claims', 'private-key', 'secret-output', '"sig"']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain('visible');
  });
});
