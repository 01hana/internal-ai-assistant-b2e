import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { redactSecrets } from '../../../../src/common/logger/redaction.util';
import type { CanonicalGatewayIdentity } from '../../src/identity/canonical-gateway-identity';

const repositoryRoot = resolve(__dirname, '../../../..');
const clientPath = join(repositoryRoot, 'apps/gateway/src/backend-client/gateway-backend-client.service.ts');
const internalJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJjdXN0b21lcl9pZCI6ImN1c3RvbWVyLWEifQ.internal-jwt-secret-sentinel';
const upstreamCredential = 'upstream-secret-sentinel';
const backendUrl = 'https://backend.internal.test/private-backend-url-sentinel';

type CreateSessionInput = Readonly<{
  pageContext?: Readonly<Record<string, unknown>>;
  requestId?: string;
  traceparent?: string;
}>;

type SendStreamMessageInput = Readonly<{
  message: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId?: string;
  traceparent?: string;
}>;

type FetchCall = Readonly<{
  url: string;
  init: Readonly<{
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }>;
}>;
type FetchDouble = (url: string, init: FetchCall['init']) => Promise<unknown>;
type GatewayBackendClient = Readonly<{
  createSession(identity: CanonicalGatewayIdentity, input: CreateSessionInput): Promise<unknown>;
  sendStreamMessage(identity: CanonicalGatewayIdentity, sessionId: string, input: SendStreamMessageInput): Promise<ReadableStream<Uint8Array>>;
}>;
type GatewayBackendClientConstructor = new (dependencies: Readonly<{
  backendBaseUrl: string;
  timeoutMilliseconds: number;
  internalTokenIssuer: Readonly<{ issue(identity: CanonicalGatewayIdentity): Promise<string> }>;
  fetch: FetchDouble;
  createTimeoutSignal(milliseconds: number): AbortSignal;
  createAbortController(): AbortController;
}>) => GatewayBackendClient;

const customerAIdentity: CanonicalGatewayIdentity = Object.freeze({
  customerId: 'customer-a',
  integrationId: 'integration-a',
  subject: 'actor-shared',
  organizationId: 'org-shared',
  hostApp: 'admin',
  roles: Object.freeze(['planner']),
  permissionScopes: Object.freeze(['orders:read'])
});

const createSessionInput = Object.freeze({
  pageContext: Object.freeze({ module: 'orders', route: '/orders/SO-10001' }),
  requestId: 'gateway-security-json-request',
  traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
});

const sendStreamMessageInput = Object.freeze({
  message: 'Summarize order SO-10001.',
  pageContext: Object.freeze({ module: 'orders', route: '/orders/SO-10001' }),
  requestId: 'gateway-security-sse-request',
  traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
});

