import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { boundedArguments, customerBOperation, getOperation, parsedManifest } from '../fixtures/phase5-manifests';

describe('OperationManifestRegistry', () => {
  it.each(['GET_QUERY_V1', 'POST_QUERY_JSON_V1'] as const)(
    'maps optional input properties correctly for %s',
    (profile) => {
      const connectorKey = profile === 'GET_QUERY_V1' ? 'metrics' : 'inventory';
      const operation = operationWithOptionalArgument(profile);
      const registry = new OperationManifestRegistry([parsedManifest(connectorKey, [operation])]);
      const operationKey = profile === 'GET_QUERY_V1' ? 'metrics.current' : 'inventory.stock-on-hand';

      const absentOptional = registry.prepare(
        connectorKey,
        operationKey,
        '1.0.0',
        boundedArguments({ requiredField: 'required' })
      );
      expect(absentOptional).toEqual({
        ok: true,
        value: expect.objectContaining({
          request: profile === 'GET_QUERY_V1'
            ? {
                profile,
                path: '/metrics/current',
                query: [
                  { name: 'period', value: 'month' },
                  { name: 'required', value: 'required' }
                ]
              }
            : {
                profile,
                path: '/inventory/stock/query',
                body: [
                  { name: 'scope', value: 'available' },
                  { name: 'required', value: 'required' }
                ]
              }
        })
      });

      const presentOptional = registry.prepare(
        connectorKey,
        operationKey,
        '1.0.0',
        boundedArguments({ requiredField: 'required', optionalField: 'optional' })
      );
      expect(presentOptional).toEqual({
        ok: true,
        value: expect.objectContaining({
          request: profile === 'GET_QUERY_V1'
            ? {
                profile,
                path: '/metrics/current',
                query: [
                  { name: 'period', value: 'month' },
                  { name: 'required', value: 'required' },
                  { name: 'optional', value: 'optional' }
                ]
              }
            : {
                profile,
                path: '/inventory/stock/query',
                body: [
                  { name: 'scope', value: 'available' },
                  { name: 'required', value: 'required' },
                  { name: 'optional', value: 'optional' }
                ]
              }
        })
      });

      expect(registry.prepare(connectorKey, operationKey, '1.0.0', boundedArguments({}))).toEqual({
        ok: false,
        code: 'CONNECTOR_OPERATION_UNAVAILABLE'
      });
      expect(registry.prepare(
        connectorKey,
        operationKey,
        '1.0.0',
        boundedArguments({ requiredField: 'required', optionalField: 7 })
      )).toEqual({ ok: false, code: 'CONNECTOR_OPERATION_UNAVAILABLE' });
    }
  );

  it('resolves and maps exact GET_QUERY_V1 operations', () => {
    const registry = new OperationManifestRegistry([parsedManifest('metrics', [getOperation()])]);
    const result = registry.prepare('metrics', 'metrics.current', '1.0.0', boundedArguments({ region: 'TW' }));
    expect(result).toEqual({ ok: true, value: expect.objectContaining({
      connectorKey: 'metrics', operationKey: 'metrics.current', contractVersion: '1.0.0',
      credentialProfileRef: 'metrics-bearer-v1',
      request: { profile: 'GET_QUERY_V1', path: '/metrics/current', query: [
        { name: 'period', value: 'month' }, { name: 'region', value: 'TW' }
      ] }
    }) });
    if (result.ok) expect(Object.isFrozen(result.value.request)).toBe(true);
  });

  it('represents Synthetic Customer B through the same exact POST_QUERY_JSON_V1 path', () => {
    const registry = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])]);
    expect(registry.prepare('inventory', 'inventory.stock-on-hand', '1.0.0', boundedArguments({ sku: 'SKU-7' }))).toEqual({
      ok: true,
      value: expect.objectContaining({
        credentialProfileRef: 'customer-b-inventory-api-key-v1',
        request: { profile: 'POST_QUERY_JSON_V1', path: '/inventory/stock/query', body: [
          { name: 'scope', value: 'available' }, { name: 'sku', value: 'SKU-7' }
        ] }
      })
    });
  });

  it('accepts exact declared-pointer trees with shared ancestors, multiple pointers, duplicates, and derived fields', () => {
    const response = declaredResponse({
      schema: {
        type: 'object', properties: {
          status: { type: 'integer' },
          payload: {
            type: 'object', properties: {
              value: { type: 'integer', minimum: 0 }, secondary: { type: 'string' }
            }, required: ['value', 'secondary'], additionalProperties: false
          }
        }, required: ['status', 'payload'], additionalProperties: false
      },
      extraction: [
        { sourcePointer: '/payload/value', targetField: 'legacyValue', conversion: 'non_negative_integer' },
        { source: 'response_pointer', sourcePointer: '/payload/value', targetField: 'duplicateValue', conversion: 'integer' },
        { source: 'response_pointer', sourcePointer: '/payload/secondary', targetField: 'secondary', conversion: 'string' },
        { source: 'operation_key', targetField: 'operation', conversion: 'string' },
        { source: 'fixed_query', queryName: 'period', targetField: 'period', conversion: 'string' }
      ]
    });
    const registry = new OperationManifestRegistry([parsedManifest('metrics', [getOperation({ response })])]);
    expect(registry.isValid).toBe(true);
  });

  it.each([
    ['missing application-code pointer', declaredResponse({ applicationCodePointer: undefined })],
    ['unknown application-code node', declaredResponse({ applicationCodePointer: '/missing' })],
    ['nullable application-code node', declaredResponse({ schema: declaredSchema({ status: { type: 'integer', nullable: true } }) })],
    ['non-integer application-code node', declaredResponse({ schema: declaredSchema({ status: { type: 'string' } }) })],
    ['missing extraction schema', declaredResponse({ extraction: [{ sourcePointer: '/payload/missing', targetField: 'value', conversion: 'integer' }] })],
    ['optional corridor segment', declaredResponse({ schema: {
      type: 'object', properties: {
        status: { type: 'integer' },
        payload: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false }
      }, required: ['status'], additionalProperties: false
    } })],
    ['nullable extraction leaf', declaredResponse({ schema: declaredSchema({ value: { type: 'integer', nullable: true } }) })],
    ['incompatible extraction conversion', declaredResponse({
      extraction: [{ sourcePointer: '/payload/value', targetField: 'value', conversion: 'string' }]
    })],
    ['unused schema branch', declaredResponse({ schema: declaredSchema({ unused: { type: 'string' } }, ['value', 'unused']) })]
  ])('rejects invalid DECLARED_POINTERS_V1 configuration: %s', (_case, response) => {
    expect(new OperationManifestRegistry([parsedManifest('metrics', [getOperation({ response })])]).isValid).toBe(false);
  });

  it('keeps explicit full validation equivalent to the omitted legacy profile at registry admission', () => {
    const legacy = new OperationManifestRegistry([parsedManifest('metrics', [getOperation()])]);
    const explicit = new OperationManifestRegistry([parsedManifest('metrics', [getOperation({
      response: { ...(getOperation().response as object), validationProfile: 'FULL_CLOSED_SCHEMA_V1' }
    })])]);
    expect(legacy.isValid).toBe(true);
    expect(explicit.isValid).toBe(true);
  });

  it.each([
    ['unknown operation', 'inventory', 'missing', '1.0.0', { sku: 'SKU-7' }],
    ['wrong version', 'inventory', 'inventory.stock-on-hand', '2.0.0', { sku: 'SKU-7' }],
    ['missing argument', 'inventory', 'inventory.stock-on-hand', '1.0.0', {}],
    ['unexpected argument', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', url: 'https://unsafe.invalid' }],
    ['bad argument type', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 7 }],
    ['method override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', method: 'DELETE' }],
    ['path override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', path: '/other' }],
    ['URL override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', url: 'https://unsafe.invalid' }],
    ['query override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', query: {} }],
    ['body override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', body: {} }],
    ['header override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', headers: {} }],
    ['credential profile override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', credentialProfileRef: 'other' }],
    ['credential provider override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', credentialProviderKey: 'other' }],
    ['application strategy override', 'inventory', 'inventory.stock-on-hand', '1.0.0', { sku: 'SKU-7', applicationStrategyKey: 'other' }]
  ])('rejects %s', (_case, connector, operation, version, args) => {
    const registry = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])]);
    expect(registry.prepare(connector, operation, version, boundedArguments(args))).toEqual({
      ok: false, code: 'CONNECTOR_OPERATION_UNAVAILABLE'
    });
  });

  it('rejects mapped target collisions, unmapped inputs, ambiguous identities, and unloaded operations', () => {
    const collision = customerBOperation({ request: {
      profile: 'POST_QUERY_JSON_V1', path: '/inventory/stock/query', fixedBody: { sku: 'fixed' },
      argumentMappings: [{ argument: 'sku', target: 'body', name: 'sku', scalarType: 'string' }]
    } });
    const unused = customerBOperation({ request: {
      profile: 'POST_QUERY_JSON_V1', path: '/inventory/stock/query', fixedBody: {}, argumentMappings: []
    } });
    expect(new OperationManifestRegistry([parsedManifest('inventory', [collision])]).isValid).toBe(false);
    expect(new OperationManifestRegistry([parsedManifest('inventory', [unused])]).isValid).toBe(false);
    expect(new OperationManifestRegistry([
      parsedManifest('inventory', [customerBOperation()]), parsedManifest('inventory', [customerBOperation()])
    ]).isValid).toBe(false);
    expect(new OperationManifestRegistry([]).prepare('inventory', 'inventory.stock-on-hand', '1.0.0', boundedArguments({ sku: 'SKU-7' }))).toEqual({
      ok: false, code: 'CONNECTOR_OPERATION_UNAVAILABLE'
    });
  });
});

