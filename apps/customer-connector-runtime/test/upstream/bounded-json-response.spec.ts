import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { customerBOperation, getOperation, parsedManifest, PHASE5_LIMITS } from '../fixtures/phase5-manifests';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { boundedArguments } from '../fixtures/phase5-manifests';
import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';
import { ConnectorDestinationPolicy } from '../../src/upstream/connector-destination-policy';
import { UpstreamExecutionService } from '../../src/upstream/upstream-execution.service';
import { appliedCredentialRequest } from '../../src/credentials/credential.types';

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

  it('keeps legacy value.code enforcement while diagnosing the pointer as not configured', async () => {
    const emit = jest.fn();
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from('{"value":7,"code":500}')),
      prepared(),
      new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    )).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    expect(emit).toHaveBeenCalledWith('UPSTREAM_RESPONSE_SCHEMA_FAILED', 'FAILED', expect.objectContaining({
      applicationCodePointerConfigured: false,
      applicationCodeValidationStatus: 'NOT_CONFIGURED'
    }));
  });

  it('diagnoses only manifest-declared legacy response pointers with bounded generic counts', async () => {
    const emit = jest.fn();
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from('{"value":7}')),
      prepared(),
      new AbortController().signal,
      { diagnostics: { emit }, metadata: { requestId: 'request-generic-pointer' } }
    )).resolves.toMatchObject({ ok: true });
    expect(emit).toHaveBeenCalledWith('UPSTREAM_RESPONSE_SCHEMA_VALIDATED', 'SUCCEEDED', expect.objectContaining({
      responsePointerCount: 1,
      responsePointerResolvedCount: 1,
      responsePointerMissingCount: 0,
      applicationCodePointerConfigured: false,
      applicationCodePointerResolved: false,
      applicationCodeValidationStatus: 'NOT_CONFIGURED',
      declaredPointerSchemaCount: 1,
      declaredPointerSchemaValidCount: 1,
      declaredPointerSchemaInvalidCount: 0,
      fullClosedSchemaValidation: 'PASS'
    }));
  });

  it.each([
    ['PASS', { status: 200, value: 7 }, true],
    ['MISSING', { value: 7 }, false],
    ['TYPE_INVALID', { status: '200', value: 7 }, false],
    ['REJECTED', { status: 500, value: 7 }, false]
  ])('reports configured application-code validation as %s without emitting its value', async (status, body, accepted) => {
    const operation = preparedFor({
      type: 'object',
      properties: { status: { type: 'integer' }, value: { type: 'integer' } },
      required: ['status', 'value'], additionalProperties: false
    }, [{ sourcePointer: '/value', targetField: 'value', conversion: 'integer' }], {}, {
      applicationCodePointer: '/status'
    });
    const emit = jest.fn();
    const result = await new BoundedJsonResponse().read(
      response(Buffer.from(JSON.stringify(body))), operation, new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    );
    expect(result.ok).toBe(accepted);
    expect(emit).toHaveBeenCalledWith(
      accepted ? 'UPSTREAM_RESPONSE_SCHEMA_VALIDATED' : 'UPSTREAM_RESPONSE_SCHEMA_FAILED',
      accepted ? 'SUCCEEDED' : 'FAILED',
      expect.objectContaining({ applicationCodeValidationStatus: status })
    );
    const diagnosticOutput = JSON.stringify(emit.mock.calls);
    expect(diagnosticOutput).not.toMatch(/\/status|"status"|"value"/);
    expect(diagnosticOutput).not.toContain('500');
  });

  it('counts resolved declared pointers by schema validity and excludes missing or derived sources', async () => {
    const operation = preparedFor({
      type: 'object', properties: { value: { type: 'integer' }, missing: { type: 'string' } },
      required: ['value'], additionalProperties: false
    }, [
      { sourcePointer: '/value', targetField: 'legacyValue', conversion: 'integer' },
      { source: 'response_pointer', sourcePointer: '/value', targetField: 'explicitValue', conversion: 'integer' },
      { source: 'response_pointer', sourcePointer: '/missing', targetField: 'missingValue', conversion: 'string' },
      { source: 'operation_key', targetField: 'operation', conversion: 'string' },
      { source: 'fixed_query', queryName: 'period', targetField: 'period', conversion: 'string' }
    ]);
    const emit = jest.fn();
    await new BoundedJsonResponse().read(
      response(Buffer.from('{"value":"wrong"}')), operation, new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    );
    expect(emit).toHaveBeenCalledWith('UPSTREAM_RESPONSE_SCHEMA_FAILED', 'FAILED', expect.objectContaining({
      responsePointerCount: 2,
      responsePointerResolvedCount: 1,
      responsePointerMissingCount: 1,
      declaredPointerSchemaCount: 1,
      declaredPointerSchemaValidCount: 0,
      declaredPointerSchemaInvalidCount: 1,
      fullClosedSchemaValidation: 'FAIL'
    }));
  });

  it('separates an unrelated closed-schema failure from valid declared response pointers', async () => {
    const operation = preparedFor({
      type: 'object', properties: {
        status: { type: 'integer' }, value: { type: 'integer' }, unrelated: { type: 'string' }
      }, required: ['status', 'value', 'unrelated'], additionalProperties: false
    }, [{ source: 'response_pointer', sourcePointer: '/value', targetField: 'value', conversion: 'integer' }], {}, {
      applicationCodePointer: '/status'
    });
    const emit = jest.fn();
    await new BoundedJsonResponse().read(
      response(Buffer.from('{"status":200,"value":7,"unrelated":9}')),
      operation,
      new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    );
    expect(emit).toHaveBeenCalledWith('UPSTREAM_RESPONSE_SCHEMA_FAILED', 'FAILED', expect.objectContaining({
      applicationCodeValidationStatus: 'PASS',
      responsePointerCount: 1,
      responsePointerResolvedCount: 1,
      declaredPointerSchemaCount: 1,
      declaredPointerSchemaValidCount: 1,
      declaredPointerSchemaInvalidCount: 0,
      fullClosedSchemaValidation: 'FAIL'
    }));
  });

  it.each([
    ['extra top-level field', { status: 200, payload: { value: 7 }, unrelated: 'ignored' }],
    ['extra sibling in an ancestor', { status: 200, payload: { value: 7, unrelated: 'ignored' } }],
    ['unrelated field absent', { status: 200, payload: { value: 7 } }],
    ['unrelated field with an unexpected bounded shape', { status: 200, payload: { value: 7, unrelated: { nested: [true] } } }]
  ])('DECLARED_POINTERS_V1 accepts valid corridors when %s', async (_case, body) => {
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from(JSON.stringify(body))),
      declaredPrepared()
    )).resolves.toMatchObject({ ok: true });
  });

  it('DECLARED_POINTERS_V1 validates only declared corridors and omits the full-schema diagnostic', async () => {
    const emit = jest.fn();
    const sentinel = 'unrelated-business-secret-sentinel';
    const operation = declaredPrepared();
    const bounded = await new BoundedJsonResponse().read(
      response(Buffer.from(JSON.stringify({
        status: 200,
        payload: { value: 7, unrelated: sentinel },
        topLevelUnrelated: sentinel
      }))),
      operation,
      new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    );
    expect(bounded).toMatchObject({ ok: true });
    if (!bounded.ok) throw new Error('fixture');
    const extraction = new ManifestResponseExtractor().extract(bounded.value, operation, {});
    expect(extraction).toEqual({ ok: true, value: { value: 7 } });
    expect(emit).toHaveBeenCalledWith('UPSTREAM_RESPONSE_SCHEMA_VALIDATED', 'SUCCEEDED', expect.objectContaining({
      applicationCodeValidationStatus: 'PASS',
      responsePointerCount: 1,
      responsePointerResolvedCount: 1,
      responsePointerMissingCount: 0,
      declaredPointerSchemaCount: 1,
      declaredPointerSchemaValidCount: 1,
      declaredPointerSchemaInvalidCount: 0
    }));
    const diagnostic = emit.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(diagnostic).not.toHaveProperty('fullClosedSchemaValidation');
    expect(JSON.stringify({ extraction, diagnostic })).not.toContain(sentinel);
  });

  it('releases no unrelated sentinel from the generic upstream execution boundary', async () => {
    const sentinel = 'raw-upstream-business-secret-sentinel';
    const emit = jest.fn();
    const upstream = new UpstreamExecutionService(
      new ConnectorDestinationPolicy([{
        upstreamServiceRef: 'metrics-api',
        origin: 'https://metrics.test',
        basePath: '/',
        addressMode: 'public_only',
        allowedCidrs: []
      }], 'production'),
      { execute: jest.fn().mockResolvedValue({
        ok: true,
        value: response(Buffer.from(JSON.stringify({
          status: 200,
          payload: { value: 7, unrelated: sentinel },
          unrelated: sentinel
        })))
      }) } as never,
      jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    );
    const result = await upstream.execute(
      declaredPrepared(),
      {},
      appliedCredentialRequest({}),
      new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    );
    expect(result).toEqual({ ok: true, value: { value: 7 } });
    expect(JSON.stringify({ result, diagnostics: emit.mock.calls })).not.toContain(sentinel);
  });

  it.each([
    ['missing', { payload: { value: 7 } }, 'MISSING'],
    ['null', { status: null, payload: { value: 7 } }, 'TYPE_INVALID'],
    ['wrong type', { status: '200', payload: { value: 7 } }, 'TYPE_INVALID']
  ])('DECLARED_POINTERS_V1 rejects an application code that is %s', async (_case, body, expectedStatus) => {
    const emit = jest.fn();
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from(JSON.stringify(body))),
      declaredPrepared(),
      new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    )).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    expect(emit).toHaveBeenCalledWith('UPSTREAM_RESPONSE_SCHEMA_FAILED', 'FAILED', expect.objectContaining({
      applicationCodeValidationStatus: expectedStatus
    }));
  });

  it('DECLARED_POINTERS_V1 preserves rejected application-code error mapping', async () => {
    const operation = declaredPrepared({}, {}, {
      errorMap: { '500': 'CONNECTOR_UPSTREAM_FAILED' }
    });
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from(JSON.stringify({ status: 500, payload: { value: 7 } }))),
      operation
    )).resolves.toEqual({ ok: false, code: 'CONNECTOR_UPSTREAM_FAILED' });
  });

  it.each([
    ['missing intermediate object', { status: 200 }],
    ['wrong intermediate container kind', { status: 200, payload: 7 }],
    ['missing leaf', { status: 200, payload: {} }],
    ['null leaf', { status: 200, payload: { value: null } }],
    ['wrong leaf type', { status: 200, payload: { value: '7' } }],
    ['numeric constraint violation', { status: 200, payload: { value: -1 } }],
    ['exact casing mismatch', { status: 200, payload: { Value: 7 } }]
  ])('DECLARED_POINTERS_V1 rejects corridor failure: %s', async (_case, body) => {
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from(JSON.stringify(body))),
      declaredPrepared()
    )).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it('DECLARED_POINTERS_V1 applies declared container constraints while traversing', async () => {
    const operation = preparedFor({
      type: 'object',
      properties: {
        status: { type: 'integer' },
        payload: { type: 'array', items: { type: 'integer' }, maxItems: 1 }
      },
      required: ['status', 'payload'],
      additionalProperties: false
    }, [{ sourcePointer: '/payload/0', targetField: 'value', conversion: 'integer' }], {}, {
      validationProfile: 'DECLARED_POINTERS_V1',
      applicationCodePointer: '/status'
    });
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from('{"status":200,"payload":[7,8]}')),
      operation
    )).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it.each([
    ['byte overflow', Buffer.from(JSON.stringify({ status: 200, payload: { value: 7 }, extra: 'x'.repeat(128) })), { maxResponseBytes: 64 }],
    ['depth overflow', Buffer.from(JSON.stringify({ status: 200, payload: { value: 7 }, extra: nestedShape(9).value })), {}],
    ['item overflow', Buffer.from(JSON.stringify({ status: 200, payload: { value: 7 }, extra: Array.from({ length: 101 }, () => 1) })), {}],
    ['object-key overflow', Buffer.from(JSON.stringify({ status: 200, payload: { value: 7 }, extra: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`k${index}`, index])) })), {}],
    ['string overflow', Buffer.from(JSON.stringify({ status: 200, payload: { value: 7 }, extra: 'x'.repeat(1_025) })), {}],
    ['malformed UTF-8', Buffer.from([0xff]), {}],
    ['malformed JSON', Buffer.from('{'), {}]
  ])('DECLARED_POINTERS_V1 preserves global safety: %s', async (_case, body, limits) => {
    await expect(new BoundedJsonResponse().read(response(body), declaredPrepared({}, limits)))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it('explicit FULL_CLOSED_SCHEMA_V1 is runtime-equivalent to omitted legacy behavior', async () => {
    const omitted = prepared();
    const explicit = preparedFor(
      { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false },
      [{ sourcePointer: '/value', targetField: 'value', conversion: 'integer' }],
      {},
      { validationProfile: 'FULL_CLOSED_SCHEMA_V1' }
    );
    for (const operation of [omitted, explicit]) {
      await expect(new BoundedJsonResponse().read(response(Buffer.from('{"value":7}')), operation))
        .resolves.toMatchObject({ ok: true });
      await expect(new BoundedJsonResponse().read(response(Buffer.from('{"value":7,"extra":1}')), operation))
        .resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
      await expect(new BoundedJsonResponse().read(response(Buffer.from('{}')), operation))
        .resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    }
  });

  it('keeps omitted-profile Customer B on full closed-schema validation', async () => {
    const result = new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])])
      .prepare('inventory', 'inventory.stock-on-hand', '1.0.0', boundedArguments({ sku: 'SKU-1' }));
    if (!result.ok) throw new Error('customer B fixture');
    expect(result.value.response.validationProfile).toBeUndefined();
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from('{"sku":"SKU-1","quantity":9}')),
      result.value
    )).resolves.toMatchObject({ ok: true });
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from('{"sku":"SKU-1","quantity":9,"extra":true}')),
      result.value
    )).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    await expect(new BoundedJsonResponse().read(
      response(Buffer.from('{"sku":"SKU-1"}')),
      result.value
    )).resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
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