describe('GatewayBackendClient transport security contract (T065)', () => {
  it('keeps internal and upstream credentials out of existing safe response, logger, audit, and SSE-like projections', () => {
    const projected = redactSecrets({
      response: { authorization: `Bearer ${internalJwt}`, upstreamToken: upstreamCredential },
      error: new Error(`backend failure ${internalJwt} ${upstreamCredential} ${backendUrl}`),
      loggerMetadata: { authorization: `Bearer ${internalJwt}`, credential: upstreamCredential },
      auditMetadata: { token: internalJwt, authorization: `Bearer ${upstreamCredential}` },
      sseLikeChunk: { data: { authorization: `Bearer ${internalJwt}`, credential: upstreamCredential } }
    });

    const serialized = JSON.stringify(projected);
    [internalJwt, upstreamCredential, backendUrl].forEach((sentinel) => expect(serialized).not.toContain(sentinel));
  });

  it('rebuilds JSON Backend headers from the Gateway allowlist with one fresh internal Authorization owner', async () => {
    const harness = createSecurityHarness(['internal-token-json']);
    await harness.client.createSession(customerAIdentity, createSessionInput);

    expect(harness.issuerIdentities).toEqual([customerAIdentity]);
    expect(harness.issuerIdentities[0]).toBe(customerAIdentity);
    expect(harness.fetchCalls).toEqual([
      expect.objectContaining({
        url: 'https://backend.internal.test/api/v1/assistant/sessions',
        init: expect.objectContaining({
          headers: {
            authorization: 'Bearer internal-token-json',
            'content-type': 'application/json',
            accept: 'application/json',
            'x-request-id': createSessionInput.requestId,
            traceparent: createSessionInput.traceparent
          }
        })
      })
    ]);
  });

  it('rebuilds SSE Backend headers from the Gateway allowlist and never returns an internal token in a chunk', async () => {
    const harness = createSecurityHarness(['internal-token-sse'], async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: answer_delta\ndata: safe\n\n'));
          controller.close();
        }
      })
    }));
    const stream = await harness.client.sendStreamMessage(customerAIdentity, 'session-owned-001', sendStreamMessageInput);
    const result = await stream.getReader().read();

    expect(harness.issuerIdentities).toEqual([customerAIdentity]);
    expect(harness.issuerIdentities[0]).toBe(customerAIdentity);
    expect(harness.fetchCalls[0]).toEqual(expect.objectContaining({
      url: 'https://backend.internal.test/api/v1/assistant/sessions/session-owned-001/messages',
      init: expect.objectContaining({
        headers: {
          authorization: 'Bearer internal-token-sse',
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'x-request-id': sendStreamMessageInput.requestId,
          traceparent: sendStreamMessageInput.traceparent
        }
      })
    }));
    expect(new TextDecoder().decode(result.value)).not.toContain('internal-token-sse');
  });

  it.each([
    ['headers', { Authorization: `Bearer ${upstreamCredential}`, Cookie: 'host-session-secret' }],
    ['authorization', `Bearer ${upstreamCredential}`],
    ['cookie', 'host-session-secret'],
    ['backendUrl', 'https://attacker.invalid'],
    ['destination', 'https://attacker.invalid'],
    ['url', 'https://attacker.invalid'],
    ['path', '/admin'],
    ['method', 'GET'],
    ['token', internalJwt],
    ['kid', 'caller-kid'],
    ['Authorization', `Bearer ${upstreamCredential}`],
    ['Cookie', 'host-session-secret'],
    ['x-customer-id', 'customer-b'],
    ['x-integration-id', 'integration-b'],
    ['x-org-id', 'org-attacker'],
    ['x-user-id', 'actor-attacker'],
    ['x-host-app', 'host-attacker'],
    ['host', 'attacker.invalid'],
    ['forwarded', 'host=attacker.invalid'],
    ['x-forwarded-host', 'attacker.invalid'],
    ['x-backend-url', 'https://attacker.invalid'],
    ['x-target-url', 'https://attacker.invalid'],
    ['customerId', 'customer-b'],
    ['integrationId', 'integration-b']
  ])('rejects JSON caller-supplied %s before issuing or attempting transport', async (field, value) => {
    const harness = createSecurityHarness(['never-issued']);
    const input = { ...createSessionInput, [field]: value } as unknown as CreateSessionInput;

    await expect(harness.client.createSession(customerAIdentity, input)).rejects.toThrow();
    expect(harness.issuerCalls).toBe(0);
    expect(harness.fetchCalls).toEqual([]);
  });

  it.each([
    ['headers', { Authorization: `Bearer ${upstreamCredential}`, Cookie: 'host-session-secret' }],
    ['authorization', `Bearer ${upstreamCredential}`],
    ['cookie', 'host-session-secret'],
    ['customerId', 'customer-b'],
    ['integrationId', 'integration-b'],
    ['x-customer-id', 'customer-b'],
    ['x-integration-id', 'integration-b']
  ])('rejects SSE caller-supplied %s before issuing or attempting transport', async (field, value) => {
    const harness = createSecurityHarness(['never-issued']);
    const input = { ...sendStreamMessageInput, [field]: value } as unknown as SendStreamMessageInput;

    await expect(harness.client.sendStreamMessage(customerAIdentity, 'session-owned-001', input)).rejects.toThrow();
    expect(harness.issuerCalls).toBe(0);
    expect(harness.fetchCalls).toEqual([]);
  });

  it('maps a raw JSON Backend failure to the safe projection without credential, token, or URL disclosure', async () => {
    const harness = createSecurityHarness(['internal-token-json'], async () => {
      throw new Error(`raw backend failure ${internalJwt} ${upstreamCredential} ${backendUrl}`);
    });

    let failure: unknown;
    try {
      await harness.client.createSession(customerAIdentity, createSessionInput);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      statusCode: 503,
      code: 'BACKEND_UNAVAILABLE',
      message: 'Backend is unavailable.'
    });
    expect(JSON.stringify(failure)).not.toMatch(new RegExp(`${internalJwt}|${upstreamCredential}|${backendUrl}`));
    expect(harness.issuerCalls).toBe(1);
    expect(harness.fetchCalls).toHaveLength(1);
  });

  it('maps a raw SSE Backend failure to the safe projection without internal or upstream credential disclosure', async () => {
    const harness = createSecurityHarness(['internal-token-sse'], async () => {
      throw new Error(`raw backend stream failure ${internalJwt} ${upstreamCredential} ${backendUrl}`);
    });

    await expect(harness.client.sendStreamMessage(customerAIdentity, 'session-owned-001', sendStreamMessageInput)).rejects.toMatchObject({
      statusCode: 503,
      code: 'BACKEND_UNAVAILABLE',
      message: 'Backend is unavailable.'
    });
    expect(harness.issuerCalls).toBe(1);
    expect(harness.fetchCalls).toHaveLength(1);
  });

  it('maps a post-response SSE source error to the safe projection without credential or URL disclosure', async () => {
    let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const harness = createSecurityHarness(['internal-token-sse'], async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          sourceController = controller;
        }
      })
    }));
    const stream = await harness.client.sendStreamMessage(customerAIdentity, 'session-owned-001', sendStreamMessageInput);
    const reader = stream.getReader();
    sourceController?.error(new Error(`post-response source failure ${internalJwt} ${upstreamCredential} ${backendUrl}`));

    let failure: unknown;
    try {
      await reader.read();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      statusCode: 503,
      code: 'BACKEND_UNAVAILABLE',
      message: 'Backend is unavailable.'
    });
    expect(JSON.stringify(failure)).not.toMatch(new RegExp(`${internalJwt}|${upstreamCredential}|${backendUrl}`));
    expect(harness.abortController.signal.aborted).toBe(true);
    expect(harness.issuerCalls).toBe(1);
    expect(harness.fetchCalls).toHaveLength(1);
  });
});

