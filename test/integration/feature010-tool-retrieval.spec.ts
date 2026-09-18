import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 Tool-only grounded retrieval (T055)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterAll(async () => app.close());

  it('uses current discovery and authority for exactly one projected Tool evidence item', async () => {
    const before = { tools: state.toolCalls.length, retrievals: state.retrievalRuns.length };
    const response = await send('req-f010-tool-lane', '請查 SKU-DEMO-RED 目前庫存');
    expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
    ]);
    expect(state.toolCalls).toHaveLength(before.tools + 1);
    expect(state.retrievalRuns).toHaveLength(before.retrievals);
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-tool-lane')).toEqual([
      expect.objectContaining({ sourceType: 'structured_record', fieldPaths: ['availableQuantity', 'incomingQuantity'] })
    ]);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-tool-lane')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'TOOL', coverage: 'COMPLETE' }));
  });

  it('keeps current policy denial out of successful normalization', async () => {
    const policy = state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!;
    policy.enabled = false;
    const before = { tools: state.toolCalls.length, evidence: state.evidenceRefs.length };
    const response = await send('req-f010-tool-denied', '請查 SKU-DEMO-BLUE 目前庫存');
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
