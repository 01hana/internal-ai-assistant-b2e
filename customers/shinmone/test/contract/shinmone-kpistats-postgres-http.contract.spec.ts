import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { parseConnectorInvocationRequestV1, parseConnectorOperationManifestV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { OperationManifestRegistry } from '../../../../apps/customer-connector-runtime/src/manifest/operation-manifest.registry';
import { BoundedJsonResponse } from '../../../../apps/customer-connector-runtime/src/upstream/bounded-json-response';
import { ManifestResponseExtractor } from '../../../../apps/customer-connector-runtime/src/upstream/response-extractor';
import type { DataAdapter, DataAdapterCompatibilityInput, DataAdapterExecuteInput } from '../../../../src/connectors/data-adapter.interface';
import type { ConnectorExecuteResult, ConnectorToolDefinition, DependencyStatus } from '../../../../src/connectors/connector-adapter.interface';
import { PrismaService } from '../../../../src/prisma/prisma.service';
import { createPrismaClient } from '../../../../src/prisma/prisma-client.factory';
import { LlmExecutionService } from '../../../../src/llm/llm-execution.service';
import { ConversationContextLoaderService } from '../../../../src/assistant/conversation/conversation-context-loader.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse,
  type Us1TestState } from '../../../../test/support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../../../../test/support/internal-identity-jwt.helper';
import { demoManifest, demoPeriods, demoResponse, demoToolOutputSchemaFor } from '../support/shinmone-kpistats-demo.fixture';

const databaseUrl = process.env.ASSISTANT_ISOLATED_PG_URL;
const describeIsolated = databaseUrl ? describe : describe.skip;
const permission = 'menu:SCM_DASHBOARD:read';
const metadata = { provider: 'stub', model: 'isolated-demo', fallbackUsed: false };

class SyntheticKpiAdapter implements DataAdapter {
  readonly key = 'business';
  readonly metadata = { adapterKey: 'business', sourceSystem: 'synthetic-kpistats',
    supportedHostApps: ['erp'], supportedCapabilities: demoPeriods.map((period) => `demo.shinmone.kpistats.${period.suffix}`) };
  readonly calls: string[] = [];

  listTools(): ConnectorToolDefinition[] {
    return demoPeriods.map((period) => ({ key: `demo.shinmone.kpistats.${period.suffix}`,
      name: `KPIStats Demo ${period.wire}`, description: 'Read synthetic KPIStats statistics.',
      operation: 'read', riskLevel: 'low', inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: {}, requiredPermissionScopes: [permission] }));
  }
  isCompatible(input: DataAdapterCompatibilityInput) {
    return { compatible: input.host.hostApp === 'erp' &&
      demoPeriods.some((period) => input.tool.key === `demo.shinmone.kpistats.${period.suffix}`) &&
      input.operation.canonicalToolKey === input.tool.key && input.operation.schemaVersion === input.tool.version };
  }
  async healthCheck(): Promise<DependencyStatus> {
    return { dependency: 'synthetic-kpistats', status: 'healthy', checkedAt: '2026-10-29T00:00:00Z' };
  }
  async execute(input: DataAdapterExecuteInput): Promise<ConnectorExecuteResult> {
    const fail = (code: string): ConnectorExecuteResult => ({ toolKey: input.toolKey, status: 'failed',
      error: { code, message: 'Synthetic operation rejected.' } });
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
    const bounded = await new BoundedJsonResponse().read({ statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(demoResponse(period.wire))); } }
    }, operation.value);
    if (!bounded.ok) return fail(bounded.code);
    const extracted = new ManifestResponseExtractor().extract(bounded.value, operation.value, input.operation.arguments);
    return extracted.ok ? { toolKey: input.toolKey, status: 'succeeded', data: { ...extracted.value } }
      : fail(extracted.code);
  }
}

