import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { seedCoreData } from '../../scripts/seed';
import { RegisterSigningKeyCommand } from '../../apps/gateway/src/commands/register-signing-key';
import { GatewayIdentityAuditWriter } from '../../apps/gateway/src/audit/gateway-identity-audit.writer';
import { createGatewayPrismaClient } from '../../apps/gateway/src/integration-registry/gateway-prisma-client.factory';
import { GatewaySigningKeyRepository } from '../../apps/gateway/src/signing/gateway-signing-key.repository';
import { KeyLifecycleService } from '../../apps/gateway/src/signing/key-lifecycle.service';
import { KeyRetirementPolicy } from '../../apps/gateway/src/signing/key-retirement-policy';
import { KeyRotationService } from '../../apps/gateway/src/signing/key-rotation.service';
import { SigningKeyProvider } from '../../apps/gateway/src/signing/signing-key-provider';
import { UnavailableSigningKeyPropagationVerifier } from '../../apps/gateway/src/signing/signing-key-propagation-verifier';
import { createEphemeralRsaFixture } from '../../apps/gateway/test/signing/ephemeral-rsa.fixture';
import { createGatewayRegistryDatabase } from '../support/gateway-registry-db.helper';
import { createGatewayUpstreamTestAuthority } from '../support/gateway-upstream-test-authority';

const describeRuntime = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const root = process.cwd();
const gatewayEntry = join(root, 'apps/gateway/dist/main.js');
const backendEntry = join(root, 'dist/src/main.js');
type ManagedProcess = ReturnType<typeof spawn> & { output: string[] };

