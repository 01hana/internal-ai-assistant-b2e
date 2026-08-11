import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CanonicalGatewayIdentity } from '../../src/identity/canonical-gateway-identity';

const repositoryRoot = resolve(__dirname, '../../../..');
const createSessionDtoPath = join(repositoryRoot, 'src/assistant/dto/assistant.dto.ts');
const sendMessageDtoPath = join(repositoryRoot, 'src/assistant/dto/assistant.dto.ts');
const clientPath = join(repositoryRoot, 'apps/gateway/src/backend-client/gateway-backend-client.service.ts');

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

type TimeoutSignalFactory = (milliseconds: number) => AbortSignal;
type AbortControllerFactory = () => AbortController;
type FetchCall = Readonly<{ url: string; init: Readonly<{ method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }> }>;
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
  createTimeoutSignal: TimeoutSignalFactory;
  createAbortController: AbortControllerFactory;
}>) => GatewayBackendClient;

const createSessionInput = Object.freeze({
  pageContext: Object.freeze({ module: 'orders', route: '/orders/SO-10001', screenId: 'order-detail', entityType: 'order', entityId: 'SO-10001' }),
  requestId: 'gateway-create-session-request',
  traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
});

const canonicalIdentity: CanonicalGatewayIdentity = Object.freeze({
  customerId: 'customer-a',
  integrationId: 'integration-a',
  subject: 'actor-shared',
  organizationId: 'org-shared',
  hostApp: 'admin',
  roles: Object.freeze(['planner']),
  permissionScopes: Object.freeze(['orders:read'])
});

const sendStreamMessageInput = Object.freeze({
  message: 'Summarize order SO-10001.',
  pageContext: Object.freeze({ module: 'orders', route: '/orders/SO-10001', screenId: 'order-detail', entityType: 'order', entityId: 'SO-10001' }),
  requestId: 'gateway-send-message-request',
  traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
});

describe('GatewayBackendClient JSON create-session transport contract (T064-A)', () => {
  const dtoSource = readFileSync(createSessionDtoPath, 'utf8');

  it('locks the Backend create-session DTO to optional top-level pageContext only', () => {
    expect(extractCreateSessionTopLevelFields(dtoSource)).toEqual([{ name: 'pageContext', optional: true }]);
  });

  it('rejects create-session DTO top-level field drift', () => {
    const mutated = dtoSource.replace('pageContext?: PageContextDto;', 'pageContext?: PageContextDto;\n  customerId?: string;');
    expect(() => assertCreateSessionDtoSurface(mutated)).toThrow('Backend create-session DTO surface no longer matches the locked Gateway contract.');
  });

  it('uses only the fixed JSON create-session route, body, headers, and a server-owned five-second timeout', async () => {
    const harness = createHarness(['internal-token-1']);
    await harness.client.createSession(canonicalIdentity, createSessionInput);

    expect(harness.fetchCalls).toEqual([
      expect.objectContaining({
        url: 'https://backend.internal.test/api/v1/assistant/sessions',
        init: expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: 'Bearer internal-token-1',
            'x-request-id': createSessionInput.requestId,
            traceparent: createSessionInput.traceparent
          }),
          body: JSON.stringify({ pageContext: createSessionInput.pageContext }),
          signal: harness.timeoutSignal
        })
      })
    ]);
    expect(harness.timeoutCalls).toEqual([5_000]);
    expect(harness.issuerIdentities).toEqual([canonicalIdentity]);
    expect(harness.issuerIdentities[0]).toBe(canonicalIdentity);
    expect(JSON.stringify(harness.fetchCalls)).not.toMatch(/customerId|integrationId|subject|organizationId|hostApp|roles|permissionScopes|customer_id|integration_id/i);
  });

  it('issues one fresh internal token for each logical create-session request', async () => {
    const harness = createHarness(['internal-token-1', 'internal-token-2']);
    await harness.client.createSession(canonicalIdentity, createSessionInput);
    await harness.client.createSession(canonicalIdentity, { ...createSessionInput, requestId: 'gateway-create-session-request-2' });

    expect(harness.issuerCalls).toBe(2);
    expect(harness.issuerIdentities).toEqual([canonicalIdentity, canonicalIdentity]);
    expect(harness.issuerIdentities[0]).toBe(canonicalIdentity);
    expect(harness.issuerIdentities[1]).toBe(canonicalIdentity);
    expect(harness.fetchCalls).toHaveLength(2);
    expect(harness.fetchCalls.map((call) => call.init.headers?.authorization)).toEqual(['Bearer internal-token-1', 'Bearer internal-token-2']);
  });

  it.each([
    ['url', 'https://attacker.invalid'],
    ['path', '/admin'],
    ['method', 'GET'],
    ['destination', 'https://attacker.invalid'],
    ['backendUrl', 'https://attacker.invalid'],
    ['authorization', 'Bearer caller-token'],
    ['token', 'caller-token'],
    ['kid', 'caller-kid'],
    ['customer_id', 'customer-b'],
    ['arbitraryBody', { unrestricted: true }]
  ])('rejects caller-supplied %s before issuing or attempting transport', async (field, value) => {
    const harness = createHarness(['never-issued']);
    const input = { ...createSessionInput, [field]: value } as unknown as CreateSessionInput;

    await expect(harness.client.createSession(canonicalIdentity, input)).rejects.toThrow();
    expect(harness.issuerCalls).toBe(0);
    expect(harness.fetchCalls).toEqual([]);
  });

  it.each(['timeout', 'connection failure'])('maps %s to safe Backend-unavailable failure without retry', async (failure) => {
    const harness = createHarness(['internal-token-1'], async () => {
      throw new Error(`${failure}-sentinel`);
    });

    await expect(harness.client.createSession(canonicalIdentity, createSessionInput)).rejects.toMatchObject({
      statusCode: 503,
      code: 'BACKEND_UNAVAILABLE',
      message: 'Backend is unavailable.'
    });
    expect(harness.issuerCalls).toBe(1);
    expect(harness.fetchCalls).toHaveLength(1);
  });
});

