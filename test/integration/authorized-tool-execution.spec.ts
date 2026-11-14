import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { isolateIntegrationLlm, stubGroundedIntegrationAnswer, stubIntegrationToolDecision } from '../support/isolated-integration-llm.helper';

describe.each(['false', 'true'] as const)('US2 authorized mock connector tool execution (LLM selection %s)', (mode) => {
  let app: INestApplication;
  let state: Us1TestState;
  let isolated: ReturnType<typeof isolateIntegrationLlm>;
  let previousMode: string | undefined;

  beforeAll(async () => {
    previousMode = process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
    process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = mode;
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
    isolated = isolateIntegrationLlm(app);
    state.customerToolPolicies.push({
      customerId: 'customer-a',
      toolDefinitionId: 'tool-definition-inventory-001',
      enabled: true,
      requiredRoles: [],
      requiredPermissionScopes: []
    });
  });

  afterAll(async () => {
    try {
      await app.close();
      jest.restoreAllMocks();
    } finally {
      if (previousMode === undefined) delete process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED;
      else process.env.ASSISTANT_LLM_TOOL_SELECTION_ENABLED = previousMode;
    }
  });

  it('uses an authorized mock inventory connector path instead of falling back to a no-answer shell', async () => {
    if (mode === 'true') stubIntegrationToolDecision(isolated.llm, 'mock.inventory.availability.lookup', 'SKU-DEMO-RED');
    stubGroundedIntegrationAnswer(isolated.llm, '"availableQuantity":36', '庫存可用量為 36。');
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        {
          ...createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
            claims: { permission_scopes: ['orders:read', 'inventory:read'] },
            requestId: 'req-us2-authorized-tool'
          }),
          'x-permission-scopes': 'orders:read,inventory:read'
        }
      )
      .send({
        message: '查詢庫存可用量 料號 SKU-DEMO-RED',
        pageContext: {
          module: 'inventory',
          entityType: 'item',
          entityId: 'SKU-DEMO-RED',
          visibleColumns: ['availableQuantity', 'incomingQuantity']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    expect(events.filter((event) => event.event !== 'answer_delta').map((event) => event.event)).toEqual([
      'tool_call_started',
      'tool_call_completed',
      'evidence_attached',
      'final'
    ]);
    expect(events.filter((event) => event.event === 'answer_delta').length).toBeGreaterThan(0);
    expect(events.filter((event) => event.event === 'answer_delta').map((event) => event.data.data.delta).join(''))
      .toBe(events.at(-1)?.data.data.answer);
    const finalEvent = events.find((event) => event.event === 'final');
    const completedToolEvent = events.find((event) => event.event === 'tool_call_completed');
    const latestToolCall = state.toolCalls[state.toolCalls.length - 1];
    const latestEvidenceRef = state.evidenceRefs[state.evidenceRefs.length - 1];

    expect(state.executionPlans.at(-1)?.candidateTools).toEqual([expect.objectContaining({
      key: 'mock.inventory.availability.lookup', version: '1.0.0',
      arguments: { entityId: 'SKU-DEMO-RED' },
      capabilityKey: 'inventory.availability', bindingId: 'inventory.availability'
    })]);
    if (mode === 'true') {
      expect(state.auditEvents).toEqual(expect.arrayContaining([expect.objectContaining({
        eventType: 'llm_tool_selection_completed',
        metadata: expect.objectContaining({ reason: 'SELECTED', modelCalled: true,
          toolKey: 'mock.inventory.availability.lookup', selectionBinding: 'validated' })
      })]));
    }
    expect(completedToolEvent?.data?.data?.status).toBe('completed');
    expect(latestToolCall?.toolName).toBe('mock.inventory.availability.lookup');
    expect(latestToolCall?.outputSummary).toEqual({
      canonicalToolKey: 'mock.inventory.availability.lookup',
      schemaVersion: '1.0.0',
      fieldPaths: ['availableQuantity', 'incomingQuantity'],
      fieldCount: 2,
      evidenceProvenanceFields: ['itemSku']
    });
    const serializedOutputSummary = JSON.stringify(latestToolCall?.outputSummary);
    expect(serializedOutputSummary).not.toContain('36');
    expect(serializedOutputSummary).not.toContain('120');
    expect(serializedOutputSummary).not.toContain('SKU-DEMO-RED');
    expect(serializedOutputSummary).not.toContain('WH-DEMO-TPE');
    expect(latestEvidenceRef).toEqual(
      expect.objectContaining({
        sourceId: 'SKU-DEMO-RED',
        entityId: 'SKU-DEMO-RED',
        fieldPaths: ['availableQuantity', 'incomingQuantity'],
        summary: {
          fields: {
            availableQuantity: 36,
            incomingQuantity: 120
          }
        }
      })
    );
    expect(finalEvent?.data).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          answerDecision: 'answered',
          answer: expect.stringContaining('36')
        })
      })
    );
    const history = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { permission_scopes: ['orders:read', 'inventory:read'] },
        requestId: `req-us2-authorized-tool-history-${mode}`
      }));
    expect(history.status).toBe(200);
    expect(history.body.data.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: finalEvent?.data.messageId,
        content: finalEvent?.data.data.answer, evidenceRefs: [latestEvidenceRef?.id] })
    ]));
    expect(isolated.providerGenerate).not.toHaveBeenCalled();
    expect(isolated.providerStream).not.toHaveBeenCalled();
    expect(isolated.outboundFetch).not.toHaveBeenCalled();
  });

  if (mode === 'false') {
    it('emits an SSE error without a completed answer when the controlled provider fails after Evidence', async () => {
      jest.spyOn(isolated.llm, 'streamAnswer').mockImplementation(async function* () {
        yield await Promise.reject(new Error('SYNTHETIC_PROVIDER_FAILURE'));
      });
      const requestId = 'req-us2-provider-failure';
      const response = await request(app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: { permission_scopes: ['orders:read', 'inventory:read'] }, requestId
        }))
        .send({ message: '查詢庫存可用量 料號 SKU-DEMO-RED', pageContext: {
          module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED'
        } });
      expect(response.status).toBe(200);
      expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
        'tool_call_started', 'tool_call_completed', 'evidence_attached', 'error'
      ]);
      expect(state.toolCalls.filter((call) => call.requestId === requestId)).toEqual([
        expect.objectContaining({ status: 'success' })
      ]);
      expect(state.evidenceRefs.filter((evidence) => evidence.requestId === requestId)).toHaveLength(1);
      expect(state.answerDecisions.filter((decision) => decision.requestId === requestId)).toHaveLength(0);
      const history = await request(app.getHttpServer())
        .get('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: { permission_scopes: ['orders:read', 'inventory:read'] },
          requestId: `${requestId}-history`
        }));
      expect(history.status).toBe(200);
      expect(history.body.data.messages).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', requestId })
      ]));
      expect(isolated.providerGenerate).not.toHaveBeenCalled();
      expect(isolated.providerStream).not.toHaveBeenCalled();
      expect(isolated.outboundFetch).not.toHaveBeenCalled();
    });

    it('blocks an accidental external LLM fetch before any network request', () => {
      expect(() => globalThis.fetch('https://api.openai.com/v1/responses'))
        .toThrow('EXTERNAL_TEST_FETCH_FORBIDDEN');
      expect(isolated.outboundFetch).toHaveBeenCalledTimes(1);
      expect(isolated.providerGenerate).not.toHaveBeenCalled();
      expect(isolated.providerStream).not.toHaveBeenCalled();
    });
  }
});
