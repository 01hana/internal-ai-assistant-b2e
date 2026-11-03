import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { DataAdapterRegistry } from '../../src/connectors/data-adapter-registry.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';
import request = require('supertest');
import { DataAdapterRegistrations } from '../../src/connectors/data-adapter-registration';
import { QueryScopeValidationService } from '../../src/query-scope/query-scope-validation.service';
import { LlmProviderService } from '../../src/llm/llm-provider.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { ToolPermissionPrecheckService } from '../../src/permissions/tool-permission-precheck.service';

describe('Synthetic acceptance: test-only non-ERP Customer onboarding', () => {
  const scope = { customerId: 'customer-c', integrationId: 'integration-hr', hostApp: 'hr-portal' };
  const tool = {
    id: 'fixture-hr-leave-count', key: 'hr.leave-request-count', name: 'hr.leave-request-count',
    version: '1.0.0', description: '', operation: ToolOperation.read, riskLevel: RiskLevel.low,
    active: true, connectorKey: 'hr-fixture', timeoutMs: 1000, requiredPermissionScopes: [],
    inputSchema: { type: 'object', additionalProperties: false, required: [], properties: {} },
    outputSchema: { type: 'object', required: [], properties: {} },
    hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
  };
  const execute = jest.fn().mockResolvedValue({ toolKey: tool.key, status: 'succeeded', data: { count: 3 } });
  const adapter = {
    key: 'hr-fixture', metadata: { adapterKey: 'hr-fixture', sourceSystem: 'synthetic-hr',
      supportedHostApps: ['hr-portal'], supportedCapabilities: [tool.key] },
    listTools: () => [], execute, isCompatible: () => ({ compatible: true }),
    healthCheck: async () => ({ dependency: 'hr-fixture', status: 'healthy' as const, checkedAt: new Date().toISOString() })
  };

  it('resolves only the scoped HR Pack, checks Customer policy and selects an exact Connector', async () => {
    execute.mockClear();
    const harness = await createFeature011DirectHarness([
      'test/fixtures/capability-packs/customer-c-hr-leave.v1.json',
      'test/fixtures/capability-packs/customer-b-inventory.v1.json'
    ], { additionalTools: { [tool.key]: { customerId: 'customer-c', tool } } });
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic,
      harness.parameters, harness.binding, harness.audit);
    const text = '查詢今天請假申請數量';
    const selected = await resolver.resolve({ scope, text });
    expect(selected).toMatchObject({ outcome: 'RESOLVED', capability: { capabilityKey: 'leave.request-count' },
      toolCandidate: { key: tool.key, version: '1.0.0', arguments: {} } });
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), resolver,
      undefined, undefined, harness.registry, harness.parameters);
    const understood = await pipeline.understand({ requestId: 'request-c', sessionId: 'session-c',
      messageId: 'message-c', text, hostIntegrationContext: { ...scope, requestId: 'request-c',
        organizationId: 'org-c', actorId: 'actor-c', roles: [], permissionScopes: [] } });
    expect(understood.candidateTools).toMatchObject([{ key: tool.key, version: '1.0.0', arguments: {} }]);
    expect(await harness.tools.resolveExactToolForCustomer(tool.key, tool.version, 'customer-c'))
      .toMatchObject({ resolved: { tool: { key: tool.key } } });
    expect(await harness.tools.resolveExactToolForCustomer(tool.key, tool.version, 'customer-b'))
      .toEqual({ deniedReason: 'customer_policy_denied' });

    const registry = new DataAdapterRegistry([{ adapter, connectorKey: 'hr-fixture', ...scope, active: true }]);
    const host = { ...scope, organizationId: 'org-c', actorId: 'actor-c' };
    const selectedAdapter = await registry.select({ host: host as never, tool,
      operation: { canonicalToolKey: tool.key, arguments: {}, schemaVersion: '1.0.0' } });
    expect(await selectedAdapter.execute({ host: host as never,
      operation: { canonicalToolKey: tool.key, arguments: {}, schemaVersion: '1.0.0' },
      requestId: 'request-c', organizationId: 'org-c', actorId: 'actor-c', toolKey: tool.key,
      arguments: {} })).toMatchObject({ status: 'succeeded', data: { count: 3 } });
    expect(execute).toHaveBeenCalledTimes(1);

    for (const wrong of [
      { ...scope, customerId: 'customer-b' }, { ...scope, integrationId: 'integration-erp' },
      { ...scope, hostApp: 'other' }
    ]) {
      expect(await resolver.resolve({ scope: wrong, text })).not.toHaveProperty('toolCandidate');
      await expect(registry.select({ host: { ...host, ...wrong } as never, tool,
        operation: { canonicalToolKey: tool.key, arguments: {}, schemaVersion: '1.0.0' } }))
        .rejects.toThrow('Data adapter unavailable');
    }
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not create an HR Tool candidate without the HR Pack', async () => {
    const harness = await createFeature011DirectHarness([], {
      additionalTools: { [tool.key]: { customerId: 'customer-c', tool } }
    });
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic,
      harness.parameters, harness.binding, harness.audit);
    expect(await resolver.resolve({ scope, text: '查詢今天請假申請數量' }))
      .toMatchObject({ outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED' });
  });
});