function createSecurityHarness(tokens: readonly string[], fetchImplementation?: FetchDouble): Readonly<{
  client: GatewayBackendClient;
  fetchCalls: FetchCall[];
  issuerCalls: number;
  issuerIdentities: CanonicalGatewayIdentity[];
  abortController: AbortController;
}> {
  const GatewayBackendClientImplementation = loadGatewayBackendClient();
  const fetchCalls: FetchCall[] = [];
  const abortController = new AbortController();
  let issuerCalls = 0;
  const issuerIdentities: CanonicalGatewayIdentity[] = [];
  const internalTokenIssuer = {
    async issue(identity: CanonicalGatewayIdentity) {
      issuerIdentities.push(identity);
      const token = tokens[issuerCalls];
      issuerCalls += 1;
      if (!token) throw new Error('test token sequence exhausted');
      return token;
    }
  };
  const fetch: FetchDouble = async (url, init) => {
    fetchCalls.push({ url, init });
    if (fetchImplementation) return fetchImplementation(url, init);
    return { ok: true, status: 201, json: async () => ({}) };
  };
  const client = new GatewayBackendClientImplementation({
    backendBaseUrl: 'https://backend.internal.test',
    timeoutMilliseconds: 5_000,
    internalTokenIssuer,
    fetch,
    createTimeoutSignal: () => new AbortController().signal,
    createAbortController: () => abortController
  });

  return Object.freeze({
    client,
    fetchCalls,
    get issuerCalls() { return issuerCalls; },
    issuerIdentities,
    abortController
  });
}

function loadGatewayBackendClient(): GatewayBackendClientConstructor {
  if (!existsSync(clientPath)) throw new Error('GatewayBackendClient production surface missing.');
  const target = require(clientPath) as { GatewayBackendClient?: GatewayBackendClientConstructor };
  if (!target.GatewayBackendClient) throw new Error('GatewayBackendClient production surface missing.');
  return target.GatewayBackendClient;
}
