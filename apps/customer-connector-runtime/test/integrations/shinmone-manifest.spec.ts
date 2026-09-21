import { readFileSync } from 'node:fs';
import { parseConnectorOperationManifestV1, parseConnectorInvocationRequestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';
import {
  SHINMONE_CREDENTIAL_PROFILE_REF,
  SHINMONE_MANIFEST_PATH,
  SHINMONE_OPERATION_KEY
} from '../../integrations/shinmone';

describe('removable Shinmone monthly new-work-order manifest', () => {
  it('loads one exact closed GET_QUERY_V1 operation with no origin or dynamic request surface', () => {
    const raw = JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8'));
    const parsed = parseConnectorOperationManifestV1(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toMatchObject({
      version: '1', connectorKey: 'business', operations: [expect.objectContaining({
        operationKey: SHINMONE_OPERATION_KEY, contractVersion: '1.0.0', readOnly: true,
        upstreamServiceRef: 'shinmone-scm-api', credentialProfileRef: SHINMONE_CREDENTIAL_PROFILE_REF,
        request: {
          profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats',
          fixedQuery: [{ name: 'TimeRange', value: 'thisMonth' }], argumentMappings: []
        },
        response: expect.objectContaining({
          validationProfile: 'DECLARED_POINTERS_V1',
          applicationCodePointer: '/Code',
          extraction: [
            { source: 'operation_key', targetField: 'metricKey', conversion: 'string' },
            { source: 'fixed_query', queryName: 'TimeRange', targetField: 'period', conversion: 'string' },
            { source: 'response_pointer', sourcePointer: '/Data/NewOrders/Current', targetField: 'count', conversion: 'non_negative_integer' }
          ]
        }),
        limits: expect.objectContaining({ maxRequestBytes: 4096, maxResponseBytes: 262144, timeoutMs: 3500 })
      })]
    });
    expect(raw.operations[0].response.schema).toEqual(minimalResponseSchema());
    expect(JSON.stringify(raw)).not.toMatch(/https?:|authorization|nativeAccessToken|acceptedEntry|header|callback|script|body/i);
  });

  it('maps no caller arguments and extracts only the bounded metric, period, and count fields', () => {
    const raw = JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8'));
    const parsed = parseConnectorOperationManifestV1(raw);
    if (!parsed.ok) throw new Error('fixture manifest');
    const registry = new OperationManifestRegistry([parsed.value]);
    const invocation = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
      version: '1', requestId: 'req-shinmone-manifest', remainingBudgetMs: 4500,
      trustedContext: {
        customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared',
        connectorKey: 'business', connectorInstanceId: 'shinmone-scm-connector-1'
      },
      operation: { key: SHINMONE_OPERATION_KEY, version: '1.0.0', arguments: {} },
      connectorContextRef: `ccr_${'A'.repeat(43)}`
    })));
    if (!invocation.ok) throw new Error('fixture invocation');
    const prepared = registry.prepare('business', SHINMONE_OPERATION_KEY, '1.0.0', invocation.value.operation.arguments);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.request).toEqual({ profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats', query: [{ name: 'TimeRange', value: 'thisMonth' }] });
    expect(new ManifestResponseExtractor().extract(realPascalResponse(), prepared.value, {})).toEqual({
      ok: true, value: { metricKey: SHINMONE_OPERATION_KEY, period: 'thisMonth', count: 17 }
    });
  });

  it('accepts a realistic PascalCase KPI response before releasing only normalized fields', async () => {
    const prepared = preparedShinmoneOperation();
    const sentinel = 'unrelated-kpi-business-sentinel';
    const emit = jest.fn();
    const bounded = await new BoundedJsonResponse().read(
      wireResponse({ ...realPascalResponse(), DiagnosticNotes: sentinel }),
      prepared,
      new AbortController().signal,
      { diagnostics: { emit }, metadata: {} }
    );
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    const extracted = new ManifestResponseExtractor().extract(bounded.value, prepared, {});
    expect(extracted).toEqual({
      ok: true,
      value: { metricKey: SHINMONE_OPERATION_KEY, period: 'thisMonth', count: 17 }
    });
    if (!extracted.ok) return;
    expect(Object.keys(extracted.value).sort()).toEqual(['count', 'metricKey', 'period']);
    expect(JSON.stringify(extracted.value)).not.toContain(sentinel);
    const diagnosticOutput = JSON.stringify(emit.mock.calls);
    expect(diagnosticOutput).not.toContain(sentinel);
    expect(diagnosticOutput).not.toContain('/Code');
    expect(diagnosticOutput).not.toContain('/Data/NewOrders/Current');
    expect(emit).toHaveBeenCalledWith(
      'UPSTREAM_RESPONSE_SCHEMA_VALIDATED',
      'SUCCEEDED',
      expect.not.objectContaining({ fullClosedSchemaValidation: expect.anything() })
    );
  });

  it.each([
    ['unrelated top-level field', { ...realPascalResponse(), AdditionalEnvelopeMetadata: { unexpected: true } }],
    ['unrelated Data sibling', { ...realPascalResponse(), Data: { ...realPascalResponse().Data, AdditionalKpi: { Current: 'unexpected' } } }],
    ['malformed unrelated KPI fields', {
      ...realPascalResponse(),
      ExecutionTime: { unexpected: true },
      Message: 7,
      Data: {
        ...realPascalResponse().Data,
        CompletedOrders: 'malformed-but-unrelated',
        OverdueOrders: { unexpected: ['bounded'] }
      }
    }]
  ])('ignores %s for operation validation', async (_case, body) => {
    const prepared = preparedShinmoneOperation();
    const bounded = await new BoundedJsonResponse().read(wireResponse(body), prepared);
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    expect(new ManifestResponseExtractor().extract(bounded.value, prepared, {})).toEqual({
      ok: true,
      value: { metricKey: SHINMONE_OPERATION_KEY, period: 'thisMonth', count: 17 }
    });
  });

  it.each([
    ['missing application code', without(realPascalResponse(), 'Code')],
    ['null application code', { ...realPascalResponse(), Code: null }],
    ['wrong-type application code', { ...realPascalResponse(), Code: '200' }],
    ['rejected application code', { ...realPascalResponse(), Code: 500 }],
    ['missing Data', without(realPascalResponse(), 'Data')],
    ['missing NewOrders', { ...realPascalResponse(), Data: without(realPascalResponse().Data, 'NewOrders') }],
    ['missing Current', withNewOrders(without(realPascalResponse().Data.NewOrders, 'Current'))],
    ['null Current', withNewOrders({ ...realPascalResponse().Data.NewOrders, Current: null })],
    ['negative Current', withNewOrders({ ...realPascalResponse().Data.NewOrders, Current: -1 })],
    ['non-integer Current', withNewOrders({ ...realPascalResponse().Data.NewOrders, Current: 1.5 })],
    ['string Current', withNewOrders({ ...realPascalResponse().Data.NewOrders, Current: '17' })],
    ['camelCase-only fake response', camelCaseFakeResponse()],
    ['wrong NewOrders casing', { ...realPascalResponse(), Data: { ...realPascalResponse().Data, NewOrders: undefined, newOrders: realPascalResponse().Data.NewOrders } }],
    ['wrong Current casing', withNewOrders({ ...realPascalResponse().Data.NewOrders, Current: undefined, current: 17 })]
  ])('rejects %s in the raw upstream contract', async (_case, body) => {
    await expect(new BoundedJsonResponse().read(wireResponse(body), preparedShinmoneOperation()))
      .resolves.toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it.each([
    { method: 'POST' }, { url: 'https://attacker.invalid' }, { headers: { Authorization: 'x' } },
    { body: { arbitrary: true } }
  ])('rejects caller or manifest request overrides %#', (override) => {
    const raw = JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8'));
    raw.operations[0] = { ...raw.operations[0], ...override };
    expect(parseConnectorOperationManifestV1(raw).ok).toBe(false);
  });
});

function preparedShinmoneOperation() {
  const raw = JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8'));
  const parsed = parseConnectorOperationManifestV1(raw);
  if (!parsed.ok) throw new Error('fixture manifest');
  const prepared = new OperationManifestRegistry([parsed.value]).prepare('business', SHINMONE_OPERATION_KEY, '1.0.0', boundedArguments({}));
  if (!prepared.ok) throw new Error('fixture operation');
  return prepared.value;
}

function boundedArguments(value: object) {
  const parsed = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
    version: '1', requestId: 'req-shinmone-wire-contract', remainingBudgetMs: 4500,
    trustedContext: {
      customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp', organizationId: 'org-a', actorId: 'actor-a',
      connectorKey: 'business', connectorInstanceId: 'shinmone-scm-connector-1'
    },
    operation: { key: SHINMONE_OPERATION_KEY, version: '1.0.0', arguments: value },
    connectorContextRef: `ccr_${'A'.repeat(43)}`
  })));
  if (!parsed.ok) throw new Error('fixture arguments');
  return parsed.value.operation.arguments;
}

