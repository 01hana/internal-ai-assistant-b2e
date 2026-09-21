import {
  LocalProductizedConnectorDiagnostics,
  type ProductizedConnectorDiagnosticEvent
} from '../../src/connectors/productized-business/local-productized-connector.diagnostics';
import {
  ProductizedBusinessConnectorAdapter,
  type ProductizedAdapterBinding
} from '../../src/connectors/productized-business/productized-business-connector.adapter';

describe('local Productized connector invocation diagnostics', () => {
  it.each([
    [{}, false],
    [{ LOCAL_DEVELOPMENT: '1' }, false],
    [{ LOCAL_CONNECTOR_DIAGNOSTICS: '1' }, false],
    [{ LOCAL_DEVELOPMENT: '1', LOCAL_CONNECTOR_DIAGNOSTICS: '1' }, true]
  ])('requires both local flags: %#', (environment, enabled) => {
    const events: ProductizedConnectorDiagnosticEvent[] = [];
    const diagnostics = new LocalProductizedConnectorDiagnostics(environment, (event) => events.push(event));
    diagnostics.emit('TOOL_CONNECTOR_EXECUTION_STARTED', 'STARTED', { requestId: 'request-safe' });
    expect(diagnostics.enabled).toBe(enabled);
    expect(events).toHaveLength(enabled ? 1 : 0);
  });

  it('reports context presence and execution correlation without emitting protected material', async () => {
    const events: ProductizedConnectorDiagnosticEvent[] = [];
    const diagnostics = new LocalProductizedConnectorDiagnostics(
      { LOCAL_DEVELOPMENT: '1', LOCAL_CONNECTOR_DIAGNOSTICS: '1' },
      (event) => events.push(event)
    );
    const adapter = new ProductizedBusinessConnectorAdapter(
      binding(),
      { resolveExactExecutableTool: jest.fn().mockResolvedValue({ tool: { connectorKey: 'business', timeoutMs: 5_000 } }) },
      {
        executionConstraints: jest.fn(() => ({ ok: true, maxTransportMs: 4_500, productionReady: false })),
        invoke: jest.fn().mockResolvedValue({
          ok: true,
          value: { version: '1', requestId: 'request-safe', status: 'succeeded', result: { count: 42 } }
        })
      } as never,
      { nowMilliseconds: () => 0 },
      diagnostics
    );

    const argumentsValue = Object.freeze({});
    await adapter.execute({
      requestId: 'request-safe', organizationId: 'organization-safe', actorId: 'actor-safe',
      toolKey: 'work-orders.monthly-new-count', arguments: argumentsValue,
      host: {
        requestId: 'request-safe', customerId: 'customer-safe', integrationId: 'integration-safe',
        hostApp: 'host-safe', organizationId: 'organization-safe', actorId: 'actor-safe',
        roles: [], permissionScopes: []
      },
      operation: { canonicalToolKey: 'work-orders.monthly-new-count', schemaVersion: '1.0.0', arguments: argumentsValue },
      transientConnectorContext: { connectorContextRef: 'ccr_connector-reference-secret-sentinel' }
    });

    expect(events.map((event) => event.stage)).toEqual([
      'TOOL_CONNECTOR_EXECUTION_STARTED',
      'CONNECTOR_CONTEXT_PRESENT',
      'CONNECTOR_EXECUTION_COMPLETED'
    ]);
    expect(events[1]).toMatchObject({ connectorContextStatus: 'PRESENT', requestId: 'request-safe' });
    const released = JSON.stringify(events);
    for (const prohibited of [
      'connector-reference-secret-sentinel', 'native-token-secret-sentinel', 'Authorization',
      'service-proof-secret-sentinel', 'private-key-secret-sentinel', 'raw-request-body-secret-sentinel',
      'raw-response-body-secret-sentinel', 'credential-handle-secret-sentinel'
    ]) expect(released).not.toContain(prohibited);
  });

  it('drops arbitrary diagnostic metadata instead of serializing it', () => {
    const events: ProductizedConnectorDiagnosticEvent[] = [];
    const diagnostics = new LocalProductizedConnectorDiagnostics(
      { LOCAL_DEVELOPMENT: '1', LOCAL_CONNECTOR_DIAGNOSTICS: '1' },
      (event) => events.push(event)
    );
    diagnostics.emit('CONNECTOR_EXECUTION_FAILED', 'FAILED', {
      requestId: 'request-safe',
      authorization: 'Bearer authorization-secret-sentinel',
      connectorContextRef: 'ccr_reference-secret-sentinel',
      rawResponseBody: 'raw-response-body-secret-sentinel',
      extractedValue: 987654321
    } as never);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ requestId: 'request-safe', stage: 'CONNECTOR_EXECUTION_FAILED' });
    expect(JSON.stringify(events)).not.toMatch(/authorization-secret|reference-secret|raw-response-body|987654321/i);
  });
});

function binding(): ProductizedAdapterBinding {
  return Object.freeze({
    version: '1', active: true, customerId: 'customer-safe', integrationId: 'integration-safe',
    hostApp: 'host-safe', connectorKey: 'business', connectorInstanceId: 'connector-safe',
    operations: Object.freeze([{ key: 'work-orders.monthly-new-count', version: '1.0.0' }])
  });
}
