import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { DataAdapter, DataAdapterExecuteInput } from '../../src/connectors/data-adapter.interface';
import {
  DATA_ADAPTER_REGISTRATIONS,
  DataAdapterRegistration,
  DataAdapterRegistrations
} from '../../src/connectors/data-adapter-registration';
import { DataAdapterRegistry } from '../../src/connectors/data-adapter-registry.service';
import { AdapterResultProjectorService } from '../../src/connectors/adapter-result-projector.service';
import { ConnectorsModule } from '../../src/connectors/connectors.module';
import { PermissionsModule } from '../../src/permissions/permissions.module';
import {
  MOCK_CONNECTOR_ADAPTER,
  MOCK_DATA_ADAPTER_REGISTRATIONS,
  MockConnectorModule
} from '../../src/connectors/mock/mock-connector.module';
import { AppConfigModule } from '../../src/common/config/app-config.module';
import { ToolsModule } from '../../src/tools/tools.module';
import { ProductizedBusinessConnectorModule } from '../../src/connectors/productized-business/productized-business-connector.module';
import { PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS } from '../../src/connectors/productized-business/productized-adapter-binding.registry';

describe('ConnectorsModule', () => {
  it('provides one frozen combined registration array while preserving exact mocks', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] }).compile();
    const registrations = moduleRef.get<DataAdapterRegistrations>(DATA_ADAPTER_REGISTRATIONS);

    expect(registrations).toHaveLength(2);
    expect(registrations).toEqual(MOCK_DATA_ADAPTER_REGISTRATIONS);
    expect(registrations.map(({ customerId, integrationId, hostApp, connectorKey }) => ({
      customerId,
      integrationId,
      hostApp,
      connectorKey
    }))).toEqual([
      { customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp', connectorKey: 'mock' },
      { customerId: 'customer-b', integrationId: 'integration-erp', hostApp: 'erp', connectorKey: 'mock' }
    ]);
    expect(registrations.every((registration) => registration.adapter === MOCK_CONNECTOR_ADAPTER)).toBe(true);
    expect(Object.isFrozen(registrations)).toBe(true);
    expect(moduleRef.get(DataAdapterRegistry)).toBeInstanceOf(DataAdapterRegistry);
  });

  it('combines trusted productized registrations with mocks through one factory provider', () => {
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ConnectorsModule) ?? []) as unknown[];
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, ConnectorsModule) ?? []) as unknown[];
    const registrationProviders = providers.filter(
      (provider): provider is Record<string, unknown> => isRecord(provider) && provider.provide === DATA_ADAPTER_REGISTRATIONS
    );

    expect(registrationProviders).toHaveLength(1);
    expect(Object.keys(registrationProviders[0]).sort()).toEqual(['inject', 'provide', 'useFactory']);
    expect(registrationProviders[0].inject).toEqual([PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS]);
    expect(registrationProviders[0]).not.toHaveProperty('multi');
    expect(registrationProviders[0]).not.toHaveProperty('useValue');
    expect(registrationProviders[0]).not.toHaveProperty('useClass');
    expect(imports).toEqual(expect.arrayContaining([PermissionsModule, MockConnectorModule, ToolsModule]));
    expect(imports.some((entry) => isRecord(entry) && entry.module === ProductizedBusinessConnectorModule)).toBe(true);
    expect(providers).toEqual(expect.arrayContaining([registrationProviders[0], DataAdapterRegistry, AdapterResultProjectorService]));
  });

  it('preserves an explicitly overridden duplicate array so the registry fails ambiguous', async () => {
    const first = createAdapter('adapter-one');
    const second = createAdapter('adapter-two');
    const duplicateRegistrations: DataAdapterRegistrations = Object.freeze([
      registration(first),
      registration(second)
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] })
      .overrideProvider(DATA_ADAPTER_REGISTRATIONS)
      .useValue(duplicateRegistrations)
      .compile();

    expect(moduleRef.get(DATA_ADAPTER_REGISTRATIONS)).toBe(duplicateRegistrations);
    await expect(moduleRef.get(DataAdapterRegistry).select(selection())).rejects.toMatchObject({
      response: {
        error: 'DATA_ADAPTER_UNAVAILABLE',
        message: 'Data adapter unavailable.'
      },
      status: 503
    });
    expect(first.isCompatible).toHaveBeenCalledTimes(1);
    expect(second.isCompatible).toHaveBeenCalledTimes(1);
    expect(first.healthCheck).not.toHaveBeenCalled();
    expect(second.healthCheck).not.toHaveBeenCalled();
    expect(first.execute).not.toHaveBeenCalled();
    expect(second.execute).not.toHaveBeenCalled();
  });
});

function selection() {
  const tool = Object.freeze({
    id: 'tool-a',
    key: 'fixture.inventory.lookup',
    name: 'Fixture inventory lookup',
    version: '1.0.0',
    description: 'Fixture lookup.',
    operation: ToolOperation.read,
    riskLevel: RiskLevel.low,
    active: true,
    connectorKey: 'fixture-connector',
    timeoutMs: 3000,
    requiredPermissionScopes: ['inventory:read'],
    inputSchema: { required: ['entityId'] },
    outputSchema: { required: [] },
    hasSideEffect: false,
    requiresConfirmation: false,
    requiresApproval: false
  });

  return Object.freeze({
    host: Object.freeze({
      customerId: 'customer-a',
      integrationId: 'integration-a',
      hostApp: 'erp',
      organizationId: 'organization-a',
      actorId: 'actor-a',
      roles: Object.freeze(['operator']),
      permissionScopes: Object.freeze(['inventory:read']),
      requestId: 'request-a'
    }),
    tool,
    operation: Object.freeze({
      canonicalToolKey: tool.key,
      arguments: Object.freeze({ entityId: 'SKU-001' }),
      schemaVersion: tool.version
    })
  });
}

function registration(adapter: DataAdapter): DataAdapterRegistration {
  return Object.freeze({
    adapter,
    connectorKey: 'fixture-connector',
    customerId: 'customer-a',
    integrationId: 'integration-a',
    hostApp: 'erp',
    active: true
  });
}

function createAdapter(key: string): DataAdapter {
  return {
    key,
    metadata: Object.freeze({
      adapterKey: key,
      sourceSystem: 'fixture-system',
      supportedHostApps: Object.freeze(['erp']),
      supportedCapabilities: Object.freeze(['fixture.inventory.lookup'])
    }),
    listTools: jest.fn(() => []),
    execute: jest.fn(async (input: DataAdapterExecuteInput) => ({
      toolKey: input.operation.canonicalToolKey,
      status: 'succeeded' as const,
      data: {}
    })),
    healthCheck: jest.fn(async () => ({
      dependency: key,
      status: 'healthy' as const,
      checkedAt: '2026-09-07T00:00:00.000Z'
    })),
    isCompatible: jest.fn(() => ({ compatible: true }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
