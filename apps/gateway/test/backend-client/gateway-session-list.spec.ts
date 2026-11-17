import { EventEmitter } from 'node:events';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { GatewayBackendClient } from '../../src/backend-client/gateway-backend-client.service';
import type { GatewaySessionListQuery } from '../../src/backend-client/gateway-backend-client.service';
import { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import type { CanonicalGatewayIdentity } from '../../src/identity/canonical-gateway-identity';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import type { VerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';
import { GatewayAssistantController } from '../../src/operations/gateway-assistant.controller';

/** Feature 013 US4 (T043): fixed Gateway operations for the session list and archive. */
const canonicalIdentity: CanonicalGatewayIdentity = Object.freeze({ customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze(['planner']), permissionScopes: Object.freeze(['orders:read']) });
const verifiedIdentity: VerifiedUpstreamIdentity = Object.freeze({ integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze(['planner']), permissionScopes: Object.freeze(['orders:read']) });

describe('GatewayBackendClient session list and archive (Feature 013 T043)', () => {
  it('lists sessions on the fixed path with only limit and cursor, a fresh credential and no body', async () => {
    const harness = createClientHarness();
    await harness.client.listSessions(canonicalIdentity, { limit: '20', cursor: 'eyJ0IjoiMjAyNiJ9_-' }, { requestId: 'list-1', traceparent: 'trace-a' });

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].url).toBe('https://backend.internal.test/api/v1/assistant/sessions?limit=20&cursor=eyJ0IjoiMjAyNiJ9_-');
    expect(harness.calls[0].init.method).toBe('GET');
    expect(harness.calls[0].init.body).toBeUndefined();
    expect(harness.calls[0].init.headers).toEqual({ authorization: 'Bearer token-1', accept: 'application/json', 'x-request-id': 'list-1', traceparent: 'trace-a' });
    expect(JSON.stringify(harness.calls)).not.toMatch(/customer-a|integration-a|actor-a|org-a|permissionScopes/i);
  });

  it('archives on the fixed encoded path with POST and no body', async () => {
    const harness = createClientHarness();
    await harness.client.archiveSession(canonicalIdentity, '../session-a?customerId=customer-b', { requestId: 'archive-1' });

    expect(harness.calls[0].url).toBe('https://backend.internal.test/api/v1/assistant/sessions/..%2Fsession-a%3FcustomerId%3Dcustomer-b/archive');
    expect(harness.calls[0].init.method).toBe('POST');
    expect(harness.calls[0].init.body).toBeUndefined();
  });

  it('lists archived sessions with status=archived only', async () => {
    const harness = createClientHarness();
    await harness.client.listSessions(canonicalIdentity, { status: 'archived' }, { requestId: 'list-archived' });
    expect(harness.calls[0].url).toBe('https://backend.internal.test/api/v1/assistant/sessions?status=archived');
  });

  it('unarchives with POST and deletes with DELETE on fixed encoded paths, without a body', async () => {
    const harness = createClientHarness();
    await harness.client.unarchiveSession(canonicalIdentity, 's/1', { requestId: 'unarchive-1' });
    await harness.client.deleteSession(canonicalIdentity, 's/1', { requestId: 'delete-1' });
    expect(harness.calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      'POST https://backend.internal.test/api/v1/assistant/sessions/s%2F1/unarchive',
      'DELETE https://backend.internal.test/api/v1/assistant/sessions/s%2F1'
    ]);
    expect(harness.calls.every((call) => call.init.body === undefined)).toBe(true);
  });

  it('passes a safe 404 through for unarchive and delete', async () => {
    const notFound = { requestId: 'gone', error: { code: 'NOT_FOUND', message: 'Assistant session not found.' } };
    const harness = createClientHarness(async () => ({ ok: false, status: 404, json: async () => notFound }));
    await expect(harness.client.unarchiveSession(canonicalIdentity, 'gone', { requestId: 'gone' })).resolves.toEqual({ statusCode: 404, body: notFound });
    await expect(harness.client.deleteSession(canonicalIdentity, 'gone', { requestId: 'gone' })).resolves.toEqual({ statusCode: 404, body: notFound });
  });

  it.each([
    [{ customerId: 'customer-b' }],
    [{ limit: '20', order: 'asc' }],
    [{ status: 'deleted' }],
    [{ limit: '-1' }],
    [{ limit: '1000' }],
    [{ cursor: 'has space' }],
    [{ cursor: 'a'.repeat(201) }]
  ])('rejects a non-allowlisted or malformed list query %j before issuing or fetching', async (query) => {
    const harness = createClientHarness();
    await expect(harness.client.listSessions(canonicalIdentity, query as GatewaySessionListQuery, { requestId: 'invalid' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'BACKEND_UNAVAILABLE' });
    expect(harness.issued).toBe(0);
    expect(harness.calls).toEqual([]);
  });

  it('passes a safe Backend 400 through for the list (bad cursor or limit) but not for archive', async () => {
    const badRequest = { requestId: 'list-bad', error: { code: 'BAD_REQUEST', message: 'Invalid cursor.' } };
    const list = createClientHarness(async () => ({ ok: false, status: 400, json: async () => badRequest }));
    await expect(list.client.listSessions(canonicalIdentity, { cursor: 'abc' }, { requestId: 'list-bad' })).resolves.toEqual({ statusCode: 400, body: badRequest });

    const archive = createClientHarness(async () => ({ ok: false, status: 400, json: async () => badRequest }));
    await expect(archive.client.archiveSession(canonicalIdentity, 'session-a', { requestId: 'archive-bad' })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('passes a safe 404 through for archive and maps malformed or 5xx failures to Backend unavailable', async () => {
    const notFound = { requestId: 'archive-missing', error: { code: 'NOT_FOUND', message: 'Assistant session not found.' } };
    const safe = createClientHarness(async () => ({ ok: false, status: 404, json: async () => notFound }));
    await expect(safe.client.archiveSession(canonicalIdentity, 'missing', { requestId: 'archive-missing' })).resolves.toEqual({ statusCode: 404, body: notFound });

    const malformed = createClientHarness(async () => ({ ok: false, status: 400, json: async () => ({ diagnostic: 'secret' }) }));
    await expect(malformed.client.listSessions(canonicalIdentity, {}, { requestId: 'list-malformed' })).rejects.toMatchObject({ statusCode: 503 });

    const failure = createClientHarness(async () => ({ ok: false, status: 500, json: async () => ({ error: 'raw' }) }));
    await expect(failure.client.listSessions(canonicalIdentity, {}, { requestId: 'list-500' })).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('GatewayTrustChainHandler session list and archive (Feature 013 T043)', () => {
  it('runs verify → resolve → fixed client for list and archive', async () => {
    const harness = createHandlerHarness();
    await harness.handler.listSessions({ authorization: 'Bearer upstream', query: { limit: '5' }, requestId: 'handler-list' });
    await harness.handler.archiveSession({ authorization: 'Bearer upstream', sessionId: 'session-a', requestId: 'handler-archive' });

    expect(harness.verifyCalls).toHaveLength(2);
    expect(harness.clientCalls).toEqual([
      { operation: 'list', identity: canonicalIdentity, query: { limit: '5' }, input: { requestId: 'handler-list', traceparent: undefined } },
      { operation: 'archive', identity: canonicalIdentity, sessionId: 'session-a', input: { requestId: 'handler-archive', traceparent: undefined } }
    ]);
  });

  it('stops before the client when upstream authentication fails', async () => {
    const harness = createHandlerHarness(new UpstreamAuthenticationError('invalid_signature'));
    await expect(harness.handler.listSessions({ authorization: 'Bearer invalid', query: {}, requestId: 'auth-stop' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    await expect(harness.handler.archiveSession({ authorization: 'Bearer invalid', sessionId: 'session-a', requestId: 'auth-stop' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    expect(harness.clientCalls).toEqual([]);
  });

  it('rejects malformed handler input without any trust-chain work', async () => {
    const harness = createHandlerHarness();
    await expect(harness.handler.listSessions({ query: { limit: 'x' }, requestId: 'bad' } as never)).rejects.toThrow('Gateway trust-chain input is invalid.');
    await expect(harness.handler.archiveSession({ sessionId: ' ', requestId: 'bad' })).rejects.toThrow('Gateway trust-chain input is invalid.');
    expect(harness.verifyCalls).toEqual([]);
  });
});

describe('GatewayAssistantController session list and archive (Feature 013 T043)', () => {
  it('delegates the list query and writes the Backend status and body unchanged', async () => {
    const body = { sessions: [{ sessionId: 'session-a', title: '你好', createdAt: '2026-11-16T00:00:00.000Z', lastMessageAt: '2026-11-16T00:01:00.000Z' }], nextCursor: null };
    const handler = { listSessions: jest.fn(async () => ({ statusCode: 200, body })) } as unknown as GatewayTrustChainHandler;
    const response = new TestResponse();
    await new GatewayAssistantController(handler).listSessions('Bearer upstream-token', 'gateway-list', undefined, { limit: '10', cursor: 'abc_-' }, undefined, response as unknown as Response);

    expect(handler.listSessions).toHaveBeenCalledWith({ authorization: 'Bearer upstream-token', query: { limit: '10', cursor: 'abc_-' }, requestId: 'gateway-list', traceparent: undefined });
    expect(response.statusCode).toBe(200);
    expect(response.sent).toEqual(body);
  });

  it.each([
    [{ customerId: 'customer-b' }],
    [{ limit: 'ten' }],
    [{ cursor: 'not/base64url' }],
    [{ limit: ['1', '2'] }]
  ])('rejects list query %j before trust-chain work', async (query) => {
    const handler = { listSessions: jest.fn() } as unknown as GatewayTrustChainHandler;
    await expect(new GatewayAssistantController(handler).listSessions('Bearer upstream-token', 'gateway-list', undefined, query, undefined, new TestResponse() as unknown as Response))
      .rejects.toBeInstanceOf(HttpException);
    expect(handler.listSessions).not.toHaveBeenCalled();
  });

  it('delegates archive with no body and writes the Backend result', async () => {
    const handler = { archiveSession: jest.fn(async () => ({ statusCode: 200, body: { sessionId: 'session-a', status: 'closed' } })) } as unknown as GatewayTrustChainHandler;
    const response = new TestResponse();
    await new GatewayAssistantController(handler).archiveSession('Bearer upstream-token', 'gateway-archive', undefined, 'session-a', {}, undefined, response as unknown as Response);

    expect(handler.archiveSession).toHaveBeenCalledWith({ authorization: 'Bearer upstream-token', sessionId: 'session-a', requestId: 'gateway-archive', traceparent: undefined });
    expect(response.statusCode).toBe(200);
    expect(response.sent).toEqual({ sessionId: 'session-a', status: 'closed' });
  });

  it('delegates unarchive and delete and writes the Backend result', async () => {
    const handler = {
      unarchiveSession: jest.fn(async () => ({ statusCode: 200, body: { sessionId: 'session-a', status: 'active' } })),
      deleteSession: jest.fn(async () => ({ statusCode: 200, body: { sessionId: 'session-a', status: 'deleted' } }))
    } as unknown as GatewayTrustChainHandler;
    const controller = new GatewayAssistantController(handler);
    const unarchived = new TestResponse();
    await controller.unarchiveSession('Bearer upstream-token', 'gateway-unarchive', undefined, 'session-a', {}, undefined, unarchived as unknown as Response);
    const deleted = new TestResponse();
    await controller.deleteSession('Bearer upstream-token', 'gateway-delete', undefined, 'session-a', {}, undefined, deleted as unknown as Response);

    expect(handler.unarchiveSession).toHaveBeenCalledWith({ authorization: 'Bearer upstream-token', sessionId: 'session-a', requestId: 'gateway-unarchive', traceparent: undefined });
    expect(handler.deleteSession).toHaveBeenCalledWith({ authorization: 'Bearer upstream-token', sessionId: 'session-a', requestId: 'gateway-delete', traceparent: undefined });
    expect([unarchived.sent, deleted.sent]).toEqual([{ sessionId: 'session-a', status: 'active' }, { sessionId: 'session-a', status: 'deleted' }]);
  });

  it('rejects unarchive or delete carrying a body or query before trust-chain work', async () => {
    const handler = { unarchiveSession: jest.fn(), deleteSession: jest.fn() } as unknown as GatewayTrustChainHandler;
    const controller = new GatewayAssistantController(handler);
    await expect(controller.unarchiveSession('Bearer t', 'a', undefined, 'session-a', { force: '1' }, undefined, new TestResponse() as unknown as Response)).rejects.toBeInstanceOf(HttpException);
    await expect(controller.deleteSession('Bearer t', 'a', undefined, 'session-a', {}, { customerId: 'customer-b' }, new TestResponse() as unknown as Response)).rejects.toBeInstanceOf(HttpException);
    expect(handler.unarchiveSession).not.toHaveBeenCalled();
    expect(handler.deleteSession).not.toHaveBeenCalled();
  });

  it('accepts status=archived on the list and rejects other statuses', async () => {
    const handler = { listSessions: jest.fn(async () => ({ statusCode: 200, body: { sessions: [], nextCursor: null } })) } as unknown as GatewayTrustChainHandler;
    const controller = new GatewayAssistantController(handler);
    await controller.listSessions('Bearer t', 'a', undefined, { status: 'archived' }, undefined, new TestResponse() as unknown as Response);
    expect(handler.listSessions).toHaveBeenCalledWith(expect.objectContaining({ query: { status: 'archived' } }));
    await expect(controller.listSessions('Bearer t', 'a', undefined, { status: 'deleted' }, undefined, new TestResponse() as unknown as Response)).rejects.toBeInstanceOf(HttpException);
  });

  it('rejects an archive request carrying a body or query before trust-chain work', async () => {
    const handler = { archiveSession: jest.fn() } as unknown as GatewayTrustChainHandler;
    const controller = new GatewayAssistantController(handler);
    await expect(controller.archiveSession('Bearer upstream-token', 'a', undefined, 'session-a', {}, { customerId: 'customer-b' }, new TestResponse() as unknown as Response)).rejects.toBeInstanceOf(HttpException);
    await expect(controller.archiveSession('Bearer upstream-token', 'a', undefined, 'session-a', { force: '1' }, undefined, new TestResponse() as unknown as Response)).rejects.toBeInstanceOf(HttpException);
    expect(handler.archiveSession).not.toHaveBeenCalled();
  });

  it('projects an upstream authentication failure to the generic 401 envelope', async () => {
    const handler = { listSessions: jest.fn(async () => { throw new UpstreamAuthenticationError('invalid_signature'); }) } as unknown as GatewayTrustChainHandler;
    try {
      await new GatewayAssistantController(handler).listSessions('Bearer bad', 'gateway-list', undefined, {}, undefined, new TestResponse() as unknown as Response);
      throw new Error('Expected HTTP projection.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toEqual({ statusCode: 401, code: 'UPSTREAM_IDENTITY_INVALID', message: 'Upstream identity is invalid.' });
    }
  });
});

class TestResponse extends EventEmitter {
  statusCode: number | undefined;
  sent: unknown;
  status(status: number): this { this.statusCode = status; return this; }
  setHeader(_name: string, _value: string): void { /* body only */ }
  send(value: unknown): void { this.sent = value; }
}

type FetchInit = Readonly<{ method: string; headers: Record<string, string>; signal: AbortSignal; body?: string }>;
type FetchResult = Readonly<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

function createClientHarness(implementation?: (url: string) => Promise<FetchResult>) {
  const calls: Array<{ url: string; init: FetchInit }> = [];
  let issued = 0;
  const client = new GatewayBackendClient({
    backendBaseUrl: 'https://backend.internal.test',
    timeoutMilliseconds: 5000,
    internalTokenIssuer: { issue: async () => `token-${++issued}` },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return implementation ? implementation(url) : { ok: true, status: 200, json: async () => ({ sessions: [], nextCursor: null }) };
    },
    createTimeoutSignal: () => new AbortController().signal,
    createAbortController: () => new AbortController()
  });
  return { client, calls, get issued() { return issued; } };
}

function createHandlerHarness(verifyFailure?: Error) {
  const verifyCalls: unknown[] = [];
  const clientCalls: unknown[] = [];
  const handler = new GatewayTrustChainHandler({
    upstreamTokenVerifier: { verify: async (input: unknown) => { verifyCalls.push(input); if (verifyFailure) throw verifyFailure; return verifiedIdentity; } } as never,
    canonicalIdentityResolver: { resolve: async () => canonicalIdentity },
    gatewayBackendClient: {
      listSessions: async (identity: unknown, query: unknown, input: unknown) => { clientCalls.push({ operation: 'list', identity, query, input }); return { statusCode: 200, body: {} }; },
      archiveSession: async (identity: unknown, sessionId: unknown, input: unknown) => { clientCalls.push({ operation: 'archive', identity, sessionId, input }); return { statusCode: 200, body: {} }; }
    } as never
  });
  return { handler, verifyCalls, clientCalls };
}
