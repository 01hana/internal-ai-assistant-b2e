import { CapabilityResolutionAuditService } from '../../src/capabilities/capability-resolution-audit.service';
import { createCustomerScopeFromHostIntegrationContext } from '../../src/host-integration/host-integration-request.factory';

const customerScope = createCustomerScopeFromHostIntegrationContext(Object.freeze({
  customerId: 'customer-a', integrationId: 'integration-a', organizationId: 'org-a',
  hostApp: 'app-a', actorId: 'actor-a', roles: Object.freeze(['reader']),
  permissionScopes: Object.freeze(['inventory:read']), requestId: 'req-a'
}));

describe('CapabilityResolutionAuditService', () => {
  it('awaits one bounded existing AuditWriter event without raw query, values, arguments, or privilege snapshots', async () => {
    const append = jest.fn(async (_input: unknown) => ({ id: 'audit-event-1' }));
    const service = new CapabilityResolutionAuditService({ append } as never);
    await service.record({
      scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'app-a' },
      packId: 'pack-a', packVersion: '1.0.0', outcome: 'RESOLVED', capabilityKey: 'inventory.count',
      bindingId: 'binding-a', parameterNames: ['itemRef'], candidateCount: 1, durationMs: 4,
      auditContext: { customerScope, requestId: 'req-a', sessionId: 'session-a', messageId: 'message-a' }
    });

    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      customerScope, requestId: 'req-a', sessionId: 'session-a', messageId: 'message-a',
      eventType: 'capability_resolution_completed',
      metadata: expect.objectContaining({ outcome: 'RESOLVED', parameterNames: ['itemRef'] })
    }));
    const serialized = JSON.stringify((append.mock.calls[0]?.[0] as { metadata?: unknown } | undefined)?.metadata);
    expect(serialized).not.toContain('inventory:read');
    expect(serialized).not.toContain('reader');
    expect(serialized).not.toContain('canonicalValue');
    expect(serialized).not.toContain('arguments');
  });

  it('propagates AuditWriter failure before any candidate can be released', async () => {
    const append = jest.fn().mockRejectedValue(new Error('storage unavailable'));
    const service = new CapabilityResolutionAuditService({ append } as never);
    await expect(service.record({
      scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'app-a' },
      outcome: 'RESOLVED', parameterNames: [], candidateCount: 1, durationMs: 1,
      auditContext: { customerScope, requestId: 'req-a', sessionId: 'session-a', messageId: 'message-a' }
    })).rejects.toThrow();
  });

  it('rejects unbounded or non-reference metadata before persistence', async () => {
    const append = jest.fn();
    const service = new CapabilityResolutionAuditService({ append } as never);
    const base = {
      scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'app-a' },
      outcome: 'RESOLVED' as const, parameterNames: ['itemRef'], candidateCount: 1, durationMs: 4,
      auditContext: { customerScope, requestId: 'req-a', sessionId: 'session-a', messageId: 'message-a' }
    };
    await expect(service.record({ ...base, parameterNames: ['itemRef', 'itemRef'] }))
      .rejects.toThrow('CAPABILITY_RESOLUTION_AUDIT_INVALID');
    await expect(service.record({ ...base, bindingId: 'https://forbidden.example/path' }))
      .rejects.toThrow('CAPABILITY_RESOLUTION_AUDIT_INVALID');
    await expect(service.record({ ...base, candidateCount: 33 }))
      .rejects.toThrow('CAPABILITY_RESOLUTION_AUDIT_INVALID');
    expect(append).not.toHaveBeenCalled();
  });
});