function kpi(current: number, changePercentage: number | null = 0) {
  return { Current: current, Previous: 16, Change: 1, Trend: 'up', ChangePercentage: changePercentage };
}

function realPascalResponse() {
  return {
    Code: 200,
    ExecutionTime: '00:00:00.001',
    Message: 'synthetic fixture',
    Data: {
      NewOrders: kpi(17),
      CompletedOrders: kpi(11),
      InProductionOrders: kpi(9),
      AvgCompletionRate: kpi(87.5, null),
      OverdueOrders: kpi(2),
      TodayShipments: kpi(5),
      LastUpdated: '2026-09-20T00:00:00.000Z'
    }
  };
}

function withNewOrders(NewOrders: Record<string, unknown>) {
  const response = realPascalResponse();
  return { ...response, Data: { ...response.Data, NewOrders } };
}

function without<T extends Record<string, unknown>>(value: T, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

function camelCaseFakeResponse() {
  const response = realPascalResponse();
  return {
    code: response.Code,
    executionTime: response.ExecutionTime,
    message: response.Message,
    data: { newOrders: { current: response.Data.NewOrders.Current } }
  };
}

function wireResponse(value: unknown) {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)); } }
  };
}

function minimalResponseSchema() {
  return {
    type: 'object',
    properties: {
      Code: { type: 'integer' },
      Data: {
        type: 'object',
        properties: {
          NewOrders: {
            type: 'object',
            properties: { Current: { type: 'integer', minimum: 0 } },
            required: ['Current'],
            additionalProperties: false
          }
        },
        required: ['NewOrders'],
        additionalProperties: false
      }
    },
    required: ['Code', 'Data'],
    additionalProperties: false
  };
}
