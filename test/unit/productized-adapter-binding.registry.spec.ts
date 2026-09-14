import {
  parseProductizedAdapterBindings,
  PRODUCTIZED_ADAPTER_BINDINGS_ENV
} from '../../src/connectors/productized-business/productized-adapter-binding.registry';

describe('Productized adapter trusted binding configuration', () => {
  it('treats absent configuration as no productized registrations', () => {
    expect(PRODUCTIZED_ADAPTER_BINDINGS_ENV).toBe('ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON');
    expect(parseProductizedAdapterBindings(undefined)).toEqual([]);
    expect(Object.isFrozen(parseProductizedAdapterBindings(undefined))).toBe(true);
  });

  it('parses and deeply freezes one exact adapter-to-instance binding', () => {
    const result = parseProductizedAdapterBindings(JSON.stringify([binding()]));

    expect(result).toEqual([binding()]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0].operations)).toBe(true);
    expect(Object.isFrozen(result[0].operations[0])).toBe(true);
  });

  it.each([
    ['unknown binding field', [{ ...binding(), endpoint: 'https://attacker.test' }]],
    ['wildcard Customer', [binding({ customerId: '*' })]],
    ['blank HostApp', [binding({ hostApp: '' })]],
    ['invalid contract version', [binding({ version: '2' })]],
    ['missing operations', [{ ...binding(), operations: undefined }]],
    ['unknown operation field', [binding({ operations: [{ key: 'inventory.stock-on-hand', version: '1.0.0', url: 'https://attacker.test' }] })]],
    ['invalid operation version', [binding({ operations: [{ key: 'inventory.stock-on-hand', version: 'latest' }] })]],
    ['duplicate operation declaration', [binding({ operations: [operation(), operation()] })]],
    ['duplicate active four-part registration', [binding(), binding({ connectorInstanceId: 'instance-2' })]]
  ])('rejects %s', (_label, value) => {
    expect(() => parseProductizedAdapterBindings(JSON.stringify(value))).toThrow('CONNECTOR_CONFIGURATION_INVALID');
  });

  it('allows inactive history without making it an active ambiguous registration', () => {
    expect(parseProductizedAdapterBindings(JSON.stringify([
      binding(), binding({ active: false, connectorInstanceId: 'instance-2' })
    ]))).toHaveLength(2);
  });
});

function operation() {
  return { key: 'inventory.stock-on-hand', version: '1.0.0' };
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    version: '1', active: true, customerId: 'customer-b', integrationId: 'inventory-b',
    hostApp: 'customer-b-inventory', connectorKey: 'business',
    connectorInstanceId: 'customer-b-inventory-connector-1', operations: [operation()], ...overrides
  };
}
