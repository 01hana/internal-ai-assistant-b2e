import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { CustomerConnectorRuntimeModule } from '../../apps/customer-connector-runtime/src/customer-connector-runtime.module';
import { UpstreamExecutionService } from '../../apps/customer-connector-runtime/src/upstream/upstream-execution.service';
import { ConnectorDestinationPolicy } from '../../apps/customer-connector-runtime/src/upstream/connector-destination-policy';
import { SafeUpstreamHttpClient } from '../../apps/customer-connector-runtime/src/upstream/safe-upstream-http-client';
import { createShinmoneRuntimeIntegration } from '../../apps/customer-connector-runtime/integrations/shinmone';
import { BridgeConfigService } from '../../apps/identity-bridge/src/config/bridge-config.service';
import { ConnectorBindingClient } from '../../apps/identity-bridge/src/connector-binding/connector-binding.client';
import { ConnectorBindingServiceAuthSigner } from '../../apps/identity-bridge/src/connector-binding/connector-binding-service-auth.signer';
import { bindingEnvironment } from '../../apps/identity-bridge/test/connector-binding/binding-fixtures';
import { ProductizedBusinessConnectorTransportService } from '../../src/connectors/productized-business/productized-business-connector.module';
import { createProductizedAdapterRegistrations } from '../../src/connectors/productized-business/productized-adapter-binding.registry';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { shinmoneAdapterBinding, shinmoneConnectorDeployment } from '../support/shinmone-reference.fixture';

const TLS_HOST = 'phase6-upstream.test';
const CERTIFICATE = readFileSync('apps/customer-connector-runtime/test/fixtures/phase6-upstream.crt');
const PRIVATE_KEY = readFileSync('apps/customer-connector-runtime/test/fixtures/phase6-upstream.key');

