import request = require('supertest');
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { claimsForToolScenario, CUSTOMER_TOOL_PHASE6 } from '../support/customer-tool-phase6-fixtures';

const describeUs3 = process.env.RUN_CUSTOMER_US3_TESTS === 'true' ? describe : describe.skip;
const fixture = createInternalIdentityJwtFixture();
const question = '查詢訂單目前狀態 訂單號 SO-10001';
const pageContext = { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] };
const toolKey = CUSTOMER_TOOL_PHASE6.toolName;
const metadata = { provider: 'openai', model: 'synthetic-test', fallbackUsed: false };
type Harness = Awaited<ReturnType<typeof createPermissionHarness>>;

async function createPermissionHarness(mode: 'true' | 'false') {
  const previousMode = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
  process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = mode;
  const { app, state, prismaMock } = await createUs1TestAppWithState({
    internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
  });
  const llm = app.get(LlmExecutionService, { strict: false });
  jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* (input) {
    const citation = input.instructions?.split('allowedCitations=')[1]?.trim();
    if (!citation) throw new Error('ORDER_EVIDENCE_CITATION_MISSING');
    yield { type: 'text_delta', text: `訂單狀態為 picking。 [${citation}]` };
    yield { type: 'completed', finishReason: 'stop', metadata };
  });
  const connector = app.get(MockConnectorAdapter, { strict: false });
  const execute = jest.spyOn(connector, 'execute');
  return { app, state, prismaMock, llm, execute, previousMode };
}

async function closePermissionHarness(harness: Harness) {
  try {
    jest.restoreAllMocks();
    await harness.app.close();
  } finally {
    if (harness.previousMode === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = harness.previousMode;
  }
}

function sendOrder(harness: Harness, requestId: string, claims = fixture.canonicalClaims.customerA,
  extraHeaders: Record<string, string> = {}, message = question) {
  return request(harness.app.getHttpServer())
    .post('/api/v1/assistant/sessions/session-owned-001/messages')
    .set({ ...createAuthorizedInternalIdentityHeaders(fixture, { claims, requestId }), ...extraHeaders })
    .send({ message, pageContext });
}

function expectOwnPolicyLookup(harness: Harness) {
  expect(harness.prismaMock.customerToolPolicy.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { customerId_toolDefinitionId: {
      customerId: 'customer-a', toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId
    } }
  }));
  expect(harness.prismaMock.customerToolPolicy.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({
    where: { customerId_toolDefinitionId: {
      customerId: 'customer-b', toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId
    } }
  }));
}

