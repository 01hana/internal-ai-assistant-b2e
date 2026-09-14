import { ToolOperation, RiskLevel } from '../../src/generated/prisma/enums';
import {
  ProductizedBusinessConnectorAdapter,
  type ProductizedAdapterBinding
} from '../../src/connectors/productized-business/productized-business-connector.adapter';
import type { DataAdapterExecuteInput } from '../../src/connectors/data-adapter.interface';

const binding: ProductizedAdapterBinding = Object.freeze({
  version: '1',
  active: true,
  customerId: 'customer-b',
  integrationId: 'inventory-b',
  hostApp: 'customer-b-inventory',
  connectorKey: 'business',
  connectorInstanceId: 'customer-b-inventory-connector-1',
  operations: Object.freeze([
    Object.freeze({ key: 'inventory.stock-on-hand', version: '1.0.0' })
  ])
});

describe('ProductizedBusinessConnectorAdapter contract', () => {
  it('declares immutable generic capability and readiness without becoming tool authority', async () => {
    const transport = {
      executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: true })),
      invoke: jest.fn()
    };
    const adapter = new ProductizedBusinessConnectorAdapter(
      binding,
      { resolveExactExecutableTool: jest.fn() } as never,
      transport as never
    );

    expect(adapter.key).toBe('productized-business');
    expect(adapter.metadata).toEqual({
      adapterKey: 'productized-business',
      sourceSystem: 'customer-local-connector-runtime',
      supportedHostApps: ['customer-b-inventory'],
      supportedCapabilities: ['inventory.stock-on-hand']
    });
    expect(Object.isFrozen(adapter.metadata)).toBe(true);
    expect(adapter.listTools()).toEqual([]);
    await expect(adapter.healthCheck()).resolves.toMatchObject({
      dependency: 'productized-business',
      status: 'healthy'
    });
  });

  it('accepts only its exact trusted host and declared canonical operation version', () => {
    const transport = {
      executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: true })),
      invoke: jest.fn()
    };
    const adapter = new ProductizedBusinessConnectorAdapter(
      binding,
      { resolveExactExecutableTool: jest.fn() } as never,
      transport as never
    );
    const compatible = {
      host: host(),
      tool: tool(),
      operation: operation()
    };

    expect(adapter.isCompatible(compatible)).toEqual({ compatible: true });
    expect(transport.executionConstraints).toHaveBeenLastCalledWith({
      customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
      connectorKey: 'business', connectorInstanceId: 'customer-b-inventory-connector-1'
    });
    expect(adapter.isCompatible({ ...compatible, host: host({ customerId: 'other' }) }).compatible).toBe(false);
    expect(adapter.isCompatible({ ...compatible, operation: operation({ schemaVersion: '2.0.0' }) }).compatible).toBe(false);
  });

  it('re-resolves the exact ToolDefinition and sends the elapsed bounded budget to transport', async () => {
    const exactLookup = jest.fn().mockResolvedValue({ tool: tool() });
    const invoke = jest.fn().mockResolvedValue({
      ok: true,
      value: { version: '1', requestId: 'request-b', status: 'failed', error: { code: 'CONNECTOR_UPSTREAM_FAILED' } }
    });
    const adapter = new ProductizedBusinessConnectorAdapter(
      binding,
      { resolveExactExecutableTool: exactLookup } as never,
      {
        executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_200, productionReady: true })),
        invoke
      } as never,
      sequenceClock(1_000, 1_250)
    );

    const result = await adapter.execute(executeInput());

    expect(exactLookup).toHaveBeenCalledWith('inventory.stock-on-hand', '1.0.0');
    expect(invoke).toHaveBeenCalledTimes(1);
    const [request, signal, remainingMs] = invoke.mock.calls[0];
    expect(request).toEqual({
      version: '1',
      requestId: 'request-b',
      remainingBudgetMs: 4_200,
      trustedContext: {
        customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
        organizationId: 'organization-b', actorId: 'actor-b', connectorKey: 'business',
        connectorInstanceId: 'customer-b-inventory-connector-1'
      },
      operation: { key: 'inventory.stock-on-hand', version: '1.0.0', arguments: { sku: 'SKU-001' } },
      connectorContextRef: 'ccr_phase9_reference'
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(remainingMs).toBe(4_200);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_UPSTREAM_FAILED' } });
  });

  it('fails before transport for exact-version mismatch or exhausted useful budget', async () => {
    const invoke = jest.fn();
    const missing = new ProductizedBusinessConnectorAdapter(
      binding,
      { resolveExactExecutableTool: jest.fn().mockResolvedValue({ deniedReason: 'tool_not_registered' }) } as never,
      { executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: true })), invoke } as never,
      sequenceClock(0, 1)
    );
    await expect(missing.execute(executeInput())).resolves.toMatchObject({ status: 'failed' });
    expect(invoke).not.toHaveBeenCalled();

    const exhausted = new ProductizedBusinessConnectorAdapter(
      binding,
      { resolveExactExecutableTool: jest.fn().mockResolvedValue({ tool: tool() }) } as never,
      { executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: true })), invoke } as never,
      sequenceClock(0, 4_300)
    );
    await expect(exhausted.execute(executeInput())).resolves.toMatchObject({ status: 'failed' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('aborts transport from the same ToolDefinition-derived deadline and never retries', async () => {
    jest.useFakeTimers();
    try {
      const invoke = jest.fn((_request, signal: AbortSignal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ ok: false, code: 'CONNECTOR_TIMEOUT' }), { once: true });
      }));
      const adapter = new ProductizedBusinessConnectorAdapter(
        binding,
        { resolveExactExecutableTool: jest.fn().mockResolvedValue({ tool: { ...tool(), timeoutMs: 1_000 } }) } as never,
        { executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: true })), invoke } as never,
        sequenceClock(0, 0)
      );

      const pending = adapter.execute(executeInput());
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(750);

      await expect(pending).resolves.toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_TIMEOUT' } });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke.mock.calls[0][1].aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

