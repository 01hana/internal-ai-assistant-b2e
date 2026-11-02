import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import request = require('supertest');
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { OpenAiProvider, type OpenAiResponsesClient } from '../../src/llm/openai/openai.provider';
import type { GenerateAnswerInput } from '../../src/llm/llm-provider.interface';
import type { DataAdapter, DataAdapterCompatibilityInput, DataAdapterExecuteInput } from '../../src/connectors/data-adapter.interface';
import type { ConnectorExecuteResult, ConnectorToolDefinition, DependencyStatus } from '../../src/connectors/connector-adapter.interface';
import { parseConnectorInvocationRequestV1, parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../apps/customer-connector-runtime/src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../apps/customer-connector-runtime/src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../apps/customer-connector-runtime/src/upstream/response-extractor';
import type { RuntimeDiagnosticMetadata, RuntimeDiagnosticStage } from '../../apps/customer-connector-runtime/src/diagnostics/local-connector-diagnostics';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, type Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { syntheticDashboardFacts as facts, syntheticDashboardUpstreamResponse as upstreamSuccess } from '../support/synthetic-structured-dashboard.fixture';
import { assessSyntheticModelObservation, structuredApiOpenAiCases } from '../support/structured-api-openai-oracle';

const liveModelKey = process.env.OPENAI_API_KEY;
const liveModelName = process.env.LLM_MODEL;
const liveCaseId = process.env.STRUCTURED_API_OPENAI_CASE_ID;
const runApprovedLiveEvaluation = process.env.RUN_STRUCTURED_API_OPENAI_EVAL === 'true' &&
  process.env.OPENAI_SYNTHETIC_EVAL_APPROVED === 'true' ? it : it.skip;

const metric = { type: 'object', additionalProperties: false, required: ['Current', 'Previous'],
  properties: { Current: { type: 'integer', description: '本期件數', 'x-unit': '件' },
    Previous: { type: 'integer', description: '前期件數', 'x-unit': '件' } } };
const properties = {
  ReportId: { type: 'string' },
  NewOrders: { ...metric, description: '新增訂單統計' },
  LateOrders: { ...metric, description: '逾期訂單統計' },
  CompletionRate: { type: 'number', description: '完工率', 'x-unit': '%' },
  Period: { type: 'string', description: '統計期間' },
  Categories: { type: 'array', description: '分類統計', maxItems: 3, items: { type: 'object', additionalProperties: false,
    required: ['Name', 'Count'], properties: { Name: { type: 'string' }, Count: { type: 'integer' } } } },
  OptionalNote: { type: ['string', 'null'], description: '選填備註，null 表示未提供' },
  CustomerSatisfaction: { type: 'number', description: '滿意度', 'x-unit': '分' }
};
const metadata = { provider: 'openai', model: 'synthetic-test', fallbackUsed: false };
const connectorString = { type: 'string', maxLength: 128 };
const connectorInteger = { type: 'integer', minimum: 0 };
const closed = (fields: Record<string, unknown>, required = Object.keys(fields)) =>
  ({ type: 'object', properties: fields, required, additionalProperties: false });
const connectorMetric = closed({ Current: connectorInteger, Previous: connectorInteger });
const connectorProperties = {
  ReportId: connectorString, NewOrders: connectorMetric, LateOrders: connectorMetric,
  CompletionRate: { type: 'number' }, Period: connectorString,
  Categories: { type: 'array', maxItems: 3, items: closed({ Name: connectorString, Count: connectorInteger }) },
  OptionalNote: { type: 'string', nullable: true }, CustomerSatisfaction: { type: 'number' }
};
const manifest = {
  version: '1', connectorKey: 'synthetic', operations: [{
    operationKey: 'synthetic.dashboard.snapshot', contractVersion: '1.0.0', inputSchema: closed({}),
    upstreamServiceRef: 'synthetic-http', request: { profile: 'GET_QUERY_V1', path: '/synthetic/dashboard', fixedQuery: {},
      argumentMappings: [] },
    credentialProfileRef: 'synthetic-user', readOnly: true,
    response: { validationProfile: 'FULL_CLOSED_SCHEMA_V1', acceptedHttpStatuses: [200], acceptedApplicationCodes: [200],
      applicationCodePointer: '/Code', contentType: 'application/json',
      schema: closed({ Code: connectorInteger, ...connectorProperties,
        Categories: { type: 'array', maxItems: 3,
          items: closed({ Name: connectorString, Count: connectorInteger, InternalToken: connectorString }) },
        InternalToken: connectorString }),
      extraction: [], structuredOutputSchema: closed(connectorProperties) },
    limits: { maxRequestBytes: 1024, maxResponseBytes: 8192, maxDepth: 4, maxItems: 20,
      maxStringLength: 512, timeoutMs: 1000 }, errorMap: {}, readinessDependency: 'synthetic-http'
  }]
};

class StructuredSyntheticAdapter implements DataAdapter {
  readonly key = 'synthetic';
  readonly metadata = { adapterKey: 'synthetic', sourceSystem: 'synthetic-http', supportedHostApps: ['erp'],
    supportedCapabilities: ['synthetic.dashboard.snapshot'] };
  readonly connectorStages: string[] = [];
  readonly connectorDiagnostics: Array<{ stage: RuntimeDiagnosticStage; result: string; metadata: RuntimeDiagnosticMetadata }> = [];
  connectorFailure: { layer: 'bounded_json' | 'extractor'; code: string } | undefined;
  upstreamResponse: Record<string, unknown> = upstreamSuccess;

  listTools(): ConnectorToolDefinition[] {
    return [{ key: 'synthetic.dashboard.snapshot', name: 'Synthetic approved dashboard',
      description: 'Read a synthetic approved dashboard response.', operation: 'read', riskLevel: 'low',
      inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: {}, requiredPermissionScopes: ['orders:read'] }];
  }

  isCompatible(input: DataAdapterCompatibilityInput) {
    return { compatible: input.host.hostApp === 'erp' && input.tool.key === 'synthetic.dashboard.snapshot' &&
      input.operation.canonicalToolKey === input.tool.key && input.operation.schemaVersion === input.tool.version };
  }

  async healthCheck(): Promise<DependencyStatus> {
    return { dependency: 'synthetic-http', status: 'healthy', checkedAt: '2026-10-24T00:00:00Z' };
  }

  async execute(input: DataAdapterExecuteInput): Promise<ConnectorExecuteResult> {
    if (input.operation.canonicalToolKey === 'synthetic.dashboard.snapshot') {
      if (input.requestId !== input.host.requestId || input.organizationId !== input.host.organizationId ||
        input.actorId !== input.host.actorId || input.toolKey !== input.operation.canonicalToolKey ||
        JSON.stringify(input.arguments) !== JSON.stringify(input.operation.arguments)) {
        return { toolKey: input.toolKey, status: 'failed', error: { code: 'SYNTHETIC_IDENTITY_MISMATCH', message: 'Synthetic identity mismatch.' } };
      }
      const parsed = parseConnectorOperationManifestV1(manifest);
      if (!parsed.ok) throw new Error('SYNTHETIC_MANIFEST_INVALID');
      this.connectorStages.push('manifest');
      const invocation = parseConnectorInvocationRequestV1(Buffer.from(JSON.stringify({
        version: '1', requestId: input.requestId, remainingBudgetMs: 1000,
        trustedContext: { customerId: input.host.customerId, integrationId: input.host.integrationId,
          hostApp: input.host.hostApp, organizationId: input.host.organizationId, actorId: input.host.actorId,
          connectorKey: 'synthetic', connectorInstanceId: 'synthetic-instance' },
        operation: { key: input.operation.canonicalToolKey, version: input.operation.schemaVersion,
          arguments: input.operation.arguments }, connectorContextRef: `ccr_${'A'.repeat(43)}`
      })));
      if (!invocation.ok) throw new Error('SYNTHETIC_INVOCATION_INVALID');
      const prepared = new OperationManifestRegistry([parsed.value]).prepare('synthetic', input.operation.canonicalToolKey,
        input.operation.schemaVersion, invocation.value.operation.arguments);
      if (!prepared.ok) return { toolKey: input.toolKey, status: 'failed', error: { code: 'SYNTHETIC_OPERATION_INVALID', message: 'Synthetic operation rejected.' } };
      this.connectorStages.push('operation');
      const payload = this.upstreamResponse;
      const bounded = await new BoundedJsonResponse().read({ statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(payload)); } }
      }, prepared.value, undefined, { diagnostics: { emit: (stage, result, metadata = {}) => {
        this.connectorDiagnostics.push({ stage, result, metadata });
      } }, metadata: {} });
      if (!bounded.ok) {
        this.connectorFailure = { layer: 'bounded_json', code: bounded.code };
        return { toolKey: input.toolKey, status: 'failed', error: { code: bounded.code, message: 'Synthetic response rejected.' } };
      }
      this.connectorStages.push('bounded_json');
      const extracted = new ManifestResponseExtractor().extract(bounded.value, prepared.value, input.operation.arguments);
      if (!extracted.ok) {
        this.connectorFailure = { layer: 'extractor', code: extracted.code };
        return { toolKey: input.toolKey, status: 'failed', error: { code: extracted.code, message: 'Synthetic extraction rejected.' } };
      }
      this.connectorStages.push('extracted');
      return { toolKey: input.toolKey, status: 'succeeded', data: { ...extracted.value } };
    }
    return { toolKey: input.toolKey, status: 'failed', error: { code: 'SYNTHETIC_OPERATION_UNAVAILABLE', message: 'Synthetic operation unavailable.' } };
  }
}