describeRuntime('Feature 003 production-like runtime alignment (T082)', () => {
  it('fails Gateway bootstrap before listener startup when a required identity setting is absent', async () => {
    expect(existsSync(gatewayEntry)).toBe(true);
    const port = await reservePort();
    const child = start(gatewayEntry, { NODE_ENV: 'test', GATEWAY_PORT: String(port) });
    try {
      await expectExit(child);
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toBeDefined();
    } finally {
      await stop(child);
    }
  }, 30_000);

  it('boots actual Gateway and Backend processes with aligned local configuration, publishes only a controlled public key, and fails operational activation closed', async () => {
    expect(existsSync(gatewayEntry)).toBe(true);
    expect(existsSync(backendEntry)).toBe(true);

    const database = await createGatewayRegistryDatabase('t082-runtime');
    const rootPrisma = createPrismaClient(database.databaseUrl);
    const gatewayPrisma = createGatewayPrismaClient(database.databaseUrl);
    const authority = await createGatewayUpstreamTestAuthority();
    const signing = await createEphemeralRsaFixture({ kid: 't082-file-backed-key' });
    const signingFile = await signing.writeTemporaryPem();
    const [gatewayPort, backendPort] = await Promise.all([reservePort(), reservePort()]);
    const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
    const backendOrigin = `http://127.0.0.1:${backendPort}`;
    const environment = runtimeEnvironment({ databaseUrl: database.databaseUrl, gatewayOrigin, backendOrigin, signingReference: signingFile.fileReference, gatewayPort, backendPort });
    let gateway: ManagedProcess | undefined;
    let backend: ManagedProcess | undefined;

    try {
      await seedCoreData(rootPrisma);
      await seedGatewayProfileRuntimePrerequisite(gatewayPrisma);
      gateway = start(gatewayEntry, environment);
      await waitForJson(`${gatewayOrigin}/health`, (body) => body.status === 'healthy' && body.service === 'identity-gateway', { process: gateway, label: 'Gateway', sensitive: [signingFile.fileReference] });
      await waitForJson(`${gatewayOrigin}/readiness`, (body) => body.status === 'not_ready' && body.productionReady === false);
      await expectPublicJwks(`${gatewayOrigin}/.well-known/jwks.json`, []);

      backend = start(backendEntry, environment);
      await waitForJson(`${backendOrigin}/api/v1/health`, (body) => {
        const data = body.data as Record<string, unknown> | undefined;
        return data?.status === 'healthy' && data.service === 'internal-assistant-core';
      });

      const repository = new GatewaySigningKeyRepository(gatewayPrisma);
      const policy = retirementPolicy();
      const lifecycle = new KeyLifecycleService({ repository, signingKeyProvider: new SigningKeyProvider(), retirementPolicy: policy, now: () => new Date() });
      const command = new RegisterSigningKeyCommand(lifecycle);
      await expect(command.execute({ kid: signing.kid, keyReference: signingFile.fileReference, requestId: 't082-register' })).resolves.toMatchObject({ kid: signing.kid, status: 'new' });
      await expect(lifecycle.transition({ kid: signing.kid, to: 'published', requestId: 't082-publish' })).resolves.toMatchObject({ status: 'published' });
      await expectPublicJwks(`${gatewayOrigin}/.well-known/jwks.json`, [signing.kid]);

      const rotation = new KeyRotationService({
        repository,
        lifecycle,
        retirementPolicy: policy,
        propagationVerifier: new UnavailableSigningKeyPropagationVerifier(),
        compensationAuditWriter: new GatewayIdentityAuditWriter(gatewayPrisma),
        now: () => new Date()
      });
      await expect(rotation.activatePublished({ kid: signing.kid, requestId: 't082-activate' })).rejects.toMatchObject({
        status: 503, code: 'IDENTITY_SERVICE_UNAVAILABLE'
      });
      await expect(gatewayPrisma.gatewaySigningKey.findUnique({ where: { kid: signing.kid } })).resolves.toMatchObject({ status: 'published' });

      const localAuthorityToken = await authority.issue({ integrationId: 'integration-a', subject: 'actor-shared', organizationId: 'org-shared', hostApp: 'admin', roles: [], permissionScopes: [] });
      const localAuthorityResponse = await fetch(`${gatewayOrigin}/api/v1/assistant/sessions`, {
        method: 'POST', headers: { authorization: `Bearer ${localAuthorityToken}`, 'content-type': 'application/json' }, body: '{}'
      });
      expect(localAuthorityResponse.status).toBe(401);
      const localAuthorityBody = await localAuthorityResponse.text();
      expectNoSensitiveValues(localAuthorityBody, [
        { surface: 'unregistered-local-authority-401', label: 'upstream-jwt', value: localAuthorityToken },
        { surface: 'unregistered-local-authority-401', label: 'upstream-authorization', value: `Bearer ${localAuthorityToken}` },
        { surface: 'host-503', label: 'signing-reference', value: signingFile.fileReference }
      ]);
      expect(await rootPrisma.assistantSession.count()).toBe(0);

      expect(environment.GATEWAY_INTERNAL_JWT_TTL_SECONDS).toBe('300');
      expect(environment.GATEWAY_INTERNAL_JWT_ISSUER).toBe(environment.INTERNAL_IDENTITY_JWT_ISSUER);
      expect(environment.GATEWAY_INTERNAL_JWT_AUDIENCE).toBe(environment.INTERNAL_IDENTITY_JWT_AUDIENCE);
      expect(environment.INTERNAL_IDENTITY_JWKS_URI).toBe(`${gatewayOrigin}/.well-known/jwks.json`);
      expect(environment.GATEWAY_BACKEND_BASE_URL).toBe(backendOrigin);
      expect(environment).not.toHaveProperty('GATEWAY_UPSTREAM_JWT_ISSUER');
      expect(environment).not.toHaveProperty('GATEWAY_UPSTREAM_JWT_AUDIENCE');
      expect(environment).not.toHaveProperty('GATEWAY_UPSTREAM_JWKS_URI');
      expectNoSensitiveValues(processOutput(gateway), [
        { surface: 'gateway-process', label: 'local-upstream-jwt', value: localAuthorityToken },
        { surface: 'gateway-process', label: 'local-upstream-authorization', value: `Bearer ${localAuthorityToken}` },
        { surface: 'gateway-process', label: 'signing-reference', value: signingFile.fileReference }
      ]);
      expectNoSensitiveValues(processOutput(backend), [
        { surface: 'backend-process', label: 'local-upstream-jwt', value: localAuthorityToken },
        { surface: 'backend-process', label: 'local-upstream-authorization', value: `Bearer ${localAuthorityToken}` },
        { surface: 'backend-process', label: 'signing-reference', value: signingFile.fileReference }
      ]);
    } finally {
      await stop(gateway);
      await stop(backend);
      await signingFile.dispose();
      await authority.dispose();
      await gatewayPrisma.$disconnect();
      await rootPrisma.$disconnect();
      await database.dispose();
    }
  }, 90_000);
});

function runtimeEnvironment(input: Readonly<{ databaseUrl: string; gatewayOrigin: string; backendOrigin: string; signingReference: string; gatewayPort: number; backendPort: number }>): Record<string, string> {
  return {
    NODE_ENV: 'test', DATABASE_URL: input.databaseUrl, POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 't082_runtime_test',
    LLM_PROVIDER: 'openai', LLM_MODEL: 'local-bootstrap-placeholder', OPENAI_API_KEY: 'local-bootstrap-placeholder',
    INTERNAL_IDENTITY_JWT_ISSUER: input.gatewayOrigin, INTERNAL_IDENTITY_JWT_AUDIENCE: 't082-backend', INTERNAL_IDENTITY_JWKS_URI: `${input.gatewayOrigin}/.well-known/jwks.json`, INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    ENABLE_RUNTIME_DEBUG: 'false', ENABLE_REDIS: 'false', ENABLE_SWAGGER_DOCS: 'false', SWAGGER_PATH: 'docs', PORT: String(input.backendPort),
    GATEWAY_INTERNAL_JWT_ISSUER: input.gatewayOrigin, GATEWAY_INTERNAL_JWT_AUDIENCE: 't082-backend', GATEWAY_PUBLIC_JWKS_URL: `${input.gatewayOrigin}/.well-known/jwks.json`, GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300', GATEWAY_BACKEND_BASE_URL: input.backendOrigin, GATEWAY_SIGNING_KEY_REFERENCE: input.signingReference, GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001', GATEWAY_PORT: String(input.gatewayPort)
  };
}

