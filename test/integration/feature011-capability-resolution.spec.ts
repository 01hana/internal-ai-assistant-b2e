import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const shinmonePack = 'customer-capability-packs/shinmone-scm-local/1.0.0.json';
const scope = Object.freeze({
  customerId: 'customer-shinmone-scm-local',
  integrationId: 'shinmone-scm-assistant-local',
  hostApp: 'shinmone-scm'
});

describe('Feature 011 Shinmone pack-backed direct resolution', () => {
  const toolCalls = jest.fn();
  const customerRequests = jest.fn();
  const connectorExecutions = jest.fn();
  const modelCalls = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it.each([
    '請查本月工單新增數量',
    '想知道這個月新開立的維修工單數量',
    '本月份維修工單新增數量是多少',
    '這個月新增幾張工單？'
  ])('resolves a monthly paraphrase through exact existing Tool authority: %s', async (text) => {
    const harness = await createFeature011DirectHarness([shinmonePack]);
    const service = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);

    const result = await service.resolve({ scope, text });

    expect(result).toMatchObject({
      version: '1', outcome: 'RESOLVED',
      capability: { capabilityKey: 'work-orders.count' },
      parameters: { timeRange: 'this_month' },
      toolCandidate: { key: 'work-orders.monthly-new-count', version: '1.0.0', arguments: {} }
    });
    expect(harness.tools.resolveExactToolForCustomer).toHaveBeenCalledWith(
      'work-orders.monthly-new-count', '1.0.0', scope.customerId
    );
    expect(harness.audit.record).toHaveBeenCalledTimes(1);
    expect(harness.audit.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'RESOLVED', capabilityKey: 'work-orders.count', parameterNames: ['timeRange']
    }));
    const auditJson = JSON.stringify(harness.audit.record.mock.calls);
    expect(auditJson).not.toContain(text);
    expect(auditJson).not.toContain('this_month');
    expect(auditJson).not.toContain('arguments');
    expect(toolCalls).not.toHaveBeenCalled();
    expect(customerRequests).not.toHaveBeenCalled();
    expect(connectorExecutions).not.toHaveBeenCalled();
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('clarifies the canonical missing timeRange without executing', async () => {
    const harness = await createFeature011DirectHarness([shinmonePack]);
    const service = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    const result = await service.resolve({ scope, text: '請查工單新增數量' });
    expect(result).toMatchObject({ outcome: 'NEEDS_CLARIFICATION', reasonCode: 'PARAMETER_ISSUES', missingParameters: ['timeRange'] });
    expect(result).not.toHaveProperty('toolCandidate');
    expect(toolCalls).not.toHaveBeenCalled();
    expect(customerRequests).not.toHaveBeenCalled();
  });

  it('understands today but never falls back to the monthly binding', async () => {
    const harness = await createFeature011DirectHarness([shinmonePack]);
    const service = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    const result = await service.resolve({ scope, text: '今天工單新增數量' });
    expect(result).toMatchObject({
      outcome: 'CAPABILITY_UNAVAILABLE', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING',
      capability: { capabilityKey: 'work-orders.count' }, parameters: { timeRange: 'today' }
    });
    expect(result).not.toHaveProperty('toolCandidate');
    expect(toolCalls).not.toHaveBeenCalled();
    expect(customerRequests).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', '請說明差旅政策', { outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED' }],
    ['invalid', '工單新增數量 期間 下季', { outcome: 'NEEDS_CLARIFICATION', reasonCode: 'PARAMETER_ISSUES', invalidParameters: [{ parameterName: 'timeRange' }] }],
    ['conflicting', '本月和今天工單新增數量', { outcome: 'NEEDS_CLARIFICATION', reasonCode: 'PARAMETER_ISSUES', conflictingParameters: [{ parameterName: 'timeRange', candidateCount: 2 }] }]
  ])('returns a closed non-executing %s outcome', async (_label, text, expected) => {
    const harness = await createFeature011DirectHarness([shinmonePack]);
    const service = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    const result = await service.resolve({ scope, text });
    expect(result).toMatchObject(expected);
    expect(result).not.toHaveProperty('toolCandidate');
    expect(JSON.stringify(result)).not.toContain('下季');
    expect(JSON.stringify(harness.audit.record.mock.calls)).not.toContain('下季');
    expect(toolCalls).not.toHaveBeenCalled();
    expect(customerRequests).not.toHaveBeenCalled();
    expect(connectorExecutions).not.toHaveBeenCalled();
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('returns bounded ambiguity references without a Tool candidate', async () => {
    const harness = await createFeature011DirectHarness([shinmonePack]);
    const loaded = harness.registry.resolveCatalog(scope);
    if (!loaded.available) throw new Error('Expected loaded fixture catalog');
    const first = loaded.catalog.capabilities[0];
    const registry = new CapabilityCatalogRegistry();
    registry.installRelease([{
      ...loaded.catalog,
      capabilities: [first, { ...first, capabilityKey: 'maintenance.count' }],
      bindings: loaded.catalog.bindings
    }]);
    const service = new CapabilityResolutionService(registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    const result = await service.resolve({ scope, text: '本月工單新增數量' });
    expect(result).toMatchObject({ outcome: 'AMBIGUOUS', reasonCode: 'MULTIPLE_CAPABILITIES' });
    expect(result).not.toHaveProperty('toolCandidate');
    expect(toolCalls).not.toHaveBeenCalled();
    expect(customerRequests).not.toHaveBeenCalled();
  });

  it('does not release even a resolved candidate when bounded audit fails', async () => {
    const harness = await createFeature011DirectHarness([shinmonePack]);
    harness.audit.record.mockRejectedValueOnce(new Error('audit storage unavailable'));
    const service = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    await expect(service.resolve({ scope, text: '請查本月工單新增數量' })).rejects.toThrow('CAPABILITY_RESOLUTION_AUDIT_FAILED');
    expect(toolCalls).not.toHaveBeenCalled();
    expect(customerRequests).not.toHaveBeenCalled();
  });
});
