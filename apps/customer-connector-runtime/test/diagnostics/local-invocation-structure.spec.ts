import { readFileSync } from 'node:fs';
import { parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { LocalConnectorDiagnostics, type RuntimeDiagnosticEvent } from '../../src/diagnostics/local-connector-diagnostics';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { SHINMONE_MANIFEST_PATH, SHINMONE_OPERATION_KEY } from '../../integrations/shinmone';
import { boundedArguments } from '../fixtures/phase5-manifests';

describe('local invocation structural diagnostics', () => {
  it('emits only allowlisted response structure and never the business value or body', async () => {
    const manifest = parseConnectorOperationManifestV1(JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8')));
    if (!manifest.ok) throw new Error('fixture manifest');
    const prepared = new OperationManifestRegistry([manifest.value]).prepare(
      'business', SHINMONE_OPERATION_KEY, '1.0.0', boundedArguments({})
    );
    if (!prepared.ok) throw new Error('fixture operation');
    const events: RuntimeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(
      { LOCAL_DEVELOPMENT: '1', LOCAL_CONNECTOR_DIAGNOSTICS: '1' },
      (event) => events.push(event)
    );
    const businessValue = 987654321;
    const rawBody = Buffer.from(JSON.stringify(pascalResponse(businessValue)));
    const result = await new BoundedJsonResponse().read({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield rawBody; } }
    }, prepared.value, new AbortController().signal, {
      diagnostics,
      metadata: {
        requestId: 'request-structure-safe',
        operationKey: SHINMONE_OPERATION_KEY,
        operationVersion: '1.0.0'
      }
    });

    expect(result.ok).toBe(true);
    expect(events).toEqual([expect.objectContaining({
      stage: 'UPSTREAM_RESPONSE_SCHEMA_VALIDATED',
      httpStatusCategory: 'HTTP_2XX',
      contentTypeCategory: 'APPLICATION_JSON',
      responseByteLength: rawBody.byteLength,
      jsonParsingPassed: true,
      responsePointerCount: 1,
      responsePointerResolvedCount: 1,
      responsePointerMissingCount: 0,
      applicationCodePointerConfigured: true,
      applicationCodePointerResolved: true,
      applicationCodeValidationStatus: 'PASS',
      declaredPointerSchemaCount: 1,
      declaredPointerSchemaValidCount: 1,
      declaredPointerSchemaInvalidCount: 0
    })]);
    expect(events[0]).not.toHaveProperty('fullClosedSchemaValidation');
    const released = JSON.stringify(events);
    expect(released).not.toContain(String(businessValue));
    expect(released).not.toContain(rawBody.toString('utf8'));
    expect(released).not.toMatch(/authorization|connectorContextRef|credential|proof|private.?key/i);
  });

  it('classifies a missing expected field without exposing unrelated keys or values', async () => {
    const manifest = parseConnectorOperationManifestV1(JSON.parse(readFileSync(SHINMONE_MANIFEST_PATH, 'utf8')));
    if (!manifest.ok) throw new Error('fixture manifest');
    const prepared = new OperationManifestRegistry([manifest.value]).prepare(
      'business', SHINMONE_OPERATION_KEY, '1.0.0', boundedArguments({})
    );
    if (!prepared.ok) throw new Error('fixture operation');
    const events: RuntimeDiagnosticEvent[] = [];
    const diagnostics = new LocalConnectorDiagnostics(
      { LOCAL_DEVELOPMENT: '1', LOCAL_CONNECTOR_DIAGNOSTICS: '1' },
      (event) => events.push(event)
    );
    const response = pascalResponse(1);
    const rawBody = Buffer.from(JSON.stringify({
      ...response,
      Data: { ...response.Data, NewOrders: undefined, UnrelatedBusinessRecord: 'business-record-secret-sentinel' }
    }));

    const result = await new BoundedJsonResponse().read({
      statusCode: 200, headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield rawBody; } }
    }, prepared.value, new AbortController().signal, {
      diagnostics,
      metadata: { requestId: 'request-structure-failed' }
    });

    expect(result).toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    expect(events).toEqual([expect.objectContaining({
      stage: 'UPSTREAM_RESPONSE_SCHEMA_FAILED',
      responsePointerCount: 1,
      responsePointerResolvedCount: 0,
      responsePointerMissingCount: 1,
      applicationCodePointerConfigured: true,
      applicationCodePointerResolved: true,
      applicationCodeValidationStatus: 'PASS',
      declaredPointerSchemaCount: 0,
      declaredPointerSchemaValidCount: 0,
      declaredPointerSchemaInvalidCount: 0,
      failureCategory: 'CONNECTOR_RESPONSE_INVALID'
    })]);
    expect(events[0]).not.toHaveProperty('fullClosedSchemaValidation');
    expect(JSON.stringify(events)).not.toMatch(/unrelatedBusinessRecord|business-record-secret-sentinel/);
  });
});

function pascalResponse(current: number) {
  const kpi = (value: number, percentage: number | null = 0) => ({
    Current: value, Previous: 1, Change: 0, Trend: 'neutral', ChangePercentage: percentage
  });
  return {
    Code: 200,
    ExecutionTime: '00:00:00.001',
    Message: 'synthetic fixture',
    Data: {
      NewOrders: kpi(current),
      CompletedOrders: kpi(1),
      InProductionOrders: kpi(1),
      AvgCompletionRate: kpi(1, null),
      OverdueOrders: kpi(1),
      TodayShipments: kpi(1),
      LastUpdated: '2026-09-20T00:00:00.000Z'
    }
  };
}