function expectRuntimePermissionDenied(harness: Harness, requestId: string, responseText: string) {
  const events = parseSseResponse(responseText);
  expect(events.map((item) => item.event)).toEqual(['tool_call_blocked', 'answer_delta', 'final']);
  expect(events.find((item) => item.event === 'tool_call_blocked')?.data.data).toEqual(expect.objectContaining({
    toolName: toolKey, deniedReason: 'missing_scope', executionStatus: 'not_started'
  }));
  expect(events.find((item) => item.event === 'final')?.data.data).toEqual(expect.objectContaining({
    answerDecision: 'permission_denied', evidenceRefs: []
  }));
  expect(responseText).not.toContain('SO-10001');
  expect(harness.state.toolCalls.filter((item) => item.requestId === requestId)).toEqual([
    expect.objectContaining({ customerId: 'customer-a', toolName: toolKey,
      status: 'blocked', executionStatus: 'not_started', errorCode: 'missing_scope' })
  ]);
  expect(harness.state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
  expect(harness.state.auditEvents).toEqual(expect.arrayContaining([
    expect.objectContaining({ customerId: 'customer-a', requestId, eventType: 'tool_permission_denied',
      metadata: expect.objectContaining({ deniedReason: 'missing_scope' }) })
  ]));
  expect(harness.execute).not.toHaveBeenCalled();
}

function expectAuthorizedOrder(harness: Harness, requestId: string, responseText: string) {
  const events = parseSseResponse(responseText);
  const call = harness.state.toolCalls.find((item) => item.requestId === requestId);
  const evidence = harness.state.evidenceRefs.find((item) => item.requestId === requestId);
  expect(events.slice(0, 3).map((item) => item.event)).toEqual([
    'tool_call_started', 'tool_call_completed', 'evidence_attached'
  ]);
  expect(events.at(-1)?.event).toBe('final');
  expect(events.slice(3, -1).every((item) => item.event === 'answer_delta')).toBe(true);
  expect(events.slice(3, -1).length).toBeGreaterThan(0);
  expect(call).toEqual(expect.objectContaining({ customerId: 'customer-a',
    toolName: toolKey, toolVersion: '1.0.0',
    inputSummary: expect.objectContaining({ canonicalToolKey: toolKey, schemaVersion: '1.0.0' }),
    status: 'success', executionStatus: 'executed',
    permissionResult: expect.objectContaining({ scopes: expect.arrayContaining(['orders:read']) }) }));
  expect(evidence).toEqual(expect.objectContaining({ customerId: 'customer-a', toolCallId: call?.id,
    sourceType: 'structured_record' }));
  expect(events.find((item) => item.event === 'final')?.data.data).toEqual(expect.objectContaining({
    answerDecision: 'answered', evidenceRefs: [evidence?.id]
  }));
  expect(harness.execute).toHaveBeenCalledTimes(1);
  expect(harness.execute).toHaveBeenCalledWith(expect.objectContaining({
    toolKey, organizationId: 'org-shared', actorId: 'actor-shared',
    host: expect.objectContaining({ customerId: 'customer-a', integrationId: 'integration-erp',
      hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared',
      permissionScopes: expect.arrayContaining(['orders:read']) })
  }));
  expectOwnPolicyLookup(harness);
}

describeUs3('Customer tool permission pre-execution contract (Rule-based)', () => {
  let harness: Harness;
  beforeEach(async () => { harness = await createPermissionHarness('false'); });
  afterEach(async () => closePermissionHarness(harness));

  it('denies empty arrays before connector, successful ToolCall, evidence, or side effect', async () => {
    const requestId = 'req-us3-empty-arrays';
    const claims = claimsForToolScenario(fixture, 'customerA', { roles: [], permission_scopes: [] });
    const before = { drafts: harness.state.actionDrafts.length, approvals: harness.state.approvalRequests.length };
    const response = await sendOrder(harness, requestId, claims);
    expect(response.status).toBe(200);
    expectOwnPolicyLookup(harness);
    expectRuntimePermissionDenied(harness, requestId, response.text);
    expect({ drafts: harness.state.actionDrafts.length, approvals: harness.state.approvalRequests.length }).toEqual(before);
  });

  it('denies header conflict before connector, successful ToolCall, evidence, or side effect', async () => {
    const requestId = 'req-us3-header-conflict';
    const claims = claimsForToolScenario(fixture, 'customerA', { roles: [], permission_scopes: [] });
    const before = { drafts: harness.state.actionDrafts.length, approvals: harness.state.approvalRequests.length };
    const response = await sendOrder(harness, requestId, claims, {
      'x-customer-id': 'customer-b', 'x-integration-id': 'integration-other',
      'x-organization-id': 'org-other', 'x-host-app': 'other-app', 'x-actor-id': 'actor-other',
      'x-role': 'admin', 'x-permission-scopes': 'orders:read,orders:update'
    });
    expect(response.status).toBe(200); // Public identity headers are ignored; signed JWT remains authoritative.
    expectOwnPolicyLookup(harness);
    expectRuntimePermissionDenied(harness, requestId, response.text);
    expect(harness.state.toolCalls.filter((item) => item.customerId === 'customer-b' && item.requestId === requestId)).toHaveLength(0);
    expect({ drafts: harness.state.actionDrafts.length, approvals: harness.state.approvalRequests.length }).toEqual(before);
  });

  it('executes an enabled-policy, complete-permission structured Tool for the owning scope', async () => {
    const requestId = 'req-us3-own-success';
    const response = await sendOrder(harness, requestId);
    expect(response.status).toBe(200);
    expect(harness.state.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId, customerId: 'customer-a', eventType: 'capability_resolution_completed',
        metadata: expect.objectContaining({ outcome: 'RESOLVED', bindingId: 'orders.status' }) })
    ]));
    expectAuthorizedOrder(harness, requestId, response.text);
  });
});

