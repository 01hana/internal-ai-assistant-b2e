import { ServiceUnavailableException } from '@nestjs/common';
import request = require('supertest');
import { ConnectorBindingService } from '../../apps/customer-connector-runtime/src/bindings/connector-binding.service';
import { InMemoryConnectorBindingStore } from '../../apps/customer-connector-runtime/src/bindings/in-memory-connector-binding.store';
import { opaqueCredentialHandle } from '../../apps/customer-connector-runtime/src/bindings/binding-bootstrap-provider';
import { DataAdapterRegistry } from '../../src/connectors/data-adapter-registry.service';
import { ConnectorDeploymentRegistry } from '../../src/connectors/productized-business/connector-deployment.registry';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

const SHARED = Object.freeze({
  integrationId: 'shared-integration',
  hostApp: 'shared-host',
  organizationId: 'shared-organization',
  actorId: 'shared-actor',
  connectorInstanceId: 'shared-instance'
});

describe('Feature 009 two-Customer isolation', () => {
  it('keeps discovery and canonical policy resolution Customer-scoped', async () => {
    const fixture = await createUs1TestAppWithState();
    try {
      const tools = fixture.app.get(ToolRegistryService);
      const [customerA, customerB] = await Promise.all([
        tools.listDiscoverableToolsForCustomer({ customerId: 'customer-a' }),
        tools.listDiscoverableToolsForCustomer({ customerId: 'customer-b' })
      ]);
      expect(customerA.map(({ key }) => key)).toContain('work-orders.monthly-new-count');
      expect(customerA.map(({ key }) => key)).not.toContain('inventory.stock-on-hand');
      expect(customerB.map(({ key }) => key)).toEqual(['inventory.stock-on-hand']);

      const resolvedB = await tools.resolveToolForCustomer(
        'inventory.stock-on-hand',
        scope('customer-b')
      );
      expect(resolvedB).toMatchObject({ resolved: { tool: { key: 'inventory.stock-on-hand' } } });
      await expect(tools.resolveToolForCustomer('inventory.stock-on-hand', scope('customer-a')))
        .resolves.toEqual({ deniedReason: 'customer_policy_denied' });
    } finally {
      await fixture.app.close();
    }
  });

  it('requires exact Customer equality for deployment and adapter selection', async () => {
    const deployments = ConnectorDeploymentRegistry.fromJson(JSON.stringify([
      deployment('customer-a'),
      deployment('customer-b')
    ]));
    expect(deployments.resolve(deploymentKey('customer-a'))).toMatchObject({
      ok: true,
      value: { customerId: 'customer-a' }
    });
    expect(deployments.resolve(deploymentKey('customer-b'))).toMatchObject({
      ok: true,
      value: { customerId: 'customer-b' }
    });
    expect(deployments.resolve(deploymentKey('customer-c'))).toEqual({
      ok: false,
      code: 'CONNECTOR_UNAVAILABLE'
    });

    const adapterA = adapter('adapter-a');
    const adapterB = adapter('adapter-b');
    const registry = new DataAdapterRegistry(Object.freeze([
      registration('customer-a', adapterA),
      registration('customer-b', adapterB)
    ]) as never);
    await expect(registry.select(selection('customer-a'))).resolves.toBe(adapterA);
    await expect(registry.select(selection('customer-b'))).resolves.toBe(adapterB);
    await expect(registry.select(selection('customer-c'))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('returns the same non-enumerating binding failure for a foreign Customer and an unknown reference', async () => {
    let entropy = 0;
    const store = new InMemoryConnectorBindingStore(
      { maxEntries: 16, scopeMaxEntries: 8, sweepBatchSize: 8 },
      { nowSeconds: () => 1_800_000_000, randomBytes: (size) => Buffer.alloc(size, ++entropy) }
    );
    const bindings = new ConnectorBindingService(store);
    const mintedA = await bindings.mint(bindingInput('customer-a', 'handle-a'));
    const mintedB = await bindings.mint(bindingInput('customer-b', 'handle-b'));
    expect(mintedA.ok && mintedB.ok).toBe(true);
    if (!mintedA.ok || !mintedB.ok) throw new Error('Expected isolated binding fixtures.');
    expect(mintedA.value.connectorContextRef).not.toBe(mintedB.value.connectorContextRef);

    const foreign = await bindings.withInvocationLease(
      mintedA.value.connectorContextRef,
      { trustedContext: trustedContext('customer-b') },
      async () => 'unexpected'
    );
    const missing = await bindings.withInvocationLease(
      `ccr_${'Z'.repeat(43)}`,
      { trustedContext: trustedContext('customer-b') },
      async () => 'unexpected'
    );
    expect(foreign).toEqual({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });
    expect(missing).toEqual(foreign);
  });

  it('does not disclose foreign ToolCall, Evidence, answer, or SSE existence', async () => {
    const fixture = await createUs1TestAppWithState();
    try {
      const headers = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerB,
        requestId: 'req-phase13-customer-isolation'
      });
      const before = {
        toolCalls: fixture.state.toolCalls.length,
        evidence: fixture.state.evidenceRefs.length,
        messages: fixture.state.messages.length
      };
      const foreign = await request(fixture.app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(headers)
        .send({ message: '請查 SKU-B-001 庫存' });
      const missing = await request(fixture.app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-does-not-exist/messages')
        .set({ ...headers, 'x-request-id': 'req-phase13-customer-missing' })
        .send({ message: '請查 SKU-B-001 庫存' });

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body.error).toEqual(missing.body.error);
      expect(foreign.headers['content-type']).not.toContain('text/event-stream');
      expect(JSON.stringify(foreign.body)).not.toContain('customer-a');
      expect({
        toolCalls: fixture.state.toolCalls.length,
        evidence: fixture.state.evidenceRefs.length,
        messages: fixture.state.messages.length
      }).toEqual(before);
    } finally {
      await fixture.app.close();
    }
  });
});

function scope(customerId: string) {
  return createCustomerScopeFromIdentityContext({
    requestId: `request-${customerId}`,
    customer: { customerId, integrationId: SHARED.integrationId },
    organization: { organizationId: SHARED.organizationId },
    hostApp: { hostApp: SHARED.hostApp },
    actor: { actorId: SHARED.actorId, roles: ['operator'], permissionScopes: ['inventory:read'] },
    auth: { tokenId: `token-${customerId}`, gatewayIssuer: 'https://gateway.test.internal' }
  });
}

function deployment(customerId: string) {
  return {
    version: '1', customerId, integrationId: SHARED.integrationId, hostApp: SHARED.hostApp,
    connectorKey: 'business', connectorInstanceId: SHARED.connectorInstanceId, active: true,
    invocationUri: `https://${customerId}.runtime.test/v1/connector/invocations`,
    serviceAuthProfileKey: `central-${customerId}`,
    destinationPolicy: { mode: 'public_only', allowedCidrs: [] },
    maxRequestBytes: 16_384, maxResponseBytes: 16_384, maxTransportMs: 4_500
  };
}

function deploymentKey(customerId: string) {
  return {
    customerId, integrationId: SHARED.integrationId, hostApp: SHARED.hostApp,
    connectorKey: 'business', connectorInstanceId: SHARED.connectorInstanceId
  };
}

function adapter(key: string) {
  return {
    key,
    metadata: Object.freeze({
      displayName: key,
      supportedHostApps: Object.freeze([SHARED.hostApp]),
      supportedCapabilities: Object.freeze(['inventory.stock-on-hand'])
    }),
    listTools: jest.fn().mockResolvedValue([]),
    isCompatible: jest.fn().mockReturnValue({ compatible: true }),
    execute: jest.fn(),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
  };
}

function registration(customerId: string, selectedAdapter: ReturnType<typeof adapter>) {
  return Object.freeze({
    customerId, integrationId: SHARED.integrationId, hostApp: SHARED.hostApp,
    connectorKey: 'business', active: true, adapter: selectedAdapter
  });
}

function selection(customerId: string) {
  const tool = Object.freeze({
    id: 'tool-stock', key: 'inventory.stock-on-hand', name: 'Inventory stock', version: '1.0.0',
    description: 'Read stock.', operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true,
    connectorKey: 'business', timeoutMs: 5_000, requiredPermissionScopes: ['inventory:read'],
    inputSchema: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } },
    outputSchema: { type: 'object', required: ['sku', 'quantity'], properties: {
      sku: { type: 'string' }, quantity: { type: 'integer' }
    } },
    hasSideEffect: false,
    requiresConfirmation: false, requiresApproval: false
  });
  return Object.freeze({
    host: Object.freeze({
      customerId, ...SHARED, roles: Object.freeze(['operator']),
      permissionScopes: Object.freeze(['inventory:read']), requestId: `request-${customerId}`
    }),
    tool,
    operation: Object.freeze({
      canonicalToolKey: tool.key, schemaVersion: tool.version,
      arguments: Object.freeze({ sku: 'SKU-SHARED' })
    })
  });
}

function trustedContext(customerId: string) {
  return Object.freeze({ customerId, ...SHARED });
}

function bindingInput(customerId: string, handle: string) {
  return Object.freeze({
    trustedContext: trustedContext(customerId),
    bootstrapProviderKey: 'shared-bootstrap', credentialProviderKey: 'shared-credentials',
    opaqueCredentialHandle: opaqueCredentialHandle(handle)!, credentialGeneration: 'generation-1',
    providerMetadata: Object.freeze({})
  });
}
