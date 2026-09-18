import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

const INTERNAL_KEYS = /GroundedContextBundle|groundedRetrievalPlan|requestedNeeds|needResults|resolvedFrame|boundedRecentTurns|citations|unsupportedNeeds|canonicalToolKey|permissionResult|permissionSnapshot|rawResponse|preProjectionData|transientConnectorContext/i;

describe('Feature 010 public compatibility contract (T075)', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState({ forceMessageServiceErrorForSessionId: 'session-flow-error-001' }));
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true,
      requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterAll(async () => app.close());

  it.each([
    ['document', 'req-f010-public-doc', '退貨流程 SOP 怎麼說？', { module: 'orders', visibleColumns: ['status'] }, ['answer_delta', 'final']],
    ['tool', 'req-f010-public-tool', '請查 SKU-DEMO-RED 目前庫存', inventoryPage(),
      ['tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final']],
    ['clarification', 'req-f010-public-clarify', '那個呢？', { module: 'orders', visibleColumns: [] }, ['answer_delta', 'final']]
  ])('preserves the %s SSE event order and envelope without publishing internal bundle fields', async (_name, requestId, message, pageContext, expectedEvents) => {
    const response = await send(requestId, message, pageContext);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = parseSseResponse(response.text);
    expect(events.map((event) => event.event)).toEqual(expectedEvents);
    for (const event of events) {
      expectExactKeys(event.data, ['requestId', 'sessionId', 'messageId', 'eventType', 'sequence', 'data']);
      expect(event.data).toEqual(expect.objectContaining({ requestId, sessionId: 'session-owned-001', messageId: expect.any(String),
        eventType: event.event, sequence: expect.any(Number), data: expect.anything() }));
      assertExactEventData(event.event ?? '', event.data.data);
    }
    expect(response.text).not.toMatch(INTERNAL_KEYS);
  });

  it('preserves history and EvidenceRef public shapes without exposing safe internal handoff metadata', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 50, order: 'asc' }).set(headers('req-f010-public-history'));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ requestId: 'req-f010-public-history', data: expect.objectContaining({
      sessionId: 'session-owned-001', messages: expect.any(Array), nextCursor: null
    }) }));
    expectExactKeys(response.body, ['requestId', 'data']);
    expectExactKeys(response.body.data, ['sessionId', 'messages', 'nextCursor']);
    for (const message of response.body.data.messages) {
      if (message.role === 'user') expectExactKeys(message, ['messageId', 'role', 'content', 'createdAt']);
      if (message.role === 'assistant') {
        expectAllowedExactKeys(message, [
          ['messageId', 'role', 'content', 'createdAt', 'answerDecision', 'evidenceRefs'],
          ['messageId', 'role', 'content', 'createdAt', 'answerDecision', 'evidenceRefs', 'toolSummary']
        ]);
        expect(message.evidenceRefs).toEqual(expect.any(Array));
        expect(message.evidenceRefs.every((id: unknown) => typeof id === 'string')).toBe(true);
      }
    }
    expect(JSON.stringify(response.body)).not.toMatch(INTERNAL_KEYS);
  });

  it('preserves the existing pre-stream JSON and in-stream SSE error envelopes', async () => {
    const unauthorized = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .send({ message: 'must not execute' });
    expect(unauthorized.status).toBe(401);
    expectExactKeys(unauthorized.body, ['requestId', 'error']);
    expectAllowedExactKeys(unauthorized.body.error, [['code', 'message'], ['code', 'message', 'details']]);
    expect(unauthorized.body).toEqual(expect.objectContaining({ requestId: expect.any(String), error: expect.objectContaining({
      code: expect.any(String), message: expect.any(String)
    }) }));

    const failed = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-flow-error-001/messages')
      .set(headers('req-f010-public-error')).send({ message: 'force safe failure' });
    expect(failed.status).toBe(200);
    expect(parseSseResponse(failed.text)).toEqual([expect.objectContaining({ event: 'error', data: expect.objectContaining({
      requestId: 'req-f010-public-error', sessionId: 'session-flow-error-001', eventType: 'error', sequence: 1,
      data: expect.objectContaining({ code: expect.any(String), message: expect.any(String) })
    }) })]);
    const errorEnvelope = parseSseResponse(failed.text)[0]!.data;
    expectExactKeys(errorEnvelope, ['requestId', 'sessionId', 'messageId', 'eventType', 'sequence', 'data']);
    expectExactKeys(errorEnvelope.data, ['code', 'message']);
    expect(`${JSON.stringify(unauthorized.body)}${failed.text}`).not.toMatch(INTERNAL_KEYS);
  });

  function send(requestId: string, message: string, pageContext: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(headers(requestId)).send({ message, pageContext });
  }
});

function headers(requestId: string) {
  return createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
    claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA,
      permission_scopes: ['orders:read', 'inventory:read'] }, requestId
  });
}
function inventoryPage() {
  return { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] };
}

function assertExactEventData(event: string, data: Record<string, unknown>) {
  if (event === 'tool_call_started') expectExactKeys(data, ['toolCallId', 'toolName']);
  if (event === 'tool_call_completed') expectExactKeys(data, ['toolCallId', 'toolName', 'status', 'executionStatus']);
  if (event === 'evidence_attached') {
    expectExactKeys(data, ['evidenceRefs']);
    expect((data.evidenceRefs as unknown[]).every((id) => typeof id === 'string')).toBe(true);
  }
  if (event === 'answer_delta') expectExactKeys(data, ['delta']);
  if (event === 'final') expectAllowedExactKeys(data, [
    ['answerDecision', 'answer', 'evidenceRefs'],
    ['answerDecision', 'answer', 'evidenceRefs', 'clarificationQuestionId'],
    ['answerDecision', 'answer', 'evidenceRefs', 'noAnswerReason'],
    ['answerDecision', 'answer', 'evidenceRefs', 'noAnswerReason', 'errorCode']
  ]);
}
function expectExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}
function expectAllowedExactKeys(value: Record<string, unknown>, variants: readonly (readonly string[])[]) {
  const actual = Object.keys(value).sort();
  expect(variants.some((variant) => JSON.stringify([...variant].sort()) === JSON.stringify(actual))).toBe(true);
}
