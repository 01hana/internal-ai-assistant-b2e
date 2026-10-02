import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { FollowUpSemanticResolverService } from '../../src/assistant/conversation/follow-up-semantic-resolver.service';
import type { CapabilityFollowUpFrameV1 } from '../../src/assistant/conversation/conversation.types';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const erpPack = 'test/fixtures/capability-packs/customer-a-monthly-followup.v1.json';
const adminPack = 'test/fixtures/capability-packs/shinmone-reference-vertical.v1.json';
const erpScope = Object.freeze({ customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' });
const adminScope = Object.freeze({ customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'admin' });
const productionScope = Object.freeze({
  customerId: 'customer-shinmone-scm-local', integrationId: 'shinmone-scm-assistant-local', hostApp: 'shinmone-scm'
});

describe('Feature 011 Phase F test-only monthly fixture reconciliation', () => {
  async function loadFixtures() {
    const harness = await createFeature011DirectHarness([erpPack, adminPack], {
      additionalMonthlyToolPolicyCustomerIds: ['customer-a']
    });
    const service = new CapabilityResolutionService(
      harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit
    );
    return { ...harness, service };
  }

  it.each([
    [erpPack, erpScope, adminScope],
    [adminPack, adminScope, erpScope]
  ])('loads %s independently without materializing the other scope', async (pack, ownScope, foreignScope) => {
    const harness = await createFeature011DirectHarness([pack], {
      additionalMonthlyToolPolicyCustomerIds: ['customer-a']
    });
    expect(harness.registry.resolveCatalog(ownScope).available).toBe(true);
    expect(harness.registry.resolveCatalog(foreignScope)).toEqual({
      available: false, reasonCode: 'NO_ACTIVE_CAPABILITY_PACK'
    });
  });

  it('loads a semantic catalog independently of dynamic Customer A monthly policy', async () => {
    const harness = await createFeature011DirectHarness([erpPack]);
    expect(harness.registry.resolveCatalog(erpScope).available).toBe(true);
    expect(harness.tools.resolveExactToolForCustomer).not.toHaveBeenCalled();
  });

  it('loads two independent exact scopes and resolves the ERP follow-up seed to one pinned monthly Tool', async () => {
    const { registry, service } = await loadFixtures();
    const erp = registry.resolveCatalog(erpScope);
    const admin = registry.resolveCatalog(adminScope);
    expect(erp.available).toBe(true);
    expect(admin.available).toBe(true);
    if (!erp.available || !admin.available) throw new Error('Expected exact test catalogs');
    expect(erp.catalog.packId).not.toBe(admin.catalog.packId);
    expect(erp.catalog.capabilities.map((entry) => entry.capabilityKey)).toEqual(['work-orders.count']);
    expect(admin.catalog.capabilities.map((entry) => entry.capabilityKey)).toEqual(['work-orders.count']);
    expect(await service.resolve({ scope: erpScope, text: '請查這個月新增工單數' })).toMatchObject({
      outcome: 'RESOLVED', capability: { capabilityKey: 'work-orders.count' },
      parameters: { timeRange: 'this_month' },
      toolCandidate: { key: 'work-orders.monthly-new-count', version: '1.0.0', arguments: {} }
    });
  });

  it('treats last_month as valid only in the ERP test catalog, with no compatible binding or Tool candidate', async () => {
    const { registry, service } = await loadFixtures();
    const selected = registry.resolveCatalog(erpScope);
    if (!selected.available) throw new Error('Expected ERP test catalog');
    const frame = (value: string, sourceMessageId: string): CapabilityFollowUpFrameV1 => ({
      version: '1', scope: erpScope, packId: selected.catalog.packId,
      packVersion: selected.catalog.packVersion, capabilityKey: 'work-orders.count', sourceMessageId,
      parameters: [{ parameterName: 'timeRange', value, source: 'current_explicit', sourceMessageId }]
    });
    expect(new FollowUpSemanticResolverService().resolveCapability({
      currentFrame: frame('last_month', 'current'), priorFrames: [frame('this_month', 'prior')],
      catalog: selected.catalog
    })).toMatchObject({ kind: 'REPLACE', replacedParameters: ['timeRange'] });
    const result = await service.resolve({ scope: erpScope, text: '上個月工單新增數量' });
    expect(result).toMatchObject({
      outcome: 'CAPABILITY_UNAVAILABLE', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING',
      parameters: { timeRange: 'last_month' }
    });
    expect(result).not.toHaveProperty('toolCandidate');
  });

  it('resolves the unchanged vertical question only in its synthetic admin scope', async () => {
    const { service } = await loadFixtures();
    expect(await service.resolve({ scope: adminScope, text: '這個月新增幾張工單？' })).toMatchObject({
      outcome: 'RESOLVED', parameters: { timeRange: 'this_month' },
      toolCandidate: { key: 'work-orders.monthly-new-count', version: '1.0.0', arguments: {} }
    });
  });

  it('does not enumerate or fall back across integration, HostApp, or production Customer scope', async () => {
    const { registry, binding, service } = await loadFixtures();
    const lookup = jest.spyOn(registry, 'resolveCatalog');
    const bind = jest.spyOn(binding, 'resolve');
    for (const scope of [
      { ...erpScope, hostApp: 'admin' },
      { ...adminScope, hostApp: 'erp' },
      productionScope
    ]) {
      lookup.mockClear();
      bind.mockClear();
      expect(registry.resolveCatalog(scope)).toEqual({ available: false, reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' });
      lookup.mockClear();
      expect(await service.resolve({ scope, text: '這個月新增幾張工單？' })).toMatchObject({
        outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED'
      });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledWith(scope);
      expect(bind).not.toHaveBeenCalled();
    }
    expect(registry).not.toHaveProperty('listAll');
  });
});
