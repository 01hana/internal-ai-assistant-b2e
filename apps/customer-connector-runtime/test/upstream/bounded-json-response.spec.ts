import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { getOperation, parsedManifest, PHASE5_LIMITS } from '../fixtures/phase5-manifests';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { boundedArguments } from '../fixtures/phase5-manifests';

describe('Phase 6 bounded upstream JSON response', () => {
  const prepared = () => {
    const result = new OperationManifestRegistry([parsedManifest('metrics', [getOperation()])]).prepare('metrics', 'metrics.current', '1.0.0', boundedArguments({ region: 'TW' }));
    if (!result.ok) throw new Error('fixture'); return result.value;
  };
  const response = (body: Buffer, headers: Record<string, string> = { 'content-type': 'application/json' }, statusCode = 200) => ({ statusCode, headers, body: { async *[Symbol.asyncIterator]() { yield body; } } });

  it('accepts bounded UTF-8 JSON and validates the declaredable response/able it', async () => {
    expect(await new BoundedJsonResponse().read(response(Buffer.from('{"value":7}')), prepared())).toEqual({ ok: true, value: { value: 7 } });
  });
  it.each([
    [Buffer.from('{'), { 'content-type': 'application/json' }, 200],
    [Buffer.from([0xff]), { 'content-type': 'application/json' }, 200],
    [Buffer.from('{"value":"wrong"}'), { 'content-type': 'application/json' }, 200],
    [Buffer.from('{"value":7}'), { 'content-type': 'text/plain' }, 200],
    [Buffer.from('{"value":7}'), { 'content-type': 'application/json', 'content-encoding': 'gzip' }, 200],
    [Buffer.from('{"value":7}'), { 'content-type': 'application/json' }, 500]
  ])('rejects malformed/status/header response %#', async (body, headers, status) => {
    expect((await new BoundedJsonResponse().read(response(body, headers, status), prepared())).ok).toBe(false);
  });
  it('stops while streaming beyond the manifest/global cap', async () => {
    const huge = Buffer.alloc(262_145, 0x20);
    expect(await new BoundedJsonResponse().read(response(huge), prepared())).toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });
  it('honls optional application code when present', async () => {
    expect((await new BoundedJsonResponse().read(response(Buffer.from('{"value":7,"code":500}')), prepared())).ok).toBe(false);
  });

  it('preserves timeout ownership when cancellation interrupts a response body stream', async () => {
    const abort = new AbortController();
    const destroy = jest.fn();
    const body = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{"value":');
        await new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('stream-abort-sentinel');
      }
    };
    const pending = new BoundedJsonResponse().read({
      statusCode: 200, headers: { 'content-type': 'application/json' }, body, destroy
    }, prepared(), abort.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: 'CONNECTOR_TIMEOUT' });
    expect(destroy).toHaveBeenCalled();
  });

  it('keeps non-cancelled truncated multi-chunk JSON classified as response invalid', async () => {
    const body = { async *[Symbol.asyncIterator]() { yield Buffer.from('{"val'); yield Buffer.from('ue":'); } };
    await expect(new BoundedJsonResponse().read({
      statusCode: 200, headers: { 'content-type': 'application/json' }, body
    }, prepared(), new AbortController().signal)).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it('rejects fatal UTF-8 split across chunks', async () => {
    const body = { async *[Symbol.asyncIterator]() { yield Buffer.from([0xe2]); yield Buffer.from([0x28, 0xa1]); } };
    await expect(new BoundedJsonResponse().read({
      statusCode: 200, headers: { 'content-type': 'application/json' }, body
    }, prepared(), new AbortController().signal)).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it.each([
    [100, true],
    [101, false]
  ])('enforces the array-item boundary at %i', async (items, accepted) => {
    const operation = preparedFor({
      type: 'object', properties: { values: { type: 'array', items: { type: 'integer' }, maxItems: 100 } },
      required: ['values'], additionalProperties: false
    }, [{ sourcePointer: '/values/0', targetField: 'first', conversion: 'integer' }]);
    const result = await new BoundedJsonResponse().read(response(Buffer.from(JSON.stringify({ values: Array.from({ length: items }, (_, index) => index) }))), operation);
    expect(result.ok).toBe(accepted);
  });

  it.each([
    [8, true],
    [9, false]
  ])('enforces the JSON depth boundary at %i', async (depth, accepted) => {
    const declared = nestedShape(8);
    const operation = preparedFor(declared.schema, [{
      sourcePointer: `/${Array.from({ length: 8 }, () => 'next').join('/')}`,
      targetField: 'value', conversion: 'integer'
    }]);
    const result = await new BoundedJsonResponse().read(response(Buffer.from(JSON.stringify(nestedShape(depth).value))), operation);
    expect(result.ok).toBe(accepted);
  });

  it.each([
    [64, true],
    [65, false]
  ])('enforces the object-key boundary at %i', async (keys, accepted) => {
    const declaredKeys = Math.min(keys, 64);
    const properties = Object.fromEntries(Array.from({ length: declaredKeys }, (_, index) => [`k${index}`, { type: 'integer' }]));
    const operation = preparedFor({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, [
      { sourcePointer: '/k0', targetField: 'first', conversion: 'integer' }
    ]);
    const value = Object.fromEntries(Array.from({ length: keys }, (_, index) => [`k${index}`, index]));
    const result = await new BoundedJsonResponse().read(response(Buffer.from(JSON.stringify(value))), operation);
    expect(result.ok).toBe(accepted);
  });

  it.each([
    [1_024, true],
    [1_025, false]
  ])('enforces the string boundary at %i characters', async (length, accepted) => {
    const operation = preparedFor({
      type: 'object', properties: { value: { type: 'string', maxLength: 1_024 } }, required: ['value'], additionalProperties: false
    }, [{ sourcePointer: '/value', targetField: 'value', conversion: 'string' }]);
    const result = await new BoundedJsonResponse().read(response(Buffer.from(JSON.stringify({ value: 'x'.repeat(length) }))), operation);
    expect(result.ok).toBe(accepted);
  });

  it('accepts the exact raw cap and rejects cap plus one during streaming', async () => {
    const cap = 128;
    const shellBytes = Buffer.byteLength('{"padding":""}');
    const exact = Buffer.from(JSON.stringify({ padding: 'x'.repeat(cap - shellBytes) }));
    expect(exact.byteLength).toBe(cap);
    const operation = preparedFor({
      type: 'object', properties: { padding: { type: 'string', maxLength: cap } }, required: ['padding'], additionalProperties: false
    }, [{ sourcePointer: '/padding', targetField: 'padding', conversion: 'string' }], { maxResponseBytes: cap });
    await expect(new BoundedJsonResponse().read(response(exact), operation)).resolves.toMatchObject({ ok: true });
    const destroy = jest.fn();
    const body = { async *[Symbol.asyncIterator]() { yield exact; yield Buffer.from(' '); } };
    await expect(new BoundedJsonResponse().read({
      statusCode: 200, headers: { 'content-type': 'application/json' }, body, destroy
    }, operation)).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    expect(destroy).toHaveBeenCalled();
  });
});

function preparedFor(schema: object, extraction: readonly object[], limitOverrides: Record<string, number> = {}) {
  const result = new OperationManifestRegistry([parsedManifest('metrics', [getOperation({
    response: { acceptedHttpStatuses: [200], acceptedApplicationCodes: [200], contentType: 'application/json', schema, extraction },
    limits: { ...PHASE5_LIMITS, ...limitOverrides }
  })])]).prepare('metrics', 'metrics.current', '1.0.0', boundedArguments({ region: 'TW' }));
  if (!result.ok) throw new Error('bounded response fixture');
  return result.value;
}

function nestedShape(depth: number): { schema: object; value: unknown } {
  let schema: object = { type: 'integer' };
  let value: unknown = 1;
  for (let index = 0; index < depth; index += 1) {
    schema = { type: 'object', properties: { next: schema }, required: ['next'], additionalProperties: false };
    value = { next: value };
  }
  return { schema, value };
}
