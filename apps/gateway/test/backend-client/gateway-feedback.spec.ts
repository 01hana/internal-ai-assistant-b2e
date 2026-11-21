import { EventEmitter } from 'node:events';
import { HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { GatewayBackendClient } from '../../src/backend-client/gateway-backend-client.service';
import { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import type { CanonicalGatewayIdentity } from '../../src/identity/canonical-gateway-identity';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import type { VerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';
import { GatewayAssistantController } from '../../src/operations/gateway-assistant.controller';

/** Feedback on an Assistant answer through the fixed Gateway operation. */
const canonicalIdentity: CanonicalGatewayIdentity = Object.freeze({ customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze(['planner']), permissionScopes: Object.freeze(['orders:read']) });
const verifiedIdentity: VerifiedUpstreamIdentity = Object.freeze({ integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze(['planner']), permissionScopes: Object.freeze(['orders:read']) });
const accepted = { requestId: 'fb-1', data: { feedbackEventId: 'fe-1', messageId: 'm-1', rating: 'negative', intent: null, reviewItemId: 'ri-1' } };

describe('GatewayBackendClient feedback', () => {
  it('posts only the allowed feedback fields as JSON on the fixed encoded path with a fresh credential', async () => {
    const harness = createClientHarness();
    const result = await harness.client.submitFeedback(canonicalIdentity, '../m-1?customerId=customer-b', { rating: 'negative', reason: '答非所問', comment: '數字不對' }, { requestId: 'fb-1', traceparent: 'trace-a' });

    expect(result).toEqual({ statusCode: 201, body: accepted });
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].url).toBe('https://backend.internal.test/api/v1/assistant/messages/..%2Fm-1%3FcustomerId%3Dcustomer-b/feedback');
    expect(harness.calls[0].init.method).toBe('POST');
    expect(JSON.parse(harness.calls[0].init.body!)).toEqual({ rating: 'negative', reason: '答非所問', comment: '數字不對' });
    expect(harness.calls[0].init.headers).toEqual({ authorization: 'Bearer token-1', accept: 'application/json', 'content-type': 'application/json', 'x-request-id': 'fb-1', traceparent: 'trace-a' });
    expect(JSON.stringify(harness.calls)).not.toMatch(/customer-a|integration-a|actor-a|org-a|permissionScopes/i);
  });

  it.each([
    [{ rating: 'great' }],
    [{ rating: 'positive', customerId: 'customer-b' }],
    [{ rating: 'positive', intent: 'spam' }],
    [{ rating: 'positive', reason: 'x'.repeat(161) }],
    [{ rating: 'positive', comment: 'x'.repeat(1001) }]
  ])('rejects %j before issuing a credential or fetching', async (feedback) => {
    const harness = createClientHarness();
    await expect(harness.client.submitFeedback(canonicalIdentity, 'm-1', feedback as never, { requestId: 'bad' })).rejects.toMatchObject({ statusCode: 503, code: 'BACKEND_UNAVAILABLE' });
    expect(harness.issued).toBe(0);
    expect(harness.calls).toEqual([]);
  });

  it('passes safe 400 and 404 failures through and maps 5xx to Backend unavailable', async () => {
    const notAnswer = { requestId: 'fb-400', error: { code: 'BAD_REQUEST', message: 'Feedback can only be submitted for assistant messages.' } };
    const badRequest = createClientHarness(async () => ({ ok: false, status: 400, json: async () => notAnswer }));
    await expect(badRequest.client.submitFeedback(canonicalIdentity, 'm-1', { rating: 'positive' }, { requestId: 'fb-400' })).resolves.toEqual({ statusCode: 400, body: notAnswer });

    const missing = { requestId: 'fb-404', error: { code: 'NOT_FOUND', message: 'Feedback resource not found.' } };
    const notFound = createClientHarness(async () => ({ ok: false, status: 404, json: async () => missing }));
    await expect(notFound.client.submitFeedback(canonicalIdentity, 'm-1', { rating: 'positive' }, { requestId: 'fb-404' })).resolves.toEqual({ statusCode: 404, body: missing });

    const failure = createClientHarness(async () => ({ ok: false, status: 500, json: async () => ({ error: 'raw' }) }));
    await expect(failure.client.submitFeedback(canonicalIdentity, 'm-1', { rating: 'positive' }, { requestId: 'fb-500' })).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('GatewayTrustChainHandler feedback', () => {
  it('runs verify → resolve → fixed client', async () => {
    const harness = createHandlerHarness();
    await harness.handler.submitFeedback({ authorization: 'Bearer upstream', messageId: 'm-1', feedback: { rating: 'positive' }, requestId: 'handler-fb' });
    expect(harness.verifyCalls).toHaveLength(1);
    expect(harness.clientCalls).toEqual([{ identity: canonicalIdentity, messageId: 'm-1', feedback: { rating: 'positive' }, input: { requestId: 'handler-fb', traceparent: undefined } }]);
  });

  it('stops before the client when authentication fails or the input is malformed', async () => {
    const failing = createHandlerHarness(new UpstreamAuthenticationError('invalid_signature'));
    await expect(failing.handler.submitFeedback({ authorization: 'Bearer bad', messageId: 'm-1', feedback: { rating: 'positive' }, requestId: 'auth' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
    expect(failing.clientCalls).toEqual([]);

    const harness = createHandlerHarness();
    await expect(harness.handler.submitFeedback({ messageId: ' ', feedback: { rating: 'positive' }, requestId: 'bad' })).rejects.toThrow('Gateway trust-chain input is invalid.');
    await expect(harness.handler.submitFeedback({ messageId: 'm-1', feedback: { rating: 'bad' } as never, requestId: 'bad' })).rejects.toThrow('Gateway trust-chain input is invalid.');
    expect(harness.verifyCalls).toEqual([]);
  });
});

describe('GatewayAssistantController feedback', () => {
  it('delegates the feedback and writes the Backend status and body unchanged', async () => {
    const handler = { submitFeedback: jest.fn(async () => ({ statusCode: 201, body: accepted })) } as unknown as GatewayTrustChainHandler;
    const response = new TestResponse();
    await new GatewayAssistantController(handler).submitFeedback('Bearer upstream-token', 'gateway-fb', undefined, 'm-1', {}, { rating: 'negative', intent: 'not_helpful' }, response as unknown as Response);

    expect(handler.submitFeedback).toHaveBeenCalledWith({ authorization: 'Bearer upstream-token', messageId: 'm-1', feedback: { rating: 'negative', intent: 'not_helpful' }, requestId: 'gateway-fb', traceparent: undefined });
    expect(response.statusCode).toBe(201);
    expect(response.sent).toEqual(accepted);
  });

  it.each([
    [{}, undefined],
    [{}, { rating: 'positive', sessionId: 's-1' }],
    [{}, { rating: 1 }],
    [{ customerId: 'customer-b' }, { rating: 'positive' }]
  ])('rejects query %j or body %j before trust-chain work', async (query, body) => {
    const handler = { submitFeedback: jest.fn() } as unknown as GatewayTrustChainHandler;
    await expect(new GatewayAssistantController(handler).submitFeedback('Bearer t', 'a', undefined, 'm-1', query, body, new TestResponse() as unknown as Response))
      .rejects.toBeInstanceOf(HttpException);
    expect(handler.submitFeedback).not.toHaveBeenCalled();
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
      return implementation ? implementation(url) : { ok: true, status: 201, json: async () => accepted };
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
      submitFeedback: async (identity: unknown, messageId: unknown, feedback: unknown, input: unknown) => { clientCalls.push({ identity, messageId, feedback, input }); return { statusCode: 201, body: {} }; }
    } as never
  });
  return { handler, verifyCalls, clientCalls };
}
