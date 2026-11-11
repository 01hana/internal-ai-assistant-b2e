import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { parseConnectorInvocationRequestV1, parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../../../apps/customer-connector-runtime/src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../../../apps/customer-connector-runtime/src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../../../apps/customer-connector-runtime/src/upstream/response-extractor';
import type { DataAdapter, DataAdapterCompatibilityInput, DataAdapterExecuteInput } from '../../../../src/connectors/data-adapter.interface';
import type { ConnectorExecuteResult, ConnectorToolDefinition, DependencyStatus } from '../../../../src/connectors/connector-adapter.interface';
import { MockConnectorAdapter } from '../../../../src/connectors/mock/mock-connector.adapter';
import { LlmExecutionService } from '../../../../src/llm/llm-execution.service';
import { ConversationContextLoaderService } from '../../../../src/assistant/conversation/conversation-context-loader.service';
import { AssistantSessionService } from '../../../../src/assistant/session/assistant-session.service';
import { createCustomerScopeFromHostIntegrationContext } from '../../../../src/host-integration/host-integration-request.factory';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse,
  type Us1TestState } from '../../../../test/support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../../../../test/support/internal-identity-jwt.helper';
import { demoManifest, demoMetricNames, demoPeriods, demoResponse, demoToolOutputSchemaFor } from '../support/shinmone-kpistats-demo.fixture';

const metadata = { provider: 'stub', model: 'isolated-demo', fallbackUsed: false };
const permission = 'menu:SCM_DASHBOARD:read';

class DemoConnectorAdapter implements DataAdapter {
  readonly key = 'business';
  readonly metadata = { adapterKey: 'business', sourceSystem: 'synthetic-shinmone-scm-api',
    supportedHostApps: ['erp'], supportedCapabilities: demoPeriods.map((period) => `demo.shinmone.kpistats.${period.suffix}`) };
  readonly calls: string[] = [];
  responseOverride: unknown;
  statusCode = 200;

  listTools(): ConnectorToolDefinition[] {
    return demoPeriods.map((period) => ({ key: `demo.shinmone.kpistats.${period.suffix}`,
      name: `KPIStats Demo ${period.wire}`, description: 'Read approved synthetic KPIStats statistics.',
      operation: 'read', riskLevel: 'low', inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: {}, requiredPermissionScopes: [permission] }));
  }

  isCompatible(input: DataAdapterCompatibilityInput) {
    return { compatible: input.host.hostApp === 'erp' &&
      demoPeriods.some((period) => input.tool.key === `demo.shinmone.kpistats.${period.suffix}`) &&
      input.operation.canonicalToolKey === input.tool.key && input.operation.schemaVersion === input.tool.version };
  }

  async healthCheck(): Promise<DependencyStatus> {
    return { dependency: 'synthetic-shinmone-scm-api', status: 'healthy', checkedAt: '2026-10-28T00:00:00Z' };
  }

  async execute(input: DataAdapterExecuteInput): Promise<ConnectorExecuteResult> {
    const fail = (code: string): ConnectorExecuteResult => ({ toolKey: input.toolKey, status: 'failed',
      error: { code, message: 'Isolated Demo operation rejected.' } });
    if (input.requestId !== input.host.requestId || input.actorId !== input.host.actorId ||
      input.organizationId !== input.host.organizationId || input.toolKey !== input.operation.canonicalToolKey) {
      return fail('SYNTHETIC_IDENTITY_MISMATCH');
    }
    const manifest = parseConnectorOperationManifestV1(demoManifest);
    if (!manifest.ok) return fail('SYNTHETIC_MANIFEST_INVALID');
    const invocation = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
      version: '1', requestId: input.requestId, remainingBudgetMs: 1000,
      trustedContext: { customerId: input.host.customerId, integrationId: input.host.integrationId,
        hostApp: input.host.hostApp, organizationId: input.host.organizationId, actorId: input.host.actorId,
        connectorKey: 'business', connectorInstanceId: 'demo-instance' },
      operation: { key: input.toolKey, version: input.operation.schemaVersion, arguments: input.operation.arguments },
      connectorContextRef: `ccr_${'A'.repeat(43)}`
    })));
    if (!invocation.ok) return fail('SYNTHETIC_INVOCATION_INVALID');
    const operation = new OperationManifestRegistry([manifest.value]).prepare('business', input.toolKey,
      input.operation.schemaVersion, invocation.value.operation.arguments);
    if (!operation.ok || operation.value.request.profile !== 'GET_QUERY_V1') return fail('SYNTHETIC_OPERATION_INVALID');
    const period = demoPeriods.find((entry) => entry.suffix === input.toolKey.split('.').at(-1));
    if (!period || operation.value.request.query.length !== 1 ||
      operation.value.request.query[0]?.name !== 'TimeRange' ||
      operation.value.request.query[0]?.value !== period.wire || Object.keys(input.operation.arguments).length !== 0) {
      return fail('SYNTHETIC_PERIOD_MISMATCH');
    }
    this.calls.push(period.wire);
    const payload = this.responseOverride ?? demoResponse(period.wire);
    const bounded = await new BoundedJsonResponse().read({ statusCode: this.statusCode,
      headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(payload)); } }
    }, operation.value);
    if (!bounded.ok) return fail(bounded.code);
    const extracted = new ManifestResponseExtractor().extract(bounded.value, operation.value, input.operation.arguments);
    return extracted.ok ? { toolKey: input.toolKey, status: 'succeeded', data: { ...extracted.value } }
      : fail(extracted.code);
  }
}

