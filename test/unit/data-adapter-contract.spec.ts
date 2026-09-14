import { ConnectorAdapter, ConnectorExecuteResult, DependencyStatus } from '../../src/connectors/connector-adapter.interface';
import {
  DataAdapter,
  DataAdapterExecuteInput,
  ValidatedNamedOperation
} from '../../src/connectors/data-adapter.interface';
import {
  DATA_ADAPTER_REGISTRATIONS,
  DataAdapterRegistration,
  DataAdapterRegistrations
} from '../../src/connectors/data-adapter-registration';
import { HostIntegrationContext } from '../../src/host-integration/host-integration.types';
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';

describe('DataAdapter contract', () => {
  it('accepts the production Mock connector as the generic DataAdapter implementation', () => {
    const adapter: DataAdapter = new MockConnectorAdapter();

    expect(adapter.metadata.adapterKey).toBe('mock');
    expect(adapter.metadata.supportedCapabilities).toContain('mock.inventory.availability.lookup');
  });

  it('extends ConnectorAdapter with immutable capability and future execution inputs', async () => {
    const adapter = createAdapter();
    const connector: ConnectorAdapter<DataAdapterExecuteInput> = adapter;
    const input: DataAdapterExecuteInput = {
      requestId: HOST.requestId,
      organizationId: HOST.organizationId,
      actorId: HOST.actorId,
      toolKey: OPERATION.canonicalToolKey,
      arguments: OPERATION.arguments,
      host: HOST,
      operation: OPERATION,
      transientConnectorContext: Object.freeze({ connectorContextRef: 'ccr_future_reference' })
    };

    await connector.execute(input);

    expect(adapter.execute).toHaveBeenCalledWith(input);
    expect(Object.isFrozen(adapter.metadata)).toBe(true);
    expect(adapter.isCompatible({ host: HOST, tool: {} as never, operation: OPERATION })).toEqual({
      compatible: true
    });
  });

  it('defines an exact static deployment registration without operation authority', () => {
    const registration: DataAdapterRegistration = Object.freeze({
      adapter: createAdapter(),
      connectorKey: 'fixture-connector',
      customerId: 'customer-a',
      integrationId: 'integration-a',
      hostApp: 'erp',
      active: true
    });
    const registrations: DataAdapterRegistrations = Object.freeze([registration]);

    expect(DATA_ADAPTER_REGISTRATIONS).toEqual(expect.any(Symbol));
    expect(Object.keys(registration).sort()).toEqual([
      'active',
      'adapter',
      'connectorKey',
      'customerId',
      'hostApp',
      'integrationId'
    ]);
    expect(registrations).toEqual([registration]);
  });

  it('rejects registration-owned capabilities, policies, operations, and wildcard fields at compile time', () => {
    const adapter = createAdapter();
    const acceptRegistration = (_registration: DataAdapterRegistration): void => undefined;

    // @ts-expect-error Adapter capability does not belong to deployment registration.
    acceptRegistration({ adapter, connectorKey: 'fixture', customerId: 'a', integrationId: 'i', hostApp: 'erp', active: true, supportedToolKeys: [] });
    // @ts-expect-error Operations are resolved from trusted ToolDefinition, not registration.
    acceptRegistration({ adapter, connectorKey: 'fixture', customerId: 'a', integrationId: 'i', hostApp: 'erp', active: true, operations: [] });
    // @ts-expect-error ToolDefinition allowlists are not deployment eligibility.
    acceptRegistration({ adapter, connectorKey: 'fixture', customerId: 'a', integrationId: 'i', hostApp: 'erp', active: true, toolDefinitionKeys: [] });
    // @ts-expect-error Result release policy belongs to ToolDefinition.outputSchema.
    acceptRegistration({ adapter, connectorKey: 'fixture', customerId: 'a', integrationId: 'i', hostApp: 'erp', active: true, resultPolicy: {} });
    // @ts-expect-error Registration has no wildcard-specific configuration.
    acceptRegistration({ adapter, connectorKey: 'fixture', customerId: 'a', integrationId: 'i', hostApp: 'erp', active: true, wildcard: true });

    expect(acceptRegistration).toEqual(expect.any(Function));
  });

  it('keeps productized execution authority out of DataAdapterExecuteInput', () => {
    const acceptInput = (_input: DataAdapterExecuteInput): void => undefined;
    const base: DataAdapterExecuteInput = {
      requestId: HOST.requestId,
      organizationId: HOST.organizationId,
      actorId: HOST.actorId,
      toolKey: OPERATION.canonicalToolKey,
      arguments: OPERATION.arguments,
      host: HOST,
      operation: OPERATION,
      transientConnectorContext: Object.freeze({ connectorContextRef: 'ccr_transient_only' })
    };

    acceptInput(base);
    // @ts-expect-error ToolDefinition owns timeout authority; adapter input does not.
    acceptInput({ ...base, timeoutMs: 5_000 });
    // @ts-expect-error Trusted startup binding owns connector instance selection.
    acceptInput({ ...base, connectorInstanceId: 'instance-browser-selected' });
    // @ts-expect-error Destination never belongs to adapter execution input.
    acceptInput({ ...base, destination: 'https://attacker.example' });
    // @ts-expect-error Credentials never belong to adapter execution input.
    acceptInput({ ...base, credential: 'secret' });

    expect(Object.keys(base).sort()).toEqual([
      'actorId', 'arguments', 'host', 'operation', 'organizationId', 'requestId',
      'toolKey', 'transientConnectorContext'
    ]);
  });
});

const HOST: HostIntegrationContext = Object.freeze({
  customerId: 'customer-a',
  integrationId: 'integration-a',
  hostApp: 'erp',
  organizationId: 'organization-a',
  actorId: 'actor-a',
  roles: Object.freeze(['operator']),
  permissionScopes: Object.freeze(['inventory:read']),
  requestId: 'request-a'
});

const OPERATION: ValidatedNamedOperation = Object.freeze({
  canonicalToolKey: 'fixture.inventory.lookup',
  arguments: Object.freeze({ entityId: 'SKU-001' }),
  schemaVersion: '1.0.0'
});

function createAdapter(): DataAdapter {
  return {
    key: 'fixture-adapter',
    metadata: Object.freeze({
      adapterKey: 'fixture-adapter',
      sourceSystem: 'fixture-system',
      supportedHostApps: Object.freeze(['erp']),
      supportedCapabilities: Object.freeze([OPERATION.canonicalToolKey])
    }),
    listTools: jest.fn(() => []),
    execute: jest.fn(async (input: DataAdapterExecuteInput): Promise<ConnectorExecuteResult> => ({
      toolKey: input.operation.canonicalToolKey,
      status: 'succeeded',
      data: {}
    })),
    healthCheck: jest.fn(async (): Promise<DependencyStatus> => ({
      dependency: 'fixture-adapter',
      status: 'healthy',
      checkedAt: '2026-09-07T00:00:00.000Z'
    })),
    isCompatible: jest.fn(() => ({ compatible: true }))
  };
}
