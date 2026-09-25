import type { ScopedCapabilityCatalogV1 } from '../../src/capabilities/capability-pack.types';
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';

describe('CapabilityCatalogRegistry', () => {
  it('returns the closed unavailable outcome for an empty or unknown exact scope', () => {
    const registry = new CapabilityCatalogRegistry();

    expect(registry.resolveCatalog(scope('customer-a'))).toEqual({
      available: false,
      reasonCode: 'NO_ACTIVE_CAPABILITY_PACK'
    });
  });

  it('resolves only the exact customer, integration, and HostApp scope', () => {
    const registry = new CapabilityCatalogRegistry();
    registry.installRelease([catalog('customer-a'), catalog('customer-b')]);

    expect(registry.resolveCatalog(scope('customer-a'))).toEqual({
      available: true,
      catalog: expect.objectContaining({ customerId: 'customer-a' })
    });
    expect(registry.resolveCatalog({ ...scope('customer-a'), integrationId: 'other' })).toEqual({
      available: false,
      reasonCode: 'NO_ACTIVE_CAPABILITY_PACK'
    });
    expect(registry.resolveCatalog({ ...scope('customer-a'), hostApp: 'other' })).toEqual({
      available: false,
      reasonCode: 'NO_ACTIVE_CAPABILITY_PACK'
    });
  });

  it('recursively freezes installed catalogs and does not expose release enumeration APIs', () => {
    const registry = new CapabilityCatalogRegistry();
    registry.installRelease([catalog('customer-a')]);
    const result = registry.resolveCatalog(scope('customer-a'));

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(Object.isFrozen(result.catalog)).toBe(true);
    expect(Object.isFrozen(result.catalog.capabilities)).toBe(true);
    expect(Object.isFrozen(result.catalog.capabilities[0])).toBe(true);
    expect(Object.isFrozen(result.catalog.capabilities[0].semanticProfiles[0].aliases)).toBe(true);
    expect(Object.isFrozen(result.catalog.bindings[0].target)).toBe(true);
    expect(registry).not.toHaveProperty('listAll');
    expect(registry).not.toHaveProperty('entries');
    expect(registry).not.toHaveProperty('resolveCapability');
    expect((registry as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
  });

  it('installs releases atomically and preserves the prior release after duplicate-scope rejection', () => {
    const registry = new CapabilityCatalogRegistry();
    registry.installRelease([catalog('customer-a')]);

    expect(() => registry.installRelease([catalog('customer-b'), catalog('customer-b')])).toThrow(
      'CAPABILITY_PACK_INVALID'
    );
    expect(registry.resolveCatalog(scope('customer-a'))).toEqual({
      available: true,
      catalog: expect.objectContaining({ customerId: 'customer-a' })
    });
    expect(registry.resolveCatalog(scope('customer-b'))).toEqual({
      available: false,
      reasonCode: 'NO_ACTIVE_CAPABILITY_PACK'
    });
  });

  it('performs one exact-key lookup without reading or materializing a foreign catalog', () => {
    let foreignReads = 0;
    const foreign = catalog('customer-b') as unknown as Record<string, unknown>;
    const foreignCapabilities = foreign.capabilities;
    Object.defineProperty(foreign, 'capabilities', {
      enumerable: true,
      get() {
        foreignReads += 1;
        return foreignCapabilities;
      }
    });
    const registry = new CapabilityCatalogRegistry();
    registry.installRelease([catalog('customer-a'), foreign as unknown as ScopedCapabilityCatalogV1]);
    foreignReads = 0;
    const getSpy = jest.spyOn(Map.prototype, 'get');
    try {
      expect(registry.resolveCatalog(scope('customer-a'))).toEqual({
        available: true,
        catalog: expect.objectContaining({ customerId: 'customer-a' })
      });
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledWith('customer-a\0integration-a\0host-a');
      expect(foreignReads).toBe(0);
    } finally {
      getSpy.mockRestore();
    }
  });
});

function scope(customerId: string) {
  return { customerId, integrationId: 'integration-a', hostApp: 'host-a' };
}

function catalog(customerId: string): ScopedCapabilityCatalogV1 {
  return {
    version: '1', packId: `${customerId}.pack`, packVersion: '1.0.0', customerId,
    integrationId: 'integration-a', hostApp: 'host-a',
    capabilities: [{
      version: '1', capabilityKey: 'orders.count', active: true, kind: 'READ_ONLY_TOOL', safeLabel: 'Orders',
      semanticProfiles: [{
        version: '1', locale: 'zh-TW', aliases: ['訂單'], examples: ['查詢訂單'], resourceTerms: ['訂單'],
        intentTerms: ['查詢'], metricTerms: ['數量'], requiredSignalGroups: ['resource', 'metric']
      }],
      parameters: [{
        version: '1', parameterName: 'timeRange', type: 'enum', required: true, semanticTerms: ['期間'],
        values: [{ value: 'this_month', aliases: ['本月'] }]
      }]
    }],
    bindings: [{
      version: '1', bindingId: 'orders.monthly', bindingVersion: '1.0.0', active: true,
      capabilityKey: 'orders.count', semanticConstraints: [],
      target: { kind: 'TOOL', toolKey: 'orders.monthly', toolVersion: '1.0.0' }, mappings: []
    }]
  };
}
