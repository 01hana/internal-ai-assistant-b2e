import { AvailableCapabilityService } from '../../src/capabilities/available-capability.service';
import type { ToolResultPolicyResolution } from '../../src/tools/tool-registry.types';
import { createExperienceHarness, EXPERIENCE_HOST as host } from '../support/assistant-experience.fixture';

describe('AvailableCapabilityService (Feature 013 FR-001)', () => {
  async function setup(overrides: Record<string, unknown> = {}) {
    const harness = await createExperienceHarness();
    const tools = { ...harness.tools, isExecutableReadOnly: () => true, ...overrides };
    return { service: new AvailableCapabilityService(harness.registry, tools as never), harness, tools };
  }
  const keys = async (service: AvailableCapabilityService, scope = host) =>
    (await service.listAvailable(scope)).map((item) => item.capabilityKey).sort();

  it('lists active capabilities with an active, permitted binding and their allowed enum values', async () => {
    const { service } = await setup();
    const available = await service.listAvailable(host);
    expect(available.map((item) => item.capabilityKey).sort()).toEqual(['orders.status', 'work-orders.count']);
    const workOrders = available.find((item) => item.capabilityKey === 'work-orders.count')!;
    expect(workOrders.safeLabel).toBe('工單新增數量');
    expect([...workOrders.bindingIds].sort()).toEqual(['work-orders.monthly', 'work-orders.today', 'work-orders.weekly']);
    expect([...workOrders.allowedParameterValues.timeRange].sort()).toEqual(['this_month', 'this_week', 'today']);
  });

  it('excludes inactive bindings and drops enum values whose only binding is not permitted', async () => {
    const { service } = await setup();
    expect(await keys(service)).not.toContain('inventory.availability');
    const limited = await service.listAvailable({ ...host, permissionScopes: ['work-orders:read'] });
    const workOrders = limited.find((item) => item.capabilityKey === 'work-orders.count')!;
    expect([...workOrders.allowedParameterValues.timeRange].sort()).toEqual(['this_week', 'today']);
    expect(await service.isAvailable({ ...host, permissionScopes: ['work-orders:read'] }, 'work-orders.count', { timeRange: 'this_month' })).toBe(false);
    expect(await service.isAvailable({ ...host, permissionScopes: ['work-orders:read'] }, 'work-orders.count', { timeRange: 'today' })).toBe(true);
  });

  it('returns nothing outside the verified Customer, integration and HostApp scope', async () => {
    const { service } = await setup();
    expect(await service.listAvailable({ ...host, customerId: 'customer-b' })).toEqual([]);
    expect(await service.listAvailable({ ...host, integrationId: 'integration-other' })).toEqual([]);
    expect(await service.listAvailable({ ...host, hostApp: 'other-app' })).toEqual([]);
  });

  it('excludes a capability whose tool is not permitted by Customer policy or required roles', async () => {
    const { service, tools } = await setup();
    const active = tools.resolveExactToolForCustomer.getMockImplementation()!;
    tools.resolveExactToolForCustomer.mockImplementation((async (key: string, version: string, customerId: string) =>
      key === 'mock.orders.status.lookup' ? { deniedReason: 'customer_policy_denied' } : active(key, version, customerId)) as never);
    expect(await keys(service)).toEqual(['work-orders.count']);

    tools.resolveExactToolForCustomer.mockImplementation((async (key: string, version: string, customerId: string) => {
      const found = await active(key, version, customerId);
      return found.resolved ? { resolved: { ...found.resolved, requiredRoles: ['supervisor'] } } : found;
    }) as never);
    expect(await service.listAvailable(host)).toEqual([]);
    expect(await keys(service, { ...host, roles: ['supervisor'] })).toEqual(['orders.status', 'work-orders.count']);
  });

  it('applies Customer policy scopes in addition to tool scopes', async () => {
    const { service, tools } = await setup();
    const active = tools.resolveExactToolForCustomer.getMockImplementation()!;
    tools.resolveExactToolForCustomer.mockImplementation((async (key: string, version: string, customerId: string) => {
      const found = await active(key, version, customerId);
      return found.resolved ? { resolved: { ...found.resolved, requiredPermissionScopes: ['policy:extra'] } } : found;
    }) as never);
    expect(await service.listAvailable(host)).toEqual([]);
    expect(await keys(service, { ...host, permissionScopes: [...host.permissionScopes, 'policy:extra'] }))
      .toEqual(['orders.status', 'work-orders.count']);
  });

  it('excludes non-executable tools, rejected result policies and permission masks the actor cannot satisfy', async () => {
    expect(await (await setup({ isExecutableReadOnly: () => false })).service.listAvailable(host)).toEqual([]);
    const rejected: ToolResultPolicyResolution = { allowed: false, reason: 'invalid_result_policy' } as never;
    expect(await (await setup({ resolveResultPolicy: () => rejected })).service.listAvailable(host)).toEqual([]);
    const masked: ToolResultPolicyResolution = { allowed: true, policy: {
      version: '1', allowedFieldPaths: [], deniedFieldPaths: [],
      permissionMasks: [{ fieldPath: 'Data', requiredPermissionScopes: ['pii:read'] }],
      limits: { maxDepth: 4, maxItems: 10, maxStringLength: 100, maxTotalBytes: 4096 }, evidenceSafeProvenanceFields: []
    } } as never;
    expect(await (await setup({ resolveResultPolicy: () => masked })).service.listAvailable(host)).toEqual([]);
  });

  it('rejects undeclared capability keys and parameter values', async () => {
    const { service } = await setup();
    expect(await service.isAvailable(host, 'unknown.capability')).toBe(false);
    expect(await service.isAvailable(host, 'work-orders.count', { timeRange: 'last_year' })).toBe(false);
    expect(await service.isAvailable(host, 'work-orders.count')).toBe(true);
  });
});
