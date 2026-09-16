import { generateKeyPairSync } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
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
import { RuntimeReadinessRegistry } from '../../apps/customer-connector-runtime/src/health/readiness.service';
import { createShinmoneRuntimeIntegration } from '../../apps/customer-connector-runtime/integrations/shinmone';
import { BridgeModule } from '../../apps/identity-bridge/src/bridge.module';
import { BridgeConfigService } from '../../apps/identity-bridge/src/config/bridge-config.service';
import { BRIDGE_ENVIRONMENT } from '../../apps/identity-bridge/src/config/bridge-config.service';
import { ConnectorBindingClient } from '../../apps/identity-bridge/src/connector-binding/connector-binding.client';
import { bindingEnvironment } from '../../apps/identity-bridge/test/connector-binding/binding-fixtures';
import { response as menuDetailResponse } from '../../apps/identity-bridge/test/fixtures/idx-semantic.vectors';
import { MenuDetailTransport } from '../../apps/identity-bridge/src/idx/transport/menu-detail.transport';
import { ProductizedBusinessConnectorTransportService } from '../../src/connectors/productized-business/productized-business-connector.module';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { seedCoreData } from '../../scripts/seed';
import { createGatewayBackendTrustChainHarness } from '../support/gateway-backend-trust-chain-harness';
import { createGatewayUpstreamTestAuthority } from '../support/gateway-upstream-test-authority';
import { parseSseResponse } from '../support/us1-test-app.helper';
import { shinmoneAdapterBinding, shinmoneConnectorDeployment } from '../support/shinmone-reference.fixture';

const TLS_HOST = 'phase6-upstream.test';
const CERTIFICATE = readFileSync('apps/customer-connector-runtime/test/fixtures/phase6-upstream.crt');
const PRIVATE_KEY = readFileSync('apps/customer-connector-runtime/test/fixtures/phase6-upstream.key');

