import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createLegacyPublicIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const describeCustomerUs1 = process.env.RUN_CUSTOMER_US1_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs1('Customer SSE isolation contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  const headersFor = (customer: 'customerA' | 'customerB', requestId: string) =>
    createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId });
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    }));
  });
  afterAll(async () => app.close());

  it.each([
    ['missing', {}, 401, 'IDENTITY_TOKEN_INVALID'],
    ['malformed', { authorization: 'Bearer not-a-jwt' }, 401, 'IDENTITY_TOKEN_INVALID'],
    ['legacy headers', createLegacyPublicIdentityHeaders(), 401, 'IDENTITY_TOKEN_INVALID'],
    ['invalid signature', { authorization: `Bearer ${fixture.tamper(fixture.sign())}` }, 401, 'IDENTITY_TOKEN_INVALID'],
    ['wrong issuer', { authorization: `Bearer ${fixture.sign({ claims: { iss: 'https://untrusted.example' } })}` }, 401, 'IDENTITY_TOKEN_INVALID'],
    ['wrong audience', { authorization: `Bearer ${fixture.sign({ claims: { aud: 'wrong-audience' } })}` }, 401, 'IDENTITY_TOKEN_INVALID'],
    ['invalid canonical claims', createAuthorizedInternalIdentityHeaders(fixture, { claims: { customer_id: '' } }), 403, 'IDENTITY_CONTEXT_INVALID']
  ])('rejects %s before an SSE stream begins', async (_name, headers, status, code) => {
    const before = counters(state);
    const response = await request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages').set(headers).send({ message: 'blocked' });
    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(response.body.error?.code).toBe(code);
    expect(counters(state)).toEqual(before);
  });

  it.each([
    ['customerA', 'session-hidden-001'],
    ['customerB', 'session-owned-001']
  ] as const)('rejects %s before opening a foreign Customer stream', async (customer, sessionId) => {
    const before = counters(state);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set({ ...headersFor(customer, `req-sse-${customer}-${sessionId}`), 'x-customer-id': 'customer-b' })
      .send({ message: 'cross customer must not stream' });
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(counters(state)).toEqual(before);
  });

  it.each([
    ['customerA', 'session-owned-001'],
    ['customerB', 'session-hidden-001']
  ] as const)('keeps the required SSE event sequence for %s own session', async (customer, sessionId) => {
    const beforeMessages = state.messages.length;
    const response = await request(app.getHttpServer())
      .post(`/api/v1/assistant/sessions/${sessionId}/messages`)
      .set(headersFor(customer, `req-sse-own-${customer}`))
      .send({
        message: '這張訂單目前狀態？',
        pageContext: {
          module: 'orders',
          screenId: 'order-detail',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(parseSseResponse(response.text).map((event) => event.event)).toEqual([
      'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
    ]);
    const created = state.messages.slice(beforeMessages);
    expect(created).not.toHaveLength(0);
    expect(created.every((message) => message.customerId === (customer === 'customerA' ? 'customer-a' : 'customer-b'))).toBe(true);
  });
});

function counters(state: Us1TestState) {
  return {
    messages: state.messages.length,
    toolCalls: state.toolCalls.length,
    evidenceRefs: state.evidenceRefs.length,
    auditEvents: state.auditEvents.length,
    orchestration: state.orchestration.sendMessage.mock.calls.length,
    eventBuilds: state.orchestration.sseEventBuilds.mock.calls.length
  };
}