describeIsolated('KPIStats HTTP follow-up with isolated PostgreSQL persistence', () => {
  let app: INestApplication;
  let db: ReturnType<typeof createPrismaClient>;
  let llm: LlmExecutionService;
  let adapter: SyntheticKpiAdapter;
  let fixtureState: Us1TestState;
  let sessionId: string;
  const previousMode = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const claims = { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
    permission_scopes: [...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA.permission_scopes, permission] };
  const otherClaims = { ...claims, integration_id: 'integration-other', jti: 'synthetic-integration-other' };
  const headers = (requestId: string, identity = claims) => createAuthorizedInternalIdentityHeaders(
    DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims: identity, requestId });

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (parsed.hostname !== '127.0.0.1' || Number(parsed.port) < 55440 ||
      !parsed.pathname.startsWith('/iaa_session_http_')) throw new Error('ISOLATED_POSTGRES_URL_REQUIRED');
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'true';
    adapter = new SyntheticKpiAdapter();
    const result = await createUs1TestAppWithState({
      isolatedDatabaseUrl: databaseUrl,
      capabilityPackPaths: ['customers/shinmone/test/fixtures/capability-packs/shinmone-kpistats-demo.v1.json'],
      augmentStateBeforeInit: (state) => {
        const prototype = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.status.lookup');
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
          state.toolDefinitions.push(definition);
          state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: definition.id,
            enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
        }
      },
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => [...mockRegistrations,
        { adapter, connectorKey: 'business', customerId: 'customer-a', integrationId: 'integration-erp',
          hostApp: 'erp', active: true }]
    });
    app = result.app;
    fixtureState = result.state;
    db = createPrismaClient(databaseUrl!);
    await db.$connect();
    await db.customer.create({ data: { id: 'customer-a' } });
    for (const tool of result.state.toolDefinitions.filter((item) => item.id.startsWith('demo-kpistats-'))) {
      await db.toolDefinition.create({ data: {
        id: tool.id, name: tool.name, version: tool.version, description: tool.description,
        resource: tool.resource, operation: tool.operation, inputSchema: tool.inputSchema as object,
        outputSchema: tool.outputSchema as object, requiredPermissions: tool.requiredPermissions,
        riskLevel: tool.riskLevel, hasSideEffect: tool.hasSideEffect,
        requiresConfirmation: tool.requiresConfirmation, requiresApproval: tool.requiresApproval,
        connectorKey: tool.connectorKey, timeoutMs: tool.timeoutMs, isActive: tool.isActive
      } });
      await db.customerToolPolicy.create({ data: { customerId: 'customer-a', toolDefinitionId: tool.id,
        enabled: true, requiredRoles: [], requiredPermissionScopes: [] } });
    }
    (app.get(PrismaService, { strict: false }) as unknown as { db: typeof db }).db = db;
    llm = app.get(LlmExecutionService, { strict: false });
    const created = await request(app.getHttpServer()).post('/api/v1/assistant/sessions')
      .set(headers('pg-create-a')).send({ pageContext: { module: 'dashboard' } });
    expect(created.status).toBe(201);
    sessionId = created.body.data.sessionId;
    expect((await db.assistantSession.findUniqueOrThrow({ where: { id: sessionId } })).integrationId).toBe('integration-erp');
    expect(fixtureState.sessions.some((session) => session.id === sessionId)).toBe(false);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (app) await app.close();
    if (db) await db.$disconnect();
    if (previousMode === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousMode;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it('keeps persisted Session ownership closed across Integration, Customer, Actor, and legacy NULL sessions', async () => {
    const initialSessions = await db.assistantSession.count();
    const initialMessages = await db.assistantMessage.count({ where: { sessionId } });
    const own = await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}`)
      .set(headers('pg-owner-session-read'));
    expect(own.status).toBe(200);
    for (const [label, foreignClaims] of [
      ['integration', otherClaims],
      ['customer', { ...claims, customer_id: 'customer-b' }],
      ['actor', { ...claims, sub: 'other-actor' }],
      ['organization', { ...claims, org_id: 'other-org' }]
    ] as const) {
      const denied = await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}/messages`)
        .set(headers(`pg-owner-denied-${label}`, foreignClaims));
      expect(denied.status).toBe(404);
    }
    const foreignWrite = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headers('pg-owner-denied-write', otherClaims)).send({ message: 'synthetic' });
    expect(foreignWrite.status).toBe(404);
    const foreignContext = await app.get(ConversationContextLoaderService, { strict: false }).load({ scope: {
      customerId: 'customer-a', integrationId: 'integration-other', sessionId,
      hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared'
    } });
    expect(foreignContext.exchanges).toHaveLength(0);
    const missingIntegration = await request(app.getHttpServer()).post('/api/v1/assistant/sessions')
      .set(headers('pg-owner-missing-integration', { ...claims, integration_id: '' })).send({});
    expect(missingIntegration.status).toBe(403);
    expect(await db.assistantSession.count()).toBe(initialSessions);
    expect(await db.assistantMessage.count({ where: { sessionId } })).toBe(initialMessages);

    const legacyId = 'synthetic-null-gate';
    await db.assistantSession.create({ data: { id: legacyId, customerId: 'customer-a',
      integrationId: null, hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared' } });
    expect((await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${legacyId}/messages`)
      .set(headers('pg-null-gate-read'))).status).toBe(404);
    expect((await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${legacyId}/messages`)
      .set(headers('pg-null-gate-write')).send({ message: 'synthetic' })).status).toBe(404);
    expect(await db.assistantMessage.count({ where: { sessionId: legacyId } })).toBe(0);
    expect((await db.assistantSession.findUniqueOrThrow({ where: { id: legacyId } })).integrationId).toBeNull();
  });

  it('persists four HTTP/SSE turns and rejects cross-Integration or legacy access', async () => {
    type SelectionPrompt = { question: string; previous?: { capabilityKey: string;
      parameters: { timeRange: string }; recentQuestions?: string[] }; tools: Array<{ toolKey: string }> };
    const focusOf = (questions: string[]) => {
      const text = questions.join(' ');
      return text.lastIndexOf('逾期') > text.lastIndexOf('新增') ? 'OverdueOrders' : 'NewOrders';
    };
    const selector = jest.spyOn(llm, 'generateAnswer').mockImplementation(async (input) => {
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
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input) {
      const questions = input.messages.filter((message) => message.role === 'assistant')
        .map((message) => message.content.split('\n')[1]).filter(Boolean);
      const current = input.messages.find((message) => message.role === 'user')?.content.split('\n')[1] ?? '';
      const focus = focusOf([...questions, current]);
      const facts = input.messages.find((message) => message.role === 'tool')?.content.split('\n')[2];
      const data = facts ? (JSON.parse(facts) as { Data: ReturnType<typeof demoResponse>['Data'] }).Data : undefined;
      const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
      if (!data || !citation) throw new Error('CURRENT_EVIDENCE_NOT_PROVIDED');
      const value = data[focus];
      yield { type: 'text_delta', text: `${focus} 本期 ${value.Current}，前期 ${value.Previous}。 [${citation}]` };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });

    const turns = [
      ['今天新增多少張工單？', 'today', 'NewOrders'],
      ['跟前期相比呢？', 'today', 'NewOrders'],
      ['那逾期的呢？', 'today', 'OverdueOrders'],
      ['這個月呢？', 'thisMonth', 'OverdueOrders']
    ] as const;
    const answers: string[] = [];
    for (const [index, [question, period, focus]] of turns.entries()) {
      const requestId = `pg-demo-followup-${index + 1}`;
      const response = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
        .set(headers(requestId)).send({ message: question, pageContext: { module: 'dashboard' } });
      expect(response.status).toBe(200);
      const events = parseSseResponse(response.text);
      const answer = events.find((event) => event.event === 'final')?.data.data.answer as string;
      expect(answer).toContain(String(demoResponse(period).Data[focus].Current));
      expect(events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta).join('')).toBe(answer);
      const user = await db.assistantMessage.findFirstOrThrow({ where: { requestId, role: 'user' } });
      const assistant = await db.assistantMessage.findFirstOrThrow({ where: { requestId, role: 'assistant' } });
      expect(user.sessionId).toBe(sessionId);
      expect(assistant.content).toBe(answer);
      expect(fixtureState.messages.some((message) => message.requestId === requestId)).toBe(false);
      const evidence = await db.evidenceRef.findFirstOrThrow({ where: { requestId } });
      expect(evidence.messageId).toBe(assistant.id);
      expect(events.find((event) => event.event === 'final')?.data.data.evidenceRefs).toEqual([evidence.id]);
      const toolCall = await db.toolCall.findFirstOrThrow({ where: { requestId, status: 'success' } });
      expect(toolCall.permissionResult).toEqual(expect.objectContaining({ scopes: expect.arrayContaining([permission]) }));
      const context = await app.get(ConversationContextLoaderService, { strict: false }).load({ scope: {
        customerId: 'customer-a', integrationId: 'integration-erp', sessionId,
        hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared'
      } });
      expect(context.exchanges).toHaveLength(index + 1);
      expect(context.exchanges.at(-1)?.evidenceRefIds).toContain(evidence.id);
      const prompt = JSON.parse(selector.mock.calls[index]?.[0].messages[0].content ?? '{}') as SelectionPrompt;
      if (index > 0) {
        expect(prompt.previous?.capabilityKey).toBe('demo.dashboard.kpistats');
        expect(prompt.previous?.recentQuestions).toEqual(turns.slice(0, index).map((item) => item[0]));
      }
      answers.push(answer);
    }
    expect(adapter.calls).toEqual(['today', 'today', 'today', 'thisMonth']);
    expect(await db.actionDraft.count()).toBe(0);
    expect(await db.approvalRequest.count()).toBe(0);
    expect(await db.toolCall.count({ where: { sessionId } })).toBe(4);
    const history = await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headers('pg-history-a'));
    expect(history.status).toBe(200);
    expect(history.body.data.messages.filter((message: { role: string }) => message.role === 'assistant')
      .map((message: { content: string }) => message.content)).toEqual(answers);

    const bCreated = await request(app.getHttpServer()).post('/api/v1/assistant/sessions')
      .set(headers('pg-create-b', otherClaims)).send({});
    expect(bCreated.status).toBe(201);
    const bId = bCreated.body.data.sessionId as string;
    expect((await db.assistantSession.findUniqueOrThrow({ where: { id: bId } })).integrationId).toBe('integration-other');
    const bContinues = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${bId}/messages`)
      .set(headers('pg-b-own-message', otherClaims)).send({ message: '合成未支援問題' });
    expect(bContinues.status).toBe(200);
    expect((await db.assistantMessage.count({ where: { sessionId: bId, role: 'user' } }))).toBe(1);
    const bHistory = await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${bId}/messages`)
      .set(headers('pg-b-own-history', otherClaims));
    expect(bHistory.status).toBe(200);
    const beforeMessages = await db.assistantMessage.count({ where: { sessionId } });
    const beforeEvidence = await db.evidenceRef.count({ where: { message: { sessionId } } });
    const foreignHistory = await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headers('pg-foreign-history', otherClaims));
    expect(foreignHistory.status).toBe(404);
    const foreignWrite = await request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headers('pg-foreign-write', otherClaims)).send({ message: '跟昨天相比呢？' });
    expect(foreignWrite.status).toBe(404);
    expect(await db.assistantMessage.count({ where: { sessionId } })).toBe(beforeMessages);
    expect(await db.evidenceRef.count({ where: { message: { sessionId } } })).toBe(beforeEvidence);
    const bContext = await app.get(ConversationContextLoaderService, { strict: false }).load({ scope: {
      customerId: 'customer-a', integrationId: 'integration-other', sessionId,
      hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared'
    } });
    expect(bContext.exchanges).toHaveLength(0);
    for (const [label, foreignClaims] of [
      ['customer', { ...claims, customer_id: 'customer-b' }],
      ['actor', { ...claims, sub: 'other-actor' }],
      ['organization', { ...claims, org_id: 'other-org' }]
    ] as const) {
      const response = await request(app.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}/messages`)
        .set(headers(`pg-foreign-${label}`, foreignClaims));
      expect(response.status).toBe(404);
    }

    await db.assistantSession.create({ data: { id: 'synthetic-null-legacy', customerId: 'customer-a',
      integrationId: null, hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared' } });
    await db.assistantMessage.create({ data: { id: 'synthetic-null-legacy-message', customerId: 'customer-a',
      sessionId: 'synthetic-null-legacy', requestId: 'synthetic-null-legacy-request', role: 'user', content: '合成舊訊息' } });
    expect((await request(app.getHttpServer()).get('/api/v1/assistant/sessions/synthetic-null-legacy/messages')
      .set(headers('pg-null-history'))).status).toBe(404);
    expect((await request(app.getHttpServer()).post('/api/v1/assistant/sessions/synthetic-null-legacy/messages')
      .set(headers('pg-null-write')).send({ message: 'synthetic' })).status).toBe(404);
    expect((await db.assistantSession.findUniqueOrThrow({ where: { id: 'synthetic-null-legacy' } })).integrationId).toBeNull();
    expect(await db.assistantMessage.count({ where: { sessionId: 'synthetic-null-legacy' } })).toBe(1);
  }, 60_000);
});
