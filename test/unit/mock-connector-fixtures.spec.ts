import {
  mockBusinessPartnerHistory,
  mockInventoryAvailability,
  mockOrderStatuses,
  mockWorkOrderProgress
} from '../../src/connectors/mock/fixtures';

const secretLookingPattern = /(sk-[A-Za-z0-9_-]{12,}|postgres(?:ql)?:\/\/|password|secret|token|api[_-]?key)/i;

describe('mock connector fixtures', () => {
  it('covers the required v1 mock connector domains', () => {
    expect(mockOrderStatuses).toEqual(expect.arrayContaining([expect.objectContaining({ orderId: 'SO-10001' })]));
    expect(mockWorkOrderProgress).toEqual(
      expect.arrayContaining([expect.objectContaining({ workOrderId: 'WO-20001' })])
    );
    expect(mockInventoryAvailability).toEqual(
      expect.arrayContaining([expect.objectContaining({ itemSku: 'SKU-DEMO-RED' })])
    );
    expect(mockBusinessPartnerHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ partnerId: 'BP-CUSTOMER-001' })])
    );
  });

  it('uses deterministic organization-scoped records', () => {
    const fixtureGroups = [
      mockOrderStatuses,
      mockWorkOrderProgress,
      mockInventoryAvailability,
      mockBusinessPartnerHistory
    ];

    for (const records of fixtureGroups) {
      expect(records.length).toBeGreaterThan(0);
      expect(records.every((record) => record.organizationId === 'org-demo')).toBe(true);
    }
  });

  it('does not include secret-looking fixture values', () => {
    const serialized = JSON.stringify({
      mockOrderStatuses,
      mockWorkOrderProgress,
      mockInventoryAvailability,
      mockBusinessPartnerHistory
    });

    expect(serialized).not.toMatch(secretLookingPattern);
  });
});
