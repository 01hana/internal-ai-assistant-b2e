import {
  CONNECTOR_INVOCATION_MAX_REQUEST_BYTES,
  CONNECTOR_INVOCATION_MAX_RESPONSE_BYTES,
  parseConnectorInvocationRequestV1,
  parseConnectorInvocationResponseV1,
  type BoundedOperationArguments
} from '../../src';

const encoder = new TextEncoder();

function invocation(overrides: object = {}): Uint8Array {
  return encoder.encode(JSON.stringify({
    version: '1',
    requestId: '5a8271fb-1127-421c-83eb-3dc6b512db50',
    remainingBudgetMs: 4500,
    trustedContext: {
      customerId: 'customer-b',
      integrationId: 'inventory-b',
      hostApp: 'customer-b-inventory',
      organizationId: 'org-1',
      actorId: 'actor-1',
      connectorKey: 'inventory',
      connectorInstanceId: 'customer-b-inventory-connector-1'
    },
    operation: { key: 'inventory.stock-on-hand', version: '1.0.0', arguments: { sku: 'SKU-1' } },
    connectorContextRef: 'ccr_abcdefghijklmnopqrstuvwxyz012345',
    ...overrides
  }));
}

describe('Connector invocation V1 wire contract', () => {
  const requestId = '5a8271fb-1127-421c-83eb-3dc6b512db50';
  it('parses and deeply freezes the exact closed request', () => {
    const parsed = parseConnectorInvocationRequestV1(invocation());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.operation).toEqual({ key: 'inventory.stock-on-hand', version: '1.0.0', arguments: { sku: 'SKU-1' } });
    const boundedArguments: BoundedOperationArguments = parsed.value.operation.arguments;
    expect(boundedArguments).toEqual({ sku: 'SKU-1' });
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.trustedContext)).toBe(true);
    expect(Object.isFrozen(parsed.value.operation.arguments)).toBe(true);
  });

  it.each([
    ['unknown root field', { destination: 'https://attacker.invalid' }],
    ['caller method', { method: 'GET' }],
    ['caller headers', { headers: { authorization: 'secret' } }],
    ['caller response validation profile', { validationProfile: 'DECLARED_POINTERS_V1' }],
    ['credential', { credential: 'secret' }],
    ['service proof in body', { serviceProof: 'jwt' }],
    ['Feature 007 user token in body', { accessToken: 'native' }]
  ])('rejects %s', (_label, field) => {
    expect(parseConnectorInvocationRequestV1(invocation(field))).toEqual({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
  });

  it('rejects invalid version, budget, identifiers, context, arguments, and reference', () => {
    expect(parseConnectorInvocationRequestV1(invocation({ version: '2' })).ok).toBe(false);
    expect(parseConnectorInvocationRequestV1(invocation({ remainingBudgetMs: 4501 })).ok).toBe(false);
    expect(parseConnectorInvocationRequestV1(invocation({ requestId: '' })).ok).toBe(false);
    expect(parseConnectorInvocationRequestV1(invocation({ trustedContext: { customerId: 'customer-b' } })).ok).toBe(false);
    expect(parseConnectorInvocationRequestV1(invocation({ operation: { key: 'inventory.stock-on-hand', version: '1.0.0', arguments: [] } })).ok).toBe(false);
    expect(parseConnectorInvocationRequestV1(invocation({ connectorContextRef: 'native-secret' })).ok).toBe(false);
  });

  it('measures the received UTF-8 bytes before parsing', () => {
    const oversized = encoder.encode(`{"${'x'.repeat(CONNECTOR_INVOCATION_MAX_REQUEST_BYTES)}":1}`);
    expect(parseConnectorInvocationRequestV1(oversized)).toEqual({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
  });

  it('accepts only bounded success or code-only failure responses', () => {
    const success = encoder.encode(JSON.stringify({
      version: '1', requestId: '5a8271fb-1127-421c-83eb-3dc6b512db50', status: 'succeeded', result: { sku: 'SKU-1', quantity: 8 }
    }));
    const failure = encoder.encode(JSON.stringify({
      version: '1', requestId: '5a8271fb-1127-421c-83eb-3dc6b512db50', status: 'failed', error: { code: 'CONNECTOR_BINDING_INVALID' }
    }));
    expect(parseConnectorInvocationResponseV1(success, requestId).ok).toBe(true);
    expect(parseConnectorInvocationResponseV1(failure, requestId).ok).toBe(true);
    expect(parseConnectorInvocationResponseV1(success, 'different-request').ok).toBe(false);
    expect(parseConnectorInvocationResponseV1(encoder.encode(JSON.stringify({
      version: '1', requestId: '5a8271fb-1127-421c-83eb-3dc6b512db50', status: 'failed', error: { code: 'CONNECTOR_BINDING_INVALID', message: 'leak' }
    })), requestId).ok).toBe(false);
    expect(parseConnectorInvocationResponseV1(new Uint8Array(CONNECTOR_INVOCATION_MAX_RESPONSE_BYTES + 1), requestId).ok).toBe(false);
  });
});
