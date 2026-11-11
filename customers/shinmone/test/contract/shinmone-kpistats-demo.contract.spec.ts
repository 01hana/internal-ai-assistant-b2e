import { parseConnectorInvocationRequestV1, parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../../../apps/customer-connector-runtime/src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../../../apps/customer-connector-runtime/src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../../../apps/customer-connector-runtime/src/upstream/response-extractor';
import { AdapterResultProjectorService } from '../../../../src/connectors/adapter-result-projector.service';
import { LlmInputSanitizerService } from '../../../../src/permissions/llm-input-sanitizer.service';
import { ToolRegistryService } from '../../../../src/tools/tool-registry.service';
import type { RegisteredToolDefinition } from '../../../../src/tools/tool-registry.types';
import { approvedOutputSummary } from '../../../../src/query-understanding/tool-capability-summary';
import { demoManifest, demoMetricNames, demoPeriods, demoResponse, demoToolOutputSchemaFor } from '../support/shinmone-kpistats-demo.fixture';

const parsed = parseConnectorOperationManifestV1(demoManifest);
const registry = new ToolRegistryService({} as never, {} as never);
const projector = new AdapterResultProjectorService(new LlmInputSanitizerService());
function boundedArguments(arguments_: Record<string, unknown>) {
  const parsedInvocation = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
    version: '1', requestId: 'req-demo', remainingBudgetMs: 1000,
    trustedContext: { customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp',
      organizationId: 'org-a', actorId: 'actor-a', connectorKey: 'business', connectorInstanceId: 'demo-instance' },
    operation: { key: 'demo.shinmone.kpistats.today', version: '1.0.0', arguments: arguments_ },
    connectorContextRef: `ccr_${'A'.repeat(43)}`
  })));
  if (!parsedInvocation.ok) throw new Error('DEMO_INVOCATION_INVALID');
  return parsedInvocation.value.operation.arguments;
}
const tool = { key: 'demo.shinmone.kpistats.today', version: '1.0.0', id: 'demo-tool',
  name: 'demo.shinmone.kpistats.today', description: 'Isolated KPIStats Demo',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  outputSchema: demoToolOutputSchemaFor('today'), requiredPermissionScopes: ['menu:SCM_DASHBOARD:read'],
  active: true, operation: 'read', riskLevel: 'low', connectorKey: 'business', timeoutMs: 1000,
  hasSideEffect: false, requiresApproval: false, requiresConfirmation: false } as RegisteredToolDefinition;

function wire(value: unknown, statusCode = 200) {
  return { statusCode, headers: { 'content-type': 'application/json' },
    body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)); } } };
}

describe('isolated Shinmone KPIStats Demo contracts', () => {
  it.each(demoPeriods)('uses an exact, fixed $wire period and projects six approved KPIs', async (period) => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const prepared = new OperationManifestRegistry([parsed.value]).prepare('business',
      `demo.shinmone.kpistats.${period.suffix}`, '1.0.0', boundedArguments({}));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.request).toEqual({ profile: 'GET_QUERY_V1', path: '/Dashboard/KpiStats',
      query: [{ name: 'TimeRange', value: period.wire }] });
    const payload = demoResponse(period.wire);
    const bounded = await new BoundedJsonResponse().read(wire(payload), prepared.value);
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    const extracted = new ManifestResponseExtractor().extract(bounded.value, prepared.value, {});
    expect(extracted).toEqual({ ok: true, value: { Data: payload.Data } });
    if (!extracted.ok) return;
    const periodTool = { ...tool, outputSchema: demoToolOutputSchemaFor(period.wire) } as RegisteredToolDefinition;
    const resultPolicy = registry.resolveResultPolicy(periodTool);
    expect(resultPolicy.allowed).toBe(true);
    const projection = projector.project({ tool: periodTool, resultPolicy, rawResult: extracted.value,
      permissionScopes: ['menu:SCM_DASHBOARD:read'] });
    expect(projection.projected).toBe(true);
    if (!projection.projected) return;
    for (const name of demoMetricNames) expect(projection.result.facts.Data).toHaveProperty(name, payload.Data[name]);
    expect(projection.result.facts.Data).toHaveProperty('TimeRange', period.wire);
    expect(projection.result.fieldPaths).toHaveLength(32);
    expect(JSON.stringify(projection.result)).not.toContain('ExecutionTime');
    expect(JSON.stringify(projection.result)).not.toContain('Message');
  });

  it('rejects unapproved arguments, unknown fields, missing data, null data and upstream errors', async () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const operations = new OperationManifestRegistry([parsed.value]);
    expect(operations.prepare('business', 'demo.shinmone.kpistats.today', '1.0.0', boundedArguments({ TimeRange: 'thisMonth' })).ok).toBe(false);
    expect(operations.prepare('business', 'demo.shinmone.kpistats.unknown', '1.0.0', boundedArguments({})).ok).toBe(false);
    const prepared = operations.prepare('business', 'demo.shinmone.kpistats.today', '1.0.0', boundedArguments({}));
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const valid = demoResponse('today');
    for (const payload of [
      { ...valid, Data: { ...valid.Data, UnknownMetric: { Current: 1 } } },
      { ...valid, Data: null },
      { ...valid, Data: { ...valid.Data, NewOrders: undefined } },
      { ...valid, Data: { ...valid.Data, NewOrders: { ...valid.Data.NewOrders, Current: null } } },
      { ...valid, Data: { ...valid.Data, TodayShipments: { ...valid.Data.TodayShipments, Trend: 1 } } }
    ]) {
      expect(await new BoundedJsonResponse().read(wire(payload), prepared.value))
        .toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    }
    expect(await new BoundedJsonResponse().read(wire(valid, 403), prepared.value))
      .toEqual({ ok: false, code: 'CONNECTOR_UPSTREAM_AUTH_FAILED' });
    expect(await new BoundedJsonResponse().read(wire({ ...valid, Code: 500 }), prepared.value))
      .toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
  });

  it('keeps output metadata bounded and applies the existing Result Policy', () => {
    const resultPolicy = registry.resolveResultPolicy(tool);
    expect(resultPolicy.allowed).toBe(true);
    if (!resultPolicy.allowed) return;
    const summary = approvedOutputSummary(tool, resultPolicy.policy, ['menu:SCM_DASHBOARD:read']);
    expect(summary.length).toBeLessThanOrEqual(32);
    expect(Buffer.byteLength(JSON.stringify(summary), 'utf8')).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(summary)).not.toContain('ExecutionTime');
    expect(JSON.stringify(summary)).not.toContain('Message');
  });

  it('rejects an incomplete structured wire contract rather than silently accepting extra data', () => {
    const invalid = structuredClone(demoManifest);
    (invalid.operations[0].response as { validationProfile: string }).validationProfile = 'DECLARED_POINTERS_V1';
    expect(parseConnectorOperationManifestV1(invalid))
      .toEqual({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
  });
});