class IsolatedInventoryAdapter implements DataAdapter {
  readonly key = 'business';
  readonly metadata = { adapterKey: 'business', sourceSystem: 'synthetic-customer-b-inventory',
    supportedHostApps: ['erp'], supportedCapabilities: ['demo.customer-b.inventory.snapshot'] };
  readonly calls: string[] = [];
  listTools(): ConnectorToolDefinition[] { return [{ key: 'demo.customer-b.inventory.snapshot', name: 'Synthetic inventory',
    description: 'Read synthetic stock snapshot.', operation: 'read', riskLevel: 'low',
    inputSchema: { required: [] }, outputSchema: {}, requiredPermissionScopes: ['inventory:read'] }]; }
  isCompatible(input: DataAdapterCompatibilityInput) { return { compatible: input.host.customerId === 'customer-b' &&
    input.tool.key === 'demo.customer-b.inventory.snapshot' && input.operation.canonicalToolKey === input.tool.key }; }
  async healthCheck(): Promise<DependencyStatus> { return { dependency: 'synthetic-customer-b-inventory',
    status: 'healthy', checkedAt: '2026-10-28T00:00:00Z' }; }
  async execute(input: DataAdapterExecuteInput): Promise<ConnectorExecuteResult> {
    if (input.host.customerId !== 'customer-b' || input.toolKey !== 'demo.customer-b.inventory.snapshot' ||
      Object.keys(input.operation.arguments).length !== 0 || input.actorId !== input.host.actorId) {
      return { toolKey: input.toolKey, status: 'failed', error: { code: 'SCOPE_OR_ARGUMENT_INVALID', message: 'Rejected.' } };
    }
    this.calls.push(input.requestId);
    return { toolKey: input.toolKey, status: 'succeeded', data: { Data: {
      CurrentStock: 47, AvailableStock: 39, SourceKey: 'inventory-snapshot' } } };
  }
}

