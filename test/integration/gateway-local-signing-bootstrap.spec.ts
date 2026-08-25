import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { seedCoreData } from '../../scripts/seed';
import { ActiveSigningKeyResolver } from '../../apps/gateway/src/signing/active-signing-key-resolver';
import { GatewaySigningKeyRepository } from '../../apps/gateway/src/signing/gateway-signing-key.repository';
import { SigningKeyProvider } from '../../apps/gateway/src/signing/signing-key-provider';
import { InternalIdentityTokenIssuer } from '../../apps/gateway/src/identity/internal-identity-token-issuer.service';
import { createGatewayPrismaClient } from '../../apps/gateway/src/integration-registry/gateway-prisma-client.factory';
import { createGatewayRegistryDatabase } from '../support/gateway-registry-db.helper';
import { createEphemeralRsaFixture } from '../../apps/gateway/test/signing/ephemeral-rsa.fixture';

const describeRuntime = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const root = process.cwd();
const gatewayEntry = join(root, 'apps/gateway/dist/main.js');
const bootstrapEntry = join(root, 'apps/gateway/dist/commands/local-signing-bootstrap.js');
const backendEntry = join(root, 'dist/src/main.js');
type ManagedProcess = ChildProcess & { output: string[] };

describeRuntime('Gateway local signing bootstrap', () => {
  it('activates one deterministic local key through real Gateway JWKS, is idempotent, permits allowed CORS, and is accepted by Backend', async () => {
    expect(existsSync(gatewayEntry)).toBe(true);
    expect(existsSync(bootstrapEntry)).toBe(true);
    expect(existsSync(backendEntry)).toBe(true);

    const database = await createGatewayRegistryDatabase('local-signing-bootstrap');
    const rootPrisma = createPrismaClient(database.databaseUrl);
    const gatewayPrisma = createGatewayPrismaClient(database.databaseUrl);
    const signing = await createEphemeralRsaFixture();
    const signingFile = await signing.writeTemporaryPem();
    const conflictingSigning = await createEphemeralRsaFixture();
    const conflictingSigningFile = await conflictingSigning.writeTemporaryPem();
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
      await waitFor(`${gatewayOrigin}/health`, (response) => response.ok, {
        process: gateway,
        label: 'Gateway',
        sensitive: [signing.privatePem, signingFile.fileReference]
      });

      const first = await run(bootstrapEntry, environment);
      expect(first.exitCode).toBe(0);
      expectNoSensitiveOutput(first.output, [signing.privatePem, signingFile.fileReference]);
      const second = await run(bootstrapEntry, environment);
      expect(second.exitCode).toBe(0);
      expectNoSensitiveOutput(second.output, [signing.privatePem, signingFile.fileReference]);
      expect(second.output).toContain('already active');
      const conflict = await run(bootstrapEntry, { ...environment, GATEWAY_SIGNING_KEY_REFERENCE: conflictingSigningFile.fileReference });
      expect(conflict.exitCode).toBe(1);
      expectNoSensitiveOutput(conflict.output, [conflictingSigning.privatePem, conflictingSigningFile.fileReference]);

      const publishedCandidateKid = await thumbprintKid(conflictingSigning.publicJwk);
      await gatewayPrisma.gatewaySigningKey.create({ data: {
        kid: publishedCandidateKid, publicJwk: publicJwkWithKid(conflictingSigning.publicJwk, publishedCandidateKid) as object,
        keyReference: conflictingSigningFile.fileReference, status: 'published'
      } });
      const publishedConflict = await run(bootstrapEntry, { ...environment, GATEWAY_SIGNING_KEY_REFERENCE: conflictingSigningFile.fileReference });
      expect(publishedConflict.exitCode).toBe(1);
      expectNoSensitiveOutput(publishedConflict.output, [conflictingSigning.privatePem, conflictingSigningFile.fileReference]);
      await expect(gatewayPrisma.gatewaySigningKey.findMany({ orderBy: { kid: 'asc' } })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'active' }),
        expect.objectContaining({ status: 'published', keyReference: conflictingSigningFile.fileReference })
      ]));
      expect(await gatewayPrisma.gatewaySigningKey.count({ where: { status: 'active' } })).toBe(1);
      expect(await gatewayPrisma.gatewaySigningKey.count({ where: { status: 'retiring' } })).toBe(0);

      const newCandidate = await createEphemeralRsaFixture();
      const newCandidateFile = await newCandidate.writeTemporaryPem();
      try {
        const newCandidateKid = await thumbprintKid(newCandidate.publicJwk);
        await gatewayPrisma.gatewaySigningKey.create({ data: {
          kid: newCandidateKid, publicJwk: publicJwkWithKid(newCandidate.publicJwk, newCandidateKid) as object,
          keyReference: newCandidateFile.fileReference, status: 'new'
        } });
        const newConflict = await run(bootstrapEntry, { ...environment, GATEWAY_SIGNING_KEY_REFERENCE: newCandidateFile.fileReference });
        expect(newConflict.exitCode).toBe(1);
        expectNoSensitiveOutput(newConflict.output, [newCandidate.privatePem, newCandidateFile.fileReference]);
        await expect(gatewayPrisma.gatewaySigningKey.findFirst({ where: { keyReference: newCandidateFile.fileReference } })).resolves.toMatchObject({ status: 'new' });
        expect(await gatewayPrisma.gatewaySigningKey.count({ where: { status: 'active' } })).toBe(1);
        expect(await gatewayPrisma.gatewaySigningKey.count({ where: { status: 'retiring' } })).toBe(0);
      } finally {
        await newCandidateFile.dispose();
      }
      expect(await gatewayPrisma.gatewaySigningKey.count({ where: { status: 'active' } })).toBe(1);
      expect(await gatewayPrisma.gatewaySigningKey.count()).toBe(3);

      const cors = await fetch(`${gatewayOrigin}/api/v1/assistant/sessions`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3001', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,accept' }
      });
      expect(cors.status).toBe(204);
      expect(cors.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
      expect(cors.headers.get('access-control-allow-headers')).toMatch(/authorization.*content-type.*accept/i);
      const rejectedCors = await fetch(`${gatewayOrigin}/api/v1/assistant/sessions`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' }
      });
      expect(rejectedCors.headers.get('access-control-allow-origin')).toBeNull();

      backend = start(backendEntry, environment);
      await waitFor(`${backendOrigin}/api/v1/health`, (response) => response.ok);
      const repository = new GatewaySigningKeyRepository(gatewayPrisma);
      const issuer = new InternalIdentityTokenIssuer({ internalIssuer: gatewayOrigin, internalAudience: 'local-bootstrap-backend', internalTokenTtlSeconds: 300 }, new ActiveSigningKeyResolver(repository, new SigningKeyProvider()));
      const internalToken = await issuer.issue({ customerId: 'customer-a', integrationId: 'integration-a', subject: 'actor-local', organizationId: 'org-local', hostApp: 'admin', roles: [], permissionScopes: [] });
      const backendResponse = await fetch(`${backendOrigin}/api/v1/assistant/sessions`, { method: 'POST', headers: { authorization: `Bearer ${internalToken}`, 'content-type': 'application/json' }, body: '{}' });
      expect(backendResponse.status).toBe(201);
      expectNoSensitiveOutput(await backendResponse.text(), [internalToken, `Bearer ${internalToken}`, signing.privatePem, signingFile.fileReference]);
    } finally {
      await stop(gateway);
      await stop(backend);
      await signingFile.dispose();
      await conflictingSigningFile.dispose();
      await gatewayPrisma.$disconnect();
      await rootPrisma.$disconnect();
      await database.dispose();
    }
  }, 120_000);
});

