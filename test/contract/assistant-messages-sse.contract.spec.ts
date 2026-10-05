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
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { LlmProviderService } from '../../src/llm/llm-provider.service';
import type { LlmProvider } from '../../src/llm/llm-provider.interface';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

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
    jest.spyOn(app.get(LlmExecutionService, { strict: false }), 'generateAnswer').mockResolvedValue({
      content: '核准證據顯示訂單狀態。', finishReason: 'stop',
      metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false }
    });
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
        message: '查詢訂單目前狀態 訂單號 SO-10001',
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
    expect(state.toolCalls.at(-1)?.toolName).toBe('mock.orders.status.lookup');
    expect(state.toolCalls.at(-1)?.requestId).toBe('req-us1-sse-success');

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

  it('forwards two Tool-grounded provider deltas before provider completion', async () => {
    let completeProvider!: () => void;
    const completion = new Promise<void>((resolve) => { completeProvider = resolve; });
    let providerCompleted = false;
    const llm = app.get(LlmExecutionService, { strict: false });
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '甲' };
      yield { type: 'text_delta', text: '乙' };
      await completion;
      providerCompleted = true;
      yield { type: 'text_delta', text: '丙' };
      yield { type: 'completed', finishReason: 'stop', metadata: { provider: 'openai', model: 'test-model', fallbackUsed: false } };
    });
    let observed = '';
    let signalTwo!: () => void;
    let signalEnd!: () => void;
    const twoDeltas = new Promise<void>((resolve) => { signalTwo = resolve; });
    const endOfBody = new Promise<void>((resolve) => { signalEnd = resolve; });
    const ongoing = request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-sse-native-timing' }))
      .send({ message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] } })
      .buffer(false)
      .parse((res, callback) => {
        res.on('data', (chunk: Buffer) => {
          observed += chunk.toString('utf8');
          if ((observed.match(/event: answer_delta/g) ?? []).length >= 2) signalTwo();
        });
        res.on('end', () => { signalEnd(); callback(null, observed); });
        res.on('error', callback);
      });
    const responsePromise = ongoing.then((result) => result);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([twoDeltas, new Promise<never>((_resolve, reject) => { timeoutHandle = setTimeout(() => reject(new Error('TIMED_DELTAS_NOT_OBSERVED')), 2000); })]);
      expect(providerCompleted).toBe(false);
      expect(observed.indexOf('event: tool_call_started')).toBeLessThan(observed.indexOf('event: answer_delta'));
      expect(observed.indexOf('event: tool_call_completed')).toBeLessThan(observed.indexOf('event: answer_delta'));
      expect(observed.indexOf('event: evidence_attached')).toBeLessThan(observed.indexOf('event: answer_delta'));
      expect(observed).not.toContain('event: final');
      expect(state.answerDecisions.filter((decision) => decision.requestId === 'req-sse-native-timing')).toEqual([]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      completeProvider();
    }
    const response = await responsePromise;
    await endOfBody;
    expect(response.status).toBe(200);
    expect(observed).not.toContain('event: error');
    expect(observed).toContain('event: final');
    expect((observed.match(/event: answer_delta/g) ?? [])).toHaveLength(3);
    expect((observed.match(/event: final/g) ?? [])).toHaveLength(1);
    expect(state.answerDecisions.filter((decision) => decision.requestId === 'req-sse-native-timing')).toHaveLength(1);
  });

  it('emits a safe error and no final after a provider fails following a provisional delta', async () => {
    const llm = app.get(LlmExecutionService, { strict: false });
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'provisional-only' };
      throw new Error('raw provider detail must stay private');
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-sse-provider-failure' }))
      .send({ message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] } });
    const names = parseSseResponse(response.text).map((event) => event.event);
    expect(names).toContain('answer_delta');
    expect(names.at(-1)).toBe('error');
    expect(names).not.toContain('final');
    expect(response.text).not.toContain('raw provider detail');
    expect(state.answerDecisions.filter((decision) => decision.requestId === 'req-sse-provider-failure')).toEqual([]);
    expect(state.messages.filter((message) => message.requestId === 'req-sse-provider-failure')
      .some((message) => message.content.includes('provisional-only'))).toBe(false);
  });

  it('propagates client disconnect to the generation AbortSignal without completing history', async () => {
    let signalAbort!: () => void;
    const providerAborted = new Promise<void>((resolve) => { signalAbort = resolve; });
    const llm = app.get(LlmExecutionService, { strict: false });
    jest.spyOn(llm, 'streamAnswer').mockRestore();
    const provider = {
      key: 'controlled-provider', getMetadata: () => ({ provider: 'controlled-provider', model: 'test-model', fallbackUsed: false }),
      generateAnswer: jest.fn(), classifyIntent: jest.fn(), summarize: jest.fn(),
      async *streamAnswer(_input: unknown, options: { signal: AbortSignal }) {
        yield { type: 'text_delta' as const, text: 'provisional-only' };
        await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => { signalAbort(); resolve(); }, { once: true }));
        throw new Error('LLM_STREAM_ABORTED');
      }
    } as LlmProvider;
    jest.spyOn(app.get(LlmProviderService, { strict: false }), 'getSelectedProvider').mockReturnValue(provider);
    let cancelled = false;
    let observed = '';
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const headers = createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-sse-client-close' });
    const client = httpRequest({ hostname: '127.0.0.1', port, path: '/api/v1/assistant/sessions/session-owned-001/messages',
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' } }, (res) => {
      res.on('data', (chunk: Buffer) => {
        observed += chunk.toString('utf8');
        if (!cancelled && observed.includes('event: answer_delta')) { cancelled = true; client.destroy(); }
      });
      res.on('error', () => undefined);
    });
    client.on('error', () => undefined);
    client.end(JSON.stringify({ message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] } }));
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([providerAborted, new Promise<never>((_resolve, reject) => { timeoutHandle = setTimeout(() => reject(new Error('ABORT_NOT_PROPAGATED')), 2000); })]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      client.destroy();
    }
    expect(cancelled).toBe(true);
    expect(observed).not.toContain('event: final');
    expect(state.answerDecisions.filter((decision) => decision.requestId === 'req-sse-client-close')).toEqual([]);
  });

  it('aborts oversized native output without a successful final or partial persistence', async () => {
    const llm = app.get(LlmExecutionService, { strict: false });
    jest.spyOn(llm, 'streamAnswer').mockRestore();
    const provider = {
      key: 'controlled-provider', getMetadata: () => ({ provider: 'controlled-provider', model: 'test-model', fallbackUsed: false }),
      generateAnswer: jest.fn(), classifyIntent: jest.fn(), summarize: jest.fn(),
      async *streamAnswer() { yield { type: 'text_delta' as const, text: 'x'.repeat(4097) }; }
    } as LlmProvider;
    jest.spyOn(app.get(LlmProviderService, { strict: false }), 'getSelectedProvider').mockReturnValue(provider);
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-sse-output-limit' }))
      .send({ message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] } });
    const names = parseSseResponse(response.text).map((event) => event.event);
    expect(names.at(-1)).toBe('error');
    expect(names).not.toContain('final');
    expect(response.text).not.toContain('x'.repeat(4097));
    expect(state.answerDecisions.filter((decision) => decision.requestId === 'req-sse-output-limit')).toEqual([]);
  });

  it('rejects a malformed provider event with a safe SSE error and no completed answer', async () => {
    const llm = app.get(LlmExecutionService, { strict: false });
    jest.spyOn(llm, 'streamAnswer').mockRestore();
    const provider = {
      key: 'controlled-provider', getMetadata: () => ({ provider: 'controlled-provider', model: 'test-model', fallbackUsed: false }),
      generateAnswer: jest.fn(), classifyIntent: jest.fn(), summarize: jest.fn(),
      async *streamAnswer() {
        yield { type: 'text_delta' as const, text: 'provisional-only' };
        yield { type: 'text_delta' as const, text: '' };
      }
    } as LlmProvider;
    jest.spyOn(app.get(LlmProviderService, { strict: false }), 'getSelectedProvider').mockReturnValue(provider);
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(identityFixture, { claims: ownedClaims, requestId: 'req-sse-malformed-event' }))
      .send({ message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] } });
    const names = parseSseResponse(response.text).map((event) => event.event);
    expect(names).toContain('answer_delta');
    expect(names.at(-1)).toBe('error');
    expect(names).not.toContain('final');
    expect(response.text).not.toContain('LLM_STREAM_INVALID_EVENT');
    expect(state.answerDecisions.filter((decision) => decision.requestId === 'req-sse-malformed-event')).toEqual([]);
    expect(state.messages.filter((message) => message.requestId === 'req-sse-malformed-event')
      .some((message) => message.content.includes('provisional-only'))).toBe(false);
  });
});