function operationWithOptionalArgument(profile: 'GET_QUERY_V1' | 'POST_QUERY_JSON_V1'): Record<string, unknown> {
  const inputSchema = {
    type: 'object',
    properties: {
      requiredField: { type: 'string', minLength: 1, maxLength: 32 },
      optionalField: { type: 'string', minLength: 1, maxLength: 32 }
    },
    required: ['requiredField'],
    additionalProperties: false
  };
  if (profile === 'GET_QUERY_V1') {
    return getOperation({
      inputSchema,
      request: {
        profile,
        path: '/metrics/current',
        fixedQuery: { period: 'month' },
        argumentMappings: [
          { argument: 'requiredField', target: 'query', name: 'required', scalarType: 'string' },
          { argument: 'optionalField', target: 'query', name: 'optional', scalarType: 'string' }
        ]
      }
    });
  }
  return customerBOperation({
    inputSchema,
    request: {
      profile,
      path: '/inventory/stock/query',
      fixedBody: { scope: 'available' },
      argumentMappings: [
        { argument: 'requiredField', target: 'body', name: 'required', scalarType: 'string' },
        { argument: 'optionalField', target: 'body', name: 'optional', scalarType: 'string' }
      ]
    }
  });
}

function declaredResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    validationProfile: 'DECLARED_POINTERS_V1',
    acceptedHttpStatuses: [200], acceptedApplicationCodes: [200], applicationCodePointer: '/status',
    contentType: 'application/json', schema: declaredSchema(),
    extraction: [{ sourcePointer: '/payload/value', targetField: 'value', conversion: 'integer' }],
    ...overrides
  };
}

function declaredSchema(
  leafOverrides: Record<string, object> = {},
  payloadRequired: readonly string[] = ['value']
): Record<string, unknown> {
  return {
    type: 'object', properties: {
      status: leafOverrides.status ?? { type: 'integer' },
      payload: {
        type: 'object', properties: {
          value: leafOverrides.value ?? { type: 'integer' },
          ...(leafOverrides.unused ? { unused: leafOverrides.unused } : {})
        }, required: payloadRequired, additionalProperties: false
      }
    }, required: ['status', 'payload'], additionalProperties: false
  };
}