function runtimeEnvironment(input: Readonly<{ databaseUrl: string; gatewayOrigin: string; backendOrigin: string; signingReference: string; gatewayPort: number; backendPort: number }>): Record<string, string> {
  return {
    NODE_ENV: 'test', DATABASE_URL: input.databaseUrl, POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'local_signing_bootstrap_test',
    LLM_PROVIDER: 'openai', LLM_MODEL: 'local-bootstrap-placeholder', OPENAI_API_KEY: 'local-bootstrap-placeholder',
    INTERNAL_IDENTITY_JWT_ISSUER: input.gatewayOrigin, INTERNAL_IDENTITY_JWT_AUDIENCE: 'local-bootstrap-backend', INTERNAL_IDENTITY_JWKS_URI: `${input.gatewayOrigin}/.well-known/jwks.json`, INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    ENABLE_RUNTIME_DEBUG: 'false', ENABLE_REDIS: 'false', ENABLE_SWAGGER_DOCS: 'false', SWAGGER_PATH: 'docs', PORT: String(input.backendPort),
    GATEWAY_INTERNAL_JWT_ISSUER: input.gatewayOrigin, GATEWAY_INTERNAL_JWT_AUDIENCE: 'local-bootstrap-backend', GATEWAY_PUBLIC_JWKS_URL: `${input.gatewayOrigin}/.well-known/jwks.json`, GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300', GATEWAY_BACKEND_BASE_URL: input.backendOrigin, GATEWAY_SIGNING_KEY_REFERENCE: input.signingReference,
    GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001', GATEWAY_LOCAL_SIGNING_BOOTSTRAP_ENABLED: 'true', GATEWAY_PORT: String(input.gatewayPort)
  };
}

