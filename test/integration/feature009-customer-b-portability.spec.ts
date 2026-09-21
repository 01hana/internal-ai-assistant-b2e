import { createHash, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import type {
  ConnectorBindingTrustedContextV1,
  ExecutionScopedCredentialMaterial,
  ValidatedProviderPayload
} from '@internal-ai-assistant/connector-runtime-contract';
import { CustomerConnectorRuntimeModule } from '../../apps/customer-connector-runtime/src/customer-connector-runtime.module';
import {
  opaqueCredentialHandle,
  type BindingBootstrapProvider,
  type OpaqueCredentialHandle
} from '../../apps/customer-connector-runtime/src/bindings/binding-bootstrap-provider';
import {
  appliedCredentialRequest,
  executionScopedCredentialMaterial,
  type CredentialApplicationStrategy,
  type CredentialProvider
} from '../../apps/customer-connector-runtime/src/credentials/credential.types';
import type { MappedReadRequest } from '../../apps/customer-connector-runtime/src/manifest/request-profile.registry';
import { ConnectorDestinationPolicy } from '../../apps/customer-connector-runtime/src/upstream/connector-destination-policy';
import { SafeUpstreamHttpClient } from '../../apps/customer-connector-runtime/src/upstream/safe-upstream-http-client';
import { UpstreamExecutionService } from '../../apps/customer-connector-runtime/src/upstream/upstream-execution.service';
import { RuntimeReadinessRegistry } from '../../apps/customer-connector-runtime/src/health/readiness.service';
import { customerBOperation } from '../../apps/customer-connector-runtime/test/fixtures/phase5-manifests';
import { ProductizedBusinessConnectorTransportService } from '../../src/connectors/productized-business/productized-business-connector.module';
import { createProductizedAdapterRegistrations } from '../../src/connectors/productized-business/productized-adapter-binding.registry';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { createEphemeralTlsTestFixture, type EphemeralTlsTestFixture } from '../../apps/customer-connector-runtime/test/fixtures/ephemeral-tls-test-fixture';

const TLS_HOST = 'phase6-upstream.test';
let tlsFixture: EphemeralTlsTestFixture;
const CONTEXT: ConnectorBindingTrustedContextV1 = Object.freeze({
  customerId: 'customer-b', integrationId: 'inventory-b', hostApp: 'customer-b-inventory',
  connectorInstanceId: 'customer-b-inventory-connector-1', organizationId: 'org-shared', actorId: 'actor-shared'
});
const API_KEY = 'customer-b-api-key-sentinel';

describe('Feature 009 Synthetic Customer B portability', () => {
  beforeAll(async () => { tlsFixture = await createEphemeralTlsTestFixture(); });
  afterAll(async () => { await tlsFixture.dispose(); });

  it('executes the natural-language POST-query vertical with no Shinmone registration in the topology', async () => {
    const upstreamRequests: Array<Readonly<{
      method?: string; url?: string; apiKey?: string; authorization?: string; body: string
    }>> = [];
    const upstream = createServer({ cert: tlsFixture.certificate, key: tlsFixture.privateKey }, (incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on('end', () => {
        upstreamRequests.push(Object.freeze({
          method: incoming.method,
          url: incoming.url,
          apiKey: header(incoming.headers['x-inventory-key']),
          authorization: header(incoming.headers.authorization),
          body: Buffer.concat(chunks).toString('utf8')
        }));
        response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'identity' });
        response.end(JSON.stringify({ sku: 'SKU-B-001', quantity: 23 }));
      });
    });
    await listen(upstream);

    const bootstrapPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const bootstrapJwk = publicJwk(bootstrapPair.publicKey, 'customer-b-bootstrap-key');
    const centralPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const centralJwk = publicJwk(centralPair.publicKey, 'customer-b-central-key');
    const provider = new CustomerBFixtureProvider();
    const strategy = customerBStrategy();
    const manifestPath = readOnlyManifest();
    const runtimeEnvironment = runtimeEnvironmentFor(
      bootstrapJwk,
      centralJwk,
      manifestPath,
      (upstream.address() as AddressInfo).port
    );
    const runtimeModule = await Test.createTestingModule({
      imports: [CustomerConnectorRuntimeModule.forEnvironment(runtimeEnvironment, [provider], {
        credentialProviders: [provider], credentialStrategies: [strategy]
      })]
    })
      .overrideProvider(UpstreamExecutionService)
      .useValue(new UpstreamExecutionService(
        new ConnectorDestinationPolicy(JSON.parse(String(runtimeEnvironment.CONNECTOR_UPSTREAMS_JSON)), 'test'),
        new SafeUpstreamHttpClient((options, callback) => httpsRequest({ ...options, ca: tlsFixture.certificate }, callback)),
        async () => [{ address: '127.0.0.1', family: 4 }]
      ))
      .compile();
    const runtimeApp = runtimeModule.createNestApplication({ bodyParser: false });
    await runtimeApp.init();
    const runtimeReadiness = runtimeModule.get(RuntimeReadinessRegistry);
    runtimeReadiness.setReady('upstream', true);
    runtimeReadiness.setReady('invocationRoute', true);
    const runtimeServer = createServer({ cert: tlsFixture.certificate, key: tlsFixture.privateKey }, runtimeApp.getHttpAdapter().getInstance());
    await listen(runtimeServer);

    const binding = await mintBinding(
      (runtimeServer.address() as AddressInfo).port,
      bootstrapPair.privateKey,
      'customer-b-bootstrap-key'
    );
    const signingDirectory = mkdtempSync(join(tmpdir(), 'phase13-customer-b-central-'));
    const privateKeyPath = join(signingDirectory, 'active.pem');
    writeFileSync(privateKeyPath, centralPair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const centralTransport = new ProductizedBusinessConnectorTransportService({
      environment: centralEnvironment(privateKeyPath, centralJwk, (runtimeServer.address() as AddressInfo).port),
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => httpsRequest({ ...options, ca: tlsFixture.certificate }, callback)
    });
    const assistant = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ toolRegistry, mockRegistrations }) => Object.freeze([
        ...mockRegistrations,
        ...createProductizedAdapterRegistrations({
          ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON: JSON.stringify([adapterBinding()])
        }, toolRegistry, centralTransport)
      ])
    });
    const hiddenSession = assistant.state.sessions.find(({ id }) => id === 'session-hidden-001');
    if (!hiddenSession) throw new Error('Customer B session fixture missing.');
    hiddenSession.hostApp = CONTEXT.hostApp;

    try {
      expect(assistant.state.toolDefinitions.some(({ name }) => name === 'work-orders.monthly-new-count')).toBe(true);
      assistant.state.toolDefinitions.splice(
        0,
        assistant.state.toolDefinitions.length,
        ...assistant.state.toolDefinitions.filter(({ name }) => name !== 'work-orders.monthly-new-count')
      );
      assistant.state.customerToolPolicies.splice(
        0,
        assistant.state.customerToolPolicies.length,
        ...assistant.state.customerToolPolicies.filter(({ toolDefinitionId }) =>
          toolDefinitionId !== 'tool-definition-shinmone-monthly-new-count-001')
      );
      expect(assistant.state.toolDefinitions.some(({ name }) => name === 'work-orders.monthly-new-count')).toBe(false);

      const response = await requestAssistant(assistant.app.getHttpServer(), binding.connectorContextRef);
      expect(response.status).toBe(200);
      const events = parseSseResponse(response.text);
      expect(events.map(({ event }) => event)).toEqual([
        'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
      ]);
      expect(upstreamRequests).toEqual([{
        method: 'POST', url: '/inventory/stock/query', apiKey: API_KEY,
        authorization: undefined, body: '{"scope":"available","sku":"SKU-B-001"}'
      }]);
      const toolCall = assistant.state.toolCalls.at(-1);
      const evidence = assistant.state.evidenceRefs.at(-1);
      expect(toolCall).toMatchObject({
        customerId: 'customer-b', toolName: 'inventory.stock-on-hand', toolVersion: '1.0.0',
        status: 'success', executionStatus: 'executed'
      });
      expect(toolCall?.outputSummary).toEqual({
        canonicalToolKey: 'inventory.stock-on-hand', schemaVersion: '1.0.0',
        fieldPaths: ['quantity', 'sku'], fieldCount: 2, evidenceProvenanceFields: ['sku']
      });
      expect(evidence).toEqual(expect.objectContaining({
        customerId: 'customer-b', sourceId: 'SKU-B-001', fieldPaths: ['quantity', 'sku'],
        summary: { fields: { quantity: 23, sku: 'SKU-B-001' } }
      }));
      expect(assistant.state.answerDecisions.at(-1)).toEqual(expect.objectContaining({ status: 'answered' }));
      const released = JSON.stringify({ response: response.text, toolCall, evidence });
      expect(released).not.toContain(API_KEY);
      expect(released).not.toContain(binding.connectorContextRef);
      expect(released).not.toContain('X-Inventory-Key');
      expect(released).not.toContain('work-orders.monthly-new-count');
      expect(provider.resolveCalls).toBe(1);
    } finally {
      await assistant.app.close();
      await close(runtimeServer);
      await runtimeApp.close();
      await close(upstream);
    }
  }, 30_000);
});