describe('Feature 009 Shinmone reference fixture vertical slice', () => {
  it('answers the real question through generic discovery, exact signed transports, projection, evidence, and existing SSE', async () => {
    const upstreamRequests: Array<Readonly<{ method?: string; url?: string; authorization?: string }>> = [];
    const nativeAccessToken = unsignedNativeJwt(Math.floor(Date.now() / 1000) + 120);
    const upstream = createServer({ cert: CERTIFICATE, key: PRIVATE_KEY }, (incoming, response) => {
      upstreamRequests.push(Object.freeze({
        method: incoming.method,
        url: incoming.url,
        authorization: typeof incoming.headers.authorization === 'string' ? incoming.headers.authorization : undefined
      }));
      response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'identity' });
      response.end(JSON.stringify({
        code: 200,
        metricKey: 'work-orders.monthly-new-count',
        period: 'thisMonth',
        data: { newOrders: { current: 17 } }
      }));
    });
    await listen(upstream);

    const bridgeBase = bindingEnvironment({
      contextOverride: {
        customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp',
        connectorInstanceId: 'shinmone-scm-connector-1'
      },
      override: { BRIDGE_INTEGRATION_ID: 'integration-erp', BRIDGE_HOST_APP: 'erp' }
    });
    const bridgeInitial = new BridgeConfigService(bridgeBase).configuration.connectorBinding!;
    const centralPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const centralJwk = Object.freeze({
      ...centralPair.publicKey.export({ format: 'jwk' }), kid: 'phase11-central', alg: 'RS256', use: 'sig'
    });
    const integration = createShinmoneRuntimeIntegration();
    const manifestDirectory = mkdtempSync(join(tmpdir(), 'phase11-manifest-'));
    const mountedManifestPath = join(manifestDirectory, 'shinmone.json');
    writeFileSync(mountedManifestPath, readFileSync(integration.manifestFiles[0]!, 'utf8'));
    chmodSync(mountedManifestPath, 0o444);
    const runtimeEnvironment = runtimeEnvironmentFor(
      bridgeInitial,
      centralJwk,
      integration,
      (upstream.address() as AddressInfo).port,
      mountedManifestPath
    );
    const runtimeModule = await Test.createTestingModule({
      imports: [CustomerConnectorRuntimeModule.forEnvironment(runtimeEnvironment, integration.bootstrapProviders, {
        credentialProviders: integration.credentialProviders,
        credentialStrategies: integration.credentialStrategies
      })]
    })
      .overrideProvider(UpstreamExecutionService)
      .useValue(new UpstreamExecutionService(
        new ConnectorDestinationPolicy(JSON.parse(String(runtimeEnvironment.CONNECTOR_UPSTREAMS_JSON)), 'test'),
        new SafeUpstreamHttpClient((options, callback) => httpsRequest({ ...options, ca: CERTIFICATE }, callback)),
        async () => [{ address: '127.0.0.1', family: 4 }]
      ))
      .compile();
    const runtimeApp = runtimeModule.createNestApplication({ bodyParser: false });
    await runtimeApp.init();
    const runtimeServer = createServer({ cert: CERTIFICATE, key: PRIVATE_KEY }, runtimeApp.getHttpAdapter().getInstance());
    await listen(runtimeServer);

    const bridgeConfig = new BridgeConfigService({
      ...bridgeBase,
      BRIDGE_CONNECTOR_BINDING_URI: `https://${TLS_HOST}:${(runtimeServer.address() as AddressInfo).port}/v1/internal/connector-bindings`
    });
    const bindingSigned = await new ConnectorBindingServiceAuthSigner(bridgeConfig).prepare({
      requestId: randomUUID(),
      nativeAccessToken,
      acceptedIdentity: { subject: 'actor-shared', organization: 'org-shared', entry: 'entry-shinmone' }
    });
    if (!bindingSigned.ok) throw new Error('Phase 11 binding signing fixture failed.');
    const bindingResult = await new ConnectorBindingClient(bridgeConfig, {
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => httpsRequest({ ...options, ca: CERTIFICATE }, callback)
    }).exchange(bindingSigned.value);
    if (!bindingResult.ok || 'status' in bindingResult.value) throw new Error('Phase 11 binding mint fixture failed.');

    const signingDirectory = mkdtempSync(join(tmpdir(), 'phase11-central-'));
    const privateKeyPath = join(signingDirectory, 'active.pem');
    writeFileSync(privateKeyPath, centralPair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const centralTransport = new ProductizedBusinessConnectorTransportService({
      environment: centralEnvironment(privateKeyPath, centralJwk, (runtimeServer.address() as AddressInfo).port),
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => httpsRequest({ ...options, ca: CERTIFICATE }, callback)
    });
    const assistant = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ toolRegistry, mockRegistrations }) => Object.freeze([
        ...mockRegistrations,
        ...createProductizedAdapterRegistrations({
          ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON: JSON.stringify([shinmoneAdapterBinding()])
        }, toolRegistry, centralTransport)
      ])
    });

    try {
      const response = await request(assistant.app.getHttpServer())
        .post('/api/v1/assistant/sessions/session-owned-001/messages')
        .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: { permission_scopes: ['work-orders:read'] },
          requestId: 'req-phase11-real-question'
        }))
        .send({
          message: '這個月新增幾張工單？',
          pageContext: { module: 'work-orders', connectorContextRef: bindingResult.value.connectorContextRef }
        });

      expect(response.status).toBe(200);
      const events = parseSseResponse(response.text);
      expect(events.map(({ event }) => event)).toEqual([
        'tool_call_started', 'tool_call_completed', 'evidence_attached', 'answer_delta', 'final'
      ]);
      expect(upstreamRequests).toEqual([{
        method: 'GET',
        url: '/Dashboard/KPIStats?TimeRange=thisMonth',
        authorization: `Bearer ${nativeAccessToken}`
      }]);
      const toolCall = assistant.state.toolCalls.at(-1);
      const evidence = assistant.state.evidenceRefs.at(-1);
      const decision = assistant.state.answerDecisions.at(-1);
      expect(toolCall).toMatchObject({
        toolName: 'work-orders.monthly-new-count', toolVersion: '1.0.0',
        status: 'success', executionStatus: 'executed', permissionResult: { scopes: ['work-orders:read'] }
      });
      expect(toolCall?.outputSummary).toEqual({
        canonicalToolKey: 'work-orders.monthly-new-count', schemaVersion: '1.0.0',
        fieldPaths: ['count', 'metricKey', 'period'], fieldCount: 3,
        evidenceProvenanceFields: ['metricKey', 'period']
      });
      expect(evidence).toEqual(expect.objectContaining({
        sourceId: 'work-orders.monthly-new-count',
        fieldPaths: ['count', 'metricKey', 'period'],
        summary: { fields: { count: 17, metricKey: 'work-orders.monthly-new-count', period: 'thisMonth' } }
      }));
      expect(decision).toEqual(expect.objectContaining({ status: 'answered' }));
      expect(events.at(-1)?.data?.data).toEqual(expect.objectContaining({
        answerDecision: 'answered', answer: expect.any(String)
      }));
      const released = JSON.stringify({ response: response.text, toolCall, evidence, decision });
      expect(released).not.toContain(nativeAccessToken);
      expect(released).not.toContain(bindingResult.value.connectorContextRef);
      expect(released).not.toContain('entry-shinmone');
      expect(released).not.toContain('newOrders');
      expect(released).not.toContain('assistant-connector-service+jwt');
    } finally {
      await assistant.app.close();
      await new Promise<void>((resolve) => runtimeServer.close(() => resolve()));
      await runtimeApp.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 30_000);
});

