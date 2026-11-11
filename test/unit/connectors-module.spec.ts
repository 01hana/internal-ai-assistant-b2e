import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
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
  MOCK_DATA_ADAPTER_REGISTRATIONS,
  MockConnectorModule
} from '../../src/connectors/mock/mock-connector.module';
import { AppConfigModule } from '../../src/common/config/app-config.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ToolsModule } from '../../src/tools/tools.module';
import {
  ProductizedBusinessConnectorModule,
  ProductizedBusinessConnectorTransportService
} from '../../src/connectors/productized-business/productized-business-connector.module';
import { PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS } from '../../src/connectors/productized-business/productized-adapter-binding.registry';
import { shinmoneAdapterBinding } from '../../customers/shinmone/test/support/shinmone-reference.fixture';

describe('ConnectorsModule', () => {
  const originalProductizedBindings = process.env.ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON;
  afterEach(() => {
    if (originalProductizedBindings === undefined) delete process.env.ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON;
    else process.env.ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON = originalProductizedBindings;
  });
  it('initializes with an empty frozen registration array when no Customer binding is configured', async () => {
    process.env.ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON = '[]';
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] }).compile();
    const app = moduleRef.createNestApplication();
    try {
      await app.init();
      const registrations = app.get<DataAdapterRegistrations>(DATA_ADAPTER_REGISTRATIONS);
      expect(registrations).toEqual([]);
      expect(Object.isFrozen(registrations)).toBe(true);
      expect(app.get(DataAdapterRegistry)).toBeInstanceOf(DataAdapterRegistry);
    } finally {
      await app.close();
    }
  });

  it('assembles only trusted productized registrations through one factory provider', () => {
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
    expect(imports).toEqual(expect.arrayContaining([PermissionsModule, ToolsModule]));
    expect(imports).not.toContain(MockConnectorModule);
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

  it('composes the exact reference binding without synthetic mock registrations', async () => {
    process.env.ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON = JSON.stringify([shinmoneAdapterBinding()]);
    const transport = {
      executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4500, productionReady: true })),
      invoke: jest.fn()
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] })
      .overrideProvider(ProductizedBusinessConnectorTransportService)
      .useValue(transport)
      .compile();
    const registrations = moduleRef.get<DataAdapterRegistrations>(DATA_ADAPTER_REGISTRATIONS);
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp',
      connectorKey: 'business', active: true, adapter: { key: 'productized-business' }
    });
  });

  it('allows test composition to explicitly install the existing exact Customer A/B mock bindings', async () => {
    process.env.ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON = '[]';
    const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, ConnectorsModule] })
      .overrideProvider(DATA_ADAPTER_REGISTRATIONS)
      .useValue(MOCK_DATA_ADAPTER_REGISTRATIONS)
      .compile();
    const registrations = moduleRef.get<DataAdapterRegistrations>(DATA_ADAPTER_REGISTRATIONS);
    expect(registrations).toBe(MOCK_DATA_ADAPTER_REGISTRATIONS);
    expect(registrations.map(({ customerId, integrationId, hostApp, connectorKey }) => ({
      customerId, integrationId, hostApp, connectorKey
    }))).toEqual([
      { customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp', connectorKey: 'mock' },
      { customerId: 'customer-b', integrationId: 'integration-erp', hostApp: 'erp', connectorKey: 'mock' }
    ]);
  });

  it('does not install synthetic Customer A/B bindings in production AppModule composition', async () => {
    const keys = [
      'DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'LLM_MODEL', 'OPENAI_API_KEY',
      'INTERNAL_IDENTITY_JWT_ISSUER', 'INTERNAL_IDENTITY_JWT_AUDIENCE', 'INTERNAL_IDENTITY_JWKS_URI',
      'ASSISTANT_CAPABILITY_PACK_PATHS_JSON', 'ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON',
      'ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON'
    ];
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://assistant:test@localhost:5432/assistant_test',
      POSTGRES_USER: 'assistant', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'assistant_test',
      LLM_MODEL: 'test-model', OPENAI_API_KEY: 'placeholder-openai-api-key',
      INTERNAL_IDENTITY_JWT_ISSUER: 'https://gateway.test.internal',
      INTERNAL_IDENTITY_JWT_AUDIENCE: 'internal-assistant-core-test',
      INTERNAL_IDENTITY_JWKS_URI: 'https://gateway.test.internal/.well-known/jwks.json',
      ASSISTANT_CAPABILITY_PACK_PATHS_JSON: '[]', ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON: '[]'
    });
    delete process.env.ASSISTANT_QUERY_SCOPE_POLICY_PATHS_JSON;
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn(), db: {} })
        .compile();
      const app = moduleRef.createNestApplication();
      try {
        await app.init();
        expect(app.get<DataAdapterRegistrations>(DATA_ADAPTER_REGISTRATIONS)).toEqual([]);
      } finally {
        await app.close();
      }
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
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
