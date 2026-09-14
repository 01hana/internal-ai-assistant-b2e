import { ConnectorDeploymentRegistry } from '../../src/connectors/productized-business/connector-deployment.registry';

const deployment = (overrides: Record<string, unknown> = {}) => ({
  version: '1',
  customerId: 'customer-a',
  integrationId: 'integration-a',
  hostApp: 'host-a',
  connectorKey: 'business',
  connectorInstanceId: 'instance-a',
  active: true,
  invocationUri: 'https://runtime.customer.test/v1/connector/invocations',
  serviceAuthProfileKey: 'central-a',
  destinationPolicy: { mode: 'public_only', allowedCidrs: [] },
  maxRequestBytes: 16_384,
  maxResponseBytes: 16_384,
  maxTransportMs: 4_500,
  ...overrides,
});

describe('ConnectorDeploymentRegistry', () => {
  it('resolves only the exact five-part active tuple and deep-freezes it', () => {
    const registry = ConnectorDeploymentRegistry.fromJson(JSON.stringify([
      deployment(),
      deployment({ customerId: 'customer-b', integrationId: 'inventory', hostApp: 'warehouse', connectorInstanceId: 'inventory-b' }),
    ]));
    const found = registry.resolve({ customerId: 'customer-b', integrationId: 'inventory', hostApp: 'warehouse', connectorKey: 'business', connectorInstanceId: 'inventory-b' });
    expect(found.ok).toBe(true);
    if (found.ok) expect(Object.isFrozen(found.value.destinationPolicy)).toBe(true);
    expect(registry.resolve({ customerId: 'customer-b', integrationId: 'inventory', hostApp: 'warehouse', connectorKey: 'business', connectorInstanceId: 'wrong' })).toEqual({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
  });

  it.each([
    ['blank', { customerId: '' }],
    ['wildcard', { connectorKey: '*' }],
    ['http', { invocationUri: 'http://runtime.customer.test/v1/connector/invocations' }],
    ['userinfo', { invocationUri: 'https://u:p@runtime.customer.test/v1/connector/invocations' }],
    ['wrong route', { invocationUri: 'https://runtime.customer.test/other' }],
    ['bad request bound', { maxRequestBytes: 16_385 }],
    ['bad response bound', { maxResponseBytes: 0 }],
    ['bad timeout', { maxTransportMs: 4_501 }],
    ['bad cidr', { destinationPolicy: { mode: 'allowlisted_networks', allowedCidrs: ['10.0.0.0/99'] } }],
    ['unknown field', { browserDestination: 'evil' }],
  ])('rejects %s configuration', (_name, override) => {
    expect(() => ConnectorDeploymentRegistry.fromJson(JSON.stringify([deployment(override)]))).toThrow('CONNECTOR_CONFIGURATION_INVALID');
  });

  it('rejects an exact duplicate five-part tuple', () => {
    expect(() => ConnectorDeploymentRegistry.fromJson(JSON.stringify([deployment(), deployment()]))).toThrow('CONNECTOR_CONFIGURATION_INVALID');
  });

  it('supports distinct active instances under one four-part authority and never falls back', () => {
    const registry = ConnectorDeploymentRegistry.fromJson(JSON.stringify([
      deployment(), deployment({ connectorInstanceId: 'instance-b', invocationUri: 'https://runtime-b.customer.test/v1/connector/invocations' }),
    ]));
    expect(registry.activeCount).toBe(2);
    expect(registry.serviceAuthProfileRefs()).toEqual(['central-a']);
    expect(Object.isFrozen(registry.serviceAuthProfileRefs())).toBe(true);
    const select = (connectorInstanceId: string) => registry.resolve({ customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a', connectorKey: 'business', connectorInstanceId });
    expect(select('instance-a')).toMatchObject({ ok: true, value: { connectorInstanceId: 'instance-a', invocationUri: 'https://runtime.customer.test/v1/connector/invocations' } });
    expect(select('instance-b')).toMatchObject({ ok: true, value: { connectorInstanceId: 'instance-b', invocationUri: 'https://runtime-b.customer.test/v1/connector/invocations' } });
    expect(select('wrong-instance')).toEqual({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
  });

  it('never resolves inactive entries', () => {
    const registry = ConnectorDeploymentRegistry.fromJson(JSON.stringify([deployment({ active: false })]));
    expect(registry.resolve({ customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a', connectorKey: 'business', connectorInstanceId: 'instance-a' })).toEqual({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
  });
});