function runtimeEnvironmentFor(
  binding: NonNullable<BridgeConfigService['configuration']['connectorBinding']>,
  centralJwk: Readonly<Record<string, unknown>>,
  integration: ReturnType<typeof createShinmoneRuntimeIntegration>,
  upstreamPort: number,
  mountedManifestPath: string
): Record<string, unknown> {
  const context = {
    customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp',
    connectorInstanceId: 'shinmone-scm-connector-1'
  };
  return {
    CONNECTOR_RUNTIME_PROCESS_ROLE: 'single-replica', CONNECTOR_REPLAY_CACHE_MAX_ENTRIES: '64',
    CONNECTOR_BINDING_STORE_MAX_ENTRIES: '4096', CONNECTOR_BINDING_SCOPE_MAX_ENTRIES: '64',
    CONNECTOR_BINDING_SWEEP_BATCH_SIZE: '128',
    CONNECTOR_RUNTIME_CONTEXT_JSON: JSON.stringify([context]),
    CONNECTOR_CENTRAL_TRUST_KEYS_JSON: JSON.stringify([{
      kind: 'central-invocation', profileKey: 'central-shinmone-reference-v1', typ: 'assistant-connector-service+jwt',
      issuer: 'urn:assistant:connector', subject: 'central-adapter',
      audience: 'urn:assistant:connector:customer-a:integration-erp:erp:business:shinmone-scm-connector-1',
      keyDomain: 'central-shinmone-reference-domain', trustedContext: context,
      keys: [{ kid: 'phase11-central', status: 'active', publicJwk: centralJwk }]
    }]),
    CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON: JSON.stringify([{
      kind: 'binding-bootstrap', profileKey: binding.serviceAuth.profileKey, typ: binding.serviceAuth.typ,
      issuer: binding.serviceAuth.issuer, subject: binding.serviceAuth.subject, audience: binding.serviceAuth.audience,
      keyDomain: binding.serviceAuth.keyDomain, trustedContext: context,
      keys: binding.serviceAuth.keys.map((key) => ({ kid: key.kid, status: key.status, publicJwk: key.publicJwk })),
      providerKey: binding.context.providerKey
    }]),
    CONNECTOR_MANIFEST_FILES: JSON.stringify([mountedManifestPath]),
    CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify(integration.credentialProfiles),
    CONNECTOR_UPSTREAMS_JSON: JSON.stringify([{
      upstreamServiceRef: 'shinmone-scm-api', origin: `https://${TLS_HOST}:${upstreamPort}`, basePath: '/',
      addressMode: 'test_loopback_tls', allowedCidrs: ['127.0.0.0/8']
    }])
  };
}

function centralEnvironment(privateKeyPath: string, centralJwk: Readonly<Record<string, unknown>>, runtimePort: number) {
  const deployment = shinmoneConnectorDeployment({
    invocationUri: `https://${TLS_HOST}:${runtimePort}/v1/connector/invocations`
  });
  return {
    ASSISTANT_CONNECTOR_SERVICE_ISSUER: 'urn:assistant:connector',
    ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON: JSON.stringify([deployment]),
    ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON: JSON.stringify([{
      profileKey: deployment.serviceAuthProfileKey, typ: 'assistant-connector-service+jwt',
      subject: 'central-adapter', keyDomain: 'central-shinmone-reference-domain',
      keys: [{ kid: 'phase11-central', status: 'active', publicJwk: centralJwk, privateKeyReference: `file://${privateKeyPath}` }]
    }])
  };
}

function unsignedNativeJwt(exp: number): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ exp })).toString('base64url'),
    'fixture-signature'
  ].join('.');
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
}