class CustomerBFixtureProvider implements BindingBootstrapProvider, CredentialProvider {
  readonly bootstrapProviderKey = 'customer-b-bootstrap-provider-v1';
  readonly serviceProfileKey = 'CUSTOMER_B_BOOTSTRAP_V1';
  readonly key = 'customer-b-provider-v1';
  readonly credentialKind = 'fixed-api-key-v1';
  readonly contract = {
    profileKey: this.serviceProfileKey,
    maxProviderPayloadBytes: 512,
    parseProviderPayload: (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).join(',') !== 'apiKey' ||
          typeof (value as { apiKey?: unknown }).apiKey !== 'string') {
        return { ok: false, code: 'CONNECTOR_REQUEST_INVALID' } as const;
      }
      return { ok: true, value: Object.freeze({ apiKey: (value as { apiKey: string }).apiKey }) } as const;
    }
  };
  private readonly values = new Map<string, Readonly<{ apiKey: string; context: string; generation: string }>>();
  private readonly counters = { resolve: 0 };
  get resolveCalls(): number { return this.counters.resolve; }

  async create(payload: ValidatedProviderPayload<string, unknown>, trustedContext: ConnectorBindingTrustedContextV1) {
    const apiKey = (payload as unknown as { apiKey: string }).apiKey;
    const handle = opaqueCredentialHandle(`customer-b-${randomUUID()}`)!;
    const generation = 'customer-b-credential-generation-1';
    this.values.set(handle, Object.freeze({ apiKey, context: JSON.stringify(trustedContext), generation }));
    return Object.freeze({
      credentialProviderKey: this.key, opaqueCredentialHandle: handle,
      credentialGeneration: generation, providerMetadata: Object.freeze({ fixture: 'customer-b' })
    });
  }

  async resolve(handle: string, trustedContext: ConnectorBindingTrustedContextV1, credentialGeneration: string) {
    this.counters.resolve += 1;
    const stored = this.values.get(handle);
    if (!stored || stored.context !== JSON.stringify(trustedContext) || stored.generation !== credentialGeneration) {
      throw new Error('customer-b-provider-rejected');
    }
    return executionScopedCredentialMaterial({ secret: stored.apiKey });
  }

  async revoke(handle: OpaqueCredentialHandle): Promise<void> {
    this.values.delete(handle);
  }
}

