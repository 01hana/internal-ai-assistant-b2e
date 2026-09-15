import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { CUSTOMER_TOOL_PHASE6 } from '../support/customer-tool-phase6-fixtures';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import { parseToolDiscoveryMetadataV1 } from '../../src/tools/tool-discovery.service';
import { CUSTOMER_SCOPE_FIXTURES, createCustomerScopeFixtureScope } from '../support/customer-scope-fixtures';

const describeUs3 = process.env.RUN_CUSTOMER_US3_TESTS === 'true' ? describe : describe.skip;

describeUs3('CustomerToolPolicy contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state'];
  let prismaMock: Awaited<ReturnType<typeof createUs1TestAppWithState>>['prismaMock'];

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks } }));
  });
  afterEach(async () => app.close());

  it.each(['customerA', 'customerB'] as const)('requires a Customer-qualified policy lookup for %s on the shared global tool', async (customer) => {
    await request(app.getHttpServer())
      .post(`/api/v1/assistant/sessions/${customer === 'customerA' ? 'session-owned-001' : 'session-hidden-001'}/messages`)
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId: `req-us3-policy-${customer}` }))
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });
    expect(prismaMock.customerToolPolicy.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId_toolDefinitionId: { customerId: customer === 'customerA' ? 'customer-a' : 'customer-b', toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId } }
    }));
  });

  it.each([
    ['disabled', 'customerB', undefined],
    ['missing', 'customerA', () => { state.customerToolPolicies.splice(0, 1); }],
    ['foreign-only', 'customerA', () => { state.customerToolPolicies.splice(0, state.customerToolPolicies.length, { ...CUSTOMER_TOOL_PHASE6.policies.customerB, toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId }); }]
  ] as const)('executes %s policy flow as a safe, indistinguishable denial', async (_scenario, customer, arrange) => {
    arrange?.();
    const before = snapshotDeniedWork(state);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/assistant/sessions/${customer === 'customerA' ? 'session-owned-001' : 'session-hidden-001'}/messages`)
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId: `req-us3-policy-${_scenario}` }))
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });

    const customerId = customer === 'customerA' ? 'customer-a' : 'customer-b';
    expect(prismaMock.customerToolPolicy.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId_toolDefinitionId: { customerId, toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId } }
    }));
    expect(response.text).not.toContain('customer-a');
    expect(response.text).not.toContain('customer-b');
    expect(snapshotDeniedWork(state)).toEqual(before);
  });

  it('rejects an inactive global definition before Customer policy or connector work', async () => {
    const tool = state.toolDefinitions.find((item) => item.id === CUSTOMER_TOOL_PHASE6.toolDefinitionId);
    if (!tool) throw new Error('US3 global ToolDefinition fixture is missing.');
    tool.isActive = false;
    const before = snapshotDeniedWork(state);
    await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-us3-inactive' }))
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });

    expect(prismaMock.customerToolPolicy.findUnique).not.toHaveBeenCalled();
    expect(snapshotDeniedWork(state)).toEqual(before);
  });
});

function snapshotDeniedWork(state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state']) {
  return {
    evidence: state.evidenceRefs.length,
    successfulToolCalls: state.toolCalls.filter((item) => item.status === 'success').length
  };
}

describe('Feature 008 ToolDefinition result-policy authority', () => {
  let app: INestApplication;
  let state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state'];

  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState());
  });

  afterAll(async () => app.close());

  it('resolves Customer policy first and parses release policy only from the resolved ToolDefinition', async () => {
    const definition = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.status.lookup');
    if (!definition) throw new Error('Mock order ToolDefinition fixture is missing.');
    definition.outputSchema = {
      type: 'object',
      required: ['orderId', 'status'],
      properties: {
        orderId: { type: 'string' },
        status: { type: 'string' },
        organizationId: { type: 'string' }
      },
      'x-assistant-result-policy': {
        version: '1',
        allowedFieldPaths: ['orderId', 'status'],
        deniedFieldPaths: ['organizationId'],
        permissionMasks: [],
        limits: { maxDepth: 4, maxItems: 100, maxStringLength: 512, maxTotalBytes: 16384 },
        evidenceSafeProvenanceFields: ['orderId']
      }
    };
    const registry = app.get(ToolRegistryService);
    const resolution = await registry.resolveToolForCustomer(
      definition.name,
      createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA)
    );

    expect(resolution.resolved).toBeDefined();
    expect(registry.resolveResultPolicy(resolution.resolved!.tool)).toEqual(
      expect.objectContaining({
        allowed: true,
        policy: expect.objectContaining({
          version: '1',
          allowedFieldPaths: ['orderId', 'status']
        })
      })
    );
  });

  it('provides accepted versioned policies for every current mock ToolDefinition fixture', async () => {
    const registry = app.get(ToolRegistryService);
    const expectedKeys = [
      'mock.business-partner.history.lookup',
      'mock.inventory.availability.lookup',
      'mock.orders.cancel',
      'mock.orders.status.lookup',
      'mock.orders.status.update',
      'mock.work-orders.progress.lookup'
    ];
    const mockDefinitions = state.toolDefinitions
      .filter((tool) => tool.connectorKey === 'mock')
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(mockDefinitions.map((tool) => tool.name)).toEqual(expectedKeys);
    for (const definition of mockDefinitions) {
      const resolved = await registry.resolveRegisteredTool(definition.name);
      expect(resolved.tool).toBeDefined();
      expect(registry.resolveResultPolicy(resolved.tool!)).toEqual(
        expect.objectContaining({
          allowed: true,
          policy: expect.objectContaining({ version: '1' })
        })
      );
      expect(parseToolDiscoveryMetadataV1(resolved.tool!.inputSchema)).toEqual(
        expect.objectContaining({ version: '1', locale: 'zh-TW' })
      );
    }
  });

  it('keeps Synthetic Customer B on the same generic discovery and result-policy contracts', async () => {
    const registry = app.get(ToolRegistryService);
    const definition = state.toolDefinitions.find((tool) => tool.name === 'inventory.stock-on-hand');
    expect(definition).toBeDefined();
    const resolution = await registry.resolveToolForCustomer(
      'inventory.stock-on-hand',
      createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerB)
    );
    expect(resolution.resolved?.tool.connectorKey).toBe('business');
    expect(parseToolDiscoveryMetadataV1(resolution.resolved!.tool.inputSchema)).toEqual(
      expect.objectContaining({ resourceConcepts: ['inventory', 'stock'], taskType: 'inventory_stock_lookup' })
    );
    expect(registry.resolveResultPolicy(resolution.resolved!.tool)).toEqual(
      expect.objectContaining({ allowed: true, policy: expect.objectContaining({ allowedFieldPaths: ['sku', 'quantity'] }) })
    );
  });

  it('keeps discoverable read-only catalogs Customer-isolated', async () => {
    const registry = app.get(ToolRegistryService);
    const customerA = await registry.listDiscoverableToolsForCustomer({ customerId: 'customer-a' });
    const customerB = await registry.listDiscoverableToolsForCustomer({ customerId: 'customer-b' });
    expect(customerA.map(({ key }) => key).sort()).toEqual([
      'mock.business-partner.history.lookup',
      'mock.inventory.availability.lookup',
      'mock.orders.status.lookup',
      'mock.work-orders.progress.lookup'
    ]);
    expect(customerB.map(({ key }) => key)).toEqual(['inventory.stock-on-hand']);
    expect(customerB.map(({ key }) => key)).not.toContain('mock.orders.status.lookup');
  });
});