describe('Synthetic acceptance: HR Customer through Assistant HTTP runtime', () => {
  const pack = 'test/fixtures/capability-packs/customer-c-hr-leave.v1.json';
  const toolKey = 'hr.leave-request-count';
  const toolId = 'fixture-hr-leave-count';
  const hrScope = { customer_id: 'customer-c', integration_id: 'integration-hr', host_app: 'hr-portal',
    org_id: 'org-hr', sub: 'actor-hr', roles: ['hr-reader'], permission_scopes: ['hr:leave:read'] };
  const created: Array<{ close(): Promise<void> }> = [];
  let previousSelectionMode: string | undefined;

  beforeEach(() => { previousSelectionMode = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED; });

  afterEach(async () => {
    await Promise.all(created.splice(0).map((app) => app.close()));
    jest.restoreAllMocks();
    if (previousSelectionMode === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousSelectionMode;
  });

  function hrAdapter() {
    return {
      key: 'hr-fixture',
      metadata: { adapterKey: 'hr-fixture', sourceSystem: 'synthetic-hr',
        supportedHostApps: ['hr-portal'], supportedCapabilities: [toolKey] },
      listTools: jest.fn(() => []),
      isCompatible: jest.fn(() => ({ compatible: true })),
      healthCheck: jest.fn(async () => ({ dependency: 'hr-fixture', status: 'healthy' as const, checkedAt: new Date().toISOString() })),
      execute: jest.fn(async () => ({ toolKey, status: 'succeeded' as const,
        data: { count: 3, sourceRecordId: 'HR-LEAVE-TODAY' } }))
    };
  }

  async function scenario(options: { packPaths?: string[]; connector?: 'exact' | 'missing' | 'wrong';
    toolVersion?: string; toolExists?: boolean; bindingIncompatible?: boolean; policyEnabled?: boolean } = {}) {
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = 'false';
    const adapter = hrAdapter();
    const registrations: DataAdapterRegistrations = options.connector === 'missing' ? [] : [{
      adapter, connectorKey: 'hr-fixture', customerId: options.connector === 'wrong' ? 'customer-b' : 'customer-c',
      integrationId: 'integration-hr', hostApp: 'hr-portal', active: true
    }];
    const result = await createUs1TestAppWithState({
      capabilityPackPaths: options.packPaths ?? [pack], queryScopeActivations: [],
      dataAdapterRegistrations: registrations,
      augmentStateBeforeInit: (state) => {
        const now = new Date('2026-06-16T00:00:00.000Z');
        state.sessions.push({ ...state.sessions[0], id: 'session-hr-001', customerId: 'customer-c',
          integrationId: 'integration-hr', hostApp: 'hr-portal', organizationId: 'org-hr', actorId: 'actor-hr', lastMessageAt: null });
        state.sessions.push({ ...state.sessions[0], id: 'session-hr-other-host', customerId: 'customer-c',
          integrationId: 'integration-hr', hostApp: 'other-portal', organizationId: 'org-hr', actorId: 'actor-hr', lastMessageAt: null });
        if (options.toolExists !== false) state.toolDefinitions.push({
          ...state.toolDefinitions[0], id: toolId, name: toolKey, version: options.toolVersion ?? '1.0.0',
          resource: 'hr', connectorKey: 'hr-fixture', requiredPermissions: ['hr:leave:read'],
          inputSchema: { type: 'object', additionalProperties: false, required: options.bindingIncompatible ? ['unmapped'] : [],
            properties: options.bindingIncompatible ? { unmapped: { type: 'string' } } : {} },
          outputSchema: { type: 'object', required: ['count', 'sourceRecordId'],
            properties: { count: { type: 'number' }, sourceRecordId: { type: 'string' } },
            'x-assistant-result-policy': { version: '1', allowedFieldPaths: ['count', 'sourceRecordId'], deniedFieldPaths: [],
              permissionMasks: [], limits: { maxDepth: 4, maxItems: 100, maxStringLength: 512, maxTotalBytes: 16384 },
              evidenceSafeProvenanceFields: ['sourceRecordId'] } },
          createdAt: now, updatedAt: now
        });
        state.customerToolPolicies.push({ customerId: 'customer-c', toolDefinitionId: toolId,
          enabled: options.policyEnabled !== false, requiredRoles: [], requiredPermissionScopes: ['hr:leave:read'] });
      }
    });
    created.push(result.app);
    return { ...result, adapter };
  }

  function send(app: Awaited<ReturnType<typeof scenario>>['app'], requestId: string,
    claims: Record<string, unknown> = hrScope, sessionId = 'session-hr-001') {
    return request(app.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, { claims, requestId }))
      .send({ message: '查詢今天請假申請數量' });
  }

  it('runs exact HR policy, permission, connector, evidence, generation, and SSE with Query Scope off', async () => {
    const { app, state, prismaMock, adapter } = await scenario();
    const scope = app.get(QueryScopeValidationService, { strict: false });
    const evaluate = jest.spyOn(scope, 'evaluate');
    const resolveCapability = jest.spyOn(app.get(CapabilityResolutionService, { strict: false }), 'resolve');
    const checkPermission = jest.spyOn(app.get(ToolPermissionPrecheckService, { strict: false }), 'checkResolvedCustomerTool');
    const generate = jest.spyOn(app.get(LlmProviderService).getSelectedProvider(), 'generateAnswer').mockResolvedValue({
      content: '今天有 3 筆請假申請。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'deterministic-test', fallbackUsed: false }
    });
    const response = await send(app, 'req-hr-full-success');
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
    ]);
    expect(state.executionPlans.at(-1)?.candidateTools).toEqual([expect.objectContaining({
      key: toolKey, version: '1.0.0', arguments: {}, capabilityKey: 'leave.request-count'
    })]);
    expect(resolveCapability).toHaveBeenCalledWith(expect.objectContaining({
      scope: { customerId: 'customer-c', integrationId: 'integration-hr', hostApp: 'hr-portal' }
    }));
    await expect(resolveCapability.mock.results.at(-1)?.value).resolves.toMatchObject({
      outcome: 'RESOLVED', capability: { packId: 'customer-c-hr-leave', capabilityKey: 'leave.request-count' },
      parameters: { timeRange: 'today' }, toolCandidate: { key: toolKey, version: '1.0.0' }
    });
    expect(state.queryUnderstandingResults.at(-1)?.normalizedTerms).toBeDefined();
    expect(prismaMock.customerToolPolicy.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId_toolDefinitionId: { customerId: 'customer-c', toolDefinitionId: toolId } }
    }));
    expect(checkPermission).toHaveBeenCalledWith(expect.objectContaining({
      customerScope: expect.objectContaining({ customerId: 'customer-c' }),
      resolvedTool: expect.objectContaining({ tool: expect.objectContaining({ key: toolKey, version: '1.0.0' }) })
    }));
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ toolKey, toolVersion: '1.0.0' }));
    expect(evaluate).toHaveBeenCalledTimes(2);
    for (const decision of evaluate.mock.results) {
      await expect(decision.value).resolves.toEqual(expect.objectContaining({ outcome: 'NOT_APPLICABLE' }));
    }
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    expect(adapter.execute).toHaveBeenCalledWith(expect.objectContaining({
      host: expect.objectContaining({ customerId: 'customer-c', integrationId: 'integration-hr', hostApp: 'hr-portal' }),
      operation: expect.objectContaining({ canonicalToolKey: toolKey, schemaVersion: '1.0.0' })
    }));
    const evidence = state.evidenceRefs.filter((item) => item.requestId === 'req-hr-full-success');
    expect(evidence).toEqual([expect.objectContaining({ customerId: 'customer-c', sourceType: 'structured_record',
      sourceId: 'HR-LEAVE-TODAY', fieldPaths: ['count', 'sourceRecordId'] })]);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-hr-full-success', messages: expect.arrayContaining([
        expect.objectContaining({ role: 'tool', content: expect.stringContaining('<SERVER_PROJECTED_TOOL_EVIDENCE>') })
      ])
    }));
    expect(state.answerDecisions.find((item) => item.requestId === 'req-hr-full-success'))
      .toMatchObject({ customerId: 'customer-c', status: 'answered', metadata: { mode: 'TOOL', coverage: 'COMPLETE' } });
    expect(parseSseResponse(response.text).at(-1)?.data?.data).toEqual(expect.objectContaining({
      answerDecision: 'answered', answer: expect.stringContaining('3'),
      evidenceRefs: [evidence[0].id]
    }));
    expect(state.auditEvents.filter((item) => item.requestId === 'req-hr-full-success'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ customerId: 'customer-c', eventType: 'capability_resolution_completed',
          messageId: expect.any(String) }),
        expect.objectContaining({ customerId: 'customer-c', eventType: 'tool_call_completed',
          messageId: expect.any(String) }),
        expect.objectContaining({ customerId: 'customer-c', eventType: 'evidence_attached',
          messageId: expect.any(String) })
      ]));
  });

  it.each([
    ['foreign Customer', { ...hrScope, customer_id: 'customer-b', integration_id: 'integration-erp',
      host_app: 'erp', org_id: 'org-shared', sub: 'actor-shared' }, 'session-hidden-001'],
    ['foreign Integration', { ...hrScope, integration_id: 'other-integration' }, 'session-hr-001'],
    ['foreign HostApp', { ...hrScope, host_app: 'other-portal' }, 'session-hr-other-host']
  ])('does not execute HR from %s', async (_label, claims, sessionId) => {
    const { app, state, adapter } = await scenario();
    const response = await send(app, `req-hr-${_label}`, claims, sessionId);
    expect(response.status).toBe(_label === 'foreign Integration' ? 404 : 200);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.filter((item) => item.requestId === `req-hr-${_label}` && item.status === 'success')).toEqual([]);
    expect(state.evidenceRefs.filter((item) => item.requestId === `req-hr-${_label}`)).toEqual([]);
  });

  it('blocks missing current permission before connector and evidence', async () => {
    const { app, state, adapter } = await scenario();
    const response = await send(app, 'req-hr-no-scope', { ...hrScope, permission_scopes: [] });
    expect(response.status).toBe(200);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.filter((item) => item.requestId === 'req-hr-no-scope')).toEqual([
      expect.objectContaining({ customerId: 'customer-c', status: 'blocked', executionStatus: 'not_started' })
    ]);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-hr-no-scope')).toEqual([]);
    expect(state.auditEvents.filter((item) => item.requestId === 'req-hr-no-scope'))
      .toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'tool_permission_denied' })]));
  });

  it('blocks a disabled current Customer policy without connector execution', async () => {
    const { app, state, adapter } = await scenario({ policyEnabled: false });
    await send(app, 'req-hr-policy-denied');
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.filter((item) => item.requestId === 'req-hr-policy-denied')).toEqual([
      expect.objectContaining({ customerId: 'customer-c', status: 'blocked', executionStatus: 'not_started' })
    ]);
    expect(state.toolCalls.filter((item) => item.requestId === 'req-hr-policy-denied' && item.status === 'success')).toEqual([]);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-hr-policy-denied')).toEqual([]);
  });

  it('has no HR or Mock fallback with no HR Pack', async () => {
    const { app, state, adapter } = await scenario({ packPaths: [] });
    await send(app, 'req-hr-no-pack');
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.executionPlans.at(-1)?.candidateTools ?? []).toEqual([]);
    expect(state.toolCalls.filter((item) => item.requestId === 'req-hr-no-pack')).toEqual([]);
  });

  it.each([
    ['Tool absent', { toolExists: false }],
    ['Tool version drift', { toolVersion: '2.0.0' }],
    ['binding incompatible', { bindingIncompatible: true }]
  ])('fails capability bootstrap for %s', async (_label, options) => {
    await expect(scenario(options)).rejects.toThrow();
  });

  it.each(['missing', 'wrong'] as const)('fails closed for %s HR Connector registration', async (connector) => {
    const { app, state, adapter } = await scenario({ connector });
    const response = await send(app, `req-hr-connector-${connector}`);
    expect(response.status).toBe(200);
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(state.toolCalls.filter((item) => item.requestId === `req-hr-connector-${connector}`)).toEqual([
      expect.objectContaining({ customerId: 'customer-c', status: 'failed', errorCode: 'DATA_ADAPTER_UNAVAILABLE' })
    ]);
    expect(state.evidenceRefs.filter((item) => item.requestId === `req-hr-connector-${connector}`)).toEqual([]);
  });
});
