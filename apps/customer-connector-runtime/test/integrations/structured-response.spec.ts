import { parseConnectorInvocationRequestV1, parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';

const number = { type: 'number' };
const integer = { type: 'integer', minimum: 0 };
const string = { type: 'string', maxLength: 128 };
const record = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });
const category = record({ Current: integer, Previous: integer, Rate: number });
const row = record({ Name: string, Count: integer });
const dataSchema = record({
  NewOrders: category,
  LateOrders: category,
  CompletionRate: number,
  Period: string,
  LastUpdated: string,
  Categories: { type: 'array', items: row, maxItems: 4 },
  OptionalNote: { type: 'string', nullable: true }
});
const approved = record({ Data: dataSchema });
const wire = record({ Code: integer, ...approved.properties, InternalToken: string });
const response = { Code: 200, Data: {
  NewOrders: { Current: 8, Previous: 5, Rate: 60.5 },
  LateOrders: { Current: 2, Previous: 3, Rate: 12.5 },
  CompletionRate: 87.25, Period: 'today', LastUpdated: '2026-10-23T00:00:00Z',
  Categories: [{ Name: 'A', Count: 4 }, { Name: 'B', Count: 6 }], OptionalNote: null
}, InternalToken: 'synthetic-secret' };

function manifest(outputSchema: unknown = approved, wireSchema: unknown = wire) {
  return { version: '1', connectorKey: 'synthetic', operations: [{
    operationKey: 'synthetic.dashboard.snapshot', contractVersion: '1.0.0',
    inputSchema: record({}, []), upstreamServiceRef: 'synthetic-api',
    request: { profile: 'GET_QUERY_V1', path: '/stats', fixedQuery: {}, argumentMappings: [] },
    credentialProfileRef: 'synthetic-user', readOnly: true,
    response: { validationProfile: 'FULL_CLOSED_SCHEMA_V1', acceptedHttpStatuses: [200],
      acceptedApplicationCodes: [200], applicationCodePointer: '/Code', contentType: 'application/json',
      schema: wireSchema, extraction: [], structuredOutputSchema: outputSchema },
    limits: { maxRequestBytes: 1024, maxResponseBytes: 8192, maxDepth: 8,
      maxItems: 10, maxStringLength: 256, timeoutMs: 1000 }, errorMap: {}, readinessDependency: 'synthetic-api'
  }] };
}

function prepared(outputSchema: unknown = approved, wireSchema: unknown = wire) {
  const parsed = parseConnectorOperationManifestV1(manifest(outputSchema, wireSchema));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('SYNTHETIC_MANIFEST_INVALID');
  const invocation = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
    version: '1', requestId: 'req-structured', remainingBudgetMs: 1000,
    trustedContext: { customerId: 'synthetic-a', integrationId: 'synthetic-i', hostApp: 'synthetic-host',
      organizationId: 'synthetic-org', actorId: 'synthetic-actor', connectorKey: 'synthetic',
      connectorInstanceId: 'synthetic-instance' },
    operation: { key: 'synthetic.dashboard.snapshot', version: '1.0.0', arguments: {} },
    connectorContextRef: `ccr_${'A'.repeat(43)}`
  })));
  if (!invocation.ok) throw new Error('SYNTHETIC_INVOCATION_INVALID');
  const operation = new OperationManifestRegistry([parsed.value]).prepare('synthetic',
    'synthetic.dashboard.snapshot', '1.0.0', invocation.value.operation.arguments);
  expect(operation.ok).toBe(true);
  if (!operation.ok) throw new Error('SYNTHETIC_OPERATION_INVALID');
  return operation.value;
}

function upstream(value: unknown) {
  return { statusCode: 200, headers: { 'content-type': 'application/json' },
    body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)); } } };
}

describe('opt-in structured response extraction', () => {
  it('releases a complete approved tree without the declared sensitive sibling', async () => {
    const operation = prepared();
    const bounded = await new BoundedJsonResponse().read(upstream(response), operation);
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    const extracted = new ManifestResponseExtractor().extract(bounded.value, operation, {});
    expect(extracted).toEqual({ ok: true, value: approvedValue(response) });
    expect(JSON.stringify(extracted)).not.toContain('synthetic-secret');
  });

  it('rejects unknown fields and malformed or incomplete trees instead of treating them as complete', async () => {
    const operation = prepared();
    for (const value of [
      { ...response, Extra: 1 },
      { ...response, Data: { ...response.Data, LateOrders: undefined } },
      { ...response, Data: { ...response.Data, CompletionRate: '87.25' } },
      { ...response, Data: { ...response.Data, Categories: Array(5).fill({ Name: 'A', Count: 1 }) } },
      { ...response, Data: { ...response.Data, LastUpdated: 'x'.repeat(9_000) } }
    ]) {
      await expect(new BoundedJsonResponse().read(upstream(value), operation))
        .resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    }
  });

  it('uses a newly approved schema field with the same Tool and extraction code', async () => {
    const newField = { CustomerSatisfaction: number };
    const expandedData = record({ ...dataSchema.properties, ...newField });
    const expandedOutput = record({ Data: expandedData });
    const expandedWire = record({ Code: integer, Data: expandedData, InternalToken: string });
    const operation = prepared(expandedOutput, expandedWire);
    const value = { ...response, Data: { ...response.Data, CustomerSatisfaction: 4.5 } };
    const bounded = await new BoundedJsonResponse().read(upstream(value), operation);
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    expect(new ManifestResponseExtractor().extract(bounded.value, operation, {}))
      .toEqual({ ok: true, value: { Data: { ...response.Data, CustomerSatisfaction: 4.5 } } });
  });

  it('rejects a structured output that exposes a credential field or is outside the wire schema', () => {
    expect(parseConnectorOperationManifestV1(manifest(record({ InternalToken: string })))).toEqual({
      ok: false, code: 'CONNECTOR_REQUEST_INVALID'
    });
    expect(parseConnectorOperationManifestV1(manifest(record({ Undeclared: string })))).toEqual({
      ok: false, code: 'CONNECTOR_REQUEST_INVALID'
    });
    const prototypeKey = JSON.parse('{"__proto__":{"type":"string"}}') as Record<string, unknown>;
    expect(parseConnectorOperationManifestV1(manifest(record(prototypeKey)))).toEqual({
      ok: false, code: 'CONNECTOR_REQUEST_INVALID'
    });
    const rowWithSecret = record({ ...row.properties, InternalToken: string });
    const nestedWithSecret = record({ ...dataSchema.properties,
      Categories: { type: 'array', items: rowWithSecret, maxItems: 4 } });
    const wireWithSecret = record({ Code: integer, Data: nestedWithSecret, InternalToken: string });
    expect(parseConnectorOperationManifestV1(manifest(record({ Data: nestedWithSecret }), wireWithSecret))).toEqual({
      ok: false, code: 'CONNECTOR_REQUEST_INVALID'
    });
    const dotted = record({ 'Metric.Current': integer });
    expect(parseConnectorOperationManifestV1(manifest(dotted, record({ Code: integer, 'Metric.Current': integer })))).toEqual({
      ok: false, code: 'CONNECTOR_REQUEST_INVALID'
    });
    const dottedRow = record({ 'Display.Name': string, Count: integer });
    const dottedArray = record({ Categories: { type: 'array', items: dottedRow, maxItems: 4 } });
    expect(parseConnectorOperationManifestV1(manifest(dottedArray, record({ Code: integer, ...dottedArray.properties })))).toEqual({
      ok: false, code: 'CONNECTOR_REQUEST_INVALID'
    });
  });
});

function approvedValue(value: typeof response) { return { Data: value.Data }; }
