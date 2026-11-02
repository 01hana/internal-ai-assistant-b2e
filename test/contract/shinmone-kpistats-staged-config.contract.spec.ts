import { readFileSync } from 'node:fs';
import { parseConnectorInvocationRequestV1, parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../apps/customer-connector-runtime/src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../apps/customer-connector-runtime/src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../apps/customer-connector-runtime/src/upstream/response-extractor';
import { GroundedToolEvidenceNormalizer } from '../../src/assistant/grounding/grounded-tool-evidence.normalizer';
import { parseCustomerCapabilityPackV1 } from '../../src/capabilities/capability-pack.parser';
import { AdapterResultProjectorService } from '../../src/connectors/adapter-result-projector.service';
import { LlmInputSanitizerService } from '../../src/permissions/llm-input-sanitizer.service';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';
import type { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';
import { demoMetricNames, demoPeriods, demoResponse } from '../support/shinmone-kpistats-demo.fixture';

const manifestPath = 'apps/customer-connector-runtime/integrations/shinmone/kpistats-six-metric.demo.manifest.json';
const packPath = 'customer-capability-packs/shinmone-scm-kpistats-demo/1.0.0.json';
const catalogPath = 'test/fixtures/shinmone-kpistats-demo-tool-catalog.json';
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const manifest = parseConnectorOperationManifestV1(readJson(manifestPath));
const pack = parseCustomerCapabilityPackV1(readJson(packPath));
type StagedCatalogTool = Omit<RegisteredToolDefinition, 'id' | 'key' | 'active' | 'requiredPermissionScopes'> & {
  isActive: boolean; requiredPermissions: string[]
};
const catalog = readJson(catalogPath) as { status: string; tools: StagedCatalogTool[] };
const policyRegistry = new ToolRegistryService({} as never, {} as never);
const projector = new AdapterResultProjectorService(new LlmInputSanitizerService());
const normalizer = new GroundedToolEvidenceNormalizer();

function wire(value: unknown) {
  return { statusCode: 200, headers: { 'content-type': 'application/json' },
    body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(value)); } } };
}

function boundedEmptyArguments() {
  const parsed = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
    version: '1', requestId: 'req-staged', remainingBudgetMs: 1000,
    trustedContext: { customerId: 'customer-shinmone-scm-local',
      integrationId: 'shinmone-scm-assistant-local', hostApp: 'shinmone-scm',
      organizationId: 'synthetic-org', actorId: 'synthetic-actor', connectorKey: 'business',
      connectorInstanceId: 'synthetic-instance' },
    operation: { key: 'shinmone.kpistats.snapshot.today', version: '1.0.0', arguments: {} },
    connectorContextRef: `ccr_${'A'.repeat(43)}`
  })));
  if (!parsed.ok) throw new Error('STAGED_INVOCATION_INVALID');
  return parsed.value.operation.arguments;
}

async function executeSynthetic(period: (typeof demoPeriods)[number]) {
  if (!manifest.ok) throw new Error('STAGED_MANIFEST_INVALID');
  const key = `shinmone.kpistats.snapshot.${period.suffix}`;
  const prepared = new OperationManifestRegistry([manifest.value]).prepare('business', key, '1.0.0', boundedEmptyArguments());
  if (!prepared.ok) throw new Error('STAGED_OPERATION_INVALID');
  const payload = demoResponse(period.wire);
  const bounded = await new BoundedJsonResponse().read(wire(payload), prepared.value);
  if (!bounded.ok) throw new Error(bounded.code);
  const extracted = new ManifestResponseExtractor().extract(bounded.value, prepared.value, {});
  if (!extracted.ok) throw new Error(extracted.code);
  const candidate = catalog.tools.find((entry) => entry.name === key);
  if (!candidate) throw new Error('STAGED_TOOL_MISSING');
  const tool: RegisteredToolDefinition = { ...candidate, id: key, key, active: candidate.isActive,
    requiredPermissionScopes: candidate.requiredPermissions };
  const resultPolicy = policyRegistry.resolveResultPolicy(tool);
  const projection = projector.project({ tool, resultPolicy, rawResult: extracted.value,
    permissionScopes: ['menu:SCM_DASHBOARD:read'] });
  if (!projection.projected) throw new Error(projection.errorCode);
  expect(JSON.stringify(projection.result)).not.toContain('ExecutionTime');
  expect(JSON.stringify(projection.result)).not.toContain('Message');
  const evidence = normalizer.normalize({ needId: 'need-1', evidenceRefId: 'evidence-1',
    toolCallId: 'call-1', canonicalToolKey: key, status: 'success', executionStatus: 'executed',
    projectionStatus: 'succeeded', evidenceAttached: true, projectedFacts: projection.result.facts,
    declaredFieldPaths: projection.result.fieldPaths,
    fieldMetadata: projection.result.fieldMetadata, observedAt: '2026-10-28T00:00:00Z' });
  const facts = evidence.projectedFacts.Data as Record<string, unknown>;
  for (const metricName of demoMetricNames) expect(facts[metricName]).toEqual(payload.Data[metricName]);
  expect(facts.TimeRange).toBe(period.wire);
  return { key, prepared: prepared.value, payload, projection, evidence, citation: normalizer.createCitation(evidence) };
}