describe('Feature 009 Shinmone reference fixture vertical slice', () => {
  it('answers the real question through Bridge admission, generic discovery, exact signed transports, projection, evidence, and existing SSE', async () => {
    const upstreamRequests: Array<Readonly<{ method?: string; url?: string; authorization?: string }>> = [];
    const nativeAccessToken = unsignedNativeJwt({
      exp: 4_102_444_800,
      sub: 'actor-shared', UUID_User: 'actor-shared', UUID_Company: 'org-shared', UUID_Entry: 'configured-entry'
    });
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
        customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'admin',
        connectorInstanceId: 'shinmone-scm-connector-1'
      },
      override: { BRIDGE_INTEGRATION_ID: 'integration-a', BRIDGE_HOST_APP: 'admin' }
    });
    const bridgeInitial = new BridgeConfigService(bridgeBase).configuration.connectorBinding!;
    const bridgeIdentityPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const bridgeIdentityJwk = Object.freeze({
      ...bridgeIdentityPair.publicKey.export({ format: 'jwk' }), kid: 'phase11-bridge-identity', alg: 'RS256', use: 'sig'
    });
    const bridgeSigningDirectory = mkdtempSync(join(tmpdir(), 'phase11-bridge-'));
    const bridgePrivateKeyPath = join(bridgeSigningDirectory, 'active.pem');
    writeFileSync(bridgePrivateKeyPath, bridgeIdentityPair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const upstreamAuthority = await createGatewayUpstreamTestAuthority({
      signing: { privateKey: bridgeIdentityPair.privateKey, publicKey: bridgeIdentityPair.publicKey, kid: 'phase11-bridge-identity' }
    });
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
    const runtimeReadiness = runtimeModule.get(RuntimeReadinessRegistry);
    runtimeReadiness.setReady('upstream', true);
    runtimeReadiness.setReady('invocationRoute', true);
    const runtimeServer = createServer({ cert: CERTIFICATE, key: PRIVATE_KEY }, runtimeApp.getHttpAdapter().getInstance());
    await listen(runtimeServer);

    const bridgeEnvironment = {
      ...bridgeBase,
      BRIDGE_ISSUER: upstreamAuthority.issuer,
      BRIDGE_AUDIENCE: upstreamAuthority.audience,
      BRIDGE_JWKS_PUBLIC_URI: upstreamAuthority.jwksUri,
      BRIDGE_SIGNING_KEYS: JSON.stringify([{
        kid: 'phase11-bridge-identity', status: 'active', publicJwk: bridgeIdentityJwk,
        keyReference: `file://${bridgePrivateKeyPath}`
      }]),
      BRIDGE_CONNECTOR_BINDING_URI: `https://${TLS_HOST}:${(runtimeServer.address() as AddressInfo).port}/v1/internal/connector-bindings`
    };
    const bridgeConfig = new BridgeConfigService(bridgeEnvironment);
    const bridgeBindingClient = new ConnectorBindingClient(bridgeConfig, {
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => httpsRequest({ ...options, ca: CERTIFICATE }, callback)
    });
    const bridgeModule = await Test.createTestingModule({ imports: [BridgeModule] })
      .overrideProvider(BRIDGE_ENVIRONMENT)
      .useValue(bridgeEnvironment)
      .overrideProvider(MenuDetailTransport)
      .useValue({ execute: jest.fn(async (token: string) => {
        if (token !== nativeAccessToken) throw new Error('Unexpected synthetic native token.');
        return { body: menuDetailResponse() };
      }) })
      .overrideProvider(ConnectorBindingClient)
      .useValue(bridgeBindingClient)
      .compile();
    const bridge = bridgeModule.createNestApplication();
    await bridge.init();
    const signingDirectory = mkdtempSync(join(tmpdir(), 'phase11-central-'));
    const privateKeyPath = join(signingDirectory, 'active.pem');
    writeFileSync(privateKeyPath, centralPair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const centralTransport = new ProductizedBusinessConnectorTransportService({
      environment: centralEnvironment(privateKeyPath, centralJwk, (runtimeServer.address() as AddressInfo).port),
      allowTestLoopbackTls: true,
      resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      requestFactory: (options, callback) => httpsRequest({ ...options, ca: CERTIFICATE }, callback)
    });
    const gateway = await createGatewayBackendTrustChainHarness({
      label: 'shinmone-local-product-rehearsal',
      bindings: [{ customerId: 'customer-a', integrationId: 'integration-a', allowedHostApp: 'admin' }],
      upstreamAuthority,
      backend: {
        environment: {
          ...centralEnvironment(privateKeyPath, centralJwk, (runtimeServer.address() as AddressInfo).port),
          ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON: JSON.stringify([shinmoneAdapterBinding({
            integrationId: 'integration-a', hostApp: 'admin'
          })])
        },
        transport: centralTransport,
        setupDatabase: async ({ databaseUrl }) => {
          const prisma = createPrismaClient(databaseUrl);
          try {
            await seedCoreData(prisma);
          } finally {
            await prisma.$disconnect();
          }
        }
      }
    });

    try {
      const exchange = await request(bridge.getHttpServer())
        .post('/identity/exchange')
        .set('authorization', `Bearer ${nativeAccessToken}`)
        .set('x-request-id', 'req-phase11-bridge-exchange')
        .send({});

      expect(exchange.status).toBe(200);
      expect(exchange.body).toEqual(expect.objectContaining({
        accessToken: expect.any(String), tokenType: 'Bearer', expiresIn: 300,
        connectorContextRef: expect.stringMatching(/^ccr_[A-Za-z0-9_-]{1,128}$/), connectorContextExpiresIn: expect.any(Number)
      }));
      expect(bridgeModule.get(MenuDetailTransport).execute).toHaveBeenCalledWith(nativeAccessToken);
      const session = await request(gateway.gateway.getHttpServer())
        .post('/api/v1/assistant/sessions')
        .set('authorization', `Bearer ${exchange.body.accessToken}`)
        .set('x-request-id', 'req-phase11-gateway-session')
        .send({ pageContext: { module: 'work-orders' } });
      expect(session.status).toBe(201);
      expect(session.body).toEqual(expect.objectContaining({
        requestId: 'req-phase11-gateway-session', data: { sessionId: expect.any(String), status: 'active' }
      }));
      const response = await request(gateway.gateway.getHttpServer())
        .post(`/api/v1/assistant/sessions/${session.body.data.sessionId}/messages`)
        .set('authorization', `Bearer ${exchange.body.accessToken}`)
        .set('x-request-id', 'req-phase11-real-question')
        .send({
          message: '這個月新增幾張工單？',
          pageContext: { module: 'work-orders', connectorContextRef: exchange.body.connectorContextRef }
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
      expect(events.at(-1)?.data?.data).toEqual(expect.objectContaining({
        answerDecision: 'answered', answer: expect.any(String)
      }));
      expect(events.at(-1)?.data?.data.answer).toContain('17');

      runtimeReadiness.setReady('upstream', false);
      upstreamRequests.splice(0, upstreamRequests.length);
      let readinessResponse;
      try {
        readinessResponse = await request(gateway.gateway.getHttpServer())
          .post(`/api/v1/assistant/sessions/${session.body.data.sessionId}/messages`)
          .set('authorization', `Bearer ${exchange.body.accessToken}`)
          .set('x-request-id', 'req-phase13-runtime-not-ready')
          .send({
            message: '這個月新增幾張工單？',
            pageContext: { module: 'work-orders', connectorContextRef: exchange.body.connectorContextRef }
          });
      } finally {
        runtimeReadiness.setReady('upstream', true);
      }
      expect(readinessResponse.status).toBe(200);
      const readinessEvents = parseSseResponse(readinessResponse.text);
      expect(readinessEvents.map(({ event }) => event)).toEqual(['tool_call_started', 'tool_call_failed', 'answer_delta', 'final']);
      expect(readinessEvents.at(-1)?.data?.data).toEqual(expect.objectContaining({
        answerDecision: 'no_answer', noAnswerReason: 'tool_failure', evidenceRefs: []
      }));
      expect(readinessEvents.at(-1)?.data?.data.answer).not.toContain('17');
      expect(upstreamRequests).toEqual([]);

      const backendPrisma = createPrismaClient(process.env.DATABASE_URL!);
      try {
        const [toolCall, evidence, decision, readinessToolCall, readinessEvidence, readinessDecision] = await Promise.all([
          backendPrisma.toolCall.findFirst({ where: { customerId: 'customer-a', requestId: 'req-phase11-real-question' } }),
          backendPrisma.evidenceRef.findFirst({ where: { customerId: 'customer-a', requestId: 'req-phase11-real-question' } }),
          backendPrisma.answerDecision.findFirst({ where: { customerId: 'customer-a', requestId: 'req-phase11-real-question' } }),
          backendPrisma.toolCall.findFirst({ where: { customerId: 'customer-a', requestId: 'req-phase13-runtime-not-ready' } }),
          backendPrisma.evidenceRef.findFirst({ where: { customerId: 'customer-a', requestId: 'req-phase13-runtime-not-ready' } }),
          backendPrisma.answerDecision.findFirst({ where: { customerId: 'customer-a', requestId: 'req-phase13-runtime-not-ready' } })
        ]);
        expect(toolCall).toMatchObject({
          toolName: 'work-orders.monthly-new-count', toolVersion: '1.0.0', status: 'success', executionStatus: 'executed',
          permissionResult: { scopes: ['menu:ORDERS:read'] },
          outputSummary: {
            canonicalToolKey: 'work-orders.monthly-new-count', schemaVersion: '1.0.0',
            fieldPaths: ['count', 'metricKey', 'period'], fieldCount: 3,
            evidenceProvenanceFields: ['metricKey', 'period']
          }
        });
        expect(evidence).toMatchObject({
          sourceId: 'work-orders.monthly-new-count', fieldPaths: ['count', 'metricKey', 'period'],
          summary: { fields: { count: 17, metricKey: 'work-orders.monthly-new-count', period: 'thisMonth' } }
        });
        expect(decision).toMatchObject({ status: 'answered' });
        expect(readinessToolCall).toMatchObject({ status: 'failed', executionStatus: 'failed', errorCode: 'TOOL_EXECUTION_FAILED' });
        expect(readinessEvidence).toBeNull();
        expect(readinessDecision).toMatchObject({ status: 'no_answer' });
      } finally {
        await backendPrisma.$disconnect();
      }
      const released = response.text;
      expect(released).not.toContain(nativeAccessToken);
      expect(released).not.toContain(exchange.body.connectorContextRef);
      expect(released).not.toContain('configured-entry');
      expect(released).not.toContain('newOrders');
      expect(released).not.toContain('assistant-connector-service+jwt');
      if (process.env.FEATURE009_LOCAL_BROWSER_REHEARSAL === 'true') {
        const bridgeOrigin = await listenNestApplication(bridge);
        await runLocalBrowserRehearsal({ bridgeOrigin, gatewayOrigin: gateway.gatewayOrigin });
      }
    } finally {
      await gateway.dispose();
      await bridge.close();
      await upstreamAuthority.dispose();
      await new Promise<void>((resolve) => runtimeServer.close(() => resolve()));
      await runtimeApp.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 120_000);
});

function runtimeEnvironmentFor(
  binding: NonNullable<BridgeConfigService['configuration']['connectorBinding']>,
  centralJwk: Readonly<Record<string, unknown>>,
  integration: ReturnType<typeof createShinmoneRuntimeIntegration>,
  upstreamPort: number,
  mountedManifestPath: string
): Record<string, unknown> {
  const context = {
    customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'admin',
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
      audience: 'urn:assistant:connector:customer-a:integration-a:admin:business:shinmone-scm-connector-1',
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
    integrationId: 'integration-a', hostApp: 'admin',
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

function unsignedNativeJwt(claims: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'fixture-signature'
  ].join('.');
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
}

async function listenNestApplication(app: { listen(port: number, host: string): Promise<unknown>; getHttpServer(): { address(): AddressInfo | string | null } }): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('Local Bridge listener did not bind a TCP address.');
  return `http://127.0.0.1:${address.port}`;
}

async function runLocalBrowserRehearsal(input: Readonly<{ bridgeOrigin: string; gatewayOrigin: string }>): Promise<void> {
  const spaRoot = process.env.FEATURE009_LOCAL_SPA_WORKTREE;
  if (!spaRoot) throw new Error('FEATURE009_LOCAL_SPA_WORKTREE is required for the local browser rehearsal.');
  const spaPort = await reserveHttpPort();
  const spaOrigin = `http://127.0.0.1:${spaPort}`;
  const environment = safeSpaEnvironment({ ...input, spaOrigin, spaPort });
  const testHost = `${spaRoot}/tests/local-rehearsal`;
  await runCommand('npm', ['--prefix', spaRoot, 'exec', '--', 'nuxi', 'build', '--cwd', testHost], environment);
  const spa = spawn(globalThis.process.execPath, [join(testHost, '.output/server/index.mjs')], {
    detached: true,
    env: environment,
    stdio: 'pipe'
  });
  const output: string[] = [];
  spa.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  spa.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  try {
    await waitForSpa(spa, spaOrigin, output);
    await runCommand('npm', ['--prefix', spaRoot, 'run', 'test:local-rehearsal'], {
      ...environment,
      FEATURE009_LOCAL_SPA_ORIGIN: spaOrigin
    });
  } finally {
    await stopProcess(spa);
  }
}

function safeSpaEnvironment(input: Readonly<{ bridgeOrigin: string; gatewayOrigin: string; spaOrigin: string; spaPort: number }>): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG,
    TMPDIR: process.env.TMPDIR,
    USER: process.env.USER,
    FEATURE009_LOCAL_BRIDGE_ORIGIN: input.bridgeOrigin,
    FEATURE009_LOCAL_GATEWAY_ORIGIN: input.gatewayOrigin,
    FEATURE009_LOCAL_SPA_ORIGIN: input.spaOrigin,
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(input.spaPort)
  };
}

async function reserveHttpPort(): Promise<number> {
  const server = createHttpServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not reserve a local SPA port.');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function waitForSpa(process: ChildProcess, origin: string, output: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Local SPA exited before it became ready: ${output.join('').slice(-2_000)}`);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Local SPA did not become ready: ${output.join('').slice(-2_000)}`);
}

async function runCommand(command: string, arguments_: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, arguments_, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code ?? 'unknown'}.`)));
  });
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null || process.killed) return;
  const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
  if (process.pid) {
    try { globalThis.process.kill(-process.pid, 'SIGTERM'); }
    catch { process.kill('SIGTERM'); }
  } else {
    process.kill('SIGTERM');
  }
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    exited,
    new Promise<void>((resolve) => { timeout = setTimeout(resolve, 5_000); })
  ]);
  if (timeout) clearTimeout(timeout);
  if (process.exitCode === null && !process.killed) {
    if (process.pid) {
      try { globalThis.process.kill(-process.pid, 'SIGKILL'); }
      catch { process.kill('SIGKILL'); }
    } else {
      process.kill('SIGKILL');
    }
  }
}