async function seedGatewayProfileRuntimePrerequisite(prisma: ReturnType<typeof createGatewayPrismaClient>): Promise<void> {
  await prisma.customer.create({ data: { id: 'customer-t082' } });
  const binding = await prisma.integrationBinding.create({
    data: { integrationId: 'integration-t082-runtime', customerId: 'customer-t082', allowedHostApp: 'admin', enabled: true }
  });
  const profile = await prisma.registeredUpstreamTrustProfile.create({
    data: {
      id: 't082-runtime-profile', integrationId: 'integration-t082-runtime', expectedIssuer: 'https://t082-profile.example.test',
      expectedAudience: 't082-profile-audience', jwksUri: 'https://t082-profile.example.test/.well-known/jwks.json',
      algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null
    }
  });

  expect(await prisma.customer.count({ where: { id: 'customer-t082' } })).toBe(1);
  expect(binding).toMatchObject({ integrationId: 'integration-t082-runtime', customerId: 'customer-t082', allowedHostApp: 'admin', enabled: true });
  expect(profile).toMatchObject({ id: 't082-runtime-profile', integrationId: 'integration-t082-runtime', algorithm: 'RS256', enabled: true, lifecycle: 'active' });
  expect(profile).not.toHaveProperty('customerId');
  expect(profile).not.toHaveProperty('allowedHostApp');
}

function retirementPolicy(): KeyRetirementPolicy {
  return new KeyRetirementPolicy({ finalOldTokenLifetimeSeconds: 300, backendClockToleranceSeconds: 300, remoteJwksCacheSeconds: 600, remoteJwksCooldownSeconds: 30, propagationMarginSeconds: 60, enforcedMinimumOverlapSeconds: 1500, httpCacheControlSeconds: 60 });
}

function start(entrypoint: string, environment: Record<string, string>): ManagedProcess {
  const child = spawn(process.execPath, [entrypoint], { cwd: root, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  const managed = child as typeof child & { output: string[] };
  managed.output = output;
  return managed;
}

function processOutput(child: ManagedProcess | undefined): string {
  return child?.output.join('') ?? '';
}

async function stop(child: ManagedProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await waitForExit(child, 2_000);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await waitForExit(child, 2_000);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function expectExit(child: ManagedProcess): Promise<void> {
  await Promise.race([waitForExit(child, 5_000), delay(5_000).then(() => { throw new Error('Gateway unexpectedly remained running with invalid configuration.'); })]);
}

async function waitForExit(child: ManagedProcess, milliseconds: number): Promise<void> {
  if (child.exitCode !== null) return;
  await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(milliseconds)]);
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not reserve local port.');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function waitForJson(
  url: string,
  predicate: (body: Record<string, unknown>) => boolean,
  context?: Readonly<{ process: ManagedProcess; label: string; sensitive?: readonly string[] }>
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (context && context.process.exitCode !== null) throw startupFailure(url, context, 'exited before readiness');
    try {
      const response = await fetch(url);
      const body = await response.json() as Record<string, unknown>;
      if (response.ok && predicate(body)) return;
    } catch {
      // The process may not have bound its local listener yet; retry until the bounded deadline.
    }
    await delay(100);
  }
  throw context ? startupFailure(url, context, 'timed out before readiness') : new Error(`Timed out waiting for local runtime endpoint: ${new URL(url).pathname}`);
}

function startupFailure(url: string, context: Readonly<{ process: ManagedProcess; label: string; sensitive?: readonly string[] }>, state: string): Error {
  const diagnostic = safeProcessDiagnostic(processOutput(context.process), context.sensitive ?? []);
  return new Error(`${context.label} ${state}: ${new URL(url).pathname}; exitCode=${String(context.process.exitCode)}; diagnostic=${diagnostic || '<none>'}`);
}

function safeProcessDiagnostic(value: string, sensitive: readonly string[]): string {
  let result = value;
  for (const item of sensitive) if (item) result = result.split(item).join('[REDACTED]');
  result = result.replace(/(?:Authorization\s*[:=]\s*|Bearer\s+)[^\s"']+/gi, '[REDACTED_AUTH]');
  result = result.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_PEM]');
  return result.replace(/\s+/g, ' ').trim().slice(0, 4_000);
}

async function expectPublicJwks(url: string, expectedKids: readonly string[]): Promise<void> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
  const document = await response.json() as { keys: Array<Record<string, unknown>> };
  expect(document.keys.map((key) => key.kid)).toEqual(expectedKids);
  for (const key of document.keys) {
    expect(Object.keys(key).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    expect(JSON.stringify(key)).not.toMatch(/"(?:d|p|q|dp|dq|qi|oth)"/);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function expectNoSensitiveValues(actual: string, values: readonly Readonly<{ surface: string; label: string; value: string }>[]): void {
  const leaks = values.filter(({ value }) => actual.includes(value)).map(({ surface, label }) => `${surface}:${label}`);
  expect(leaks).toEqual([]);
}
