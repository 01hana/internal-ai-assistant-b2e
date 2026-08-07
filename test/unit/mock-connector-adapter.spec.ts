import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';

describe('MockConnectorAdapter', () => {
  const adapter = new MockConnectorAdapter();

  it('executes deterministic inventory availability lookup from fixtures', async () => {
    await expect(
      adapter.execute({
        requestId: 'req-mock-connector',
        organizationId: 'org-001',
        actorId: 'actor-001',
        toolKey: 'mock.inventory.availability.lookup',
        arguments: {
          entityId: 'SKU-DEMO-RED'
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        toolKey: 'mock.inventory.availability.lookup',
        status: 'succeeded',
        data: expect.objectContaining({
          availableQuantity: 36,
          incomingQuantity: 120
        })
      })
    );
  });
});