function host(overrides: Record<string, unknown> = {}) {
  return Object.freeze({
    customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
    organizationId: 'organization-b', actorId: 'actor-b', roles: Object.freeze(['operator']),
    permissionScopes: Object.freeze(['inventory:read']), requestId: 'request-b', ...overrides
  });
}

function tool() {
  return Object.freeze({
    id: 'tool-b', key: 'inventory.stock-on-hand', name: 'Inventory stock on hand', version: '1.0.0',
    description: 'Read stock.', operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true,
    connectorKey: 'business', timeoutMs: 5_000, requiredPermissionScopes: ['inventory:read'],
    inputSchema: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
    outputSchema: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer' } }, required: ['sku', 'quantity'] },
    hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
  });
}

function operation(overrides: Record<string, unknown> = {}) {
  return Object.freeze({
    canonicalToolKey: 'inventory.stock-on-hand', schemaVersion: '1.0.0',
    arguments: Object.freeze({ sku: 'SKU-001' }), ...overrides
  });
}

function executeInput(): DataAdapterExecuteInput {
  const operationValue = operation();
  return Object.freeze({
    requestId: 'request-b', organizationId: 'organization-b', actorId: 'actor-b',
    toolKey: 'inventory.stock-on-hand', arguments: operationValue.arguments,
    host: host(), operation: operationValue,
    transientConnectorContext: Object.freeze({ connectorContextRef: 'ccr_phase9_reference' })
  });
}

function sequenceClock(...values: number[]) {
  let index = 0;
  return { nowMilliseconds: jest.fn(() => values[Math.min(index++, values.length - 1)]!) };
}

// Compile-time contract fixture: Phase 9 must not add authority-bearing fields.
const acceptedInput = (_input: DataAdapterExecuteInput): void => undefined;
void acceptedInput;