function customerBStrategy(): CredentialApplicationStrategy {
  return Object.freeze({
    key: 'customer-b-fixed-key-strategy-v1', credentialKind: 'fixed-api-key-v1',
    apply(material: ExecutionScopedCredentialMaterial, request: MappedReadRequest) {
      return appliedCredentialRequest({
        request,
        'X-Inventory-Key': (material as unknown as { secret: string }).secret
      });
    }
  });
}

function runtimeEnvironmentFor(
  bootstrapJwk: Readonly<Record<string, unknown>>,
  centralJwk: Readonly<Record<string, unknown>>,
  manifestPath: string,
  upstreamPort: number
) {
  const baseContext = {
    customerId: CONTEXT.customerId, integrationId: CONTEXT.integrationId,
    hostApp: CONTEXT.hostApp, connectorInstanceId: CONTEXT.connectorInstanceId
  };
  return {
    CONNECTOR_RUNTIME_PROCESS_ROLE: 'single-replica', CONNECTOR_REPLAY_CACHE_MAX_ENTRIES: '64',
    CONNECTOR_BINDING_STORE_MAX_ENTRIES: '4096', CONNECTOR_BINDING_SCOPE_MAX_ENTRIES: '64',
    CONNECTOR_BINDING_SWEEP_BATCH_SIZE: '128', CONNECTOR_RUNTIME_CONTEXT_JSON: JSON.stringify([baseContext]),
    CONNECTOR_CENTRAL_TRUST_KEYS_JSON: JSON.stringify([{
      kind: 'central-invocation', profileKey: 'central-customer-b-v1', typ: 'assistant-connector-service+jwt',
      issuer: 'urn:assistant:connector', subject: 'central-adapter',
      audience: 'urn:assistant:connector:customer-b:inventory-b:customer-b-inventory:business:customer-b-inventory-connector-1',
      keyDomain: 'central-customer-b-domain', trustedContext: baseContext,
      keys: [{ kid: 'customer-b-central-key', status: 'active', publicJwk: centralJwk }]
    }]),
    CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON: JSON.stringify([{
      kind: 'binding-bootstrap', profileKey: 'CUSTOMER_B_BOOTSTRAP_V1', typ: 'customer-bootstrap+jwt',
      issuer: 'urn:customer-b:bootstrap', subject: 'customer-b-bootstrapper',
      audience: 'urn:connector-binding:customer-b', keyDomain: 'customer-b-bootstrap-domain',
      trustedContext: baseContext,
      keys: [{ kid: 'customer-b-bootstrap-key', status: 'active', publicJwk: bootstrapJwk }],
      providerKey: 'customer-b-bootstrap-provider-v1'
    }]),
    CONNECTOR_MANIFEST_FILES: JSON.stringify([manifestPath]),
    CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([{
      credentialProfileRef: 'customer-b-inventory-api-key-v1', credentialProviderKey: 'customer-b-provider-v1',
      applicationStrategyKey: 'customer-b-fixed-key-strategy-v1', credentialKind: 'fixed-api-key-v1'
    }]),
    CONNECTOR_UPSTREAMS_JSON: JSON.stringify([{
      upstreamServiceRef: 'inventory-api', origin: `https://${TLS_HOST}:${upstreamPort}`, basePath: '/',
      addressMode: 'test_loopback_tls', allowedCidrs: ['127.0.0.0/8']
    }])
  };
}

