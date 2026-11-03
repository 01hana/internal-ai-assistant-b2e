import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request = require('supertest');
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import { CapabilitiesModule } from '../../src/capabilities/capabilities.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';

describe('health and readiness contract', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => {
    process.env.ASSISTANT_CAPABILITY_PACK_PATHS_JSON = '[]';
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterEach(async () => {
    await app.close();
    process.env.ASSISTANT_CAPABILITY_PACK_PATHS_JSON = '[]';
  });

  it('reports process liveness without requiring an identity context', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: expect.any(String),
        data: expect.objectContaining({
          status: 'healthy',
          service: 'internal-assistant-core',
          timestamp: expect.any(String)
        })
      })
    );
  });

  it('reports all core dependencies as healthy when probes succeed', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-health-readiness-healthy');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-health-readiness-healthy',
        data: expect.objectContaining({
          status: 'healthy',
          service: 'internal-assistant-core',
          timestamp: expect.any(String),
          dependencies: {
            database: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            llm: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            retrieval: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            connector: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) }),
            approval_workflow: expect.objectContaining({ status: 'healthy', checkedAt: expect.any(String), durationMs: expect.any(Number) })
          }
        })
      })
    );
    expect(Object.keys(response.body.data.dependencies).sort()).toEqual([
      'approval_workflow', 'connector', 'database', 'llm', 'retrieval'
    ]);
    expect(response.body.data).not.toHaveProperty('capabilities');
  });

  it('bootstraps an empty configured capability release as ready without changing readiness shape', async () => {
    const registry = app.get(CapabilityCatalogRegistry);
    expect(registry.resolveCatalog({ customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a' })).toEqual({
      available: false,
      reasonCode: 'NO_ACTIVE_CAPABILITY_PACK'
    });
  });

  it('bootstraps a valid complete capability release before request readiness', async () => {
    const packPath = await capabilityPackFile(validCapabilityPack());
    const capabilityApp = await createCapabilityBootstrapApp(JSON.stringify([packPath]));
    await capabilityApp.init();

    expect(capabilityApp.get(CapabilityCatalogRegistry).resolveCatalog({
      customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a'
    })).toEqual({
      available: true,
      catalog: expect.objectContaining({
        packId: 'customer-a.pack', customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a',
        bindings: [expect.objectContaining({
          target: { kind: 'TOOL', toolKey: 'work-orders.monthly-new-count', toolVersion: '1.0.0' }
        })]
      })
    });
    expect(capabilityApp.get(CapabilityCatalogRegistry).resolveCatalog({
      customerId: 'customer-b', integrationId: 'integration-a', hostApp: 'host-a'
    })).toEqual({ available: false, reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' });
    const tools = capabilityApp.get(ToolRegistryService);
    expect(tools.resolveExactExecutableTool).toHaveBeenCalledWith('work-orders.monthly-new-count', '1.0.0');
    expect(tools.resolveExactExecutableTool).toHaveBeenCalledTimes(2);
    await capabilityApp.close();
  });

  it('rejects a scoped capability release when its exact Tool target is missing', async () => {
    const packPath = await capabilityPackFile(validCapabilityPack());
    const capabilityApp = await createCapabilityBootstrapApp(JSON.stringify([packPath]), { toolAvailable: false });
    await expect(capabilityApp.init()).rejects.toThrow('CAPABILITY_PACK_INVALID');
    expect(capabilityApp.get(ToolRegistryService).resolveExactExecutableTool)
      .toHaveBeenCalledWith('work-orders.monthly-new-count', '1.0.0');
    expect(capabilityApp.get(CapabilityCatalogRegistry).resolveCatalog({
      customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a'
    })).toEqual({ available: false, reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' });
    await capabilityApp.close();
  });

  it('rejects a scoped capability release when its Tool version is not registered', async () => {
    const packPath = await capabilityPackFile(validCapabilityPack('9.9.9'));
    const capabilityApp = await createCapabilityBootstrapApp(JSON.stringify([packPath]));
    await expect(capabilityApp.init()).rejects.toThrow('CAPABILITY_PACK_INVALID');
    expect(capabilityApp.get(ToolRegistryService).resolveExactExecutableTool)
      .toHaveBeenCalledWith('work-orders.monthly-new-count', '9.9.9');
    expect(capabilityApp.get(CapabilityCatalogRegistry).resolveCatalog({
      customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a'
    })).toEqual({ available: false, reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' });
    await capabilityApp.close();
  });

  it('rejects application bootstrap for an invalid configured release', async () => {
    const invalidPath = await capabilityPackFile('{');
    const capabilityApp = await createCapabilityBootstrapApp(JSON.stringify([invalidPath]));
    await expect(capabilityApp.init()).rejects.toThrow('CAPABILITY_PACK_INVALID');
    await capabilityApp.close();
  });

  it('reports degraded readiness with a safe connector reason when no connector is registered', async () => {
    const empty = await createUs1TestAppWithState({ dataAdapterRegistrations: [] });
    const response = await request(empty.app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-health-readiness-degraded');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-health-readiness-degraded',
        data: expect.objectContaining({
          status: 'degraded',
          dependencies: expect.objectContaining({
            connector: expect.objectContaining({
              status: 'degraded',
              reason: 'connector_registry_empty'
            })
          })
        })
      })
    );
    await empty.app.close();
  });

  it.each([
    ['one unavailable', 'degraded', 'connector_degraded', false],
    ['all unavailable', 'unavailable', 'connector_unavailable', true]
  ])('reports %s registered connectors without leaking probe details', async (_case, status, reason, allUnavailable) => {
    const testApp = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => mockRegistrations.map((registration, index) => {
        const adapter = new MockConnectorAdapter();
        jest.spyOn(adapter, 'healthCheck').mockResolvedValue({
          dependency: 'connector', status: allUnavailable || index === 1 ? 'unavailable' : 'healthy',
          checkedAt: new Date().toISOString()
        });
        return { ...registration, adapter };
      })
    });
    const response = await request(testApp.app.getHttpServer()).get('/api/v1/readiness');
    expect(response.status).toBe(200);
    expect(response.body.data.dependencies.connector).toEqual(expect.objectContaining({ status, reason }));
    expect(JSON.stringify(response.body)).not.toContain('connectorSecret');
    await testApp.app.close();
  });

  it('fails readiness safely for duplicate exact connector bindings without probing them', async () => {
    const healthCheck = jest.fn();
    const testApp = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => {
        const adapter = new MockConnectorAdapter();
        jest.spyOn(adapter, 'healthCheck').mockImplementation(healthCheck);
        return [
          { ...mockRegistrations[0], adapter },
          { ...mockRegistrations[0], adapter }
        ];
      }
    });
    const response = await request(testApp.app.getHttpServer()).get('/api/v1/readiness');
    expect(response.body.data.dependencies.connector).toEqual(expect.objectContaining({ status: 'unavailable', reason: 'connector_unavailable' }));
    expect(healthCheck).not.toHaveBeenCalled();
    await testApp.app.close();
  });

  it('reports a connector probe exception without exposing its details', async () => {
    const testApp = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => {
        const adapter = new MockConnectorAdapter();
        jest.spyOn(adapter, 'healthCheck').mockRejectedValue(new Error('connectorSecret private probe failure'));
        return [{ ...mockRegistrations[0], adapter }];
      }
    });
    try {
      const response = await request(testApp.app.getHttpServer()).get('/api/v1/readiness');
      expect(response.status).toBe(200);
      expect(response.body.data.dependencies.connector).toEqual(expect.objectContaining({
        status: 'unavailable', reason: 'connector_unavailable'
      }));
      expect(JSON.stringify(response.body)).not.toContain('connectorSecret');
    } finally {
      await testApp.app.close();
    }
  });

  it('bounds a connector probe that never settles', async () => {
    const testApp = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => {
        const adapter = new MockConnectorAdapter();
        jest.spyOn(adapter, 'healthCheck').mockImplementation(async () => new Promise<never>(() => {}));
        return [{ ...mockRegistrations[0], adapter }];
      }
    });
    try {
      const startedAt = Date.now();
      const response = await request(testApp.app.getHttpServer()).get('/api/v1/readiness');
      expect(response.status).toBe(200);
      expect(response.body.data.dependencies.connector).toEqual(expect.objectContaining({
        status: 'unavailable', reason: 'connector_unavailable'
      }));
      expect(Date.now() - startedAt).toBeLessThan(4_500);
    } finally {
      await testApp.app.close();
    }
  });

  it('reports unavailable readiness for a database probe failure without exposing raw failure details', async () => {
    const prisma = app.get(PrismaService) as unknown as { db: { $queryRaw: jest.Mock } };
    prisma.db.$queryRaw.mockRejectedValueOnce(new Error('postgresql://user:database-password@db.internal/assistant'));

    const response = await request(app.getHttpServer())
      .get('/api/v1/readiness')
      .set('x-request-id', 'req-health-readiness-unavailable');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-health-readiness-unavailable',
        data: expect.objectContaining({
          status: 'unavailable',
          dependencies: expect.objectContaining({
            database: expect.objectContaining({
              status: 'unavailable',
              reason: 'database_unreachable'
            })
          })
        })
      })
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('postgresql://');
    expect(serialized).not.toContain('database-password');
    expect(serialized).not.toContain('placeholder-openai-api-key');
    expect(serialized).not.toContain('connectorSecret');
    expect(serialized).not.toContain('stack');
  });
});

