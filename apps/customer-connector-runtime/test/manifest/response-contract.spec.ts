import { parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { RequestProfileRegistry } from '../../src/manifest/request-profile.registry';
import { customerBOperation, parsedManifest } from '../fixtures/phase5-manifests';

function withResponse(overrides: Record<string, unknown>) {
  const operation = customerBOperation();
  return { ...operation, response: { ...(operation.response as object), ...overrides } };
}

describe('Phase 5 response declarations', () => {
  it('rejects syntactically invalid JSON Pointer and response schemas through the shared parser', () => {
    expect(parseConnectorOperationManifestV1({
      version: '1', connectorKey: 'inventory', operations: [withResponse({
        extraction: [{ sourcePointer: 'not-a-pointer', targetField: 'quantity', conversion: 'integer' }]
      })]
    }).ok).toBe(false);
    expect(parseConnectorOperationManifestV1({
      version: '1', connectorKey: 'inventory', operations: [withResponse({
        schema: { type: 'object', properties: {}, required: [], additionalProperties: true }
      })]
    }).ok).toBe(false);
    expect(parseConnectorOperationManifestV1({
      version: '1', connectorKey: 'inventory', operations: [{
        ...customerBOperation(),
        limits: { ...(customerBOperation().limits as object), maxResponseBytes: 262_145 }
      }]
    }).ok).toBe(false);
  });

  it.each([
    ['missing source node', [{ sourcePointer: '/missing', targetField: 'quantity', conversion: 'integer' }]],
    ['type-incompatible conversion', [{ sourcePointer: '/quantity', targetField: 'quantity', conversion: 'boolean' }]],
    ['non-negative conversion without non-negative schema', [{ sourcePointer: '/quantity', targetField: 'quantity', conversion: 'non_negative_integer' }]]
  ])('rejects %s before runtime execution', (_case, extraction) => {
    const operation = withResponse({ extraction });
    if (_case === 'non-negative conversion without non-negative schema') {
      operation.response = {
        ...(operation.response as object),
        schema: {
          type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer', minimum: -1 } },
          required: ['sku', 'quantity'], additionalProperties: false
        }
      };
    }
    expect(new OperationManifestRegistry([parsedManifest('inventory', [operation])]).isValid).toBe(false);
  });

  it('fails when the request-profile registry is incomplete', () => {
    expect(new OperationManifestRegistry(
      [parsedManifest('inventory', [customerBOperation()])], new RequestProfileRegistry(['POST_QUERY_JSON_V1'])
    ).isValid).toBe(false);
  });

  it('requires application-code pointers to resolve to a non-nullable integer schema node', () => {
    expect(new OperationManifestRegistry([parsedManifest('inventory', [withResponse({
      applicationCodePointer: '/sku'
    })])]).isValid).toBe(false);
    expect(new OperationManifestRegistry([parsedManifest('inventory', [withResponse({
      applicationCodePointer: '/missing'
    })])]).isValid).toBe(false);
  });

  it('allows fixed-query derivation only from a manifest-owned fixed query entry', () => {
    const accepted = withResponse({
      extraction: [{ source: 'fixed_query', queryName: 'scope', targetField: 'scope', conversion: 'string' }]
    });
    expect(new OperationManifestRegistry([parsedManifest('inventory', [accepted])]).isValid).toBe(false);

    const get = {
      ...customerBOperation(),
      request: {
        profile: 'GET_QUERY_V1', path: '/inventory/stock/query', fixedQuery: { scope: 'available' },
        argumentMappings: [{ argument: 'sku', target: 'query', name: 'sku', scalarType: 'string' }]
      },
      response: {
        ...(customerBOperation().response as object),
        extraction: [{ source: 'fixed_query', queryName: 'scope', targetField: 'scope', conversion: 'string' }]
      }
    };
    expect(new OperationManifestRegistry([parsedManifest('inventory', [get])]).isValid).toBe(true);
    (get.response as Record<string, unknown>).extraction = [
      { source: 'fixed_query', queryName: 'sku', targetField: 'scope', conversion: 'string' }
    ];
    expect(new OperationManifestRegistry([parsedManifest('inventory', [get])]).isValid).toBe(false);
  });
});