function centralEnvironment(privateKeyPath: string, centralJwk: Readonly<Record<string, unknown>>, runtimePort: number) {
  return {
    ASSISTANT_CONNECTOR_SERVICE_ISSUER: 'urn:assistant:connector',
    ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON: JSON.stringify([{
      version: '1', active: true, customerId: CONTEXT.customerId, integrationId: CONTEXT.integrationId,
      hostApp: CONTEXT.hostApp, connectorKey: 'business', connectorInstanceId: CONTEXT.connectorInstanceId,
      invocationUri: `https://${TLS_HOST}:${runtimePort}/v1/connector/invocations`,
      serviceAuthProfileKey: 'central-customer-b-v1', destinationPolicy: { mode: 'public_only', allowedCidrs: [] },
      maxRequestBytes: 16_384, maxResponseBytes: 16_384, maxTransportMs: 4_500
    }]),
    ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON: JSON.stringify([{
      profileKey: 'central-customer-b-v1', typ: 'assistant-connector-service+jwt', subject: 'central-adapter',
      keyDomain: 'central-customer-b-domain', keys: [{
        kid: 'customer-b-central-key', status: 'active', publicJwk: centralJwk,
        privateKeyReference: `file://${privateKeyPath}`
      }]
    }])
  };
}

function adapterBinding() {
  return {
    version: '1', active: true, customerId: CONTEXT.customerId, integrationId: CONTEXT.integrationId,
    hostApp: CONTEXT.hostApp, connectorKey: 'business', connectorInstanceId: CONTEXT.connectorInstanceId,
    operations: [{ key: 'inventory.stock-on-hand', version: '1.0.0' }]
  };
}