async function capabilityPackFile(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'capability-readiness-'));
  const path = join(directory, 'pack.json');
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
  await chmod(path, 0o444);
  return path;
}

function validCapabilityPack(toolVersion = '1.0.0'): Record<string, unknown> {
  return {
    version: '1', packId: 'customer-a.pack', packVersion: '1.0.0', customerId: 'customer-a',
    integrationId: 'integration-a', hostApps: ['host-a'], active: true,
    capabilities: [{
      version: '1', capabilityKey: 'work-orders.count', active: true, kind: 'READ_ONLY_TOOL', safeLabel: 'Work orders',
      semanticProfiles: [{
        version: '1', locale: 'zh-TW', aliases: ['工單查詢'], examples: ['查詢工單'], resourceTerms: ['工單'],
        intentTerms: ['查詢'], metricTerms: ['數量'], requiredSignalGroups: ['resource', 'metric']
      }],
      parameters: [{
        version: '1', parameterName: 'timeRange', type: 'enum', required: true, semanticTerms: ['期間'],
        values: [{ value: 'this_month', aliases: ['本月'] }]
      }]
    }],
    bindings: [{
      version: '1', bindingId: 'work-orders.monthly', bindingVersion: '1.0.0', active: true,
      capabilityKey: 'work-orders.count', semanticConstraints: [{
        version: '1', parameterName: 'timeRange', operator: 'ENUM_VALUE_IN', allowedValues: ['this_month']
      }],
      target: { kind: 'TOOL', toolKey: 'work-orders.monthly-new-count', toolVersion }, mappings: []
    }]
  };
}

async function createCapabilityBootstrapApp(pathsJson: string, options: { toolAvailable?: boolean } = {}): Promise<INestApplication> {
  const tool = {
    key: 'work-orders.monthly-new-count', version: '1.0.0', active: true,
    operation: 'read', hasSideEffect: false,
    inputSchema: { type: 'object', properties: {}, required: [] }
  };
  const moduleRef = await Test.createTestingModule({ imports: [CapabilitiesModule] })
    .overrideProvider(ConfigService)
    .useValue({ get: jest.fn(() => pathsJson) })
    .overrideProvider(PrismaService)
    .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn(), db: {} })
    .overrideProvider(ToolRegistryService)
    .useValue({
      resolveExactExecutableTool: jest.fn(async (key: string, version: string) => ({
        tool: options.toolAvailable === false || key !== tool.key || version !== tool.version ? undefined : tool
      }))
    })
    .compile();
  return moduleRef.createNestApplication();
}
