import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CanonicalGatewayIdentity } from '../../src/identity/canonical-gateway-identity';
import { IdentityResolutionError } from '../../src/integration-registry/canonical-identity-resolver.service';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import type { VerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';

const root = resolve(__dirname, '../../../..');
const clientPath = join(root, 'apps/gateway/src/backend-client/gateway-backend-client.service.ts');
const handlerPath = join(root, 'apps/gateway/src/backend-client/gateway-trust-chain.handler.ts');
const dtoPath = join(root, 'src/assistant/dto/assistant.dto.ts');

type HistoryQuery = Readonly<{ limit?: string; cursor?: string; order?: 'asc' }>;
type ReadInput = Readonly<{ requestId: string; traceparent?: string }>;
type Client = Readonly<{
  getSession(identity: CanonicalGatewayIdentity, sessionId: string, input: ReadInput): Promise<unknown>;
  getSessionMessages(identity: CanonicalGatewayIdentity, sessionId: string, query: HistoryQuery, input: ReadInput): Promise<unknown>;
}>;
type ClientConstructor = new (dependencies: Readonly<{
  backendBaseUrl: string;
  timeoutMilliseconds: number;
  internalTokenIssuer: Readonly<{ issue(identity: CanonicalGatewayIdentity): Promise<string> }>;
  fetch(url: string, init: Readonly<{ method: string; headers: Record<string, string>; signal: AbortSignal; body?: string }>): Promise<unknown>;
  createTimeoutSignal(milliseconds: number): AbortSignal;
  createAbortController(): AbortController;
}>) => Client;
type Handler = Readonly<{
  getSession(input: Readonly<{ authorization?: string; sessionId: string; requestId: string; traceparent?: string }>): Promise<unknown>;
  getSessionMessages(input: Readonly<{ authorization?: string; sessionId: string; query: HistoryQuery; requestId: string; traceparent?: string }>): Promise<unknown>;
}>;
type HandlerConstructor = new (dependencies: Readonly<{
  upstreamTokenVerifier: Readonly<{ verify(input: Readonly<{ authorization?: string }>): Promise<VerifiedUpstreamIdentity> }>;
  canonicalIdentityResolver: Readonly<{ resolve(input: Readonly<{ identity: VerifiedUpstreamIdentity; requestId: string }>): Promise<CanonicalGatewayIdentity> }>;
  gatewayBackendClient: Client;
}>) => Handler;

const canonicalIdentity: CanonicalGatewayIdentity = Object.freeze({ customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze(['planner']), permissionScopes: Object.freeze(['orders:read']) });
const verifiedIdentity: VerifiedUpstreamIdentity = Object.freeze({ integrationId: 'integration-a', subject: 'actor-a', organizationId: 'org-a', hostApp: 'admin', roles: Object.freeze(['planner']), permissionScopes: Object.freeze(['orders:read']) });

describe('Gateway Assistant read/restore contracts', () => {
  it('locks Backend history query support to limit, cursor, and ascending order only', () => {
    const source = readFileSync(dtoPath, 'utf8');
    const body = /export class AssistantMessageHistoryQueryDto\s*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    expect([...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\??\s*:/gm)].map((match) => match[1])).toEqual(['limit', 'cursor', 'order']);
    expect(body).toContain("@IsIn(['asc'])");
  });

  it('uses fixed encoded session and history paths, fresh internal credentials, no GET body, and only allowlisted query', async () => {
    const harness = createClientHarness(['read-token-1', 'read-token-2']);
    await harness.client.getSession(canonicalIdentity, '../session-a?customerId=customer-b', { requestId: 'read-session', traceparent: 'trace-a' });
    await harness.client.getSessionMessages(canonicalIdentity, 'session-a', { limit: '1', cursor: 'cursor-a', order: 'asc' }, { requestId: 'read-history' });

    expect(harness.calls).toHaveLength(2);
    expect(harness.calls[0].url).toBe('https://backend.internal.test/api/v1/assistant/sessions/..%2Fsession-a%3FcustomerId%3Dcustomer-b');
    expect(harness.calls[0].init.method).toBe('GET');
    expect(harness.calls[0].init.body).toBeUndefined();
    expect(harness.calls[0].init.headers).toEqual({ authorization: 'Bearer read-token-1', accept: 'application/json', 'x-request-id': 'read-session', traceparent: 'trace-a' });
    expect(harness.calls[1].url).toBe('https://backend.internal.test/api/v1/assistant/sessions/session-a/messages?limit=1&cursor=cursor-a&order=asc');
    expect(harness.calls[1].init.method).toBe('GET');
    expect(harness.calls[1].init.body).toBeUndefined();
    expect(harness.calls[1].init.headers).toEqual({ authorization: 'Bearer read-token-2', accept: 'application/json', 'x-request-id': 'read-history' });
    expect(harness.issuerIdentities).toEqual([canonicalIdentity, canonicalIdentity]);
    expect(harness.timeoutCalls).toEqual([5000, 5000]);
    expect(JSON.stringify(harness.calls)).not.toMatch(/customer-a|integration-a|actor-a|org-a|hostApp|roles|permissionScopes/i);
  });

  it.each([
    [{ customerId: 'customer-b' }],
    [{ limit: '1', unknown: 'value' }],
    [{ order: 'desc' }]
  ])('rejects non-allowlisted or invalid history query before issuing or fetching', async (query) => {
    const harness = createClientHarness(['never-issued']);
    await expect(harness.client.getSessionMessages(canonicalIdentity, 'session-a', query as HistoryQuery, { requestId: 'invalid-query' })).rejects.toMatchObject({ statusCode: 503, code: 'BACKEND_UNAVAILABLE' });
    expect(harness.issuerIdentities).toEqual([]);
    expect(harness.calls).toEqual([]);
  });

  it('only preserves a safe Backend not-found envelope and maps malformed or 5xx failures to Backend unavailable', async () => {
    const safeNotFound = { requestId: 'read-not-found', error: { code: 'NOT_FOUND', message: 'Assistant session not found.' } };
    const safe = createClientHarness(['read-token-1'], async () => ({ ok: false, status: 404, json: async () => safeNotFound }));
    await expect(safe.client.getSession(canonicalIdentity, 'missing', { requestId: 'read-not-found' })).resolves.toEqual({ statusCode: 404, body: safeNotFound });
    const malformed = createClientHarness(['read-token-1'], async () => ({ ok: false, status: 404, json: async () => ({ backendDiagnostic: 'secret' }) }));
    await expect(malformed.client.getSession(canonicalIdentity, 'missing', { requestId: 'read-not-found' })).rejects.toMatchObject({ statusCode: 503, code: 'BACKEND_UNAVAILABLE', message: 'Backend is unavailable.' });
    const unavailable = createClientHarness(['read-token-1'], async () => ({ ok: false, status: 500, json: async () => ({ error: 'raw backend failure' }) }));
    await expect(unavailable.client.getSession(canonicalIdentity, 'session-a', { requestId: 'read-failure' })).rejects.toMatchObject({ statusCode: 503, code: 'BACKEND_UNAVAILABLE' });
  });

  it('uses the same verify → resolve → fixed read-client chain and stops after auth or resolution failure', async () => {
    const harness = createHandlerHarness();
    await harness.handler.getSessionMessages({ authorization: 'Bearer upstream', sessionId: 'session-a', query: { limit: '1' }, requestId: 'handler-read' });
    expect(harness.verifyCalls).toEqual([{ authorization: 'Bearer upstream' }]);
    expect(harness.resolveCalls).toEqual([{ identity: verifiedIdentity, requestId: 'handler-read' }]);
    expect(harness.historyCalls).toEqual([{ identity: canonicalIdentity, sessionId: 'session-a', query: { limit: '1' }, input: { requestId: 'handler-read', traceparent: undefined } }]);

    const invalidAuth = createHandlerHarness({ verifyFailure: new UpstreamAuthenticationError('invalid_signature') });
    await expect(invalidAuth.handler.getSession({ authorization: 'Bearer invalid', sessionId: 'session-a', requestId: 'auth-stop' })).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID' });
    expect(invalidAuth.resolveCalls).toEqual([]);
    expect(invalidAuth.sessionCalls).toEqual([]);

    const invalidBinding = createHandlerHarness({ resolveFailure: new IdentityResolutionError('unknown_binding') });
    await expect(invalidBinding.handler.getSession({ authorization: 'Bearer upstream', sessionId: 'session-a', requestId: 'binding-stop' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
    expect(invalidBinding.sessionCalls).toEqual([]);
  });
});

function createClientHarness(tokens: readonly string[], implementation?: (url: string) => Promise<unknown>) {
  const ClientImplementation = loadClient();
  const calls: Array<{ url: string; init: Readonly<{ method: string; headers: Record<string, string>; signal: AbortSignal; body?: string }> }> = [];
  const timeoutCalls: number[] = [];
  const issuerIdentities: CanonicalGatewayIdentity[] = [];
  let tokenIndex = 0;
  const client = new ClientImplementation({
    backendBaseUrl: 'https://backend.internal.test', timeoutMilliseconds: 5000,
    internalTokenIssuer: { issue: async (identity) => { issuerIdentities.push(identity); return tokens[tokenIndex++] ?? 'exhausted'; } },
    fetch: async (url, init) => { calls.push({ url, init }); return implementation ? implementation(url) : { ok: true, status: 200, json: async () => ({ requestId: 'read-ok', data: {} }) }; },
    createTimeoutSignal: (milliseconds) => { timeoutCalls.push(milliseconds); return new AbortController().signal; },
    createAbortController: () => new AbortController()
  });
  return { client, calls, timeoutCalls, issuerIdentities };
}

function createHandlerHarness(options: Readonly<{ verifyFailure?: Error; resolveFailure?: Error }> = {}) {
  const HandlerImplementation = loadHandler();
  const verifyCalls: Array<Readonly<{ authorization?: string }>> = [];
  const resolveCalls: Array<Readonly<{ identity: VerifiedUpstreamIdentity; requestId: string }>> = [];
  const sessionCalls: unknown[] = [];
  const historyCalls: unknown[] = [];
  const handler = new HandlerImplementation({
    upstreamTokenVerifier: { verify: async (input) => { verifyCalls.push(input); if (options.verifyFailure) throw options.verifyFailure; return verifiedIdentity; } },
    canonicalIdentityResolver: { resolve: async (input) => { resolveCalls.push(input); if (options.resolveFailure) throw options.resolveFailure; return canonicalIdentity; } },
    gatewayBackendClient: {
      getSession: async (identity, sessionId, input) => { sessionCalls.push({ identity, sessionId, input }); return { statusCode: 200, body: {} }; },
      getSessionMessages: async (identity, sessionId, query, input) => { historyCalls.push({ identity, sessionId, query, input }); return { statusCode: 200, body: {} }; }
    }
  });
  return { handler, verifyCalls, resolveCalls, sessionCalls, historyCalls };
}

function loadClient(): ClientConstructor {
  if (!existsSync(clientPath)) throw new Error('GatewayBackendClient production surface missing.');
  const value = require(clientPath) as { GatewayBackendClient?: ClientConstructor };
  if (!value.GatewayBackendClient) throw new Error('GatewayBackendClient production surface missing.');
  return value.GatewayBackendClient;
}

function loadHandler(): HandlerConstructor {
  const value = require(handlerPath) as { GatewayTrustChainHandler?: HandlerConstructor };
  if (!value.GatewayTrustChainHandler) throw new Error('Gateway trust-chain handler production surface missing.');
  return value.GatewayTrustChainHandler;
}
