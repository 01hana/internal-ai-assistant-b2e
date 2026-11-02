import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { LlmProviderService } from '../../src/llm/llm-provider.service';

describe('Feature 010 Tool-only grounded retrieval (T055)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  let generate: jest.SpyInstance;
  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    generate = jest.spyOn(app.get(LlmProviderService).getSelectedProvider(), 'generateAnswer').mockResolvedValue({
      content: 'SKU-DEMO-RED 的庫存可用量已由查詢結果確認。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'deterministic-test', fallbackUsed: false }
    });
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('uses current discovery and authority for exactly one projected Tool evidence item', async () => {
    const before = { tools: state.toolCalls.length, retrievals: state.retrievalRuns.length };
    const response = await send('req-f010-tool-lane', '查詢庫存可用量 料號 SKU-DEMO-RED');
    expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
    ]);
    expect(state.toolCalls).toHaveLength(before.tools + 1);
    expect(state.retrievalRuns).toHaveLength(before.retrievals);
    expect(state.executionPlans.at(-1)?.candidateTools).toEqual([
      expect.objectContaining({ key: 'mock.inventory.availability.lookup', version: '1.0.0', arguments: { entityId: 'SKU-DEMO-RED' } })
    ]);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-tool-lane')).toEqual([
      expect.objectContaining({ sourceType: 'structured_record', fieldPaths: ['availableQuantity', 'incomingQuantity'] })
    ]);
    expect(state.toolCalls.at(-1)).toEqual(expect.objectContaining({ status: 'success', executionStatus: 'executed' }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-f010-tool-lane', messages: expect.arrayContaining([
        expect.objectContaining({ role: 'tool', content: expect.stringContaining('<SERVER_PROJECTED_TOOL_EVIDENCE>') })
      ])
    }));
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-tool-lane')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'TOOL', coverage: 'COMPLETE' }));
  });

  it('keeps current policy denial out of successful normalization', async () => {
    const policy = state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!;
    policy.enabled = false;
    const before = { tools: state.toolCalls.length, evidence: state.evidenceRefs.length };
    const response = await send('req-f010-tool-denied', '查詢庫存可用量 料號 SKU-DEMO-BLUE');
    expect(state.evidenceRefs).toHaveLength(before.evidence);
    expect(state.toolCalls.length).toBeLessThanOrEqual(before.tools + 1);
    expect(parseSseResponse(response.text).some((event) => event.event === 'evidence_attached')).toBe(false);
    policy.enabled = true;
  });

  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }
});