describe('staged Shinmone six-metric configuration', () => {
  it('is isolated from the running C01 registration and has three exact period bindings', () => {
    expect(manifest.ok).toBe(true);
    expect(pack.active).toBe(false);
    expect(pack.customerId).toBe('customer-shinmone-scm-local');
    expect(pack.integrationId).toBe('shinmone-scm-assistant-local');
    expect(catalog.status).toBe('staged-only');
    expect(catalog.tools).toHaveLength(3);
    expect(catalog.tools.every((tool) => !tool.isActive && tool.requiredPermissions?.includes('menu:SCM_DASHBOARD:read'))).toBe(true);
    expect(pack.bindings.map((binding) => binding.target.toolKey)).toEqual(catalog.tools.map((tool) => tool.name));
    expect(pack.bindings.map((binding) => binding.semanticConstraints[0]?.allowedValues[0]))
      .toEqual(demoPeriods.map((period) => period.canonical));
    for (const tool of catalog.tools) {
      expect(tool.inputSchema).toMatchObject({ required: [], additionalProperties: false });
      expect(tool.hasSideEffect).toBe(false);
    }
    const registration = readFileSync('apps/customer-connector-runtime/integrations/shinmone/shinmone-runtime.registration.ts', 'utf8');
    expect(registration).toContain('SHINMONE_KPISTATS_DEMO_MANIFEST_PATH');
  });

  it.each([
    ['今天新增多少工單？', 0, 'NewOrders.Current'],
    ['今天完成多少工單？', 0, 'CompletedOrders.Current'],
    ['本週生產中的工單有多少？', 1, 'InProductionOrders.Current'],
    ['這個月有逾期的工單嗎？', 2, 'OverdueOrders.Current'],
    ['這個月平均完成率是多少？', 2, 'AvgCompletionRate.Current'],
    ['本週出貨相關統計是多少？', 1, 'TodayShipments.Current'],
    ['那逾期的呢？', 0, 'OverdueOrders.Current'],
    ['那跟前一期比呢？', 0, 'NewOrders.Previous'],
    ['資料最後更新時間？', 0, 'LastUpdated']
  ] as const)('%s uses the approved field in its fixed period', async (_question, periodIndex, field) => {
    const period = demoPeriods[periodIndex];
    const result = await executeSynthetic(period);
    expect(result.prepared.request).toEqual({ profile: 'GET_QUERY_V1', path: '/Dashboard/KPIStats',
      query: [{ name: 'TimeRange', value: period.wire }] });
    const data = (result.evidence.projectedFacts.Data as Record<string, unknown>);
    const metric = field.split('.')[0];
    const member = field.split('.')[1];
    const actual = member ? (data[metric] as Record<string, unknown>)[member] : data[metric];
    expect(actual).toBe(member
      ? (result.payload.Data[metric as keyof typeof result.payload.Data] as Record<string, unknown>)[member]
      : result.payload.Data[metric as keyof typeof result.payload.Data]);
    expect(result.evidence.fieldPaths).toContain(`Data.${field}`);
    expect(result.citation.evidenceRefId).toBe(result.evidence.evidenceRefId);
  });

  it('rejects unknown, missing, null and unapproved response data before Evidence', async () => {
    if (!manifest.ok) throw new Error('STAGED_MANIFEST_INVALID');
    const period = demoPeriods[0];
    const prepared = new OperationManifestRegistry([manifest.value]).prepare('business',
      `shinmone.kpistats.snapshot.${period.suffix}`, '1.0.0', boundedEmptyArguments());
    if (!prepared.ok) throw new Error('STAGED_OPERATION_INVALID');
    const valid = demoResponse(period.wire);
    for (const payload of [
      { ...valid, Data: { ...valid.Data, Unapproved: { Current: 1 } } },
      { ...valid, Data: { ...valid.Data, CompletedOrders: undefined } },
      { ...valid, Data: { ...valid.Data, OverdueOrders: { ...valid.Data.OverdueOrders, Current: null } } },
      { ...valid, Data: { ...valid.Data, NewOrders: { ...valid.Data.NewOrders, ChangePercentage: undefined } } },
      { ...valid, Data: { ...valid.Data, NewOrders: { ...valid.Data.NewOrders, ChangePercentage: null } } },
      { ...valid, Data: { ...valid.Data, LastUpdated: 123 } },
      { ...valid, Data: { ...valid.Data, TimeRange: 123 } }
    ]) {
      expect(await new BoundedJsonResponse().read(wire(payload), prepared.value))
        .toEqual({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' });
    }
    const mismatched = { ...valid, Data: { ...valid.Data, TimeRange: 'yesterday' } };
    const bounded = await new BoundedJsonResponse().read(wire(mismatched), prepared.value);
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    const extracted = new ManifestResponseExtractor().extract(bounded.value, prepared.value, {});
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const candidate = catalog.tools[0];
    const tool: RegisteredToolDefinition = { ...candidate, id: candidate.name, key: candidate.name,
      active: candidate.isActive, requiredPermissionScopes: candidate.requiredPermissions };
    expect(projector.project({ tool, resultPolicy: policyRegistry.resolveResultPolicy(tool),
      rawResult: extracted.value, permissionScopes: ['menu:SCM_DASHBOARD:read'] }))
      .toEqual({ projected: false, errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED' });
  });

  it('has no fixed operation for unsupported historical periods', () => {
    if (!manifest.ok) throw new Error('STAGED_MANIFEST_INVALID');
    const operations = new OperationManifestRegistry([manifest.value]);
    for (const suffix of ['yesterday', 'last-week', 'last-month']) {
      expect(operations.prepare('business', `shinmone.kpistats.snapshot.${suffix}`, '1.0.0', boundedEmptyArguments()).ok).toBe(false);
    }
  });
});