describe('GatewayBackendClient SSE send-message transport contract (T064-B)', () => {
  const dtoSource = readFileSync(sendMessageDtoPath, 'utf8');

  it('locks the Backend send-message DTO to required message and optional top-level pageContext only', () => {
    expect(extractSendMessageTopLevelFields(dtoSource)).toEqual([
      { name: 'message', optional: false },
      { name: 'pageContext', optional: true }
    ]);
  });

  it('rejects send-message DTO top-level field drift', () => {
    const mutated = dtoSource.replace('message!: string;', 'message!: string;\n  customerId?: string;');
    expect(() => assertSendMessageDtoSurface(mutated)).toThrow('Backend send-message DTO surface no longer matches the locked Gateway contract.');
  });

  it('uses only the fixed SSE send-message route, body, and headers with a fresh identity-bound token', async () => {
    const harness = createSseHarness(['internal-sse-token-1']);
    await harness.client.sendStreamMessage(canonicalIdentity, 'session-owned-001', sendStreamMessageInput);

    expect(harness.fetchCalls).toEqual([
      expect.objectContaining({
        url: 'https://backend.internal.test/api/v1/assistant/sessions/session-owned-001/messages',
        init: expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            accept: 'text/event-stream',
            authorization: 'Bearer internal-sse-token-1',
            'x-request-id': sendStreamMessageInput.requestId,
            traceparent: sendStreamMessageInput.traceparent
          }),
          body: JSON.stringify({ message: sendStreamMessageInput.message, pageContext: sendStreamMessageInput.pageContext }),
          signal: harness.abortController.signal
        })
      })
    ]);
    expect(harness.issuerIdentities).toEqual([canonicalIdentity]);
    expect(harness.issuerIdentities[0]).toBe(canonicalIdentity);
    expect(harness.timeoutCalls).toEqual([]);
    expect(JSON.stringify(harness.fetchCalls)).not.toMatch(/customerId|integrationId|subject|organizationId|hostApp|roles|permissionScopes|customer_id|integration_id/i);
  });

  it('issues a distinct fresh internal token for every logical SSE message using the exact supplied identity', async () => {
    const harness = createSseHarness(['internal-sse-token-1', 'internal-sse-token-2']);
    await harness.client.sendStreamMessage(canonicalIdentity, 'session-owned-001', sendStreamMessageInput);
    await harness.client.sendStreamMessage(canonicalIdentity, 'session-owned-001', { ...sendStreamMessageInput, requestId: 'gateway-send-message-request-2' });

    expect(harness.issuerCalls).toBe(2);
    expect(harness.issuerIdentities).toEqual([canonicalIdentity, canonicalIdentity]);
    expect(harness.issuerIdentities[0]).toBe(canonicalIdentity);
    expect(harness.issuerIdentities[1]).toBe(canonicalIdentity);
    expect(harness.fetchCalls.map((call) => call.init.headers?.authorization)).toEqual(['Bearer internal-sse-token-1', 'Bearer internal-sse-token-2']);
  });

  it('makes chunk A available before chunk B or stream completion without buffering the SSE body', async () => {
    const source = createControlledSseStream();
    const harness = createSseHarness(['internal-sse-token-1'], async (url, init) => {
      harness.fetchCalls.push({ url, init });
      return { ok: true, status: 200, body: source.stream };
    });
    const result = await harness.client.sendStreamMessage(canonicalIdentity, 'session-owned-001', sendStreamMessageInput);
    const reader = result.getReader();

    source.enqueue('event: answer_delta\ndata: chunk-a\n\n');
    await expect(reader.read()).resolves.toMatchObject({ done: false, value: new TextEncoder().encode('event: answer_delta\ndata: chunk-a\n\n') });
    expect(source.closed).toBe(false);

    source.enqueue('event: final\ndata: chunk-b\n\n');
    source.close();
    await reader.cancel();
  });

  it('aborts the underlying Backend stream when the consumer cancels', async () => {
    const source = createControlledSseStream();
    const harness = createSseHarness(['internal-sse-token-1'], async (url, init) => {
      harness.fetchCalls.push({ url, init });
      return { ok: true, status: 200, body: source.stream };
    });
    const result = await harness.client.sendStreamMessage(canonicalIdentity, 'session-owned-001', sendStreamMessageInput);
    const reader = result.getReader();

    await reader.cancel('consumer-cancelled');
    expect(harness.abortController.signal.aborted).toBe(true);
    expect(source.cancelled).toBe(true);
  });

  it('maps a Backend stream disconnect to the safe failure without retrying', async () => {
    const source = createControlledSseStream();
    const harness = createSseHarness(['internal-sse-token-1'], async (url, init) => {
      harness.fetchCalls.push({ url, init });
      return { ok: true, status: 200, body: source.stream };
    });
    const result = await harness.client.sendStreamMessage(canonicalIdentity, 'session-owned-001', sendStreamMessageInput);
    const reader = result.getReader();

    const rawError = new Error('backend-stream-disconnect-sentinel');
    source.error(rawError);
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
    expect(JSON.stringify(failure)).not.toContain('backend-stream-disconnect-sentinel');
    expect(harness.abortController.signal.aborted).toBe(true);
    expect(harness.issuerCalls).toBe(1);
    expect(harness.fetchCalls).toHaveLength(1);
  });

  it.each([
    ['url', 'https://attacker.invalid'],
    ['path', '/admin'],
    ['method', 'GET'],
    ['destination', 'https://attacker.invalid'],
    ['backendUrl', 'https://attacker.invalid'],
    ['authorization', 'Bearer caller-token'],
    ['token', 'caller-token'],
    ['kid', 'caller-kid'],
    ['customer_id', 'customer-b'],
    ['customerId', 'customer-b'],
    ['integration_id', 'integration-b'],
    ['query', { customerId: 'customer-b' }],
    ['arbitraryBody', { unrestricted: true }]
  ])('rejects caller-supplied SSE %s before issuing or attempting transport', async (field, value) => {
    const harness = createSseHarness(['never-issued']);
    const input = { ...sendStreamMessageInput, [field]: value } as unknown as SendStreamMessageInput;

    await expect(harness.client.sendStreamMessage(canonicalIdentity, 'session-owned-001', input)).rejects.toThrow();
    expect(harness.issuerCalls).toBe(0);
    expect(harness.fetchCalls).toEqual([]);
  });
});

