import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse } from '../../../../test/support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../../../../test/support/internal-identity-jwt.helper';
import { shinmoneC01QueryScopeRegistration } from '../support/shinmone-query-scope.fixture';
import { MockConnectorAdapter } from '../../../../src/connectors/mock/mock-connector.adapter';
import { DataAdapterRegistry } from '../../../../src/connectors/data-adapter-registry.service';
import type { DataAdapter } from '../../../../src/connectors/data-adapter.interface';
import { LlmExecutionService } from '../../../../src/llm/llm-execution.service';
import type { QueryScopeRegistration } from '../../../../src/query-scope/query-scope.types';

// Existing C01 is the only executable Shinmone Tool in this fixture. These are
// runtime-boundary regression tests, not evidence that C02-C06 are provisioned.
describe('[HTTP_RUNTIME][MOCK_ONLY] Shinmone Assistant-side Dashboard trust negatives (existing C01 boundary)', () => {
  let previousToolSelection: string | undefined;
  beforeAll(() => {
    previousToolSelection = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'false';
  });
  afterAll(() => {
    if (previousToolSelection === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousToolSelection;
  });
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state'];
  let connectorExecute: jest.SpyInstance;
  let adapterSelect: jest.SpyInstance;

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks },
      // The helper's default Customer A pack has no work-orders.count capability.
      // This scoped fixture binds the existing C01 Tool so the negative reaches precheck.
      capabilityPackPaths: [
        'customers/shinmone/test/fixtures/capability-packs/shinmone-trust-negative.v1.json',
        'test/fixtures/capability-packs/customer-b-inventory.v1.json'
      ],
      queryScopeRegistrations: [shinmoneC01QueryScopeRegistration({
        customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp'
      })]
    }));
    connectorExecute = jest.spyOn(app.get(MockConnectorAdapter), 'execute');
    adapterSelect = jest.spyOn(app.get(DataAdapterRegistry), 'select');
  });
  afterEach(async () => app.close());

  function send(claims: Record<string, unknown>, requestId: string, message = '這個月新增幾張工單？') {
    return request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims, requestId }))
      .send({ message, pageContext: { module: 'work-orders' } });
  }

  function startedCalls() {
    return state.toolCalls.filter((call) => call.executionStatus !== 'not_started').length;
  }

  function latestScopeReason() {
    const metadata = state.auditEvents.filter((event) => event.eventType === 'query_scope_validation_completed').at(-1)?.metadata;
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).reason : undefined;
  }

  it('preserves the ordinary current-month C01 query with Dashboard read', async () => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      'req-shinmone-current-month');
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before + 1);
    expect(latestScopeReason()).toBe('QUERY_SCOPE_VALIDATED');
  });

  it('denies a signed actor without Dashboard read before a Tool starts', async () => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['orders:read'] }, 'req-shinmone-no-dashboard');
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).find(({ event }) => event === 'final')?.data?.data)
      .toEqual(expect.objectContaining({ answerDecision: 'permission_denied' }));
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
  });

  it('rejects a signed identity with no permission claim before a Tool starts', async () => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: undefined }, 'req-shinmone-missing-scope');
    // A valid signature with a missing canonical claim is an identity-context
    // failure (IdentityContextException / 403), not a token-signature failure.
    expect(response.status).toBe(403);
    expect(response.body).toEqual(expect.objectContaining({
      error: expect.objectContaining({ code: 'IDENTITY_CONTEXT_INVALID' })
    }));
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
  });

  it.each([
    ['customer', { customer_id: 'customer-b' }],
    ['integration', { integration_id: 'other-integration' }],
    ['host app', { host_app: 'other-host' }]
  ])('does not execute the Customer A Tool for a mismatched %s', async (_label, mismatch) => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'], ...mismatch },
      `req-shinmone-mismatch-${_label.replace(' ', '-')}`);
    expect(response.status).not.toBe(500);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
    expect(latestScopeReason()).toBeUndefined();
  });

  it('does not let a natural-language request for another company change the signed Customer scope', async () => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      'req-shinmone-other-company', '查另一家公司的本月新增工單數');
    expect(response.status).not.toBe(500);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
    expect(latestScopeReason()).toBe('QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE');
  });

  it.each([
    ['named other company', '查乙公司的本月新增工單數'],
    ['unspecified company', '查某家公司的本月新增工單數']
  ])('does not execute C01 for an unverified %s', async (_label, message) => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      `req-shinmone-unverified-${_label.replaceAll(' ', '-')}`, message);
    expect(response.status).not.toBe(500);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
    expect(latestScopeReason()).toBe(_label === 'named other company'
      ? 'QUERY_SCOPE_TARGET_UNVERIFIED' : 'QUERY_SCOPE_AMBIGUOUS');
  });

  it('does not mistake a negated other-company request for a cross-company lookup', async () => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      'req-shinmone-negated-other-company', '不是查另一家公司，請查本公司這個月新增幾張工單？');
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before + 1);
    expect(latestScopeReason()).toBe('QUERY_SCOPE_VALIDATED');
  });

  it('keeps an explicit current-company C01 lookup executable', async () => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      'req-shinmone-current-company', '本公司這個月新增多少工單？');
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before + 1);
    expect(latestScopeReason()).toBe('QUERY_SCOPE_VALIDATED');
  });

  it.each([
    '本月新增工單數',
    '請問本月新增多少工單？',
    '幫我查這個月新增幾張工單',
    '我想知道本月新增幾張工單'
  ])('allows an ordinary C01 phrasing without inventing a company target: %s', async (message) => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      `req-shinmone-natural-${before}-${message.length}`, message);
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before + 1);
    expect(latestScopeReason()).toBe('QUERY_SCOPE_VALIDATED');
  });

  it.each([
    '不要查本公司，查這個月新增幾張工單',
    '不是查本公司，而是查這個月新增幾張工單',
    '不查本公司，查今天新增幾張工單',
    '不是查本公司，而是查其他公司的本月新增工單數'
  ])('does not execute C01 after excluding the signed company: %s', async (message) => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      `req-shinmone-excluded-${message.length}`, message);
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
    if (!message.includes('今天')) {
      expect(['QUERY_SCOPE_AMBIGUOUS', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE']).toContain(latestScopeReason());
    }
  });

  it('clarifies a compound current/other-company request before a Tool starts', async () => {
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      'req-shinmone-compound-company', '查本公司和其他公司的本月新增工單數');
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).find(({ event }) => event === 'final')?.data?.data)
      .toEqual(expect.objectContaining({ answerDecision: 'clarification_required' }));
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
    expect(latestScopeReason()).toBe('QUERY_SCOPE_AMBIGUOUS');
  });

  it.each([
    ['absent registration', undefined],
    ['missing validator', undefined],
    ['unavailable', { evaluate: () => { throw new Error('offline'); } }]
  ])('fails closed when the required Customer policy is %s', async (_label, policy) => {
    await app.close();
    const registration: QueryScopeRegistration = {
      ...shinmoneC01QueryScopeRegistration({ customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' }),
      policy
    };
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks },
      capabilityPackPaths: ['customers/shinmone/test/fixtures/capability-packs/shinmone-trust-negative.v1.json'],
      queryScopeActivations: [registration],
      queryScopeRegistrations: _label === 'absent registration' ? [] : [registration]
    }));
    connectorExecute = jest.spyOn(app.get(MockConnectorAdapter), 'execute');
    adapterSelect = jest.spyOn(app.get(DataAdapterRegistry), 'select');
    const before = startedCalls();
    const response = await send({ ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] },
      `req-shinmone-policy-${_label.replaceAll(' ', '-')}`);
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
    expect(latestScopeReason()).toBe('QUERY_SCOPE_POLICY_UNAVAILABLE');
  });

  it('revalidates a follow-up instead of inheriting the prior current-company result', async () => {
    const claims = { ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] };
    await send(claims, 'req-shinmone-followup-first', '這個月新增幾張工單？');
    const before = startedCalls();
    const adapterSelectionsBefore = adapterSelect.mock.calls.length;
    const followUpRequestId = 'req-shinmone-followup-other';
    const response = await send(claims, followUpRequestId, '那另一家公司的本月新增工單數呢？');
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).toHaveBeenCalledTimes(adapterSelectionsBefore);
    const sourceMessage = state.messages.find((message) => message.requestId === followUpRequestId && message.role === 'user');
    expect(sourceMessage).toBeDefined();
    expect(state.executionPlans.find((plan) => plan.messageId === sourceMessage?.id)?.candidateTools).toEqual([]);
    const scopeAudits = state.auditEvents.filter((event) => event.eventType === 'query_scope_validation_completed'
      && event.requestId === followUpRequestId && event.messageId === sourceMessage?.id);
    expect(scopeAudits).toHaveLength(1);
    expect(scopeAudits[0].metadata).toEqual(expect.objectContaining({ reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE',
      mode: 'pre_candidate_deny_only' }));
    expect(parseSseResponse(response.text).find(({ event }) => event === 'final')?.data?.data)
      .toEqual(expect.objectContaining({ answerDecision: 'permission_denied' }));
  });

  it('keeps a supported current-company C01 follow-up on the normal candidate gate', async () => {
    const claims = { ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] };
    await send(claims, 'req-shinmone-legal-first', '這個月新增幾張工單？');
    const before = startedCalls();
    const response = await send(claims, 'req-shinmone-legal-followup', '這個月新增幾張工單呢？');
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before + 1);
    expect(state.executionPlans.at(-1)?.candidateTools).toEqual([expect.objectContaining({
      key: 'work-orders.monthly-new-count' })]);
    expect(state.auditEvents.filter((event) => event.eventType === 'query_scope_validation_completed'
      && event.requestId === 'req-shinmone-legal-followup')).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'QUERY_SCOPE_VALIDATED' }) })
    ]));
    expect(state.auditEvents.filter((event) => event.eventType === 'query_scope_validation_completed'
      && event.requestId === 'req-shinmone-legal-followup'
      && (event.metadata as Record<string, unknown> | null)?.mode === 'pre_candidate_deny_only')).toEqual([]);
  });

  it('keeps an unknown follow-up target as clarification without inventing a scope denial', async () => {
    const claims = { ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] };
    await send(claims, 'req-shinmone-unknown-first', '這個月新增幾張工單？');
    const before = startedCalls();
    const response = await send(claims, 'req-shinmone-unknown-followup', '那周轉率呢？');
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before);
    expect(state.executionPlans.at(-1)?.candidateTools).toEqual([]);
    expect(state.auditEvents.filter((event) => event.eventType === 'query_scope_validation_completed'
      && event.requestId === 'req-shinmone-unknown-followup')).toEqual([]);
    expect(parseSseResponse(response.text).find(({ event }) => event === 'final')?.data?.data)
      .toEqual(expect.objectContaining({ answerDecision: 'clarification_required' }));
  });

  it('does not continue to Tool execution when a deny-only scope audit cannot be written', async () => {
    const claims = { ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] };
    await send(claims, 'req-shinmone-audit-first', '這個月新增幾張工單？');
    const before = startedCalls();
    state.workflowAuditFailureEventTypes.push('query_scope_validation_completed');
    const response = await send(claims, 'req-shinmone-audit-followup', '那另一家公司的本月新增工單數呢？');
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).at(-1)?.event).toBe('error');
    expect(parseSseResponse(response.text).some(({ event }) => event === 'final')).toBe(false);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(state.executionPlans.at(-1)?.candidateTools).toEqual([]);
  });

  it('revalidates a clarification continuation before allowing a Tool', async () => {
    const claims = { ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] };
    await send(claims, 'req-shinmone-clarify-first', '查某家公司的本月新增工單數');
    const before = startedCalls();
    const response = await send(claims, 'req-shinmone-clarify-other', '查另一家公司的本月新增工單數');
    expect(response.status).toBe(200);
    expect(startedCalls()).toBe(before);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(adapterSelect).not.toHaveBeenCalled();
    expect(latestScopeReason()).toBe('QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE');
  });

  it('does not turn a denied other-company turn into a current-company follow-up execution', async () => {
    const claims = { ...fixture.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read'] };
    await send(claims, 'req-shinmone-denied-first', '查另一家公司的本月新增工單數');
    const before = startedCalls();
    for (const [requestId, message] of [
      ['req-shinmone-denied-followup', '那這個月呢？'],
      ['req-shinmone-denied-followup-metric', '那本月新增工單數呢？']
    ]) {
      const response = await send(claims, requestId, message);
      expect(response.status).toBe(200);
      expect(startedCalls()).toBe(before);
      expect(connectorExecute).not.toHaveBeenCalled();
      expect(adapterSelect).not.toHaveBeenCalled();
      expect(parseSseResponse(response.text).find(({ event }) => event === 'final')?.data?.data?.answerDecision)
        .not.toBe('answered');
    }
  });

  it('executes an authorized Customer B Tool while Customer A scope registration is active', async () => {
    await app.close();
    const businessExecute = jest.fn(async (input: Parameters<DataAdapter['execute']>[0]) => ({
      toolKey: input.operation.canonicalToolKey, status: 'succeeded' as const,
      data: { sku: input.operation.arguments.sku, quantity: 23 }
    }));
    const businessAdapter: DataAdapter = {
      key: 'business', execute: businessExecute,
      metadata: { adapterKey: 'business-test', sourceSystem: 'synthetic-customer-b', supportedHostApps: ['erp'], supportedCapabilities: ['inventory.stock-on-hand'] },
      listTools: () => [], healthCheck: async () => ({ dependency: 'business-test', status: 'healthy', checkedAt: new Date().toISOString() }),
      isCompatible: ({ host, tool, operation }) => ({ compatible: host.customerId === 'customer-b' && host.hostApp === 'erp' && tool.key === 'inventory.stock-on-hand' && operation.canonicalToolKey === tool.key })
    };
    ({ app, state } = await createUs1TestAppWithState({
      capabilityPackPaths: [
        'test/fixtures/capability-packs/customer-a-monthly-followup.v1.json',
        'test/fixtures/capability-packs/customer-b-inventory.v1.json'
      ],
      queryScopeRegistrations: [shinmoneC01QueryScopeRegistration({
        customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp'
      })],
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => Object.freeze([
        ...mockRegistrations,
        Object.freeze({ adapter: businessAdapter, connectorKey: 'business', customerId: 'customer-b', integrationId: 'integration-erp', hostApp: 'erp', active: true })
      ])
    }));
    jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '核准證據顯示結果。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
    state.customerToolPolicies.push({
      customerId: 'customer-b', toolDefinitionId: 'tool-definition-customer-b-stock-001', enabled: true,
      requiredRoles: [], requiredPermissionScopes: ['inventory:read']
    });
    const sendB = (requestId: string, message: string) => request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-hidden-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims: {
        ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerB, permission_scopes: ['inventory:read']
      }, requestId }))
      .send({ message, pageContext: { module: 'inventory', entityType: 'item', visibleColumns: ['quantity'] } });
    await sendB('req-customer-b-scope-seed', '查詢庫存現量 料號 SKU-B-001');
    const response = await sendB('req-customer-b-scope-isolation', 'SKU-B-002 呢？');
    expect(response.status).toBe(200);
    expect(state.toolCalls.at(-1)).toMatchObject({ customerId: 'customer-b', toolName: 'inventory.stock-on-hand', executionStatus: 'executed' });
    expect(businessExecute).toHaveBeenCalledTimes(2);
    expect(businessExecute).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: expect.objectContaining({ arguments: { sku: 'SKU-B-002' } })
    }));
    expect(state.auditEvents.filter((event) => event.eventType === 'query_scope_validation_completed'
      && event.customerId === 'customer-b')).toEqual([]);
  });
});