describe('isolated KPIStats Demo through HTTP, SSE and History', () => {
  const previousMode = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
  let app: INestApplication;
  let state: Us1TestState;
  let llm: LlmExecutionService;
  let adapter: DemoConnectorAdapter;
  let inventoryAdapter: IsolatedInventoryAdapter;

  const claims = { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
    permission_scopes: [...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA.permission_scopes, permission] };

  beforeEach(async () => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    adapter = new DemoConnectorAdapter();
    inventoryAdapter = new IsolatedInventoryAdapter();
    ({ app, state } = await createUs1TestAppWithState({
      capabilityPackPaths: ['customers/shinmone/test/fixtures/capability-packs/shinmone-kpistats-demo.v1.json',
        'test/fixtures/capability-packs/customer-b-context-isolation.v1.json'],
      augmentStateBeforeInit: (fixture) => {
        const prototype = fixture.toolDefinitions.find((item) => item.name === 'mock.orders.status.lookup');
        if (!prototype) throw new Error('DEMO_TOOL_PROTOTYPE_MISSING');
        for (const period of demoPeriods) {
          const definition = structuredClone(prototype);
          definition.id = `demo-kpistats-${period.suffix}`;
          definition.name = `demo.shinmone.kpistats.${period.suffix}`;
          definition.description = 'Read approved KPIStats Demo data: NewOrders 新增工單、CompletedOrders 完工工單、' +
            'InProductionOrders 生產中工單、AvgCompletionRate 完工率、OverdueOrders 逾期工單、' +
            'TodayShipments 出貨工單；含 Current 本期、Previous 前期、Change 差值、' +
            'ChangePercentage 相對變化百分比、Trend 方向、LastUpdated 與 TimeRange。';
          definition.connectorKey = 'business';
          definition.requiredPermissions = [permission];
          definition.inputSchema = { type: 'object', properties: {}, required: [], additionalProperties: false };
          definition.outputSchema = demoToolOutputSchemaFor(period.wire);
          fixture.toolDefinitions.push(definition);
          fixture.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: definition.id,
            enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
        }
        const bDefinition = structuredClone(prototype);
        bDefinition.id = 'demo-customer-b-inventory';
        bDefinition.name = 'demo.customer-b.inventory.snapshot';
        bDefinition.description = 'Read approved CurrentStock 現量 and AvailableStock 可用量.';
        bDefinition.connectorKey = 'business';
        bDefinition.requiredPermissions = ['inventory:read'];
        bDefinition.inputSchema = { type: 'object', properties: {}, required: [], additionalProperties: false };
        bDefinition.outputSchema = { type: 'object', additionalProperties: false, required: ['Data'],
          properties: { Data: { type: 'object', additionalProperties: false,
            required: ['CurrentStock', 'AvailableStock', 'SourceKey'], properties: {
              CurrentStock: { type: 'number', description: '庫存現量' },
              AvailableStock: { type: 'number', description: '庫存可用量' },
              SourceKey: { type: 'string', description: '合成來源識別' }
            } } },
          'x-assistant-result-policy': { version: '1', allowedFieldPaths: ['Data', 'Data.SourceKey'], deniedFieldPaths: [],
            permissionMasks: [], limits: { maxDepth: 3, maxItems: 10, maxStringLength: 128,
              maxTotalBytes: 1024 }, evidenceSafeProvenanceFields: ['Data.SourceKey'] } };
        fixture.toolDefinitions.push(bDefinition);
        fixture.customerToolPolicies.push({ customerId: 'customer-b', toolDefinitionId: bDefinition.id,
          enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
      },
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => [...mockRegistrations,
        { adapter, connectorKey: 'business', customerId: 'customer-a', integrationId: 'integration-erp',
          hostApp: 'erp', active: true },
        { adapter: inventoryAdapter, connectorKey: 'business', customerId: 'customer-b',
          integrationId: 'integration-erp', hostApp: 'erp', active: true }]
    }));
    llm = app.get(LlmExecutionService, { strict: false });
    jest.spyOn(llm, 'generateAnswer').mockRejectedValue(new Error('UNEXPECTED_LIVE_SELECTION'));
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '' };
      throw new Error('UNEXPECTED_LIVE_GENERATION');
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    if (previousMode === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousMode;
  });

  function stubSelection(suffix: string, canonical: string) {
    jest.mocked(llm.generateAnswer).mockResolvedValue({
      content: JSON.stringify({ decision: 'select', toolKey: `demo.shinmone.kpistats.${suffix}`,
        toolVersion: '1.0.0', parameters: { timeRange: canonical }, arguments: {} }),
      finishReason: 'stop', metadata
    });
  }

  function stubGroundedAnswer(name: (typeof demoMetricNames)[number]) {
    jest.mocked(llm.streamAnswer).mockImplementation(async function* (input) {
      const content = input.messages.find((message) => message.role === 'tool')?.content;
      const facts = content?.split('\n')[2];
      const parsed = facts ? JSON.parse(facts) as { Data: Record<string, { Current: number }> } : undefined;
      const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
      if (!parsed || !citation) throw new Error('DEMO_EVIDENCE_NOT_IN_GENERATION');
      yield { type: 'text_delta', text: `${name} 本期 ${parsed.Data[name].Current}。 [${citation}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
  }

  async function ask(message: string, requestId: string, permissionScopes = claims.permission_scopes) {
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...claims, permission_scopes: permissionScopes }, requestId
      })).send({ message, pageContext: { module: 'dashboard' } });
    return { response, events: parseSseResponse(response.text) };
  }

  it.each([
    ['今天新增多少張工單？', demoPeriods[0], 'NewOrders'],
    ['今天有多少工單完成？', demoPeriods[0], 'CompletedOrders'],
    ['本週正在生產的工單有多少？', demoPeriods[1], 'InProductionOrders'],
    ['這個月的完工率是多少？', demoPeriods[2], 'AvgCompletionRate'],
    ['今天逾期工單有幾張？', demoPeriods[0], 'OverdueOrders'],
    ['今天出貨工單統計是多少？', demoPeriods[0], 'TodayShipments']
  ] as const)('passes approved %s through exact period and six-field Evidence', async (question, period, name) => {
    stubSelection(period.suffix, period.canonical);
    stubGroundedAnswer(name);
    const requestId = `demo-${period.suffix}-${name}`;
    const { response, events } = await ask(question, requestId);
    expect(response.status).toBe(200);
    expect(state.auditEvents.find((item) => item.requestId === requestId && item.eventType === 'llm_tool_selection_completed')?.metadata)
      .toEqual(expect.objectContaining({ reason: 'SELECTED', modelCalled: true,
        toolKey: `demo.shinmone.kpistats.${period.suffix}` }));
    const selectionInput = JSON.parse(jest.mocked(llm.generateAnswer).mock.calls[0]?.[0].messages[0]?.content ?? '{}') as
      { tools: Array<{ description: string }> };
    expect(selectionInput.tools).toHaveLength(3);
    for (const metricName of demoMetricNames) {
      expect(selectionInput.tools.map((item) => item.description).join(' ')).toContain(metricName);
    }
    expect(JSON.stringify(selectionInput)).not.toContain('/Dashboard/KpiStats');
    expect(JSON.stringify(selectionInput)).not.toContain('shinmone-idx-bearer-v1');
    expect(adapter.calls).toEqual([period.wire]);
    expect(state.toolCalls.find((item) => item.requestId === requestId)).toEqual(expect.objectContaining({ status: 'success' }));
    const evidence = state.evidenceRefs.find((item) => item.requestId === requestId);
    if (!evidence) throw new Error(`DEMO_EVIDENCE_MISSING:${JSON.stringify({
      events: events.map((event) => event.event),
      audits: state.auditEvents.filter((item) => item.requestId === requestId &&
        ['grounded_retrieval_lane_rejected', 'grounded_retrieval_coverage_evaluated'].includes(item.eventType))
        .map((item) => ({ type: item.eventType, metadata: item.metadata })),
      tool: state.toolCalls.filter((item) => item.requestId === requestId).map((item) => ({ status: item.status,
        executionStatus: item.executionStatus, errorCode: item.errorCode }))
    })}`);
    expect(evidence).toBeDefined();
    const fields = (evidence?.summary as { fields: { Data: Record<string, unknown> } })?.fields;
    for (const metricName of demoMetricNames) expect(fields.Data).toHaveProperty(metricName);
    expect(fields.Data.TimeRange).toBe(period.wire);
    const answer = events.find((event) => event.event === 'final')?.data.data.answer as string;
    if (!answer) throw new Error(`DEMO_ANSWER_MISSING:${JSON.stringify({ events: events.map((event) => event.event),
      audits: state.auditEvents.filter((item) => item.requestId === requestId).map((item) => ({
        type: item.eventType, metadata: ['answer_generated', 'grounded_retrieval_lane_rejected'].includes(item.eventType)
          ? item.metadata : undefined })) })}`);
    expect(answer).toContain(String(demoResponse(period.wire).Data[name].Current));
    expect(events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta).join(''))
      .toBe(answer);
    expect(events.find((event) => event.event === 'final')?.data.data.evidenceRefs).toEqual([evidence?.id]);
    expect(state.messages.find((item) => item.requestId === requestId && item.role === 'assistant')?.content).toBe(answer);
    const history = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims, requestId: `${requestId}-history`
      }));
    expect(history.status).toBe(200);
    expect(history.body.data.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: answer })]));
    expect(JSON.stringify(events)).not.toContain('ExecutionTime');
  });

  it.each(['comparison', 'rate', 'summary'] as const)('keeps %s grounded in the same approved response', async (kind) => {
    stubSelection('monthly', 'this_month');
    jest.mocked(llm.streamAnswer).mockImplementation(async function* (input) {
      const content = input.messages.find((message) => message.role === 'tool')?.content;
      const facts = content?.split('\n')[2];
      const data = facts ? (JSON.parse(facts) as { Data: ReturnType<typeof demoResponse>['Data'] }).Data : undefined;
      const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
      if (!data || !citation) throw new Error('DEMO_EVIDENCE_NOT_IN_GENERATION');
      const answer = kind === 'comparison'
        ? `新增工單本期 ${data.NewOrders.Current} 張，前期 ${data.NewOrders.Previous} 張，差 ${data.NewOrders.Change} 張，` +
          `相對變化 ${data.NewOrders.ChangePercentage}%，方向 ${data.NewOrders.Trend}。`
        : kind === 'rate'
          ? `完工率本期 ${data.AvgCompletionRate.Current}%，前期 ${data.AvgCompletionRate.Previous}%，` +
            `差 ${data.AvgCompletionRate.Change} 個百分點；相對變化 ${data.AvgCompletionRate.ChangePercentage}%。`
          : demoMetricNames.map((name) => `${name} ${data[name].Current}`).join('、') + '。';
      yield { type: 'text_delta', text: `${answer} [${citation}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const requestId = `demo-${kind}`;
    const { events } = await ask(kind === 'comparison' ? '本月新增工單比前期多還是少？'
      : kind === 'rate' ? '比較本月與前期完工率。' : '摘要本月 KPI。', requestId);
    const evidence = state.evidenceRefs.find((item) => item.requestId === requestId);
    expect(evidence).toBeDefined();
    const data = (evidence?.summary as { fields: { Data: ReturnType<typeof demoResponse>['Data'] } })?.fields.Data;
    expect(data).toEqual(demoResponse('thisMonth').Data);
    const answer = events.find((event) => event.event === 'final')?.data.data.answer as string;
    expect(answer).toContain(String(kind === 'rate' ? data.AvgCompletionRate.Change : data.NewOrders.Current));
    if (kind === 'summary') for (const name of demoMetricNames) expect(answer).toContain(name);
    expect(events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta).join(''))
      .toBe(answer);
    expect(events.find((event) => event.event === 'final')?.data.data.evidenceRefs).toEqual([evidence?.id]);
  });

  it('rejects a model-selected period that does not match its exact Binding', async () => {
    stubSelection('today', 'this_month');
    const { response } = await ask('這個月新增多少張工單？', 'demo-period-mismatch');
    expect(response.status).toBe(200);
    expect(adapter.calls).toHaveLength(0);
    expect(state.toolCalls.filter((item) => item.requestId === 'demo-period-mismatch')).toHaveLength(0);
  });

  it.each([
    ['昨天新增多少張工單？', 'today', 'today'],
    ['上週新增多少張工單？', 'weekly', 'this_week'],
    ['上個月新增多少張工單？', 'monthly', 'this_month']
  ])('never executes a valid but wrong-period Tool for %s', async (question, suffix, canonical) => {
    stubSelection(suffix, canonical);
    const requestId = `demo-explicit-period-${suffix}`;
    const { response, events } = await ask(question, requestId);
    expect(response.status).toBe(200);
    expect(events.find((event) => event.event === 'final')?.data.data.answer)
      .toContain('目前無法安全選擇查詢工具');
    expect(adapter.calls).toHaveLength(0);
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.auditEvents.find((item) => item.requestId === requestId &&
      item.eventType === 'llm_tool_selection_completed')?.metadata).toEqual(expect.objectContaining({
      selectionFailureStage: 'TIME_RANGE', selectionFailureReason: 'EXPLICIT_TIME_RANGE_MISMATCH' }));
  });

  it('does not answer a two-period comparison using a one-period Tool', async () => {
    stubSelection('weekly', 'this_week');
    const requestId = 'demo-two-period-comparison';
    const { response } = await ask('本週跟上週新增工單相比呢？', requestId);
    expect(response.status).toBe(200);
    expect(adapter.calls).toHaveLength(0);
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.auditEvents.find((item) => item.requestId === requestId &&
      item.eventType === 'llm_tool_selection_completed')?.metadata).toEqual(expect.objectContaining({
      selectionFailureStage: 'TIME_RANGE', selectionFailureReason: 'MULTIPLE_EXPLICIT_TIME_RANGES' }));
  });

  it.each([
    ['那本週呢？', 'weekly', 'this_week', 'thisWeek'],
    ['那這個月呢？', 'monthly', 'this_month', 'thisMonth']
  ])('allows a verified follow-up to move from today to %s', async (question, suffix, canonical, wire) => {
    stubGroundedAnswer('NewOrders');
    stubSelection('today', 'today');
    await ask('今天新增多少張工單？', 'demo-followup-period-first');
    stubSelection(suffix, canonical);
    const requestId = `demo-followup-period-${suffix}`;
    const { response, events } = await ask(question, requestId);
    expect(response.status).toBe(200);
    expect(adapter.calls).toEqual(['today', wire]);
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(1);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(1);
    expect(events.find((event) => event.event === 'final')?.data.data.answer)
      .toContain(String(demoResponse(wire as 'thisWeek' | 'thisMonth').Data.NewOrders.Current));
  });

  it('does not offer or execute a Demo Tool without the synthetic menu permission', async () => {
    const selector = jest.mocked(llm.generateAnswer);
    const { response } = await ask('今天新增多少張工單？', 'demo-no-permission', []);
    expect(response.status).toBe(200);
    expect(selector).not.toHaveBeenCalled();
    expect(adapter.calls).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'demo-no-permission')).toHaveLength(0);
  });

  it('rejects a model-selected side-effect Tool outside the Demo capability and read-only registry', async () => {
    jest.mocked(llm.generateAnswer).mockResolvedValue({
      content: JSON.stringify({ decision: 'select', toolKey: 'mock.orders.status.update',
        toolVersion: '1.0.0', parameters: {}, arguments: { entityId: 'SO-10001' } }),
      finishReason: 'stop', metadata
    });
    const beforeToolCalls = state.toolCalls.length;
    const beforeDrafts = state.actionDrafts.length;
    const beforeApprovals = state.approvalRequests.length;

    const { response } = await ask('請更改訂單狀態', 'demo-reject-selected-write');

    expect(response.status).toBe(200);
    expect(adapter.calls).toHaveLength(0);
    expect(state.toolCalls).toHaveLength(beforeToolCalls);
    expect(state.actionDrafts).toHaveLength(beforeDrafts);
    expect(state.approvalRequests).toHaveLength(beforeApprovals);
    expect(jest.mocked(llm.streamAnswer)).not.toHaveBeenCalled();
  });

  it('does not let the read-only Demo identity confirm an existing write Draft or approve a write request', async () => {
    const executeWrite = jest.spyOn(app.get(MockConnectorAdapter, { strict: false }), 'execute');
    const beforeToolCalls = state.toolCalls.length;
    const draft = state.actionDrafts.find((item) => item.id === 'action-draft-waiting-001');
    const approval = state.approvalRequests.find((item) => item.id === 'approval-request-pending-approve-001');
    const beforeDraftStatus = draft?.status;
    const beforeApprovalStatus = approval?.status;
    const headers = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
      claims, requestId: 'demo-direct-write-denied'
    });

    const [draftResponse, approvalResponse] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
        .set(headers).send({ idempotencyKey: 'demo-draft-denied' }),
      request(app.getHttpServer()).post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
        .set(headers).send({ idempotencyKey: 'demo-approval-denied' })
    ]);

    expect(draftResponse.status).toBe(403);
    expect(approvalResponse.status).toBe(403);
    expect(adapter.calls).toHaveLength(0);
    expect(executeWrite).not.toHaveBeenCalled();
    expect(state.toolCalls).toHaveLength(beforeToolCalls);
    expect(draft?.status).toBe(beforeDraftStatus);
    expect(approval?.status).toBe(beforeApprovalStatus);
  });

  it.each([
    ['unknown field', { ...demoResponse('today'), Data: { ...demoResponse('today').Data, Extra: 9 } }],
    ['missing KPI', { ...demoResponse('today'), Data: { ...demoResponse('today').Data, NewOrders: undefined } }],
    ['null Data', { ...demoResponse('today'), Data: null }],
    ['invalid Trend', { ...demoResponse('today'), Data: { ...demoResponse('today').Data,
      NewOrders: { ...demoResponse('today').Data.NewOrders, Trend: 'sideways' } } }],
    ['wrong response period', { ...demoResponse('today'), Data: { ...demoResponse('today').Data,
      TimeRange: 'thisMonth' } }]
  ])('never attaches Evidence from %s', async (scenario, payload) => {
    stubSelection('today', 'today');
    adapter.responseOverride = payload;
    const requestId = `demo-invalid-${scenario.replaceAll(' ', '-')}`;
    const { response } = await ask('今天新增多少張工單？', requestId);
    expect(response.status).toBe(200);
    expect(adapter.calls).toEqual(['today']);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(jest.mocked(llm.streamAnswer)).not.toHaveBeenCalled();
  });

  it('does not execute when the isolated Customer Tool Policy is disabled', async () => {
    for (const policy of state.customerToolPolicies.filter((item) => item.toolDefinitionId.startsWith('demo-kpistats-'))) {
      policy.enabled = false;
    }
    const { response } = await ask('今天新增多少張工單？', 'demo-policy-disabled');
    expect(response.status).toBe(200);
    expect(jest.mocked(llm.generateAnswer)).not.toHaveBeenCalled();
    expect(adapter.calls).toHaveLength(0);
  });

  it('does not let another Customer use the Demo session or its Evidence', async () => {
    const requestId = 'demo-cross-customer';
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerB,
          permission_scopes: [permission] }, requestId
      })).send({ message: '今天新增多少張工單？', pageContext: { module: 'dashboard' } });
    expect(response.status).not.toBe(200);
    expect(jest.mocked(llm.generateAnswer)).not.toHaveBeenCalled();
    expect(adapter.calls).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
  });

  it('keeps same-named capabilities isolated across two Customers through selection and runtime', async () => {
    stubSelection('today', 'today');
    stubGroundedAnswer('NewOrders');
    await ask('今天新增多少張工單？', 'isolation-a-first');
    const aEvidence = state.evidenceRefs.find((item) => item.requestId === 'isolation-a-first');
    expect(aEvidence).toBeDefined();

    jest.mocked(llm.generateAnswer).mockImplementation(async (input) => {
      const prompt = JSON.parse(input.messages[0].content) as { question: string;
        previous?: { recentQuestions?: string[] }; tools: Array<{ toolKey: string; capabilityKey: string; description: string }> };
      if (prompt.question.includes('可用量')) {
        expect(prompt.previous?.recentQuestions).toEqual(['今天庫存現量是多少？']);
      } else expect(prompt.previous).toBeUndefined();
      expect(prompt.tools).toHaveLength(1);
      expect(prompt.tools[0]).toEqual(expect.objectContaining({
        capabilityKey: 'demo.dashboard.kpistats', toolKey: 'demo.customer-b.inventory.snapshot' }));
      expect(JSON.stringify(prompt)).not.toMatch(/NewOrders|新增工單|demo\.shinmone|isolation-a-first/);
      return { content: JSON.stringify({ decision: 'select', toolKey: 'demo.customer-b.inventory.snapshot',
        toolVersion: '1.0.0', parameters: {}, arguments: {} }),
      finishReason: 'stop', metadata };
    });
    jest.mocked(llm.streamAnswer).mockImplementation(async function* (input) {
      const content = input.messages.find((item) => item.role === 'tool')?.content;
      const current = input.messages.find((item) => item.role === 'user')?.content ?? '';
      const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
      if (!content || !citation) throw new Error('CUSTOMER_B_EVIDENCE_MISSING');
      const focus = current.includes('可用量') ? 'AvailableStock' : 'CurrentStock';
      const value = focus === 'AvailableStock' ? 39 : 47;
      expect(content).toContain(focus);
      expect(content).toContain(String(value));
      expect(content).not.toContain(String(demoResponse('today').Data.NewOrders.Current));
      yield { type: 'text_delta', text: `${focus} ${value}。 [${citation}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const bClaims = { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerB,
      permission_scopes: ['inventory:read'] };
    const bRequestId = 'isolation-b-own-tool';
    const b = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-hidden-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: bClaims, requestId: bRequestId
      })).send({ message: '今天庫存現量是多少？', pageContext: { module: 'inventory' } });
    const events = parseSseResponse(b.text);
    expect(b.status).toBe(200);
    expect(inventoryAdapter.calls).toEqual([bRequestId]);
    const bEvidence = state.evidenceRefs.find((item) => item.requestId === bRequestId);
    expect(bEvidence).toBeDefined();
    expect(bEvidence?.customerId).toBe('customer-b');
    expect(bEvidence?.id).not.toBe(aEvidence?.id);
    expect(events.find((item) => item.event === 'final')?.data.data.evidenceRefs).toEqual([bEvidence?.id]);
    expect(JSON.stringify(events)).not.toContain(aEvidence?.id);
    expect(JSON.stringify(state.auditEvents.filter((item) => item.requestId === bRequestId))).not.toContain(aEvidence?.id);
    const followUpId = 'isolation-b-followup';
    const second = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-hidden-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: bClaims, requestId: followUpId
      })).send({ message: '那可用量呢？', pageContext: { module: 'inventory' } });
    expect(second.status).toBe(200);
    expect(inventoryAdapter.calls).toEqual([bRequestId, followUpId]);
    const bSecondEvidence = state.evidenceRefs.find((item) => item.requestId === followUpId);
    expect(bSecondEvidence?.id).not.toBe(bEvidence?.id);
    expect(parseSseResponse(second.text).find((item) => item.event === 'final')?.data.data.evidenceRefs)
      .toEqual([bSecondEvidence?.id]);
    expect(JSON.stringify(parseSseResponse(second.text))).not.toContain(aEvidence?.id);
    const history = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-hidden-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: bClaims, requestId: 'isolation-b-history'
      }));
    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body)).not.toContain(aEvidence?.id);
    expect(JSON.stringify(history.body)).not.toContain('新增工單');
  });

  it('does not inherit a query across actor, organization, session, integration, or revoked permission', async () => {
    stubSelection('today', 'today');
    stubGroundedAnswer('NewOrders');
    await ask('今天新增多少張工單？', 'isolation-scope-anchor');
    const anchorEvidenceId = state.evidenceRefs.find((item) => item.requestId === 'isolation-scope-anchor')?.id;
    expect(anchorEvidenceId).toBeDefined();
    const selector = jest.mocked(llm.generateAnswer);
    selector.mockClear();
    for (const [suffix, change] of [
      ['actor', { sub: 'actor-other' }], ['organization', { org_id: 'org-other' }]
    ] as const) {
      const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: { ...claims, ...change }, requestId: `isolation-${suffix}`
        })).send({ message: '跟昨天相比呢？' });
      expect(response.status).not.toBe(200);
    }
    expect(selector).not.toHaveBeenCalled();
    state.sessions.push({ ...state.sessions[0], id: 'session-isolated-new', lastMessageAt: new Date() });
    selector.mockResolvedValue({ content: JSON.stringify({ decision: 'none' }), finishReason: 'stop', metadata });
    const newSession = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-isolated-new/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims, requestId: 'isolation-new-session'
      })).send({ message: '跟昨天相比呢？' });
    expect(newSession.status).toBe(200);
    expect(JSON.stringify(parseSseResponse(newSession.text))).not.toContain(anchorEvidenceId);
    if (selector.mock.calls.length > 0) {
      const prompt = JSON.parse(selector.mock.calls.at(-1)?.[0].messages[0].content ?? '{}') as Record<string, unknown>;
      expect(prompt.previous).toBeUndefined();
    }
    selector.mockClear();
    await ask('跟昨天相比呢？', 'isolation-revoked', []);
    expect(selector).not.toHaveBeenCalled();
    expect(state.toolCalls.filter((item) => item.requestId === 'isolation-revoked')).toHaveLength(0);
    const otherIntegration = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...claims, integration_id: 'integration-other' }, requestId: 'isolation-integration'
      })).send({ message: '跟昨天相比呢？' });
    expect(otherIntegration.status).toBe(404);
    expect(selector).not.toHaveBeenCalled();
    expect(state.toolCalls.filter((item) => item.requestId === 'isolation-integration')).toHaveLength(0);
    expect(JSON.stringify(otherIntegration.body)).not.toContain(anchorEvidenceId);
    expect(state.messages.filter((item) => item.requestId === 'isolation-integration')).toHaveLength(0);
    for (const policy of state.customerToolPolicies.filter((item) => item.toolDefinitionId.startsWith('demo-kpistats-'))) {
      policy.enabled = false;
    }
    await ask('跟昨天相比呢？', 'isolation-policy-revoked');
    expect(selector).not.toHaveBeenCalled();
    expect(state.toolCalls.filter((item) => item.requestId === 'isolation-policy-revoked')).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'isolation-policy-revoked')).toHaveLength(0);
  });

  it('does not expose same-session History to a different Integration', async () => {
    stubSelection('today', 'today');
    stubGroundedAnswer('NewOrders');
    await ask('今天新增多少張工單？', 'history-integration-anchor');
    const ownHistory = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims, requestId: 'history-integration-owner'
      }));
    expect(ownHistory.status).toBe(200);
    const otherHeaders = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
      claims: { ...claims, integration_id: 'integration-other' }, requestId: 'history-integration-other'
    });
    const otherSession = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001')
      .set(otherHeaders);
    expect(otherSession.status).toBe(404);
    const otherHistory = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(otherHeaders);
    expect(otherHistory.status).toBe(404);
    expect(JSON.stringify(otherHistory.body)).not.toContain('今天新增多少張工單？');
    const otherMessage = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(otherHeaders).send({ message: '跟昨天相比呢？' });
    expect(otherMessage.status).toBe(404);
    expect(state.messages.filter((item) => item.requestId === 'history-integration-other')).toHaveLength(0);
    const sessionService = app.get(AssistantSessionService, { strict: false });
    const otherScope = createCustomerScopeFromHostIntegrationContext({ customerId: 'customer-a', integrationId: 'integration-other',
      organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared',
      roles: claims.roles, permissionScopes: claims.permission_scopes, requestId: 'history-integration-other' });
    expect((await sessionService.listVisibleSessions(otherScope)).some((item) =>
      item.id === 'session-owned-001')).toBe(false);
    await expect(sessionService.closeVisibleSession({ customerScope: otherScope,
      sessionId: 'session-owned-001' })).rejects.toMatchObject({ status: 404 });
    expect(state.sessions.find((item) => item.id === 'session-owned-001')?.integrationId).toBe('integration-erp');
    const context = await app.get(ConversationContextLoaderService, { strict: false }).load({ scope: {
      customerId: 'customer-a', integrationId: 'integration-other', sessionId: 'session-owned-001',
      organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared'
    } });
    expect(context.exchanges).toHaveLength(0);
  });

  it('does not let any Integration claim a legacy session without persisted ownership', async () => {
    const legacy = state.sessions.find((item) => item.id === 'session-owned-001');
    expect(legacy).toBeDefined();
    legacy!.integrationId = null;
    const headers = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
      claims, requestId: 'legacy-session-denied'
    });
    const before = state.messages.length;
    expect((await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001').set(headers)).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages').set(headers)).status).toBe(404);
    expect((await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(headers).send({ message: '繼續' })).status).toBe(404);
    expect(state.messages).toHaveLength(before);
    expect(legacy!.integrationId).toBeNull();
    const sessionService = app.get(AssistantSessionService, { strict: false });
    const ownerScope = createCustomerScopeFromHostIntegrationContext({ customerId: 'customer-a', integrationId: 'integration-erp',
      organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared',
      roles: claims.roles, permissionScopes: claims.permission_scopes, requestId: 'legacy-session-denied' });
    expect((await sessionService.listVisibleSessions(ownerScope)).some((item) =>
      item.id === 'session-owned-001')).toBe(false);
    expect((await request(app.getHttpServer()).post('/api/v1/assistant/sessions')
      .set(headers).send({ pageContext: { module: 'dashboard' } })).status).toBe(201);
    expect(state.sessions.at(-1)?.integrationId).toBe('integration-erp');
  });

  it('persists the signed Integration and rejects an Integration supplied in the request body', async () => {
    const headers = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
      claims, requestId: 'session-integration-owner'
    });
    const created = await request(app.getHttpServer()).post('/api/v1/assistant/sessions')
      .set(headers).send({ pageContext: { module: 'dashboard' } });
    expect(created.status).toBe(201);
    expect(state.sessions.at(-1)?.integrationId).toBe('integration-erp');
    const before = state.sessions.length;
    const spoofed = await request(app.getHttpServer()).post('/api/v1/assistant/sessions')
      .set(headers).send({ integrationId: 'integration-other', pageContext: { module: 'dashboard' } });
    expect(spoofed.status).toBe(400);
    expect(state.sessions).toHaveLength(before);
  });

  it('keeps an ambiguous follow-up closed when prior model delivery or grounding cannot be verified', async () => {
    stubSelection('today', 'today');
    stubGroundedAnswer('NewOrders');
    await ask('今天新增多少張工單？', 'unverified-prior-first');
    const selector = jest.mocked(llm.generateAnswer);
    expect(selector).toHaveBeenCalledTimes(1);
    const selectionAuditIndex = state.auditEvents.findIndex((item) => item.requestId === 'unverified-prior-first' &&
      item.eventType === 'llm_tool_selection_completed');
    expect(selectionAuditIndex).toBeGreaterThanOrEqual(0);
    state.auditEvents.splice(selectionAuditIndex, 1);
    await ask('跟昨天相比呢？', 'unverified-prior-second');
    expect(selector).toHaveBeenCalledTimes(1);
    expect(state.toolCalls.filter((item) => item.requestId === 'unverified-prior-second')).toHaveLength(0);
    const grounding = state.groundingChecks.find((item) => item.requestId === 'unverified-prior-first');
    expect(grounding).toBeDefined();
    if (grounding) grounding.covered = false;
    await ask('那逾期的呢？', 'unverified-prior-third');
    expect(selector).toHaveBeenCalledTimes(1);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'unverified-prior-third')).toHaveLength(0);
  });

  it('carries verified query context through four HTTP turns while fetching fresh Evidence', async () => {
    type SelectionPrompt = { question: string; previous?: { capabilityKey: string;
      parameters: { timeRange: string }; recentQuestions?: string[] }; tools: Array<{ toolKey: string }> };
    const focusOf = (questions: string[]) => {
      const text = questions.join(' ');
      return text.lastIndexOf('逾期') > text.lastIndexOf('新增') ? 'OverdueOrders' : 'NewOrders';
    };
    jest.mocked(llm.generateAnswer).mockImplementation(async (input) => {
      const prompt = JSON.parse(input.messages[0].content) as SelectionPrompt;
      const questions = [...(prompt.previous?.recentQuestions ?? []), prompt.question];
      if (!questions.some((item) => item.includes('新增') || item.includes('逾期'))) throw new Error('QUERY_FOCUS_NOT_PROVIDED');
      const month = prompt.question.includes('這個月');
      const canonical = month ? 'this_month' : prompt.previous?.parameters.timeRange ?? 'today';
      const suffix = month ? 'monthly' : 'today';
      expect(prompt.tools.some((tool) => tool.toolKey === `demo.shinmone.kpistats.${suffix}`)).toBe(true);
      return { content: JSON.stringify({ decision: 'select', toolKey: `demo.shinmone.kpistats.${suffix}`,
        toolVersion: '1.0.0', parameters: { timeRange: canonical }, arguments: {} }), finishReason: 'stop', metadata };
    });
    jest.mocked(llm.streamAnswer).mockImplementation(async function* (input) {
      const questions = input.messages.filter((message) => message.role === 'assistant')
        .map((message) => message.content.split('\n')[1]).filter(Boolean);
      const current = input.messages.find((message) => message.role === 'user')?.content.split('\n')[1] ?? '';
      const focus = focusOf([...questions, current]);
      const facts = input.messages.find((message) => message.role === 'tool')?.content.split('\n')[2];
      const data = facts ? (JSON.parse(facts) as { Data: ReturnType<typeof demoResponse>['Data'] }).Data : undefined;
      const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
      if (!data || !citation) throw new Error('CURRENT_EVIDENCE_NOT_PROVIDED');
      const value = data[focus];
      const answer = current.includes('相比')
        ? `${focus} 本期 ${value.Current}，前期 ${value.Previous}。`
        : `${focus} 本期 ${value.Current}。`;
      yield { type: 'text_delta', text: `${answer} [${citation}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const turns = [
      ['今天新增多少張工單？', 'today', 'NewOrders'],
      ['那跟前一期相比呢？', 'today', 'NewOrders'],
      ['那逾期的呢？', 'today', 'OverdueOrders'],
      ['這個月呢？', 'thisMonth', 'OverdueOrders']
    ] as const;
    for (const [index, [question, period, focus]] of turns.entries()) {
      const requestId = `demo-followup-${index + 1}`;
      const { response, events } = await ask(question, requestId);
      expect(response.status).toBe(200);
      const prompt = JSON.parse(jest.mocked(llm.generateAnswer).mock.calls[index]?.[0].messages[0].content ?? '{}') as SelectionPrompt;
      if (index > 0) {
        expect(prompt.previous?.capabilityKey).toBe('demo.dashboard.kpistats');
        expect(prompt.previous?.recentQuestions).toEqual(turns.slice(0, index).map((item) => item[0]));
      }
      expect(state.auditEvents.find((item) => item.requestId === requestId && item.eventType === 'llm_tool_selection_completed')?.metadata)
        .toEqual(expect.objectContaining({ modelCalled: true, reason: 'SELECTED' }));
      expect(adapter.calls[index]).toBe(period);
      const evidence = state.evidenceRefs.find((item) => item.requestId === requestId);
      expect(evidence).toBeDefined();
      const answer = events.find((event) => event.event === 'final')?.data.data.answer as string;
      expect(answer).toContain(String(demoResponse(period).Data[focus].Current));
      if (index === 1) expect(answer).toContain(String(demoResponse(period).Data[focus].Previous));
      expect(events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta).join('')).toBe(answer);
      expect(events.find((event) => event.event === 'final')?.data.data.evidenceRefs).toEqual([evidence?.id]);
      expect(state.messages.find((item) => item.requestId === requestId && item.role === 'assistant')?.content).toBe(answer);
    }
    expect(jest.mocked(llm.generateAnswer)).toHaveBeenCalledTimes(4);
    expect(adapter.calls).toEqual(['today', 'today', 'today', 'thisMonth']);
    const history = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims, requestId: 'demo-followup-history' }));
    expect(history.status).toBe(200);
    expect(history.body.data.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining(String(demoResponse('thisMonth').Data.OverdueOrders.Current)) })
    ]));
  });
});