async function seedGatewayProfileRuntimePrerequisite(prisma: ReturnType<typeof createGatewayPrismaClient>): Promise<void> {
  await prisma.customer.create({ data: { id: 'customer-local-signing-bootstrap' } });
  const binding = await prisma.integrationBinding.create({
    data: {
      integrationId: 'integration-local-signing-bootstrap',
      customerId: 'customer-local-signing-bootstrap',
      allowedHostApp: 'admin',
      enabled: true
    }
  });
  const profile = await prisma.registeredUpstreamTrustProfile.create({
    data: {
      id: 'local-signing-bootstrap-runtime-profile',
      integrationId: 'integration-local-signing-bootstrap',
      expectedIssuer: 'https://local-signing-bootstrap-profile.example.test',
      expectedAudience: 'local-signing-bootstrap-profile-audience',
      jwksUri: 'https://local-signing-bootstrap-profile.example.test/.well-known/jwks.json',
      algorithm: 'RS256',
      enabled: true,
      lifecycle: 'active',
      version: 1,
      replacesProfileId: null
    }
  });

  expect(binding).toMatchObject({
    integrationId: 'integration-local-signing-bootstrap',
    customerId: 'customer-local-signing-bootstrap',
    allowedHostApp: 'admin',
    enabled: true
  });
  expect(profile).toMatchObject({
    id: 'local-signing-bootstrap-runtime-profile',
    integrationId: 'integration-local-signing-bootstrap',
    algorithm: 'RS256',
    enabled: true,
    lifecycle: 'active'
  });
  expect(profile).not.toHaveProperty('customerId');
  expect(profile).not.toHaveProperty('allowedHostApp');
}

function start(entry: string, environment: Record<string, string>): ManagedProcess {
  const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  const managed = child as ManagedProcess;
  managed.output = output;
  return managed;
}

async function run(entry: string, environment: Record<string, string>): Promise<Readonly<{ exitCode: number | null; output: string }>> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    const output: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.once('exit', (exitCode) => resolve({ exitCode, output: output.join('') }));
  });
}

async function waitFor(
  url: string,
  predicate: (response: Response) => boolean,
  context?: Readonly<{ process: ManagedProcess; label: string; sensitive?: readonly string[] }>
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (context && context.process.exitCode !== null) throw startupFailure(url, context, 'exited before listener readiness');
    try {
      const response = await fetch(url);
      if (predicate(response)) return;
    } catch { /* listener is still starting */ }
    await delay(100);
  }
  throw context ? startupFailure(url, context, 'timed out before listener readiness') : new Error('Local runtime did not become reachable.');
}

function startupFailure(url: string, context: Readonly<{ process: ManagedProcess; label: string; sensitive?: readonly string[] }>, state: string): Error {
  const diagnostic = safeProcessDiagnostic(context.process.output.join(''), context.sensitive ?? []);
  return new Error(`${context.label} ${state}: ${new URL(url).pathname}; exitCode=${String(context.process.exitCode)}; diagnostic=${diagnostic || '<none>'}`);
}

function safeProcessDiagnostic(value: string, sensitive: readonly string[]): string {
  let result = value;
  for (const item of sensitive) if (item) result = result.split(item).join('[REDACTED]');
  result = result.replace(/(?:Authorization\s*[:=]\s*|Bearer\s+)[^\s"']+/gi, '[REDACTED_AUTH]');
  result = result.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]');
  result = result.replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_PEM]');
  result = result.replace(/(keyReference|signingKeyReference|secret|password)\s*[:=]\s*[^\s,}]+/gi, '$1=[REDACTED]');
  return result.replace(/\s+/g, ' ').trim().slice(0, 4_000);
}

async function stop(child: ManagedProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(2_000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([new Promise<void>((resolve) => child.once('exit', () => resolve())), delay(2_000)]);
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
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

function expectNoSensitiveOutput(output: string, values: readonly string[]): void {
  const leaks = values.filter((value) => output.includes(value)).map((_value, index) => `sensitive-${index}`);
  expect(leaks).toEqual([]);
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function thumbprintKid(publicJwk: Readonly<Record<string, unknown>>): Promise<string> {
  const { calculateJwkThumbprint } = await import('jose');
  return calculateJwkThumbprint({ kty: 'RSA', n: publicJwk.n as string, e: publicJwk.e as string }, 'sha256');
}

function publicJwkWithKid(publicJwk: Readonly<Record<string, unknown>>, kid: string): Record<string, unknown> {
  return { ...publicJwk, kid };
}