function createHarness(tokens: readonly string[], fetchImplementation?: FetchDouble): Readonly<{
  client: GatewayBackendClient;
  fetchCalls: FetchCall[];
  issuerCalls: number;
  issuerIdentities: CanonicalGatewayIdentity[];
  timeoutCalls: number[];
  timeoutSignal: AbortSignal;
}> {
  const GatewayBackendClientImplementation = loadGatewayBackendClient();
  const fetchCalls: FetchCall[] = [];
  const timeoutCalls: number[] = [];
  const timeoutSignal = new AbortController().signal;
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
    return { ok: true, status: 201, json: async () => ({ requestId: createSessionInput.requestId }) };
  };
  const createTimeoutSignal: TimeoutSignalFactory = (milliseconds) => {
    timeoutCalls.push(milliseconds);
    return timeoutSignal;
  };
  const client = new GatewayBackendClientImplementation({
    backendBaseUrl: 'https://backend.internal.test',
    timeoutMilliseconds: 5_000,
    internalTokenIssuer,
    fetch,
    createTimeoutSignal,
    createAbortController: () => new AbortController()
  });

  return Object.freeze({
    client,
    fetchCalls,
    get issuerCalls() { return issuerCalls; },
    issuerIdentities,
    timeoutCalls,
    timeoutSignal
  });
}