describe('Customer tool permission pre-execution contract (LLM Tool Selection)', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createPermissionHarness('true');
    jest.spyOn(harness.llm, 'generateAnswer').mockResolvedValue({
      content: JSON.stringify({ decision: 'select', toolKey, toolVersion: '1.0.0',
        parameters: { entityRef: 'SO-10001' }, arguments: { entityId: 'SO-10001' } }),
      finishReason: 'stop', metadata
    });
  });
  afterEach(async () => closePermissionHarness(harness));

  it('selects and executes the authorized bounded order Tool', async () => {
    const requestId = 'req-us3-llm-success';
    const response = await sendOrder(harness, requestId);
    expect(response.status).toBe(200);
    expect(harness.state.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId, eventType: 'llm_tool_selection_completed',
        metadata: expect.objectContaining({ reason: 'SELECTED', modelCalled: true,
          toolKey, selectionPermission: 'prefiltered', runtimeValidation: 'pending' }) })
    ]));
    expectAuthorizedOrder(harness, requestId, response.text);
  });

  it('does not offer the Tool or call the model without the signed permission', async () => {
    const requestId = 'req-us3-llm-no-permission';
    const claims = claimsForToolScenario(fixture, 'customerA', { permission_scopes: [] });
    const response = await sendOrder(harness, requestId, claims);
    expect(response.status).toBe(200);
    expectOwnPolicyLookup(harness);
    expect(harness.llm.generateAnswer).not.toHaveBeenCalled();
    expect(harness.state.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId, eventType: 'llm_tool_selection_completed',
        metadata: expect.objectContaining({ reason: 'NO_ALLOWED_TOOL', offeredCount: 0, modelCalled: false }) })
    ]));
    expect(parseSseResponse(response.text).find((item) => item.event === 'final')?.data.data).toEqual(
      expect.objectContaining({ answerDecision: 'no_answer', evidenceRefs: [] }));
    expect(harness.state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(harness.state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('rejects an unoffered write Tool Decision before runtime or connector work', async () => {
    jest.mocked(harness.llm.generateAnswer).mockResolvedValue({
      content: JSON.stringify({ decision: 'select', toolKey: 'mock.orders.status.update',
        toolVersion: '1.0.0', parameters: { entityRef: 'SO-10001' }, arguments: { entityId: 'SO-10001' } }),
      finishReason: 'stop', metadata
    });
    const requestId = 'req-us3-llm-unoffered-write';
    const before = { drafts: harness.state.actionDrafts.length, approvals: harness.state.approvalRequests.length };
    const response = await sendOrder(harness, requestId);
    expect(response.status).toBe(200);
    expect(harness.state.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId, eventType: 'llm_tool_selection_completed',
        metadata: expect.objectContaining({ reason: 'TOOL_OR_PARAMETER_REJECTED',
          selectionFailureReason: 'TOOL_NOT_OFFERED' }) })
    ]));
    expect(parseSseResponse(response.text).find((item) => item.event === 'final')?.data.data).toEqual(
      expect.objectContaining({ answerDecision: 'no_answer', evidenceRefs: [] }));
    expect(harness.state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(harness.state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect({ drafts: harness.state.actionDrafts.length, approvals: harness.state.approvalRequests.length }).toEqual(before);
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('rejects an identifier supplied only by PageContext even with a valid select Decision', async () => {
    const requestId = 'req-us3-llm-untrusted-identifier';
    const response = await sendOrder(harness, requestId, fixture.canonicalClaims.customerA, {},
      '查詢訂單目前狀態');
    expect(response.status).toBe(200);
    expect(harness.state.auditEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId, eventType: 'llm_tool_selection_completed',
        metadata: expect.objectContaining({ reason: 'TOOL_OR_PARAMETER_REJECTED',
          selectionFailureReason: 'UNTRUSTED_PARAMETER_VALUE' }) })
    ]));
    expect(parseSseResponse(response.text).find((item) => item.event === 'final')?.data.data).toEqual(
      expect.objectContaining({ answerDecision: 'no_answer', evidenceRefs: [] }));
    expect(harness.state.toolCalls.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(harness.state.evidenceRefs.filter((item) => item.requestId === requestId)).toHaveLength(0);
    expect(harness.execute).not.toHaveBeenCalled();
  });
});
