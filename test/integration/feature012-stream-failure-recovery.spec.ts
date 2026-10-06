import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';
import { AssistantMessageService } from '../../src/assistant/message/assistant-message.service';
import { AssistantContextStateService } from '../../src/assistant/context/assistant-context-state.service';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { StructuredLoggerService } from '../../src/common/logger/structured-logger.service';
import { LlmProviderService } from '../../src/llm/llm-provider.service';
import type { LlmProvider } from '../../src/llm/llm-provider.interface';
import { ConversationContextLoaderService } from '../../src/assistant/conversation/conversation-context-loader.service';
import {
  createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState
} from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const question = { message: '查詢訂單目前狀態 訂單號 SO-10001', pageContext: {
  module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status']
} };
const scope = { customerId: 'customer-a', sessionId: 'session-owned-001', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared' };
const metadata = { provider: 'openai', model: 'test-model', fallbackUsed: false };

describe('Feature 012 streaming failure recovery', () => {
  const identity = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  let llm: LlmExecutionService;
  let originalStream: LlmExecutionService['streamAnswer'];

  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState({ internalIdentity: {
      issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: identity.jwks
    } }));
    llm = app.get(LlmExecutionService, { strict: false });
    originalStream = llm.streamAnswer;
  });
  afterEach(() => { jest.restoreAllMocks(); llm.streamAnswer = originalStream; });
  afterAll(async () => { await app.close(); });

  async function post(requestId: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(identity, { claims: identity.canonicalClaims.customerA, requestId }))
      .send(question);
  }
  async function expectNoCompletedAnswer(requestId: string, responseText: string, privateDetail?: string) {
    expect(parseSseResponse(responseText).map((event) => event.event)).not.toContain('final');
    if (privateDetail) expect(responseText).not.toContain(privateDetail);
    expect(state.answerDecisions.filter((decision) => decision.requestId === requestId)).toEqual([]);
    const pending = state.messages.find((message) => message.requestId === requestId && message.role === 'assistant');
    expect(pending?.content).toBe('Pending answer.');
    const history = await request(app.getHttpServer()).get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(identity, { claims: identity.canonicalClaims.customerA,
        requestId: `history-${requestId}` }));
    expect(history.status).toBe(200);
    expect(history.body.data.messages.map((message: { messageId: string }) => message.messageId)).not.toContain(pending?.id);
    const context = await app.get(ConversationContextLoaderService).load({ scope });
    expect(context.exchanges.map((exchange) => exchange.requestId)).not.toContain(requestId);
    expect(context.completedAssistantAnswers?.map((exchange) => exchange.exchangeId)).not.toContain(requestId);
  }

  function terminalAudits(requestId: string) {
    return state.auditEvents.filter((event) => event.requestId === requestId &&
      ['llm_generation_completed', 'llm_generation_terminated'].includes(event.eventType));
  }

  it('audits a completed answer once with bounded metadata and no prompt or answer', async () => {
    const requestId = 'req-recovery-audit-completed';
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '核准證據顯示訂單狀態。' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const response = await post(requestId);
    expect(parseSseResponse(response.text).filter((event) => event.event === 'final')).toHaveLength(1);
    expect(terminalAudits(requestId)).toHaveLength(1);
    expect(terminalAudits(requestId)[0]).toMatchObject({ eventType: 'llm_generation_completed',
      metadata: expect.objectContaining({ outcome: 'COMPLETED' }) });
    expect(JSON.stringify(terminalAudits(requestId))).not.toContain('核准證據顯示訂單狀態');
  });

  it.each([
    ['provider error before first delta', [], new Error('private provider diagnostic')],
    ['provider error after delta', ['provisional-only'], new Error('private provider diagnostic')],
    ['provider deadline', ['provisional-only'], new Error('LLM_STREAM_DEADLINE')],
    ['malformed stream event', ['provisional-only', ''], undefined],
    ['incomplete terminal stream', ['provisional-only'], undefined],
    ['oversized output', ['x'.repeat(4097)], undefined]
  ])('%s never creates completed history', async (name, deltas, failure) => {
    const requestId = `req-recovery-${name.replaceAll(' ', '-')}`;
    const stream = jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      for (const text of deltas) yield { type: 'text_delta' as const, text };
      if (failure) throw failure;
    });
    stream.mockClear();
    const response = await post(requestId);
    expect(response.status).toBe(200);
    await expectNoCompletedAnswer(requestId, response.text, 'private provider diagnostic');
    expect(terminalAudits(requestId)).toHaveLength(1);
    expect(terminalAudits(requestId)[0]).toMatchObject({ metadata: expect.objectContaining({
      outcome: name === 'provider deadline' ? 'TIMEOUT' : 'FAILED'
    }) });
    expect(JSON.stringify(terminalAudits(requestId))).not.toContain('private provider diagnostic');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it.each(['throw', 'hang'])('keeps a durable read-only answer and final on terminal audit %s', async (mode) => {
    const requestId = `req-recovery-audit-${mode}`;
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '核准證據顯示訂單狀態。' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    const writer = app.get(AuditWriterService, { strict: false });
    const originalAppend = writer.append.bind(writer);
    const attempts: string[] = [];
    jest.spyOn(writer, 'append').mockImplementation((input, database) => {
      if (input.eventType === 'llm_generation_completed') {
        attempts.push(input.eventType);
        if (mode === 'throw') return Promise.reject(new Error('private audit storage diagnostic'));
        return new Promise(() => undefined);
      }
      return originalAppend(input, database);
    });
    const warn = jest.spyOn(StructuredLoggerService.prototype, 'warn').mockImplementation(() => undefined);
    const response = await post(requestId);
    expect(response.status).toBe(200);
    expect(parseSseResponse(response.text).filter((event) => event.event === 'final')).toHaveLength(1);
    expect(state.answerDecisions.filter((decision) => decision.requestId === requestId)).toHaveLength(1);
    expect(attempts).toEqual(['llm_generation_completed']);
    expect(warn).toHaveBeenCalledWith('FEATURE012_AUDIT_PERSISTENCE_FAILED', 'LlmObservabilityService',
      expect.objectContaining({ AUDIT_PERSISTED: 'NO', requestId }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private audit storage diagnostic');
    expect(terminalAudits(requestId)).toHaveLength(0);
  });

  it('still attempts one terminal audit if post-commit context persistence fails', async () => {
    const requestId = 'req-recovery-post-commit-context-failure';
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '核准證據顯示訂單狀態。' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    jest.spyOn(app.get(AssistantContextStateService, { strict: false }), 'updateAfterMessageFlow')
      .mockRejectedValueOnce(new Error('private context failure'));
    const response = await post(requestId);
    expect(parseSseResponse(response.text).map((event) => event.event)).not.toContain('final');
    expect(terminalAudits(requestId)).toHaveLength(1);
    expect(terminalAudits(requestId)[0]).toMatchObject({ metadata: expect.objectContaining({ outcome: 'COMPLETED' }) });
    expect(response.text).not.toContain('private context failure');
  });

  it('rejects a valid completed terminal with no answer deltas as empty output', async () => {
    const requestId = 'req-recovery-empty-completed-output';
    const stream = jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    stream.mockClear();
    const response = await post(requestId);
    expect(response.status).toBe(200);
    const events = parseSseResponse(response.text);
    expect(events.at(-1)?.event).toBe('error');
    expect(events.map((event) => event.event)).not.toContain('answer_delta');
    await expectNoCompletedAnswer(requestId, response.text, 'LLM_STREAM_INCOMPLETE');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('rolls back a validated answer when the core transaction fails', async () => {
    const requestId = 'req-recovery-core-transaction';
    jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '核准證據顯示訂單狀態。' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    state.workflowAuditFailureEventTypes.push('answer_generated');
    const response = await post(requestId);
    expect(response.status).toBe(200);
    await expectNoCompletedAnswer(requestId, response.text);
    expect(state.groundingChecks.filter((item) => item.requestId === requestId)).toEqual([]);
  });

  it('aborts the provider when the client disconnects after a provisional delta', async () => {
    const requestId = 'req-recovery-client-disconnect';
    let notifyAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { notifyAbort = resolve; });
    jest.spyOn(llm, 'streamAnswer').mockRestore();
    const provider = {
      key: 'controlled-provider', getMetadata: () => metadata,
      generateAnswer: jest.fn(), classifyIntent: jest.fn(), summarize: jest.fn(),
      async *streamAnswer(_input: unknown, options: { signal: AbortSignal }) {
        yield { type: 'text_delta' as const, text: 'provisional-only' };
        await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => { notifyAbort(); resolve(); }, { once: true }));
        throw new Error('LLM_STREAM_ABORTED');
      }
    } as LlmProvider;
    jest.spyOn(app.get(LlmProviderService, { strict: false }), 'getSelectedProvider').mockReturnValue(provider);
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    let observed = '';
    const client = httpRequest({ hostname: '127.0.0.1', port,
      path: '/api/v1/assistant/sessions/session-owned-001/messages', method: 'POST',
      headers: { ...createAuthorizedInternalIdentityHeaders(identity, { claims: identity.canonicalClaims.customerA, requestId }),
        'content-type': 'application/json' } }, (response) => {
      response.on('data', (chunk: Buffer) => {
        observed += chunk.toString('utf8');
        if (observed.includes('event: answer_delta')) client.destroy();
      });
      response.on('error', () => undefined);
    });
    client.on('error', () => undefined);
    client.end(JSON.stringify(question));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([aborted, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('PROVIDER_ABORT_NOT_OBSERVED')), 2000);
      })]);
    } finally { if (timeout) clearTimeout(timeout); client.destroy(); }
    expect(observed).toContain('event: answer_delta');
    expect(observed).not.toContain('event: final');
    expect(state.answerDecisions.filter((item) => item.requestId === requestId)).toEqual([]);
    const context = await app.get(ConversationContextLoaderService).load({ scope });
    expect(context.exchanges.map((exchange) => exchange.requestId)).not.toContain(requestId);
  });

  it('aborts exactly one provider invocation when the client disconnects before the first delta', async () => {
    const requestId = 'req-recovery-pre-first-delta-disconnect';
    let notifyStarted!: () => void;
    let notifyAbort!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const aborted = new Promise<void>((resolve) => { notifyAbort = resolve; });
    let notifyTerminal!: () => void;
    const terminal = new Promise<void>((resolve) => { notifyTerminal = resolve; });
    const recordTerminal = llm.recordGroundedGenerationTerminal.bind(llm);
    const terminalSpy = jest.spyOn(llm, 'recordGroundedGenerationTerminal').mockImplementation(async (input) => {
      const result = await recordTerminal(input);
      notifyTerminal();
      return result;
    });
    jest.spyOn(llm, 'streamAnswer').mockRestore();
    const provider = {
      key: 'controlled-provider', getMetadata: () => metadata,
      generateAnswer: jest.fn(), classifyIntent: jest.fn(), summarize: jest.fn(),
      streamAnswer: jest.fn(async function* (_input: unknown, options: { signal: AbortSignal }) {
        notifyStarted();
        await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => { notifyAbort(); resolve(); }, { once: true }));
        yield { type: 'text_delta' as const, text: 'after-abort-only' };
      })
    } as LlmProvider;
    jest.spyOn(app.get(LlmProviderService, { strict: false }), 'getSelectedProvider').mockReturnValue(provider);
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    let observed = '';
    const client = httpRequest({ hostname: '127.0.0.1', port,
      path: '/api/v1/assistant/sessions/session-owned-001/messages', method: 'POST',
      headers: { ...createAuthorizedInternalIdentityHeaders(identity, { claims: identity.canonicalClaims.customerA, requestId }),
        'content-type': 'application/json' } }, (response) => {
      response.on('data', (chunk: Buffer) => { observed += chunk.toString('utf8'); });
      response.on('error', () => undefined);
    });
    client.on('error', () => undefined);
    client.end(JSON.stringify(question));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([started, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('PROVIDER_NOT_STARTED')), 2000);
      })]);
      expect(observed).not.toContain('event: answer_delta');
      client.destroy();
      await Promise.race([aborted, new Promise<never>((_resolve, reject) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => reject(new Error('PRE_DELTA_ABORT_NOT_PROPAGATED')), 2000);
      })]);
      await Promise.race([terminal, new Promise<never>((_resolve, reject) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => reject(new Error('CANCELLED_AUDIT_NOT_OBSERVED')), 2000);
      })]);
    } finally { if (timeout) clearTimeout(timeout); client.destroy(); }
    expect(observed).not.toContain('event: answer_delta');
    expect(observed).not.toContain('event: final');
    expect(provider.streamAnswer).toHaveBeenCalledTimes(1);
    expect(terminalSpy).toHaveBeenCalledTimes(1);
    expect(terminalSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'CANCELLED' }));
    expect(terminalAudits(requestId)).toHaveLength(1);
    expect(terminalAudits(requestId)[0]).toMatchObject({ metadata: expect.objectContaining({ outcome: 'CANCELLED' }) });
    await expectNoCompletedAnswer(requestId, observed);
  });

  it('passes a bounded deadline abort into the provider without retry', async () => {
    jest.spyOn(llm, 'streamAnswer').mockRestore();
    let aborted = false;
    const provider = {
      key: 'controlled-provider', getMetadata: () => metadata,
      generateAnswer: jest.fn(), classifyIntent: jest.fn(), summarize: jest.fn(),
      streamAnswer: jest.fn(async function* (_input: unknown, options: { signal: AbortSignal }) {
        await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
        yield { type: 'text_delta' as const, text: 'never-delivered' };
      })
    } as LlmProvider;
    jest.spyOn(app.get(LlmProviderService, { strict: false }), 'getSelectedProvider').mockReturnValue(provider);
    const input = { requestId: 'req-recovery-provider-deadline', messages: [], evidence: [] };
    const context = { identityContext: {} as Parameters<LlmExecutionService['streamAnswer']>[1]['identityContext'] };
    await expect((async () => {
      for await (const _event of llm.streamAnswer(input, context, { signal: new AbortController().signal, deadlineMs: 10 })) { /* no chunks */ }
    })()).rejects.toThrow('LLM_STREAM_DEADLINE');
    expect(aborted).toBe(true);
    expect(provider.streamAnswer).toHaveBeenCalledTimes(1);
  });

  it('aborts the native provider on a 4 KiB overflow without committing provisional output', async () => {
    const requestId = 'req-recovery-native-output-overflow';
    jest.spyOn(llm, 'streamAnswer').mockRestore();
    let providerAborted = false;
    const provider = {
      key: 'controlled-provider', getMetadata: () => metadata,
      generateAnswer: jest.fn(), classifyIntent: jest.fn(), summarize: jest.fn(),
      streamAnswer: jest.fn(async function* (_input: unknown, options: { signal: AbortSignal }) {
        options.signal.addEventListener('abort', () => { providerAborted = true; }, { once: true });
        yield { type: 'text_delta' as const, text: 'x'.repeat(4097) };
      })
    } as LlmProvider;
    jest.spyOn(app.get(LlmProviderService, { strict: false }), 'getSelectedProvider').mockReturnValue(provider);
    const response = await post(requestId);
    await expectNoCompletedAnswer(requestId, response.text);
    expect(providerAborted).toBe(true);
    expect(provider.streamAnswer).toHaveBeenCalledTimes(1);
  });

  it('keeps a durably committed answer after transport loss before final delivery', async () => {
    const requestId = 'req-recovery-post-commit-loss';
    const stream = jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '核准證據顯示訂單狀態。' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    let releaseTerminal!: () => void;
    let terminalReached!: () => void;
    const gate = new Promise<void>((resolve) => { releaseTerminal = resolve; });
    const atTerminal = new Promise<void>((resolve) => { terminalReached = resolve; });
    jest.spyOn(llm, 'recordGroundedGenerationTerminal').mockImplementation(async () => {
      // Production enters this call only after the core transaction promise resolves.
      terminalReached();
      await gate;
      return { auditPersisted: true };
    });
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    let observed = '';
    const client = httpRequest({ hostname: '127.0.0.1', port,
      path: '/api/v1/assistant/sessions/session-owned-001/messages', method: 'POST',
      headers: { ...createAuthorizedInternalIdentityHeaders(identity, { claims: identity.canonicalClaims.customerA, requestId }),
        'content-type': 'application/json' } }, (response) => {
      response.on('data', (chunk: Buffer) => { observed += chunk.toString('utf8'); });
      response.on('error', () => undefined);
    });
    client.on('error', () => undefined);
    client.end(JSON.stringify(question));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([atTerminal, new Promise<never>((_resolve, reject) =>
        { timeout = setTimeout(() => reject(new Error('CORE_COMMIT_NOT_OBSERVED')), 2000); })]);
      const decision = state.answerDecisions.find((item) => item.requestId === requestId);
      const grounding = state.groundingChecks.find((item) => item.requestId === requestId);
      const final = state.messages.find((item) => item.requestId === requestId && item.role === 'assistant');
      expect(decision?.status).toBe('answered');
      expect(grounding?.covered).toBe(true);
      expect(final?.content).toBe('核准證據顯示訂單狀態。');
      expect(observed).not.toContain('event: final');
      client.destroy();
      releaseTerminal();
      const history = await request(server).get('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(identity, { claims: identity.canonicalClaims.customerA,
          requestId: 'history-post-commit-loss' }));
      expect(history.status).toBe(200);
      expect(history.body.data.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ messageId: final?.id, content: final?.content, answerDecision: 'answered' })
      ]));
      const context = await app.get(ConversationContextLoaderService).load({ scope });
      expect(context.exchanges.map((exchange) => exchange.requestId)).toContain(requestId);
      expect(observed).not.toContain('event: final');
      expect(stream).toHaveBeenCalledTimes(1);
    } finally {
      if (timeout) clearTimeout(timeout);
      client.destroy();
      releaseTerminal();
    }
  });

  it('rolls back a validated answer when disconnect occurs inside the not-yet-durable core transaction', async () => {
    const requestId = 'req-recovery-disconnect-before-durable-commit';
    const stream = jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '核准證據顯示訂單狀態。' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    stream.mockClear();
    let releaseAudit!: () => void;
    let notifyAuditReached!: () => void;
    let notifyTerminal!: () => void;
    const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
    const auditReached = new Promise<void>((resolve) => { notifyAuditReached = resolve; });
    const terminal = new Promise<void>((resolve) => { notifyTerminal = resolve; });
    let notifyAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { notifyAbort = resolve; });
    const messageService = app.get(AssistantMessageService, { strict: false });
    const originalSend = messageService.sendMessage.bind(messageService);
    jest.spyOn(messageService, 'sendMessage').mockImplementation((input) => {
      input.abortSignal?.addEventListener('abort', notifyAbort, { once: true });
      return originalSend(input);
    });
    const writer = app.get(AuditWriterService, { strict: false });
    const originalAppend = writer.append.bind(writer);
    jest.spyOn(writer, 'append').mockImplementation(async (input, database) => {
      if (input.eventType === 'answer_generated' && input.requestId === requestId) {
        notifyAuditReached();
        await auditGate;
      }
      return originalAppend(input, database);
    });
    const originalTerminal = llm.recordGroundedGenerationTerminal.bind(llm);
    const terminalSpy = jest.spyOn(llm, 'recordGroundedGenerationTerminal').mockImplementation(async (input) => {
      const result = await originalTerminal(input);
      notifyTerminal();
      return result;
    });
    const server = app.getHttpServer();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    let observed = '';
    const client = httpRequest({ hostname: '127.0.0.1', port,
      path: '/api/v1/assistant/sessions/session-owned-001/messages', method: 'POST',
      headers: { ...createAuthorizedInternalIdentityHeaders(identity, { claims: identity.canonicalClaims.customerA, requestId }),
        'content-type': 'application/json' } }, (response) => {
      response.on('data', (chunk: Buffer) => { observed += chunk.toString('utf8'); });
      response.on('error', () => undefined);
    });
    client.on('error', () => undefined);
    client.end(JSON.stringify(question));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([auditReached, new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('VALIDATED_TRANSACTION_NOT_REACHED')), 2000);
      })]);
      expect(observed).not.toContain('event: final');
      client.destroy();
      await Promise.race([aborted, new Promise<never>((_resolve, reject) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => reject(new Error('PRE_COMMIT_ABORT_NOT_OBSERVED')), 2000);
      })]);
      releaseAudit();
      await Promise.race([terminal, new Promise<never>((_resolve, reject) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => reject(new Error('CANCELLED_TERMINAL_NOT_REACHED')), 2000);
      })]);
      expect(terminalSpy).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'CANCELLED' }));
      expect(stream).toHaveBeenCalledTimes(1);
      await expectNoCompletedAnswer(requestId, observed);
      expect(state.groundingChecks.filter((item) => item.requestId === requestId)).toEqual([]);
    } finally {
      if (timeout) clearTimeout(timeout);
      client.destroy();
      releaseAudit();
    }
  });

  it('treats a repeated POST with the same non-unique requestId as a new turn, without SSE replay', async () => {
    const requestId = 'req-recovery-repeat-post-not-idempotent';
    const stream = jest.spyOn(llm, 'streamAnswer').mockImplementation(async function* () {
      yield { type: 'text_delta', text: '核准證據顯示訂單狀態。' };
      yield { type: 'completed', finishReason: 'stop', metadata };
    });
    stream.mockClear();
    const first = await post(requestId);
    const second = await post(requestId);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(parseSseResponse(first.text).filter((event) => event.event === 'final')).toHaveLength(1);
    expect(parseSseResponse(second.text).filter((event) => event.event === 'final')).toHaveLength(1);
    expect(stream).toHaveBeenCalledTimes(2);
    const decisions = state.answerDecisions.filter((decision) => decision.requestId === requestId);
    expect(decisions).toHaveLength(2);
    expect(new Set(decisions.map((decision) => decision.messageId)).size).toBe(2);
    expect(terminalAudits(requestId)).toHaveLength(2);
  });
});