function readOnlyManifest(): string {
  const directory = mkdtempSync(join(tmpdir(), 'phase13-customer-b-manifest-'));
  const path = join(directory, 'customer-b.json');
  writeFileSync(path, JSON.stringify({ version: '1', connectorKey: 'business', operations: [customerBOperation()] }));
  chmodSync(path, 0o444);
  return path;
}

async function mintBinding(runtimePort: number, privateKey: KeyObject, kid: string) {
  const requestId = randomUUID();
  const body = {
    version: '1', requestId, bootstrapProfileKey: 'CUSTOMER_B_BOOTSTRAP_V1',
    trustedContext: CONTEXT, providerPayload: { apiKey: API_KEY }
  };
  const bytes = Buffer.from(JSON.stringify(body));
  const now = Math.floor(Date.now() / 1_000);
  const proof = await new SignJWT({
    iss: 'urn:customer-b:bootstrap', sub: 'customer-b-bootstrapper', aud: 'urn:connector-binding:customer-b',
    iat: now, nbf: now, exp: now + 30, jti: randomUUID(), proof_version: 1,
    customer_id: CONTEXT.customerId, integration_id: CONTEXT.integrationId, host_app: CONTEXT.hostApp,
    connector_instance_id: CONTEXT.connectorInstanceId, organization_id: CONTEXT.organizationId,
    actor_id: CONTEXT.actorId, bootstrap_profile_key: 'CUSTOMER_B_BOOTSTRAP_V1',
    provider_key: 'customer-b-bootstrap-provider-v1', request_id: requestId,
    body_sha256: createHash('sha256').update(bytes).digest('base64url')
  }).setProtectedHeader({ alg: 'RS256', kid, typ: 'customer-bootstrap+jwt' }).sign(privateKey);

  return new Promise<{ connectorContextRef: string; expiresIn: number }>((resolve, reject) => {
    const outgoing = httpsRequest({
      hostname: TLS_HOST, port: runtimePort, path: '/v1/internal/connector-bindings', method: 'POST',
      ca: tlsFixture.certificate, rejectUnauthorized: true, servername: TLS_HOST, agent: false,
      lookup: (_hostname: string, options: { all?: boolean }, callback: (...values: any[]) => void) => {
        if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
        else callback(null, '127.0.0.1', 4);
      },
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity',
        'Content-Length': bytes.length, 'X-Request-Id': requestId, Authorization: `Bearer ${proof}`
      }
    } as any, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        if (response.statusCode !== 200 || typeof parsed.connectorContextRef !== 'string') {
          reject(new Error(`Customer B binding mint failed: ${response.statusCode} ${JSON.stringify(parsed)}`));
          return;
        }
        resolve(parsed as { connectorContextRef: string; expiresIn: number });
      });
    });
    outgoing.once('error', reject);
    outgoing.end(bytes);
  });
}

function requestAssistant(server: unknown, connectorContextRef: string) {
  const supertest = require('supertest') as typeof import('supertest');
  return supertest(server as never)
    .post('/api/v1/assistant/sessions/session-hidden-001/messages')
    .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
      claims: {
        customer_id: CONTEXT.customerId, integration_id: CONTEXT.integrationId, host_app: CONTEXT.hostApp,
        org_id: CONTEXT.organizationId, sub: CONTEXT.actorId, permission_scopes: ['inventory:read']
      },
      requestId: 'req-phase13-customer-b-portability'
    }))
    .send({
      message: '請查 SKU-B-001 庫存',
      pageContext: { module: 'inventory', connectorContextRef }
    });
}

function publicJwk(key: KeyObject, kid: string) {
  return Object.freeze({ ...key.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
}

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
