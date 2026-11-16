import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { createExperienceHarness } from '../support/assistant-experience.fixture';

/** Feature 013 Decision 4: a declared choice skips semantic matching but keeps binding resolution and audit. */
describe('CapabilityResolutionService.resolveDeclared', () => {
  const scope = { customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' };
  const auditContext = { customerScope: { customerId: 'customer-a', integrationId: 'integration-erp', organizationId: 'org-a',
    hostApp: 'erp', actorId: 'actor-a', roles: [], permissionScopes: [] }, requestId: 'r', sessionId: 's', messageId: 'm' } as never;

  async function setup() {
    const h = await createExperienceHarness();
    const semantic = jest.spyOn(h.semantic, 'resolve');
    return { h, semantic, service: new CapabilityResolutionService(h.registry, h.semantic, h.parameters, h.binding, h.audit) };
  }

  it('resolves the declared capability and parameters to the matching binding without semantic matching', async () => {
    const { h, semantic, service } = await setup();
    const result = await service.resolveDeclared({ scope, capabilityKey: 'work-orders.count', parameters: { timeRange: 'this_week' }, auditContext });
    expect(result).toMatchObject({ outcome: 'RESOLVED', capability: { capabilityKey: 'work-orders.count' },
      parameters: { timeRange: 'this_week' }, bindingRef: { bindingId: 'work-orders.weekly' },
      toolCandidate: { key: 'experience.work-orders.weekly', version: '1.0.0' } });
    expect(semantic).not.toHaveBeenCalled();
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'RESOLVED',
      capabilityKey: 'work-orders.count', bindingId: 'work-orders.weekly', reasonCode: 'DECLARED_CHOICE', auditContext }));
  });

  it('does not resolve unknown, inactive-binding or out-of-scope declarations', async () => {
    const { service, h } = await setup();
    for (const [declaredScope, capabilityKey, parameters] of [
      [scope, 'unknown.capability', {}],
      [scope, 'inventory.availability', { entityRef: 'SKU-1' }],
      [scope, 'work-orders.count', { timeRange: 'last_year' }],
      [{ ...scope, integrationId: 'integration-other' }, 'work-orders.count', { timeRange: 'today' }]
    ] as const) {
      const result = await service.resolveDeclared({ scope: declaredScope, capabilityKey, parameters, auditContext });
      expect(result.outcome).not.toBe('RESOLVED');
    }
    expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'DECLARED_CHOICE_UNRESOLVED' }));
  });
});
