import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IdentityResolutionError } from '../../src/integration-registry/canonical-identity-resolver.service';
import type { CanonicalGatewayIdentity } from '../../src/identity/canonical-gateway-identity';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import { MultiProfileInfrastructureError } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import type { VerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';

const repositoryRoot = resolve(__dirname, '../../../..');
const handlerPath = join(repositoryRoot, 'apps/gateway/src/backend-client/gateway-trust-chain.handler.ts');
const backendClientRoot = join(repositoryRoot, 'apps/gateway/src/backend-client');

type CreateSessionHandlerInput = Readonly<{
  authorization?: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId: string;
  traceparent?: string;
}>;

type SendStreamMessageHandlerInput = Readonly<{
  authorization?: string;
  sessionId: string;
  message: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId: string;
  traceparent?: string;
}>;

type ClientCreateSessionInput = Readonly<{
  pageContext?: Readonly<Record<string, unknown>>;
  requestId: string;
  traceparent?: string;
}>;

type ClientSendStreamMessageInput = Readonly<{
  message: string;
  pageContext?: Readonly<Record<string, unknown>>;
  requestId: string;
  traceparent?: string;
}>;

type GatewayTrustChainHandler = Readonly<{
  createSession(input: CreateSessionHandlerInput): Promise<unknown>;
  getSession(input: Readonly<{ authorization?: string; sessionId: string; requestId: string; traceparent?: string }>): Promise<unknown>;
  getSessionMessages(input: Readonly<{ authorization?: string; sessionId: string; query: Readonly<{ limit?: string; cursor?: string; order?: 'asc' }>; requestId: string; traceparent?: string }>): Promise<unknown>;
  sendStreamMessage(input: SendStreamMessageHandlerInput): Promise<ReadableStream<Uint8Array>>;
}>;

type GatewayTrustChainHandlerConstructor = new (dependencies: Readonly<{
  upstreamTokenVerifier: Readonly<{ verify(input: Readonly<{ authorization?: string }>): Promise<VerifiedUpstreamIdentity> }>;
  canonicalIdentityResolver: Readonly<{ resolve(input: Readonly<{ identity: VerifiedUpstreamIdentity; requestId: string }>): Promise<CanonicalGatewayIdentity> }>;
  gatewayBackendClient: Readonly<{
    createSession(identity: CanonicalGatewayIdentity, input: ClientCreateSessionInput): Promise<unknown>;
    getSession(identity: CanonicalGatewayIdentity, sessionId: string, input: Readonly<{ requestId: string; traceparent?: string }>): Promise<unknown>;
    getSessionMessages(identity: CanonicalGatewayIdentity, sessionId: string, query: Readonly<{ limit?: string; cursor?: string; order?: 'asc' }>, input: Readonly<{ requestId: string; traceparent?: string }>): Promise<unknown>;
    sendStreamMessage(identity: CanonicalGatewayIdentity, sessionId: string, input: ClientSendStreamMessageInput): Promise<ReadableStream<Uint8Array>>;
  }>;
}>) => GatewayTrustChainHandler;

const verifiedIdentity: VerifiedUpstreamIdentity = Object.freeze({
  integrationId: 'integration-a',
  subject: 'actor-shared',
  organizationId: 'org-shared',
  hostApp: 'admin',
  roles: Object.freeze(['planner']),
  permissionScopes: Object.freeze(['orders:read'])
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

const createSessionInput = Object.freeze({
  authorization: 'Bearer upstream-token',
  pageContext: Object.freeze({ module: 'orders', route: '/orders/SO-10001' }),
  requestId: 'trust-chain-create-request',
  traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
});

const sendStreamMessageInput = Object.freeze({
  authorization: 'Bearer upstream-token',
  sessionId: 'session-owned-001',
  message: 'Summarize order SO-10001.',
  pageContext: Object.freeze({ module: 'orders', route: '/orders/SO-10001' }),
  requestId: 'trust-chain-message-request',
  traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01'
});

describe('Gateway trust-chain handler contract (T068)', () => {
  it('permits no generic proxy, controller, alternate identity, or direct signing surface in a future handler tree', () => {
    const forbidden = /@All\s*\(|@Controller\s*\(|\b(?:execute|request|proxy|forward|dispatch)\s*\(|InternalIdentityTokenIssuer|SigningKeyProvider|ActiveSigningKeyResolver|createVerifiedUpstreamIdentity|composeCanonicalGatewayIdentity/i;
    expect(readSourceFiles(backendClientRoot).filter((source) => forbidden.test(source.content))).toEqual([]);
  });

  it('requires exactly the two server-owned future handler methods', () => {
    const Handler = loadGatewayTrustChainHandler();
    expect(Object.getOwnPropertyNames(Handler.prototype).sort()).toEqual(['constructor', 'createSession', 'getSession', 'getSessionMessages', 'sendStreamMessage']);
  });

  it('has no legacy verifier, multi-profile implementation, registry, or binding authority', () => {
    const source = readFileSync(handlerPath, 'utf8');
    expect(source).not.toMatch(/RemoteJwksUpstreamTokenVerifier|GATEWAY_UPSTREAM_JWT_(?:ISSUER|AUDIENCE|JWKS_URI)|TrustProfileRepository|CandidateTrustProfileResolver|RoutingMetadataParser|ProfileScopedVerifier|HardenedJwksTransport|VerifiedProfileDecision|IntegrationBindingRepository|customerId|allowedHostApp|CustomerScope/);
  });

  it('chains verified upstream identity to canonical identity and then create-session transport by reference', async () => {
    const harness = createHarness();
    await harness.handler.createSession(createSessionInput);

    expect(harness.verifyInputs).toEqual([{ authorization: createSessionInput.authorization }]);
    expect(harness.resolveInputs).toEqual([{ identity: verifiedIdentity, requestId: createSessionInput.requestId }]);
    expect(harness.resolveInputs[0].identity).toBe(verifiedIdentity);
    expect(harness.createCalls).toEqual([{
      identity: canonicalIdentity,
      input: { pageContext: createSessionInput.pageContext, requestId: createSessionInput.requestId, traceparent: createSessionInput.traceparent }
    }]);
    expect(harness.createCalls[0].identity).toBe(canonicalIdentity);
    expect(JSON.stringify(harness.createCalls)).not.toContain(createSessionInput.authorization);
  });

  it('chains verified upstream identity to canonical identity and then SSE transport by reference', async () => {
    const harness = createHarness();
    await harness.handler.sendStreamMessage(sendStreamMessageInput);

    expect(harness.verifyInputs).toEqual([{ authorization: sendStreamMessageInput.authorization }]);
    expect(harness.resolveInputs).toEqual([{ identity: verifiedIdentity, requestId: sendStreamMessageInput.requestId }]);
    expect(harness.resolveInputs[0].identity).toBe(verifiedIdentity);
    expect(harness.sendCalls).toEqual([{
      identity: canonicalIdentity,
      sessionId: sendStreamMessageInput.sessionId,
      input: {
        message: sendStreamMessageInput.message,
        pageContext: sendStreamMessageInput.pageContext,
        requestId: sendStreamMessageInput.requestId,
        traceparent: sendStreamMessageInput.traceparent
      }
    }]);
    expect(harness.sendCalls[0].identity).toBe(canonicalIdentity);
    expect(JSON.stringify(harness.sendCalls)).not.toContain(sendStreamMessageInput.authorization);
  });

  it('stops before resolution and Backend transport when upstream authentication rejects', async () => {
    const harness = createHarness({ verifyFailure: new UpstreamAuthenticationError('invalid_signature') });

    await expect(harness.handler.createSession(createSessionInput)).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID' });
    expect(harness.verifyInputs).toEqual([{ authorization: createSessionInput.authorization }]);
    expect(harness.resolveInputs).toEqual([]);
    expect(harness.createCalls).toEqual([]);
    expect(harness.sendCalls).toEqual([]);
  });

  it('stops SSE resolution and Backend transport when upstream authentication rejects', async () => {
    const harness = createHarness({ verifyFailure: new UpstreamAuthenticationError('invalid_signature') });

    await expect(harness.handler.sendStreamMessage(sendStreamMessageInput)).rejects.toMatchObject({ status: 401, code: 'UPSTREAM_IDENTITY_INVALID' });
    expect(harness.verifyInputs).toEqual([{ authorization: sendStreamMessageInput.authorization }]);
    expect(harness.resolveInputs).toEqual([]);
    expect(harness.createCalls).toEqual([]);
    expect(harness.sendCalls).toEqual([]);
  });

  it('propagates multi-profile infrastructure failure without resolution, transport, retry, or fallback', async () => {
    const failure = new MultiProfileInfrastructureError();
    const harness = createHarness({ verifyFailure: failure });

    await expect(harness.handler.createSession(createSessionInput)).rejects.toBe(failure);
    expect(harness.verifyInputs).toEqual([{ authorization: createSessionInput.authorization }]);
    expect(harness.resolveInputs).toEqual([]);
    expect(harness.createCalls).toEqual([]);
    expect(harness.getSessionCalls).toEqual([]);
    expect(harness.historyCalls).toEqual([]);
    expect(harness.sendCalls).toEqual([]);
  });

  it('stops before Backend transport when canonical identity resolution rejects', async () => {
    const harness = createHarness({ resolveFailure: new IdentityResolutionError('unknown_binding') });

    await expect(harness.handler.createSession(createSessionInput)).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
    expect(harness.verifyInputs).toEqual([{ authorization: createSessionInput.authorization }]);
    expect(harness.resolveInputs).toEqual([{ identity: verifiedIdentity, requestId: createSessionInput.requestId }]);
    expect(harness.createCalls).toEqual([]);
    expect(harness.sendCalls).toEqual([]);
    expect(harness.verifyInputs).toHaveLength(1);
  });

  it('stops SSE Backend transport when canonical identity resolution rejects', async () => {
    const harness = createHarness({ resolveFailure: new IdentityResolutionError('unknown_binding') });

    await expect(harness.handler.sendStreamMessage(sendStreamMessageInput)).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
    expect(harness.verifyInputs).toEqual([{ authorization: sendStreamMessageInput.authorization }]);
    expect(harness.resolveInputs).toEqual([{ identity: verifiedIdentity, requestId: sendStreamMessageInput.requestId }]);
    expect(harness.resolveInputs[0].identity).toBe(verifiedIdentity);
    expect(harness.createCalls).toEqual([]);
    expect(harness.sendCalls).toEqual([]);
    expect(harness.verifyInputs).toHaveLength(1);
  });

  it('does not repeat verification or resolution after a Backend failure', async () => {
    const failure = new Error('backend unavailable');
    const harness = createHarness({ backendFailure: failure });

    await expect(harness.handler.createSession(createSessionInput)).rejects.toBe(failure);
    expect(harness.verifyInputs).toHaveLength(1);
    expect(harness.resolveInputs).toHaveLength(1);
    expect(harness.createCalls).toHaveLength(1);
  });

  it('preserves read and history dispatch through the same identity chain', async () => {
    const harness = createHarness();
    const readInput = { authorization: createSessionInput.authorization, sessionId: 'session-owned-001', requestId: 'read-request', traceparent: createSessionInput.traceparent };
    const historyInput = { authorization: createSessionInput.authorization, sessionId: 'session-owned-001', query: { limit: '1', order: 'asc' as const }, requestId: 'history-request' };
    await harness.handler.getSession(readInput);
    await harness.handler.getSessionMessages(historyInput);

    expect(harness.verifyInputs).toEqual([{ authorization: readInput.authorization }, { authorization: historyInput.authorization }]);
    expect(harness.resolveInputs).toEqual([{ identity: verifiedIdentity, requestId: readInput.requestId }, { identity: verifiedIdentity, requestId: historyInput.requestId }]);
    expect(harness.getSessionCalls).toEqual([{ identity: canonicalIdentity, sessionId: readInput.sessionId, input: { requestId: readInput.requestId, traceparent: readInput.traceparent } }]);
    expect(harness.historyCalls).toEqual([{ identity: canonicalIdentity, sessionId: historyInput.sessionId, query: historyInput.query, input: { requestId: historyInput.requestId, traceparent: undefined } }]);
  });

  it.each([
    ['headers', { Authorization: 'Bearer upstream-secret' }],
    ['cookie', 'host-session-secret'],
    ['Cookie', 'host-session-secret'],
    ['customerId', 'customer-b'],
    ['customer_id', 'customer-b'],
    ['integrationId', 'integration-b'],
    ['integration_id', 'integration-b'],
    ['x-customer-id', 'customer-b'],
    ['x-integration-id', 'integration-b'],
    ['backendUrl', 'https://attacker.invalid'],
    ['destination', 'https://attacker.invalid'],
    ['url', 'https://attacker.invalid'],
    ['path', '/admin'],
    ['method', 'GET'],
    ['token', 'caller-token'],
    ['kid', 'caller-kid']
  ])('rejects create-session public %s before verification or later work', async (field, value) => {
    const harness = createHarness();
    const input = { ...createSessionInput, [field]: value } as unknown as CreateSessionHandlerInput;

    await expect(harness.handler.createSession(input)).rejects.toThrow();
    expect(harness.verifyInputs).toEqual([]);
    expect(harness.resolveInputs).toEqual([]);
    expect(harness.createCalls).toEqual([]);
  });

  it.each([
    ['headers', { Authorization: 'Bearer upstream-secret' }],
    ['cookie', 'host-session-secret'],
    ['Cookie', 'host-session-secret'],
    ['customerId', 'customer-b'],
    ['customer_id', 'customer-b'],
    ['integrationId', 'integration-b'],
    ['integration_id', 'integration-b'],
    ['x-customer-id', 'customer-b'],
    ['x-integration-id', 'integration-b'],
    ['backendUrl', 'https://attacker.invalid'],
    ['destination', 'https://attacker.invalid'],
    ['url', 'https://attacker.invalid'],
    ['path', '/admin'],
    ['method', 'GET'],
    ['token', 'caller-token'],
    ['kid', 'caller-kid']
  ])('rejects send-message public %s before verification or later work', async (field, value) => {
    const harness = createHarness();
    const input = { ...sendStreamMessageInput, [field]: value } as unknown as SendStreamMessageHandlerInput;

    await expect(harness.handler.sendStreamMessage(input)).rejects.toThrow();
    expect(harness.verifyInputs).toEqual([]);
    expect(harness.resolveInputs).toEqual([]);
    expect(harness.sendCalls).toEqual([]);
  });
});

function createHarness(options: Readonly<{ verifyFailure?: Error; resolveFailure?: Error; backendFailure?: Error }> = {}): Readonly<{
  handler: GatewayTrustChainHandler;
  verifyInputs: Array<Readonly<{ authorization?: string }>>;
  resolveInputs: Array<Readonly<{ identity: VerifiedUpstreamIdentity; requestId: string }>>;
  createCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; input: ClientCreateSessionInput }>>;
  getSessionCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; sessionId: string; input: Readonly<{ requestId: string; traceparent?: string }> }>>;
  historyCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; sessionId: string; query: Readonly<{ limit?: string; cursor?: string; order?: 'asc' }>; input: Readonly<{ requestId: string; traceparent?: string }> }>>;
  sendCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; sessionId: string; input: ClientSendStreamMessageInput }>>;
}> {
  const Handler = loadGatewayTrustChainHandler();
  const verifyInputs: Array<Readonly<{ authorization?: string }>> = [];
  const resolveInputs: Array<Readonly<{ identity: VerifiedUpstreamIdentity; requestId: string }>> = [];
  const createCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; input: ClientCreateSessionInput }>> = [];
  const getSessionCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; sessionId: string; input: Readonly<{ requestId: string; traceparent?: string }> }>> = [];
  const historyCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; sessionId: string; query: Readonly<{ limit?: string; cursor?: string; order?: 'asc' }>; input: Readonly<{ requestId: string; traceparent?: string }> }>> = [];
  const sendCalls: Array<Readonly<{ identity: CanonicalGatewayIdentity; sessionId: string; input: ClientSendStreamMessageInput }>> = [];
  const handler = new Handler({
    upstreamTokenVerifier: {
      async verify(input) {
        verifyInputs.push(input);
        if (options.verifyFailure) throw options.verifyFailure;
        return verifiedIdentity;
      }
    },
    canonicalIdentityResolver: {
      async resolve(input) {
        resolveInputs.push(input);
        if (options.resolveFailure) throw options.resolveFailure;
        return canonicalIdentity;
      }
    },
    gatewayBackendClient: {
      async createSession(identity, input) {
        createCalls.push({ identity, input });
        if (options.backendFailure) throw options.backendFailure;
        return { requestId: input.requestId };
      },
      async getSession(identity, sessionId, input) { getSessionCalls.push({ identity, sessionId, input }); if (options.backendFailure) throw options.backendFailure; return { statusCode: 200, body: {} }; },
      async getSessionMessages(identity, sessionId, query, input) { historyCalls.push({ identity, sessionId, query, input }); if (options.backendFailure) throw options.backendFailure; return { statusCode: 200, body: {} }; },
      async sendStreamMessage(identity, sessionId, input) {
        sendCalls.push({ identity, sessionId, input });
        if (options.backendFailure) throw options.backendFailure;
        return new ReadableStream<Uint8Array>();
      }
    }
  });
  return Object.freeze({ handler, verifyInputs, resolveInputs, createCalls, getSessionCalls, historyCalls, sendCalls });
}

function loadGatewayTrustChainHandler(): GatewayTrustChainHandlerConstructor {
  if (!existsSync(handlerPath)) throw new Error('Gateway trust-chain handler production surface missing.');
  const target = require(handlerPath) as { GatewayTrustChainHandler?: GatewayTrustChainHandlerConstructor };
  if (!target.GatewayTrustChainHandler) throw new Error('Gateway trust-chain handler production surface missing.');
  return target.GatewayTrustChainHandler;
}

function readSourceFiles(root: string): Array<Readonly<{ path: string; content: string }>> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  collectSourceFiles(root, files);
  return files.map((path) => Object.freeze({ path, content: readFileSync(path, 'utf8') }));
}

function collectSourceFiles(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collectSourceFiles(path, files);
    else if (/\.(?:ts|tsx|js|cjs|mjs)$/.test(path)) files.push(path);
  }
}
