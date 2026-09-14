import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { AppConfigModule } from '../../src/common/config/app-config.module';
import { ConnectorsModule } from '../../src/connectors/connectors.module';
import { DATA_ADAPTER_REGISTRATIONS, type DataAdapterRegistrations } from '../../src/connectors/data-adapter-registration';
import { DataAdapterRegistry } from '../../src/connectors/data-adapter-registry.service';
import { ProductizedBusinessConnectorTransportService } from '../../src/connectors/productized-business/productized-business-connector.module';

const ENV_KEY = 'ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON';

describe('productized adapter exact registration', () => {
  const original = process.env[ENV_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('adds one exact trusted registration beside unchanged mocks', async () => {
    process.env[ENV_KEY] = JSON.stringify([binding()]);
    const transport = transportBoundary(true);
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] })
      .overrideProvider(ProductizedBusinessConnectorTransportService)
      .useValue(transport)
      .compile();
    const registrations = moduleRef.get<DataAdapterRegistrations>(DATA_ADAPTER_REGISTRATIONS);

    expect(registrations).toHaveLength(3);
    expect(registrations.slice(0, 2).map(({ adapter }) => adapter.key)).toEqual(['mock', 'mock']);
    expect(registrations[2]).toMatchObject({
      customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
      connectorKey: 'business', active: true, adapter: { key: 'productized-business' }
    });
    await expect(moduleRef.get(DataAdapterRegistry).select(selection())).resolves.toBe(registrations[2].adapter);
  });

  it('never falls back to a mock for wrong dimensions or unavailable exact deployment', async () => {
    process.env[ENV_KEY] = JSON.stringify([binding()]);
    const transport = transportBoundary(false);
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] })
      .overrideProvider(ProductizedBusinessConnectorTransportService)
      .useValue(transport)
      .compile();
    const registry = moduleRef.get(DataAdapterRegistry);

    await expectUnavailable(registry.select(selection()));
    await expectUnavailable(registry.select(selection({ customerId: 'customer-a' })));
    expect(transport.executionConstraints).toHaveBeenCalled();
  });

  it('fails composition for duplicate active four-part bindings', async () => {
    process.env[ENV_KEY] = JSON.stringify([
      binding(),
      binding({ connectorInstanceId: 'customer-b-inventory-connector-2' })
    ]);

    await expect(Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] }).compile())
      .rejects.toThrow('CONNECTOR_CONFIGURATION_INVALID');
  });
});

function binding(overrides: Record<string, unknown> = {}) {
  return {
    version: '1', active: true, customerId: 'customer-b', integrationId: 'inventory-b',
    hostApp: 'customer-b-inventory', connectorKey: 'business',
    connectorInstanceId: 'customer-b-inventory-connector-1',
    operations: [{ key: 'inventory.stock-on-hand', version: '1.0.0' }], ...overrides
  };
}

function transportBoundary(available: boolean) {
  return {
    executionConstraints: jest.fn(() => available
      ? { ok: true, maxTransportMs: 4_500, productionReady: true }
      : { ok: false }),
    invoke: jest.fn()
  };
}

function selection(hostOverrides: Record<string, unknown> = {}) {
  const tool = Object.freeze({
    id: 'tool-b', key: 'inventory.stock-on-hand', name: 'Inventory stock on hand', version: '1.0.0',
    description: 'Read stock.', operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true,
    connectorKey: 'business', timeoutMs: 5_000, requiredPermissionScopes: ['inventory:read'],
    inputSchema: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
    outputSchema: { type: 'object', properties: {}, required: [] },
    hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
  });
  return Object.freeze({
    host: Object.freeze({
      customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
      organizationId: 'organization-b', actorId: 'actor-b', roles: Object.freeze(['operator']),
      permissionScopes: Object.freeze(['inventory:read']), requestId: 'request-b', ...hostOverrides
    }),
    tool,
    operation: Object.freeze({ canonicalToolKey: tool.key, schemaVersion: tool.version, arguments: Object.freeze({ sku: 'SKU-001' }) })
  });
}

async function expectUnavailable(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(ServiceUnavailableException);
}
