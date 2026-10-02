import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import type { ScopedCapabilityCatalogV1 } from '../../src/capabilities/capability-pack.types';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const packA = 'test/fixtures/capability-packs/customer-a-reference.v1.json';
const packB = 'test/fixtures/capability-packs/customer-b-inventory.v1.json';
const scopeA = { customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared' };
const scopeB = { customerId: 'customer-b', integrationId: 'integration-erp', hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared' };

describe('Feature 011 direct Customer B portability and isolation', () => {
  it('maps a Customer B canonical itemRef into the existing exact Tool sku input', async () => {
    const harness = await createFeature011DirectHarness([packA, packB]);
    const service = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);

    const result = await service.resolve({ scope: scopeB, text: '查詢庫存現量 料號 ABC-1' });

    expect(result).toMatchObject({
      outcome: 'RESOLVED', capability: { capabilityKey: 'inventory.stock' },
      parameters: { itemRef: 'ABC-1' },
      toolCandidate: { key: 'inventory.stock-on-hand', version: '1.0.0', arguments: { sku: 'ABC-1' } }
    });
    expect(harness.tools.resolveExactToolForCustomer).toHaveBeenCalledWith('inventory.stock-on-hand', '1.0.0', 'customer-b');
  });

  it.each([
    ['查詢訂單目前狀態 訂單號 SO-10001', 'orders.status', 'mock.orders.status.lookup', 'SO-10001'],
    ['請查 WO-20002 工單進度', 'work-orders.progress', 'mock.work-orders.progress.lookup', 'WO-20002'],
    ['請查 SKU-DEMO-RED 庫存可用量', 'inventory.availability', 'mock.inventory.availability.lookup', 'SKU-DEMO-RED'],
    ['請查這筆客戶歷史', 'business-partners.history', 'mock.business-partner.history.lookup', 'BP-CUSTOMER-001']
  ])('uses one generic service for a repository-evidenced Customer A read path: %s', async (text, capabilityKey, toolKey, entityId) => {
    const harness = await createFeature011DirectHarness([packA, packB]);
    const service = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);

    expect(await service.resolve({ scope: scopeA, text, pageContextValues: { entityRef: entityId } })).toMatchObject({
      outcome: 'RESOLVED', capability: { capabilityKey },
      toolCandidate: { key: toolKey, version: '1.0.0', arguments: { entityId } }
    });
  });

  it('never reads a foreign catalog despite colliding capability key, alias, HostApp, organization, and actor', async () => {
    const harness = await createFeature011DirectHarness([packA, packB]);
    const selectedA = harness.registry.resolveCatalog(scopeA);
    const selectedB = harness.registry.resolveCatalog(scopeB);
    if (!selectedA.available || !selectedB.available) throw new Error('Expected loaded fixture catalogs');
    const a = selectedA.catalog;
    const b = selectedB.catalog;
    const commonProfile = {
      ...a.capabilities[0].semanticProfiles[0], aliases: ['共用查詢詞'], examples: ['共用查詢詞'],
      resourceTerms: ['共用'], intentTerms: ['查詢'], metricTerms: ['詞'], requiredSignalGroups: ['resource', 'metric'] as const
    };
    const collidingA: ScopedCapabilityCatalogV1 = {
      ...a, capabilities: [{ ...a.capabilities[0], capabilityKey: 'shared.capability', semanticProfiles: [commonProfile] }],
      bindings: [{ ...a.bindings[0], capabilityKey: 'shared.capability' }]
    };
    const collidingB: ScopedCapabilityCatalogV1 = {
      ...b, capabilities: [{ ...b.capabilities[0], capabilityKey: 'shared.capability', semanticProfiles: [commonProfile] }],
      bindings: [{ ...b.bindings[0], capabilityKey: 'shared.capability' }]
    };
    const registry = new CapabilityCatalogRegistry();
    registry.installRelease([collidingA, collidingB]);
    const originalLookup = registry.resolveCatalog.bind(registry);
    const lookup = jest.spyOn(registry, 'resolveCatalog').mockImplementation((scope) => originalLookup(scope));
    const service = new CapabilityResolutionService(registry, harness.semantic, harness.parameters, harness.binding, harness.audit);

    expect(await service.resolve({ scope: scopeA, text: '共用查詢詞 訂單號 SO-10001' })).toMatchObject({
      outcome: 'RESOLVED', toolCandidate: { key: 'mock.orders.status.lookup' }
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith({ customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' });
    lookup.mockClear();
    expect(await service.resolve({ scope: scopeB, text: '共用查詢詞 料號 ABC-1' })).toMatchObject({
      outcome: 'RESOLVED', toolCandidate: { key: 'inventory.stock-on-hand' }
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith({ customerId: 'customer-b', integrationId: 'integration-erp', hostApp: 'erp' });
  });
});
