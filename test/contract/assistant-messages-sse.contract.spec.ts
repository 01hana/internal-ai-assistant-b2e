import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createLegacyPublicIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import {
  createInternalIdentityJwtFixture,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';

describe('assistant message SSE contract', () => {
  const identityFixture = createInternalIdentityJwtFixture();
  const ownedClaims = identityFixture.canonicalClaims.customerA;
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState({
      internalIdentity: {
        issuer: TEST_GATEWAY_ISSUER,
        audience: TEST_BACKEND_AUDIENCE,
        jwks: identityFixture.jwks
      },
      forceMessageServiceErrorForSessionId: 'session-flow-error-001'
    });
    app = testApp.app;
    state = testApp.state;
    expect(state.internalIdentity).toEqual({
      issuer: TEST_GATEWAY_ISSUER,
      audience: TEST_BACKEND_AUDIENCE,
      jwks: identityFixture.jwks
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('streams Customer-owned structured ToolCall success after T056', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-us1-sse-success' }))
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

    const events = parseSseResponse(response.text);

    expect(events.map((event) => event.event)).toEqual(['tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final']);
    expect(events.map((event) => event.event)).not.toContain('error');
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            requestId: 'req-us1-sse-success',
            sessionId: 'session-owned-001',
            messageId: expect.any(String),
            eventType: expect.any(String),
            sequence: expect.any(Number)
          })
        })
      ])
    );
    const toolCall = state.toolCalls.at(-1);
    const evidence = state.evidenceRefs.find((item) => item.toolCallId === toolCall?.id);
    expect(toolCall).toEqual(expect.objectContaining({ customerId: 'customer-a', status: 'success', executionStatus: 'executed' }));
    expect(evidence).toEqual(expect.objectContaining({ customerId: 'customer-a', toolCallId: toolCall?.id }));
    expect(response.text).not.toContain('customer-b');
  });

  it('returns an SSE error event instead of a synchronous JSON body when the message flow fails', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-flow-error-001/messages')
      .set(
        createAuthorizedInternalIdentityHeaders(identityFixture, {
          claims: ownedClaims,
          requestId: 'req-us1-sse-error'
        })
      )
      .send({
        message: '請幫我查這張訂單'
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = parseSseResponse(response.text);

    expect(events).toEqual([
      expect.objectContaining({
        event: 'error',
        data: expect.objectContaining({
          requestId: 'req-us1-sse-error',
          sessionId: 'session-flow-error-001',
          eventType: 'error',
          sequence: 1,
          data: expect.objectContaining({
            code: expect.any(String),
            message: expect.any(String)
          })
        })
      })
    ]);
    expect(response.text).not.toContain('test-only in-stream failure');
  });

  it.each([
    ['missing token', {}, 401, 'IDENTITY_TOKEN_INVALID'],
    ['malformed token', { authorization: 'Bearer broken.token' }, 401, 'IDENTITY_TOKEN_INVALID'],
    ['verified-token invalid canonical claims', createAuthorizedInternalIdentityHeaders(identityFixture, { claims: { org_id: ' ' } }), 403, 'IDENTITY_CONTEXT_INVALID']
  ])('rejects %s as JSON before the SSE stream or message orchestration begins', async (_name, headers, status, code) => {
    const beforeAuditCount = state.auditEvents.length;
    const beforeMessageCount = state.messages.length;
    const beforeToolCallCount = state.toolCalls.length;
    const beforeEvidenceCount = state.evidenceRefs.length;
    const beforeOrchestrationCount = state.orchestration.sendMessage.mock.calls.length;
    const beforeSseEventBuildCount = state.orchestration.sseEventBuilds.mock.calls.length;
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(headers)
      .send({ message: 'must not enter orchestration' });

    expect(response.status).toBe(status);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-type']).not.toContain('text/event-stream');
    expect(response.body).toEqual(expect.objectContaining({ error: expect.objectContaining({ code }) }));
    expect(state.auditEvents).toHaveLength(beforeAuditCount);
    expect(state.messages).toHaveLength(beforeMessageCount);
    expect(state.toolCalls).toHaveLength(beforeToolCallCount);
    expect(state.evidenceRefs).toHaveLength(beforeEvidenceCount);
    expect(state.orchestration.sendMessage).toHaveBeenCalledTimes(beforeOrchestrationCount);
    expect(state.orchestration.sseEventBuilds).toHaveBeenCalledTimes(beforeSseEventBuildCount);
    expect(JSON.stringify(response.body)).not.toContain('JWKS');
    expect(JSON.stringify(response.body)).not.toContain('Bearer ');
  });

  it('does not let public headers start an SSE response without a verified JWT', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createLegacyPublicIdentityHeaders({ 'x-request-id': 'req-sse-header-not-authority' }))
      .send({ message: 'must not be streamed' });

    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-type']).not.toContain('text/event-stream');
  });
});