function preparedFor(
  schema: object,
  extraction: readonly object[],
  limitOverrides: Record<string, number> = {},
  responseOverrides: Record<string, unknown> = {},
  operationOverrides: Record<string, unknown> = {}
) {
  const result = new OperationManifestRegistry([parsedManifest('metrics', [getOperation({
    response: {
      acceptedHttpStatuses: [200], acceptedApplicationCodes: [200], contentType: 'application/json',
      schema, extraction, ...responseOverrides
    },
    limits: { ...PHASE5_LIMITS, ...limitOverrides },
    ...operationOverrides
  })])]).prepare('metrics', 'metrics.current', '1.0.0', boundedArguments({ region: 'TW' }));
  if (!result.ok) throw new Error('bounded response fixture');
  return result.value;
}

function declaredPrepared(
  responseOverrides: Record<string, unknown> = {},
  limitOverrides: Record<string, number> = {},
  operationOverrides: Record<string, unknown> = {}
) {
  return preparedFor({
    type: 'object',
    properties: {
      status: { type: 'integer' },
      payload: {
        type: 'object',
        properties: { value: { type: 'integer', minimum: 0 } },
        required: ['value'],
        additionalProperties: false
      }
    },
    required: ['status', 'payload'],
    additionalProperties: false
  }, [{ sourcePointer: '/payload/value', targetField: 'value', conversion: 'integer' }], limitOverrides, {
    validationProfile: 'DECLARED_POINTERS_V1',
    applicationCodePointer: '/status',
    ...responseOverrides
  }, operationOverrides);
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
