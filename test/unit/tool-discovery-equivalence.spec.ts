import { createToolDiscoveryFixtureService } from '../support/tool-discovery.fixture';

describe('metadata discovery equivalence before obsolete branch removal', () => {
  it.each([
    ['order', 'orderId', 'SO-10001', 'mock.orders.status.lookup', 'entityId'],
    ['workOrder', 'workOrderId', 'WO-20002', 'mock.work-orders.progress.lookup', 'entityId'],
    ['inventory', 'itemSku', 'SKU-ABC-001', 'mock.inventory.availability.lookup', 'entityId'],
    ['businessPartner', 'customerId', 'CUST-001', 'mock.business-partner.history.lookup', 'entityId']
  ])('discovers the existing %s mock through metadata with bounded arguments', async (resource, entityType, value, key, argumentName) => {
    const result = await createToolDiscoveryFixtureService().discover({
      customerScope: scope('customer-a'),
      normalizedTerms: [{ originalTerm: resource, normalizedTerm: resource, category: 'resource', confidence: 0.9, reason: 'domain_lexicon' }],
      phrases: [{ value: '查詢', normalizedValue: 'read', category: 'intent' }],
      timeRanges: [], entityCandidates: [{ type: entityType, value, confidence: 0.95 }] as never
    });
    expect(result.candidates).toEqual([{ key, arguments: { [argumentName]: value }, reason: 'metadata_discovery' }]);
    expect(result.matchConfidence).toBe(0.95);
  });

  it('discovers Synthetic Customer B through the same algorithm and isolates Customer A tools', async () => {
    const result = await createToolDiscoveryFixtureService().discover({
      customerScope: scope('customer-b'),
      normalizedTerms: [{ originalTerm: '庫存', normalizedTerm: 'inventory', category: 'resource', confidence: 0.9, reason: 'domain_lexicon' }],
      phrases: [{ value: '查詢', normalizedValue: 'read', category: 'intent' }],
      timeRanges: [], entityCandidates: [{ type: 'itemSku', value: 'SKU-B-001', confidence: 0.95 }]
    });
    expect(result.candidates).toEqual([{ key: 'inventory.stock-on-hand', arguments: { sku: 'SKU-B-001' }, reason: 'metadata_discovery' }]);
    expect(result.candidates.map(({ key }) => key)).not.toContain('mock.inventory.availability.lookup');
  });
});

function scope(customerId: string) {
  return { customerId, integrationId: 'integration', organizationId: 'org', hostApp: 'app', actorId: 'actor', roles: [], permissionScopes: [] } as never;
}