describe('structured API evidence through HTTP Message, Tool, SSE, and History', () => {
  const previousMode = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
  let app: INestApplication;
  let state: Us1TestState;
  let llm: LlmExecutionService;
  let adapter: StructuredSyntheticAdapter;

  beforeEach(async () => {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    adapter = new StructuredSyntheticAdapter();
    ({ app, state } = await createUs1TestAppWithState({
      capabilityPackPaths: ['test/fixtures/capability-packs/synthetic-dashboard.v1.json'],
      augmentStateBeforeInit: (fixture) => {
        const detail = fixture.toolDefinitions.find((item) => item.name === 'mock.orders.status.lookup');
        if (!detail) throw new Error('SYNTHETIC_DETAIL_TOOL_MISSING');
        const dashboard = structuredClone(detail);
        dashboard.id = 'tool-definition-synthetic-dashboard-001';
        dashboard.name = 'synthetic.dashboard.snapshot';
        dashboard.description = 'Read the complete approved dashboard statistics for the current reporting period.';
        dashboard.connectorKey = 'synthetic';
        dashboard.inputSchema = { type: 'object', additionalProperties: false, required: [], properties: {} };
        dashboard.outputSchema = { type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
          'x-assistant-result-policy': { version: '1', allowedFieldPaths: Object.keys(properties), deniedFieldPaths: [],
            permissionMasks: [], limits: { maxDepth: 4, maxItems: 100, maxStringLength: 512, maxTotalBytes: 16 * 1024 },
            evidenceSafeProvenanceFields: ['ReportId'] } };
        fixture.toolDefinitions.push(dashboard);
        fixture.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: dashboard.id,
          enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
      },
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => [...mockRegistrations,
        { adapter, connectorKey: 'synthetic', customerId: 'customer-a', integrationId: 'integration-erp',
          hostApp: 'erp', active: true }]
    }));
    llm = app.get(LlmExecutionService, { strict: false });
    jest.spyOn(llm, 'generateAnswer').mockResolvedValue({
      content: JSON.stringify({ decision: 'select', toolKey: 'synthetic.dashboard.snapshot', toolVersion: '1.0.0',
        parameters: {}, arguments: {} }), finishReason: 'stop', metadata
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    if (previousMode === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousMode;
  });

  it.each([
    ['unsupported question', { decision: 'none' }, '目前沒有可用的已授權資料能回答這個問題。', 'MODEL_NO_MATCH'],
    ['missing detail identifier', { decision: 'clarify', toolKey: 'mock.orders.status.lookup', toolVersion: '1.0.0' },
      '請補充查詢所需的識別資訊。', 'MODEL_CLARIFY'],
    ['invented detail identifier', { decision: 'select', toolKey: 'mock.orders.status.lookup', toolVersion: '1.0.0',
      parameters: { entityRef: 'SO-' }, arguments: { entityId: 'SO-' } },
      '目前無法安全選擇查詢工具，因此不能回答這個問題。', 'TOOL_OR_PARAMETER_REJECTED'],
    ['absent detail identifier', { decision: 'select', toolKey: 'mock.orders.status.lookup', toolVersion: '1.0.0',
      parameters: { entityRef: 'SO-10001' }, arguments: { entityId: 'SO-10001' } },
      '目前無法安全選擇查詢工具，因此不能回答這個問題。', 'TOOL_OR_PARAMETER_REJECTED']
  ])('maps %s without executing a tool', async (_label, decision, expectedAnswer, reason) => {
    jest.spyOn(llm, 'generateAnswer').mockResolvedValue({ content: JSON.stringify(decision), finishReason: 'stop', metadata });
    const requestId = `req-structured-selection-${reason}`;
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId
      })).send({ message: '請查訂單狀態', pageContext: { module: 'dashboard' } });
    const events = parseSseResponse(response.text);
    expect(response.status).toBe(200);
    expect(events.find((event) => event.event === 'final')?.data.data.answer).toBe(expectedAnswer);
    expect(state.auditEvents.find((event) => event.requestId === requestId && event.eventType === 'llm_tool_selection_completed')?.metadata)
      .toEqual(expect.objectContaining({ reason }));
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
  });

  it('does not make a forbidden tool discoverable when permission is missing', async () => {
    const requestId = 'req-structured-no-allowed-tool';
    const claims = { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: [] };
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims, requestId }))
      .send({ message: '請查儀表板', pageContext: { module: 'dashboard' } });
    const final = parseSseResponse(response.text).find((event) => event.event === 'final')?.data.data.answer;
    expect(final).toBe('目前沒有可用的已授權資料能回答這個問題。');
    expect(state.auditEvents.find((event) => event.requestId === requestId && event.eventType === 'llm_tool_selection_completed')?.metadata)
      .toEqual(expect.objectContaining({ reason: 'NO_ALLOWED_TOOL', modelCalled: false }));
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
  });

  it('accepts a detail identifier only when it appears explicitly in the current question', async () => {
    jest.spyOn(llm, 'generateAnswer').mockResolvedValue({ content: JSON.stringify({ decision: 'select',
      toolKey: 'mock.orders.status.lookup', toolVersion: '1.0.0',
      parameters: { entityRef: 'SO-10001' }, arguments: { entityId: 'SO-10001' } }), finishReason: 'stop', metadata });
    const requestId = 'req-structured-explicit-detail';
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId
      })).send({ message: '請查訂單 SO-10001 的狀態', pageContext: { module: 'dashboard' } });
    expect(response.status).toBe(200);
    expect(state.auditEvents.find((item) => item.requestId === requestId && item.eventType === 'llm_tool_selection_completed')?.metadata)
      .toEqual(expect.objectContaining({ reason: 'SELECTED', toolKey: 'mock.orders.status.lookup' }));
    expect(state.toolCalls.filter((item) => item.requestId === requestId))
      .toEqual([expect.objectContaining({ toolName: 'mock.orders.status.lookup' })]);
    expect(adapter.connectorStages).toHaveLength(0);
  });

  it.each([
    ['請查本期新增數量', '新增 8 件。'],
    ['請查本期逾期數量', '逾期 2 件。'],
    ['請比較本期與前期新增數量', '新增由 5 件增至 8 件。'],
    ['請摘要整份儀表板統計', '本期新增 8 件、逾期 2 件、完工率 87.25%、滿意度 4.5 分。'],
    ['備註是什麼？', '目前資料未提供備註。'],
    ['退貨金額是多少？', '目前核准資料沒有退貨金額，無法回答。']
  ])('keeps all approved fields available for %s', async (question, expected) => {
    let prompt: GenerateAnswerInput | undefined;
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input) {
      prompt = input;
      const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
      if (!citation) throw new Error('SYNTHETIC_CITATION_MISSING');
      yield { type: 'text_delta', text: `${expected} [${citation}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const requestId = `req-structured-http-${expected.length}-${question.length}`;
    const headers = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
      claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId
    });
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(headers).send({ message: question, pageContext: { module: 'dashboard' } });
    const events = parseSseResponse(response.text);
    const deltas = events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta as string).join('');
    const final = events.find((event) => event.event === 'final')?.data.data.answer as string | undefined;
    expect(response.status).toBe(200);
    expect(state.auditEvents.filter((event) => event.requestId === requestId).map((event) => [event.eventType, event.metadata])).toEqual(
      expect.arrayContaining([expect.arrayContaining(['llm_tool_selection_completed', expect.objectContaining({ reason: 'SELECTED' })])])
    );
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toEqual([
      expect.objectContaining({ status: 'success', executionStatus: 'executed' })
    ]);
    expect(adapter.connectorStages).toEqual(['manifest', 'operation', 'bounded_json', 'extracted']);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(1);
    expect(prompt).toBeDefined();
    expect(final).toBe(`${expected}\n\n資料來源：內部資料查詢`);
    expect(deltas).toBe(final);
    expect(state.auditEvents.find((event) => event.requestId === requestId && event.eventType === 'llm_tool_selection_completed')?.metadata)
      .toEqual(expect.objectContaining({ modelCalled: true, reason: 'SELECTED' }));
    const selectionPrompt = JSON.stringify(jest.mocked(llm.generateAnswer).mock.calls[0]?.[0]?.messages);
    expect(selectionPrompt).toContain('outputSummary');
    expect(selectionPrompt).toContain('LateOrders.Current');
    expect(selectionPrompt).toContain('CustomerSatisfaction');
    expect(selectionPrompt).not.toContain('InternalToken');
    const call = state.toolCalls.find((item) => item.requestId === requestId);
    const evidence = state.evidenceRefs.find((item) => item.requestId === requestId);
    expect(call).toEqual(expect.objectContaining({ status: 'success', executionStatus: 'executed' }));
    expect(evidence).toEqual(expect.objectContaining({ toolCallId: call?.id, sourceType: 'structured_record',
      sourceId: facts.ReportId }));
    expect(events.find((event) => event.event === 'final')?.data.data.evidenceRefs).toEqual([evidence?.id]);
    expect((evidence?.summary as { fields: unknown })?.fields).toEqual(facts);
    expect(JSON.stringify(evidence?.summary)).not.toContain('synthetic-secret');
    expect(JSON.stringify(evidence?.summary)).not.toContain('synthetic-row-secret');
    expect(JSON.stringify(prompt?.messages)).toContain('CustomerSatisfaction');
    expect(JSON.stringify(prompt?.messages)).toContain('LateOrders');
    expect(JSON.stringify(prompt?.messages)).toContain(evidence?.id);
    expect(JSON.stringify(prompt?.messages)).not.toContain('synthetic-secret');
    expect(JSON.stringify(prompt?.messages)).not.toContain('synthetic-row-secret');
    const stored = state.messages.find((item) => item.requestId === requestId && item.role === 'assistant');
    expect(stored?.content).toBe(final);
    const history = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId: `${requestId}-history`
      }));
    expect(history.status).toBe(200);
    expect(history.body.data.messages).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: stored?.id, content: final })]));
  });

  it('does not execute the Tool when the caller lacks its required permission', async () => {
    const requestId = 'req-structured-no-permission';
    const claims = { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: [] };
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims, requestId }))
      .send({ message: '請查完整儀表板統計', pageContext: { module: 'dashboard' } });
    expect(response.status).toBe(200);
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(adapter.connectorStages).toHaveLength(0);
    expect(state.auditEvents.find((item) => item.requestId === requestId && item.eventType === 'llm_tool_selection_completed')?.metadata)
      .toEqual(expect.objectContaining({ modelCalled: false, offeredCount: 0 }));
  });

  it('accepts one complete Categories item and keeps it in Evidence', async () => {
    adapter.upstreamResponse = { ...upstreamSuccess,
      Categories: [{ Name: 'A', Count: 4, InternalToken: 'synthetic-row-secret' }] };
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input) {
      const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
      if (!citation) throw new Error('SYNTHETIC_CITATION_MISSING');
      yield { type: 'text_delta', text: `A 類 4 件。 [${citation}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const requestId = 'req-structured-one-valid-category';
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId
      }))
      .send({ message: '請查儀表板分類統計', pageContext: { module: 'dashboard' } });
    const events = parseSseResponse(response.text);
    const evidence = state.evidenceRefs.find((item) => item.requestId === requestId);
    expect(response.status).toBe(200);
    expect(adapter.connectorStages).toEqual(['manifest', 'operation', 'bounded_json', 'extracted']);
    expect(adapter.connectorDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'UPSTREAM_RESPONSE_SCHEMA_VALIDATED', metadata: expect.objectContaining({ fullClosedSchemaValidation: 'PASS' }) })
    ]));
    expect(adapter.connectorFailure).toBeUndefined();
    expect(state.toolCalls.find((item) => item.requestId === requestId)).toEqual(expect.objectContaining({ status: 'success' }));
    expect((evidence?.summary as { fields: { Categories: unknown } })?.fields.Categories).toEqual([{ Name: 'A', Count: 4 }]);
    expect(JSON.stringify(evidence?.summary)).not.toContain('synthetic-row-secret');
    expect(events.find((event) => event.event === 'final')?.data.data.evidenceRefs).toEqual([evidence?.id]);
  });

  it.each([
    ['unknown', { ...upstreamSuccess, NotApproved: 100 }],
    ['missing', { ...upstreamSuccess, LateOrders: undefined }],
    ['legacy one-row fixture missing wire InternalToken', { ...upstreamSuccess,
      Categories: [{ Name: 'A', Count: 4 }] }],
    ['missing required Count in Categories item', { ...upstreamSuccess,
      Categories: [{ Name: 'A', InternalToken: 'synthetic-row-secret' }] }],
    ['wrong type', { ...upstreamSuccess, CompletionRate: '87.25' }],
    ['oversized', { ...upstreamSuccess, Period: 'x'.repeat(9_000) }]
  ])('fails safely before Evidence when the upstream response is %s', async (caseName, payload) => {
    adapter.upstreamResponse = payload;
    const answerModel = jest.spyOn(llm, 'streamAnswer');
    const requestId = `req-structured-invalid-${caseName.replaceAll(' ', '-')}`;
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId
      }))
      .send({ message: '請查完整儀表板統計', pageContext: { module: 'dashboard' } });
    expect(response.status).toBe(200);
    expect(adapter.connectorStages).toEqual(['manifest', 'operation']);
    expect(adapter.connectorFailure).toEqual({ layer: 'bounded_json', code: 'CONNECTOR_RESPONSE_INVALID' });
    expect(adapter.connectorDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'UPSTREAM_RESPONSE_SCHEMA_FAILED', result: 'FAILED',
        metadata: expect.objectContaining({ failureCategory: 'CONNECTOR_RESPONSE_INVALID',
          ...(caseName === 'oversized' ? {} : { fullClosedSchemaValidation: 'FAIL' }) }) })
    ]));
    if (caseName === 'missing required Count in Categories item') {
      expect((manifest.operations[0].response.schema.properties.Categories as { items: { required: string[] } }).items.required).toContain('Count');
    }
    if (caseName === 'legacy one-row fixture missing wire InternalToken') {
      expect((manifest.operations[0].response.schema.properties.Categories as { items: { required: string[] } }).items.required)
        .toContain('InternalToken');
    }
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(answerModel).not.toHaveBeenCalled();
    expect(JSON.stringify(parseSseResponse(response.text))).not.toContain('synthetic-secret');
  });

  it('does not execute the Connector when Customer Tool Policy is disabled', async () => {
    const rule = state.customerToolPolicies.find((item) => item.customerId === 'customer-a' &&
      item.toolDefinitionId === 'tool-definition-synthetic-dashboard-001');
    if (!rule) throw new Error('SYNTHETIC_POLICY_MISSING');
    rule.enabled = false;
    const requestId = 'req-structured-policy-disabled';
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, requestId
      }))
      .send({ message: '請查完整儀表板統計', pageContext: { module: 'dashboard' } });
    expect(response.status).toBe(200);
    expect(adapter.connectorStages).toHaveLength(0);
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
  });

  it('does not let another Customer use the owned session or its structured evidence', async () => {
    const requestId = 'req-structured-foreign-customer';
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerB, requestId
      }))
      .send({ message: '請查完整儀表板統計' });
    expect([403, 404]).toContain(response.status);
    expect(state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(adapter.connectorStages).toHaveLength(0);
  });

  runApprovedLiveEvaluation('uses real OpenAI selection and generation only with synthetic Connector data', async () => {
    if (!liveModelKey || !/^sk-[A-Za-z0-9_-]{20,}$/.test(liveModelKey) ||
      liveModelName !== 'gpt-5.4-mini' || structuredApiOpenAiCases.length !== 10) {
      throw new Error('APPROVED_SYNTHETIC_OPENAI_CONFIGURATION_MISSING');
    }
    const evaluationCases = liveCaseId === undefined ? structuredApiOpenAiCases
      : liveCaseId === 'summary' ? structuredApiOpenAiCases.filter((item) => item.id === 'summary') : [];
    if (evaluationCases.length !== (liveCaseId === undefined ? 10 : 1)) {
      throw new Error('APPROVED_SYNTHETIC_OPENAI_CASE_INVALID');
    }
    const callLimit = liveCaseId === 'summary' ? 2 : 20;
    const config = { get: (name: string) => name === 'OPENAI_API_KEY' ? liveModelKey : liveModelName } as
      ConfigService<EnvironmentVariables, true>;
    const sdk = new OpenAI({ apiKey: liveModelKey, maxRetries: 0 });
    const usageRecords: Array<{ stage: 'selection' | 'generation'; input: number; output: number }> = [];
    let externalCalls = 0;
    let inFlight = 0;
    let usageUnknown = false;
    let guardFailure: string | undefined;
    let activeCase = evaluationCases[0];
    const estimatedCost = () => usageRecords.reduce((total, record) =>
      total + (record.input * 0.75 + record.output * 4.5) / 1_000_000, 0);
    const recordUsage = (stage: 'selection' | 'generation', response: unknown) => {
      const usage = response && typeof response === 'object' && 'usage' in response ? response.usage : undefined;
      const parsed = usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
      if (!Number.isInteger(parsed?.input_tokens) || !Number.isInteger(parsed?.output_tokens)) {
        usageUnknown = true;
        return;
      }
      usageRecords.push({ stage, input: parsed!.input_tokens as number, output: parsed!.output_tokens as number });
    };
    const meteredClient = { responses: { create: async (body: unknown, options: unknown) => {
      const requestBody = body as { instructions?: string; input?: string; stream?: boolean; max_output_tokens?: number };
      const stage = requestBody.stream ? 'generation' : 'selection';
      const outboundText = JSON.stringify({ instructions: requestBody.instructions, input: requestBody.input });
      if (/shinmone|\/APIs\/SCM|Bearer\s|sk-[A-Za-z0-9_-]{20,}|synthetic-(?:row-)?secret|InternalToken/i.test(outboundText) ||
        outboundText.includes(activeCase.example) || !outboundText.includes(activeCase.question)) {
        guardFailure = 'NON_SYNTHETIC_OR_ORACLE_PROMPT';
        throw new Error(guardFailure);
      }
      const projectedCost = (Buffer.byteLength(outboundText, 'utf8') * 0.75 +
        (requestBody.max_output_tokens ?? 1024) * 4.5) / 1_000_000;
      if (externalCalls >= callLimit || usageUnknown || inFlight !== 0 || estimatedCost() + projectedCost > 0.50) {
        guardFailure = 'CALL_OR_COST_LIMIT';
        throw new Error(guardFailure);
      }
      externalCalls += 1;
      inFlight += 1;
      try {
        const result: unknown = await sdk.responses.create(body as never,
          { ...(options as object), timeout: stage === 'selection' ? 7_000 : 25_000, maxRetries: 0 } as never);
        if (stage === 'selection') {
          recordUsage(stage, result);
          inFlight -= 1;
          return result;
        }
        return (async function* () {
          let completed = false;
          try {
            for await (const event of result as AsyncIterable<{ type: string; response?: unknown }>) {
              if (event.type === 'response.completed') {
                recordUsage(stage, event.response);
                completed = true;
              }
              yield event;
            }
            if (!completed) usageUnknown = true;
          } finally {
            inFlight -= 1;
          }
        })();
      } catch (error) {
        usageUnknown = true;
        inFlight -= 1;
        throw error;
      }
    } } } as unknown as OpenAiResponsesClient;
    const provider = new OpenAiProvider(config, meteredClient);
    let selectionCalls = 0;
    let generationCalls = 0;
    jest.spyOn(llm, 'generateAnswer').mockImplementation(async (input) => {
      selectionCalls += 1;
      return provider.generateAnswer(input);
    });
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input, _context, options) {
      generationCalls += 1;
      yield* provider.streamAnswer(input, { signal: options.signal });
    });

    const observations: Array<Record<string, unknown>> = [];
    for (const [index, testCase] of evaluationCases.entries()) {
      activeCase = testCase;
      const usageStart = usageRecords.length;
      const callsStart = externalCalls;
      const requestId = `req-structured-openai-${index + 1}`;
      const claims = testCase.id === 'unauthorized'
        ? { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: [] }
        : DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA;
      const headers = createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims, requestId });
      const session = await request(app.getHttpServer()).post('/api/v1/assistant/sessions')
        .set(headers).send({ pageContext: { module: 'dashboard' } });
      expect(session.status).toBe(201);
      const sessionId = session.body.data.sessionId as string;
      const response = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
        .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims, requestId: `${requestId}-message`
        }))
        .send({ message: testCase.question,
          pageContext: { module: 'dashboard' } });
      const events = response.status === 200 ? parseSseResponse(response.text) : [];
      const final = events.find((event) => event.event === 'final')?.data.data;
      const requestAudit = state.auditEvents.find((event) => event.requestId === `${requestId}-message` &&
        event.eventType === 'llm_tool_selection_completed');
      const selectedMetadata = requestAudit?.metadata as { toolKey?: string; toolVersion?: string; modelCalled?: boolean;
        reason?: string; selectionFailureStage?: string; selectionFailureReason?: string;
        jsonParseSucceeded?: boolean } | undefined;
      const plan = state.executionPlans.find((item) => item.sessionId === sessionId && item.messageId !== null);
      const candidate = (plan?.candidateTools as Array<{ key?: string; version?: string; arguments?: unknown }> | undefined)?.[0];
      const call = state.toolCalls.find((item) => item.requestId === `${requestId}-message`);
      const evidence = state.evidenceRefs.find((item) => item.requestId === `${requestId}-message`);
      const result = [...assessSyntheticModelObservation(testCase, {
        selection: selectedMetadata?.toolKey && selectedMetadata.toolVersion
          ? { key: selectedMetadata.toolKey, version: selectedMetadata.toolVersion } : null,
        answer: String(final?.answer ?? ''),
        evidenceFacts: evidence?.summary && typeof evidence.summary === 'object' && 'fields' in evidence.summary
          ? (evidence.summary as { fields: Record<string, unknown> }).fields : null,
        sourceId: evidence?.sourceId ?? null,
        toolCallCount: call ? 1 : 0
      })];
      if (testCase.requireTool && selectedMetadata?.modelCalled !== true) result.push('MODEL_SELECTION_NOT_CALLED');
      if (testCase.requireTool && (!call || !evidence)) result.push('TOOL_OR_EVIDENCE_MISSING');
      if (response.status !== 200) result.push(`HTTP_${response.status}`);
      if (!final) result.push('SSE_FINAL_MISSING');
      if (evidence && !((final?.evidenceRefs as string[] | undefined) ?? []).includes(evidence.id)) {
        result.push('CITATION_EVIDENCE_MISMATCH');
      }
      const caseUsage = usageRecords.slice(usageStart);
      const selectionFailures = result.filter((reason) => ['EXPECTED_APPROVED_TOOL', 'UNAPPROVED_TOOL',
        'MODEL_SELECTION_NOT_CALLED', 'EXPECTED_ONE_TOOL_CALL', 'TOOL_OR_EVIDENCE_MISSING'].includes(reason));
      const answerFailures = result.filter((reason) => !selectionFailures.includes(reason));
      observations.push({ id: testCase.id, question: testCase.question,
        selectedTool: selectedMetadata?.toolKey && selectedMetadata.toolVersion
          ? `${selectedMetadata.toolKey}@${selectedMetadata.toolVersion}` : null,
        selectionReason: selectedMetadata?.reason ?? null,
        selectionFailureStage: selectedMetadata?.selectionFailureStage ?? null,
        selectionFailureReason: selectedMetadata?.selectionFailureReason ?? null,
        jsonParseSucceeded: selectedMetadata?.jsonParseSucceeded ?? null,
        arguments: candidate?.arguments ?? null,
        expected: testCase.example, answer: String(final?.answer ?? ''),
        selectionPass: selectionFailures.length === 0, answerPass: answerFailures.length === 0,
        failures: result, calls: externalCalls - callsStart,
        inputTokens: caseUsage.reduce((total, record) => total + record.input, 0),
        outputTokens: caseUsage.reduce((total, record) => total + record.output, 0) });
      process.stdout.write(`SYNTHETIC_OPENAI_CASE ${JSON.stringify(observations.at(-1))}\n`);
      if (guardFailure || usageUnknown || inFlight !== 0 || estimatedCost() >= 0.50) break;
    }
    process.stdout.write(`SYNTHETIC_OPENAI_TOTAL ${JSON.stringify({ cases: observations.length, calls: externalCalls,
      inputTokens: usageRecords.reduce((total, record) => total + record.input, 0),
      outputTokens: usageRecords.reduce((total, record) => total + record.output, 0),
      estimatedUsd: estimatedCost(), selectionCalls, generationCalls, guardFailure, usageUnknown })}\n`);
    expect(guardFailure).toBeUndefined();
    expect(usageUnknown).toBe(false);
    expect(observations).toHaveLength(evaluationCases.length);
    expect(observations.every((item) => item.selectionPass && item.answerPass)).toBe(true);
    expect(selectionCalls).toBeGreaterThan(0);
    expect(generationCalls).toBeGreaterThan(0);
  }, 600_000);
});