function createSseHarness(tokens: readonly string[], fetchImplementation?: FetchDouble): Readonly<{
  client: GatewayBackendClient;
  fetchCalls: FetchCall[];
  issuerCalls: number;
  issuerIdentities: CanonicalGatewayIdentity[];
  timeoutCalls: number[];
  abortController: AbortController;
}> {
  const GatewayBackendClientImplementation = loadGatewayBackendClient();
  const fetchCalls: FetchCall[] = [];
  const timeoutCalls: number[] = [];
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
    if (fetchImplementation) return fetchImplementation(url, init);
    fetchCalls.push({ url, init });
    return { ok: true, status: 200, body: createControlledSseStream().stream };
  };
  const client = new GatewayBackendClientImplementation({
    backendBaseUrl: 'https://backend.internal.test',
    timeoutMilliseconds: 5_000,
    internalTokenIssuer,
    fetch,
    createTimeoutSignal: (milliseconds) => {
      timeoutCalls.push(milliseconds);
      return new AbortController().signal;
    },
    createAbortController: () => abortController
  });

  return Object.freeze({
    client,
    fetchCalls,
    get issuerCalls() { return issuerCalls; },
    issuerIdentities,
    timeoutCalls,
    abortController
  });
}

function loadGatewayBackendClient(): GatewayBackendClientConstructor {
  if (!existsSync(clientPath)) throw new Error('GatewayBackendClient production surface missing.');
  const target = require(clientPath) as { GatewayBackendClient?: GatewayBackendClientConstructor };
  if (!target.GatewayBackendClient) throw new Error('GatewayBackendClient production surface missing.');
  return target.GatewayBackendClient;
}

function assertCreateSessionDtoSurface(source: string): void {
  if (JSON.stringify(extractCreateSessionTopLevelFields(source)) !== JSON.stringify([{ name: 'pageContext', optional: true }])) {
    throw new Error('Backend create-session DTO surface no longer matches the locked Gateway contract.');
  }
}

function assertSendMessageDtoSurface(source: string): void {
  const expected = [{ name: 'message', optional: false }, { name: 'pageContext', optional: true }];
  if (JSON.stringify(extractSendMessageTopLevelFields(source)) !== JSON.stringify(expected)) {
    throw new Error('Backend send-message DTO surface no longer matches the locked Gateway contract.');
  }
}

function extractCreateSessionTopLevelFields(source: string): Array<Readonly<{ name: string; optional: boolean }>> {
  const classBody = extractDtoClassBody(source, 'CreateAssistantSessionDto');
  return [...classBody.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(\?|!)?\s*:/gm)].map((match) => Object.freeze({ name: match[1], optional: match[2] === '?' }));
}

function extractSendMessageTopLevelFields(source: string): Array<Readonly<{ name: string; optional: boolean }>> {
  const classBody = extractDtoClassBody(source, 'SendAssistantMessageDto');
  return [...classBody.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*(\?|!)?\s*:/gm)].map((match) => Object.freeze({ name: match[1], optional: match[2] === '?' }));
}

function extractDtoClassBody(source: string, className: string): string {
  const classBody = new RegExp(`export class ${className}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1];
  if (!classBody) throw new Error(`Backend ${className} is missing.`);
  return classBody;
}

function createControlledSseStream(): Readonly<{
  stream: ReadableStream<Uint8Array>;
  enqueue(value: string): void;
  close(): void;
  error(reason: unknown): void;
  readonly cancelled: boolean;
  readonly closed: boolean;
}> {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
    cancel() {
      cancelled = true;
    }
  });
  return Object.freeze({
    stream,
    enqueue(value) {
      if (!controller) throw new Error('SSE stream controller is unavailable.');
      controller.enqueue(new TextEncoder().encode(value));
    },
    close() {
      if (!controller) throw new Error('SSE stream controller is unavailable.');
      closed = true;
      controller.close();
    },
    error(reason) {
      if (!controller) throw new Error('SSE stream controller is unavailable.');
      controller.error(reason);
    },
    get cancelled() { return cancelled; },
    get closed() { return closed; }
  });
}
