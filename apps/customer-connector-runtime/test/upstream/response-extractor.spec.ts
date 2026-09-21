import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { boundedArguments, customerBOperation, getOperation, parsedManifest } from '../fixtures/phase5-manifests';

describe('Phase 6 declarative response extraction', () => {
  const prepared = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])]).prepare('inventory', 'inventory.stock-on-hand', '1.0.0', boundedArguments({ sku: 'SKU-1' }));
  if (!prepared.ok) throw new Error('fixture');
  it('releases only declared fields and enforces argument correlation', () => {
    const extractor = new ManifestResponseExtractor();
    expect(extractor.extract({ sku: 'SKU-1', quantity: 9 }, prepared.value, { sku: 'SKU-1' })).toEqual({ ok: true, value: { sku: 'SKU-1', quantity: 9 } });
    expect(extractor.extract({ sku: 'OTHER', quantity: 9 }, prepared.value, { sku: 'SKU-1' })).toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });
  it.each([
    [{ sku: 'SKU-1' }, { sku: 'SKU-1' }],
    [{ sku: 'SKU-1', quantity: -1 }, { sku: 'SKU-1' }],
    [{ sku: 'SKU-1', quantity: 1.2 }, { sku: 'SKU-1' }],
    [{ sku: 'SKU-1', quantity: '9' }, { sku: 'SKU-1' }]
  ])('rejects missing or invalid extraction %#', (response, args) => {
    expect(new ManifestResponseExtractor().extract(response, prepared.value, args)).toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it.each([
    [{ data: { newOrders: { current: 0 } } }, true],
    [{ data: { newOrders: { current: 9 } } }, true],
    [{ data: { newOrders: { current: -1 } } }, false],
    [{ data: { newOrders: { current: 1.5 } } }, false],
    [{ data: { newOrders: { current: '9' } } }, false],
    [{ data: { newOrders: {} } }, false]
  ])('enforces the generic reference count extraction matrix for %#', (response, accepted) => {
    const manifest = parsedManifest('metrics', [getOperation({
      response: {
        acceptedHttpStatuses: [200], acceptedApplicationCodes: [200], contentType: 'application/json',
        schema: {
          type: 'object', properties: { data: {
            type: 'object', properties: { newOrders: {
              type: 'object', properties: { current: { type: 'integer', minimum: 0 } }, required: ['current'], additionalProperties: false
            } }, required: ['newOrders'], additionalProperties: false
          } }, required: ['data'], additionalProperties: false
        },
        extraction: [{ sourcePointer: '/data/newOrders/current', targetField: 'count', conversion: 'non_negative_integer' }]
      }
    })]);
    const operation = new OperationManifestRegistry([manifest]).prepare('metrics', 'metrics.current', '1.0.0', boundedArguments({ region: 'TW' }));
    if (!operation.ok) throw new Error('reference count fixture');
    expect(new ManifestResponseExtractor().extract(response, operation.value, {}).ok).toBe(accepted);
  });

  it('does not allow caller arguments to supply or spoof derived metadata', () => {
    const manifest = parsedManifest('metrics', [getOperation({
      response: {
        acceptedHttpStatuses: [200], acceptedApplicationCodes: [200], contentType: 'application/json',
        schema: {
          type: 'object', properties: { value: { type: 'integer', minimum: 0 } }, required: ['value'], additionalProperties: false
        },
        extraction: [
          { source: 'operation_key', targetField: 'metricKey', conversion: 'string' },
          { source: 'fixed_query', queryName: 'period', targetField: 'period', conversion: 'string' },
          { source: 'response_pointer', sourcePointer: '/value', targetField: 'count', conversion: 'non_negative_integer' }
        ]
      }
    })]);
    const operation = new OperationManifestRegistry([manifest]).prepare('metrics', 'metrics.current', '1.0.0', boundedArguments({ region: 'TW' }));
    if (!operation.ok) throw new Error('derived metadata fixture');
    const extractor = new ManifestResponseExtractor();
    expect(extractor.extract({ value: 7 }, operation.value, {})).toEqual({
      ok: true, value: { metricKey: 'metrics.current', period: 'month', count: 7 }
    });
    expect(extractor.extract({ value: 7 }, operation.value, { metricKey: 'attacker.operation' })).toEqual({
      ok: false, code: 'CONNECTOR_RESPONSE_INVALID'
    });
    expect(extractor.extract({ value: 7 }, operation.value, { period: 'attacker-period' })).toEqual({
      ok: false, code: 'CONNECTOR_RESPONSE_INVALID'
    });
  });
});
