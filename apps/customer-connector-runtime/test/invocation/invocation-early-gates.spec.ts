import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { SignJWT } from 'jose';
import { ConnectorBindingService } from '../../src/bindings/connector-binding.service';
import { InMemoryConnectorBindingStore } from '../../src/bindings/in-memory-connector-binding.store';
import type { ConnectorBindingTrustedContextV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { CredentialExecutionBoundary } from '../../src/credentials/credential-execution.boundary';
import { CredentialProfileRegistry } from '../../src/credentials/credential-profile.registry';
import { ConnectorInvocationService } from '../../src/invocation/connector-invocation.service';
import { ConnectorInvocationController } from '../../src/invocation/connector-invocation.controller';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { RequestProfileRegistry } from '../../src/manifest/request-profile.registry';
import { ReplayProtectionService } from '../../src/replay/replay-protection.service';
import { ExactRawBodyAuthenticator } from '../../src/service-auth/exact-raw-body.authenticator';
import { RuntimeServiceProfileRegistry } from '../../src/service-auth/service-profile.registry';
import { ConnectorServiceProofVerifier } from '../../src/service-auth/service-proof.verifier';
import { BoundedJsonResponse } from '../../src/upstream/bounded-json-response';
import { ConnectorDestinationPolicy } from '../../src/upstream/connector-destination-policy';
import { ManifestResponseExtractor } from '../../src/upstream/response-extractor';
import { SafeUpstreamHttpClient } from '../../src/upstream/safe-upstream-http-client';
import { UpstreamExecutionService } from '../../src/upstream/upstream-execution.service';
import { credentialFixtures, profileConfigurations } from '../fixtures/phase5-credentials';
import { customerBOperation, parsedManifest } from '../fixtures/phase5-manifests';
import { bodyDigest, serviceProofFixtureSet, signServiceProof, type TestProfile } from '../fixtures/service-proof-fixtures';

const NOW = 1_800_000_000;
const CONTEXT: ConnectorBindingTrustedContextV1 = Object.freeze({
  customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
  connectorInstanceId: 'customer-b-inventory-connector-1', organizationId: 'org-b', actorId: 'actor-b'
});

describe('Phase 6 real-component invocation early gates', () => {
  it.each([
    ['wrong method', { method: 'GET' }],
    ['wrong media', { contentType: 'text/plain' }],
    ['content encoding', { contentEncoding: 'gzip' }]
  ])('rejects invalid transport %s before proof or downstream state', async (_case, transport) => {
    const harness = await createHarness();
    const request = requestFixture(harness.reference);
    const authorization = await authorizationFor(harness.profiles.central, request);
    const result = await harness.service.handle({ ...input(request, authorization), ...transport });
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_REQUEST_INVALID' } });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it.each(['invalid', 'bootstrap', 'user'] as const)('rejects %s proof before binding, credential, DNS, HTTP, or extraction', async (kind) => {
    const harness = await createHarness();
    const request = requestFixture(harness.reference);
    const authorization = kind === 'invalid'
      ? 'Bearer invalid.proof.value'
      : kind === 'bootstrap'
        ? `Bearer ${await signServiceProof(harness.profiles.customerB, proofOverrides(request))}`
        : `Bearer ${await userToken(harness.profiles.central)}`;
    const result = await harness.service.handle(input(request, authorization));
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_AUTH_FAILED' } });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it('rejects a valid signed proof while Runtime readiness is false before binding or downstream execution', async () => {
    const harness = await createHarness({ readiness: { snapshot: () => ({ ready: false }) } });
    const lease = jest.spyOn(harness.bindings, 'withInvocationLease');
    const result = await invoke(harness, requestFixture(harness.reference));

    expect(result).toEqual(expect.objectContaining({
      statusCode: 503,
      body: { version: '1', requestId: expect.any(String), status: 'failed', error: { code: 'CONNECTOR_UNAVAILABLE' } }
    }));
    expect(lease).not.toHaveBeenCalled();
    expectUnreached(harness, { credential: true, http: true, extraction: true });
    expect(JSON.stringify(result)).not.toMatch(/readiness|dependency|customer-b-handle|ccr_/i);
  });

  it('rejects replay before a second binding or credential access', async () => {
    const harness = await createHarness();
    const request = requestFixture(harness.reference);
    const authorization = await authorizationFor(harness.profiles.central, request);
    await expect(harness.service.handle(input(request, authorization))).resolves.toMatchObject({ body: { status: 'succeeded' } });
    harness.credentialResolve.mockClear();
    harness.httpRequest.mockClear();
    harness.extract.mockClear();
    await expect(harness.service.handle(input(request, authorization))).resolves.toMatchObject({
      body: { status: 'failed', error: { code: 'CONNECTOR_REPLAY_REJECTED' } }
    });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it('rejects signed/body trusted-context mismatch before binding and credentials', async () => {
    const harness = await createHarness();
    const request = requestFixture(harness.reference, { context: { ...CONTEXT, customerId: 'other-customer' } });
    const authorization = await signServiceProof(harness.profiles.central, {
      request_id: request.requestId, body_sha256: bodyDigest(request.rawBody), jti: randomUUID()
    });
    await expect(harness.service.handle(input(request, `Bearer ${authorization}`))).resolves.toMatchObject({
      body: { status: 'failed', error: { code: 'CONNECTOR_REQUEST_INVALID' } }
    });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it.each(['invalid-reference', 'stale-reference', 'binding-context'] as const)('rejects %s before credential resolution', async (kind) => {
    const harness = await createHarness();
    let reference = harness.reference;
    if (kind === 'invalid-reference') reference = `ccr_${'Z'.repeat(43)}`;
    if (kind === 'stale-reference') {
      const replacement = await harness.bindings.mint(bindingInput(CONTEXT, 'customer-b-provider-v1', 'customer-b-handle'));
      if (!replacement.ok) throw new Error('replacement fixture');
    }
    if (kind === 'binding-context') {
      const other = await harness.bindings.mint(bindingInput({ ...CONTEXT, actorId: 'other-actor' }, 'customer-b-provider-v1', 'customer-b-handle'));
      if (!other.ok) throw new Error('context fixture');
      reference = other.value.connectorContextRef;
    }
    const request = requestFixture(reference);
    const result = await invoke(harness, request);
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_BINDING_INVALID' } });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it.each([
    ['unknown-operation', { operationKey: 'inventory.unknown' }],
    ['wrong-version', { operationVersion: '2.0.0' }],
    ['invalid-arguments', { argumentsValue: {} }]
  ] as const)('rejects %s before credential resolution', async (_case, overrides) => {
    const harness = await createHarness();
    const request = requestFixture(harness.reference, overrides);
    const result = await invoke(harness, request);
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_OPERATION_UNAVAILABLE' } });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it('rejects an incomplete request-profile registry before credential resolution', async () => {
    const manifests = new OperationManifestRegistry(
      [parsedManifest('inventory', [customerBOperation()])], new RequestProfileRegistry(['GET_QUERY_V1'])
    );
    const harness = await createHarness({ manifests });
    const result = await invoke(harness, requestFixture(harness.reference));
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_OPERATION_UNAVAILABLE' } });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it('rejects binding and credential-profile provider mismatch before provider resolution', async () => {
    const harness = await createHarness({ credentialProviderKey: 'metrics-provider-v1', credentialHandle: 'metrics-handle' });
    const result = await invoke(harness, requestFixture(harness.reference));
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_BINDING_INVALID' } });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it.each(['unsafe-destination', 'dns-rejection'] as const)('fails %s without an HTTP request or extraction', async (kind) => {
    const policy = kind === 'unsafe-destination'
      ? new ConnectorDestinationPolicy([{ upstreamServiceRef: 'other-api', origin: 'https://other.test', basePath: '/', addressMode: 'public_only', allowedCidrs: [] }], 'production')
      : undefined;
    const resolver = kind === 'dns-rejection'
      ? jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
      : undefined;
    const harness = await createHarness({ policy, resolver });
    const result = await invoke(harness, requestFixture(harness.reference));
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_DESTINATION_REJECTED' } });
    expect(harness.credentialResolve).toHaveBeenCalledTimes(1);
    expectUnreached(harness, { http: true, extraction: true });
  });

  it('fails exhausted signed budget before credential, DNS, HTTP, or extraction', async () => {
    const harness = await createHarness({ clock: jest.fn().mockReturnValueOnce(0).mockReturnValueOnce(4_251) });
    const result = await invoke(harness, requestFixture(harness.reference));
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_TIMEOUT' } });
    expectUnreached(harness, { credential: true, http: true, extraction: true });
  });

  it('never connects after caller abort during DNS and releases the binding lease', async () => {
    const resolver = jest.fn((_hostname: string, _signal: AbortSignal) => new Promise<never>(() => undefined));
    const harness = await createHarness({ resolver, clock: () => 0 });
    const request = requestFixture(harness.reference);
    const authorization = await authorizationFor(harness.profiles.central, request);
    const caller = new AbortController();
    const pending = harness.service.handle({ ...input(request, authorization), requestSignal: caller.signal });
    await waitUntil(() => harness.credentialResolve.mock.calls.length === 1);
    caller.abort();
    await expect(pending).resolves.toMatchObject({ body: { error: { code: 'CONNECTOR_TIMEOUT' } } });
    expect(harness.httpRequest).not.toHaveBeenCalled();
    expect(harness.credentialResolve).toHaveBeenCalledTimes(1);
    await expect(harness.bindings.withInvocationLease(harness.reference, { trustedContext: CONTEXT }, async () => true))
      .resolves.toEqual({ ok: true, value: true });
  });

  it('propagates a premature route connection close into DNS and releases the binding lease', async () => {
    const resolver = jest.fn((_hostname: string, _signal: AbortSignal) => new Promise<never>(() => undefined));
    const harness = await createHarness({ resolver, clock: () => 0 });
    const route = await invokeThroughController(harness, requestFixture(harness.reference));
    await waitUntil(() => resolver.mock.calls.length === 1);
    route.response.emit('close');
    await route.pending;
    expect(resolver.mock.calls[0]?.[1].aborted).toBe(true);
    expect(harness.httpRequest).not.toHaveBeenCalled();
    await expect(harness.bindings.withInvocationLease(harness.reference, { trustedContext: CONTEXT }, async () => true))
      .resolves.toEqual({ ok: true, value: true });
  });

  it('propagates a premature route connection close into an in-flight HTTPS request without retry', async () => {
    const outgoingDestroy = jest.fn();
    const requestFactory = jest.fn(() => {
      const outgoing = new EventEmitter() as EventEmitter & { write: jest.Mock; end(): void; destroy: jest.Mock };
      outgoing.write = jest.fn();
      outgoing.destroy = outgoingDestroy;
      outgoing.end = jest.fn();
      return outgoing;
    });
    const harness = await createHarness({ requestFactory, clock: () => 0 });
    const route = await invokeThroughController(harness, requestFixture(harness.reference));
    await waitUntil(() => requestFactory.mock.calls.length === 1);
    route.response.emit('close');
    await route.pending;
    expect(outgoingDestroy).toHaveBeenCalledTimes(1);
    expect(requestFactory).toHaveBeenCalledTimes(1);
    await expect(harness.bindings.withInvocationLease(harness.reference, { trustedContext: CONTEXT }, async () => true))
      .resolves.toEqual({ ok: true, value: true });
  });

  it('propagates a premature route connection close into response streaming and releases the binding lease', async () => {
    let stopBody: (() => void) | undefined;
    const responseDestroy = jest.fn(() => stopBody?.());
    const requestFactory = jest.fn((_options: object, callback: (response: unknown) => void) => {
      const outgoing = new EventEmitter() as EventEmitter & { write: jest.Mock; end(): void; destroy: jest.Mock };
      outgoing.write = jest.fn();
      outgoing.destroy = jest.fn();
      outgoing.end = () => callback(Object.assign(new EventEmitter(), {
        statusCode: 200, headers: { 'content-type': 'application/json' }, destroy: responseDestroy,
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('{"sku":"SKU-1",');
          await new Promise<void>((resolve) => { stopBody = resolve; });
          throw new Error('route-stream-close-sentinel');
        }
      }));
      return outgoing;
    });
    const harness = await createHarness({ requestFactory, clock: () => 0 });
    const route = await invokeThroughController(harness, requestFixture(harness.reference));
    await waitUntil(() => requestFactory.mock.calls.length === 1 && stopBody !== undefined);
    route.response.emit('close');
    await route.pending;
    expect(responseDestroy).toHaveBeenCalled();
    expect(requestFactory).toHaveBeenCalledTimes(1);
    expect(harness.extract).not.toHaveBeenCalled();
    await expect(harness.bindings.withInvocationLease(harness.reference, { trustedContext: CONTEXT }, async () => true))
      .resolves.toEqual({ ok: true, value: true });
  });

  it('uses the effective invocation deadline to cancel DNS without a second timeout', async () => {
    const resolver = jest.fn((_hostname: string, _signal: AbortSignal) => new Promise<never>(() => undefined));
    const harness = await createHarness({ resolver, clock: () => 0 });
    const request = requestFixture(harness.reference, { remainingBudgetMs: 500 });
    const authorization = await authorizationFor(harness.profiles.central, request);
    const started = Date.now();
    const result = await harness.service.handle(input(request, authorization));
    expect(result).toMatchObject({ body: { error: { code: 'CONNECTOR_TIMEOUT' } } });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(harness.httpRequest).not.toHaveBeenCalled();
    expect(harness.credentialResolve).toHaveBeenCalledTimes(1);
    await expect(harness.bindings.withInvocationLease(harness.reference, { trustedContext: CONTEXT }, async () => true))
      .resolves.toEqual({ ok: true, value: true });
  });

  it('never connects after lease revocation aborts DNS and completes lease release', async () => {
    const resolver = jest.fn((_hostname: string, _signal: AbortSignal) => new Promise<never>(() => undefined));
    const harness = await createHarness({ resolver });
    const request = requestFixture(harness.reference);
    const authorization = await authorizationFor(harness.profiles.central, request);
    const pending = harness.service.handle(input(request, authorization));
    await waitUntil(() => harness.credentialResolve.mock.calls.length === 1);
    await harness.bindings.revoke(harness.reference, 'administrative');
    await expect(pending).resolves.toMatchObject({ body: { error: { code: 'CONNECTOR_TIMEOUT' } } });
    expect(harness.httpRequest).not.toHaveBeenCalled();
    expect(harness.handleRevoke.mock.calls[0]?.[0]).toMatchObject({ activeLeases: 0 });
  });

  it('does not extract a response that fails bounded response validation', async () => {
    const harness = await createHarness({ responseBody: '{"sku":"SKU-1","quantity":"invalid"}' });
    const result = await invoke(harness, requestFixture(harness.reference));
    expect(result.body).toMatchObject({ status: 'failed', error: { code: 'CONNECTOR_RESPONSE_INVALID' } });
    expect(harness.httpRequest).toHaveBeenCalledTimes(1);
    expect(harness.extract).not.toHaveBeenCalled();
  });

  it('executes the complete real component path and releases only the bounded envelope', async () => {
    const harness = await createHarness();
    const result = await invoke(harness, requestFixture(harness.reference));
    expect(result).toEqual({
      statusCode: 200,
      body: { version: '1', requestId: expect.any(String), status: 'succeeded', result: { sku: 'SKU-1', quantity: 9 } }
    });
    expect(harness.credentialResolve).toHaveBeenCalledTimes(1);
    expect(harness.resolver).toHaveBeenCalledTimes(1);
    expect(harness.httpRequest).toHaveBeenCalledTimes(1);
    expect(harness.extract).toHaveBeenCalledTimes(1);
    expect(harness.handleRevoke).not.toHaveBeenCalled();
    await expect(harness.bindings.withInvocationLease(harness.reference, { trustedContext: CONTEXT }, async () => true))
      .resolves.toEqual({ ok: true, value: true });
    expect(JSON.stringify(result)).not.toMatch(/customer-b-handle|api-key-secret-sentinel|ccr_/);
  });
});

type HarnessOptions = Readonly<{
  manifests?: OperationManifestRegistry;
  policy?: ConnectorDestinationPolicy;
  readiness?: Readonly<{ snapshot(): Readonly<{ ready: boolean }> }>;
  resolver?: jest.Mock;
  responseBody?: string;
  credentialProviderKey?: string;
  credentialHandle?: string;
  clock?: () => number;
  requestFactory?: jest.Mock;
}>;

async function createHarness(options: HarnessOptions = {}) {
  const profiles = serviceProofFixtureSet();
  const authenticator = new ExactRawBodyAuthenticator(
    new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([
      profiles.central.config, profiles.bridge.config, profiles.customerB.config
    ]), () => NOW),
    new ReplayProtectionService(64, () => NOW)
  );
  let entropy = 1;
  const store = new InMemoryConnectorBindingStore(
    { maxEntries: 16, scopeMaxEntries: 16, sweepBatchSize: 16 },
    { nowSeconds: () => NOW, randomBytes: () => Buffer.alloc(32, entropy++) }
  );
  const handleRevoke = jest.fn().mockResolvedValue(undefined);
  const bindings = new ConnectorBindingService(store, { revoke: handleRevoke });
  const credentialProviderKey = options.credentialProviderKey ?? 'customer-b-provider-v1';
  const credentialHandle = options.credentialHandle ?? 'customer-b-handle';
  const minted = await bindings.mint(bindingInput(CONTEXT, credentialProviderKey, credentialHandle));
  if (!minted.ok) throw new Error('invocation harness binding');
  const fixtures = credentialFixtures();
  const credentialResolve = jest.spyOn(fixtures.apiKeyProvider, 'resolve');
  const credentials = new CredentialExecutionBoundary(new CredentialProfileRegistry(
    profileConfigurations, [fixtures.bearerProvider, fixtures.apiKeyProvider], [fixtures.bearerStrategy, fixtures.apiKeyStrategy]
  ));
  const manifests = options.manifests ?? new OperationManifestRegistry([parsedManifest('inventory', [customerBOperation()])]);
  const policy = options.policy ?? new ConnectorDestinationPolicy([{
    upstreamServiceRef: 'inventory-api', origin: 'https://inventory.test', basePath: '/', addressMode: 'public_only', allowedCidrs: []
  }], 'production');
  const resolver = options.resolver ?? jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  const responseBody = options.responseBody ?? '{"sku":"SKU-1","quantity":9}';
  const httpRequest = options.requestFactory ?? jest.fn((_requestOptions: object, callback: (response: unknown) => void) => {
    const outgoing = new EventEmitter() as EventEmitter & { write: jest.Mock; end(): void; destroy: jest.Mock };
    outgoing.write = jest.fn();
    outgoing.destroy = jest.fn();
    outgoing.end = () => callback(Object.assign(new EventEmitter(), {
      statusCode: 200, headers: { 'content-type': 'application/json' }, destroy: jest.fn(),
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(responseBody); }
    }));
    return outgoing;
  });
  const extractor = new ManifestResponseExtractor();
  const extract = jest.spyOn(extractor, 'extract');
  const upstream = new UpstreamExecutionService(
    policy, new SafeUpstreamHttpClient(httpRequest as never), resolver,
    new BoundedJsonResponse(), extractor
  );
  const readiness = options.readiness ?? { snapshot: () => ({ ready: true }) };
  const service = new ConnectorInvocationService(authenticator, readiness, bindings, manifests, credentials, upstream, options.clock);
  return { profiles, service, bindings, reference: minted.value.connectorContextRef, credentialResolve, resolver, httpRequest, extract, handleRevoke };
}

function bindingInput(context: ConnectorBindingTrustedContextV1, credentialProviderKey: string, opaqueCredentialHandle: string) {
  return {
    trustedContext: context,
    bootstrapProviderKey: 'customer-b-bootstrap-provider-v1',
    credentialProviderKey,
    opaqueCredentialHandle,
    credentialGeneration: 'credential-generation-1',
    providerMetadata: {}
  };
}

type RequestOverrides = Readonly<{
  context?: ConnectorBindingTrustedContextV1;
  operationKey?: string;
  operationVersion?: string;
  argumentsValue?: object;
  remainingBudgetMs?: number;
}>;

function requestFixture(reference: string, overrides: RequestOverrides = {}) {
  const requestId = randomUUID();
  const context = overrides.context ?? CONTEXT;
  const operationKey = overrides.operationKey ?? 'inventory.stock-on-hand';
  const operationVersion = overrides.operationVersion ?? '1.0.0';
  const body = {
    version: '1', requestId, remainingBudgetMs: overrides.remainingBudgetMs ?? 4500,
    trustedContext: { ...context, connectorKey: 'inventory' },
    operation: { key: operationKey, version: operationVersion, arguments: overrides.argumentsValue ?? { sku: 'SKU-1' } },
    connectorContextRef: reference
  };
  return { requestId, context, operationKey, operationVersion, rawBody: Buffer.from(JSON.stringify(body)) };
}

async function authorizationFor(profile: TestProfile, request: ReturnType<typeof requestFixture>): Promise<string> {
  return `Bearer ${await signServiceProof(profile, proofOverrides(request))}`;
}

function proofOverrides(request: ReturnType<typeof requestFixture>) {
  return {
    request_id: request.requestId, body_sha256: bodyDigest(request.rawBody), jti: randomUUID(),
    customer_id: request.context.customerId, integration_id: request.context.integrationId,
    host_app: request.context.hostApp, connector_instance_id: request.context.connectorInstanceId,
    connector_key: 'inventory', operation: request.operationKey, operation_version: request.operationVersion
  };
}

function input(request: ReturnType<typeof requestFixture>, authorization: string) {
  return {
    method: 'POST', contentType: 'application/json', authorization,
    requestIdHeader: request.requestId, rawBody: request.rawBody
  };
}

async function invoke(harness: Awaited<ReturnType<typeof createHarness>>, request: ReturnType<typeof requestFixture>) {
  return harness.service.handle(input(request, await authorizationFor(harness.profiles.central, request)));
}

async function invokeThroughController(harness: Awaited<ReturnType<typeof createHarness>>, invocation: ReturnType<typeof requestFixture>) {
  const authorization = await authorizationFor(harness.profiles.central, invocation);
  const controller = new ConnectorInvocationController(harness.service, { nowMilliseconds: () => 0 });
  const request = Object.assign(new EventEmitter(), {
    method: 'POST', pause: jest.fn(), socket: { destroy: jest.fn() },
    headers: {
      'content-type': 'application/json', authorization, 'x-request-id': invocation.requestId,
      'content-length': String(invocation.rawBody.byteLength)
    }
  });
  const response = Object.assign(new EventEmitter(), {
    writableFinished: false,
    setHeader: jest.fn(), status: jest.fn(), type: jest.fn(), send: jest.fn()
  });
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  response.send.mockImplementation(() => { response.writableFinished = true; response.emit('finish'); return response; });
  const pending = controller.invoke(request as never, response as never);
  request.emit('data', invocation.rawBody);
  request.emit('end');
  return { pending, request, response };
}

async function userToken(profile: TestProfile): Promise<string> {
  return new SignJWT({ sub: 'actor', organization_id: 'organization' })
    .setProtectedHeader({ alg: 'RS256', kid: profile.config.keys[0]?.kid, typ: 'JWT' })
    .sign(profile.privateKey);
}

function expectUnreached(harness: Awaited<ReturnType<typeof createHarness>>, gates: Readonly<{ credential?: boolean; http?: boolean; extraction?: boolean }>) {
  if (gates.credential) expect(harness.credentialResolve).not.toHaveBeenCalled();
  if (gates.http) expect(harness.httpRequest).not.toHaveBeenCalled();
  if (gates.extraction) expect(harness.extract).not.toHaveBeenCalled();
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('condition not reached');
}
