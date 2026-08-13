import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { ValidationPipe, type INestApplication, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Prisma } from '../../apps/gateway/src/generated/prisma/client';
import { GatewayModule } from '../../apps/gateway/src/gateway.module';
import { createGatewayPrismaClient } from '../../apps/gateway/src/integration-registry/gateway-prisma-client.factory';
import { createEphemeralRsaFixture, type EphemeralRsaFixture } from '../../apps/gateway/test/signing/ephemeral-rsa.fixture';
import { createGatewayRegistryDatabase, type GatewayRegistryDatabase } from './gateway-registry-db.helper';
import { createGatewayUpstreamTestAuthority, type GatewayUpstreamTestAuthority } from './gateway-upstream-test-authority';

export type TrustChainBindingFixture = Readonly<{
  customerId: string;
  integrationId: string;
  allowedHostApp: string;
  enabled?: boolean;
}>;

export type GatewayBackendTrustChainHarness = Readonly<{
  gateway: INestApplication;
  backend: INestApplication;
  prisma: ReturnType<typeof createGatewayPrismaClient>;
  upstreamAuthority: GatewayUpstreamTestAuthority;
  signingFixture: EphemeralRsaFixture;
  gatewayOrigin: string;
  backendOrigin: string;
  bindings: readonly TrustChainBindingFixture[];
  outboundAuthorizations: readonly string[];
  gatewayLogs: readonly RuntimeLogEntry[];
  backendLogs: readonly RuntimeLogEntry[];
  clearObservations(): void;
  stopBackend(): Promise<void>;
  dispose(): Promise<void>;
}>;

export type RuntimeLogEntry = Readonly<{ level: string; values: readonly unknown[] }>;

/** Shared Phase 8 real-runtime foundation; it owns no generic operation or identity API. */
export async function createGatewayBackendTrustChainHarness(input: Readonly<{
  label: string;
  bindings: readonly TrustChainBindingFixture[];
}>): Promise<GatewayBackendTrustChainHarness> {
  const bindings = validateBindings(input.bindings);
  const database = await createGatewayRegistryDatabase(input.label);
  const prisma = createGatewayPrismaClient(database.databaseUrl);
  const upstreamAuthority = await createGatewayUpstreamTestAuthority();
  const signingFixture = await createEphemeralRsaFixture({ kid: `phase8-gateway-${randomUUID()}` });
  const signingFile = await signingFixture.writeTemporaryPem();
  const [gatewayPort, backendPort] = await reservePorts(2);
  const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const restoreEnvironment = installEnvironment(environmentFor({
    databaseUrl: database.databaseUrl,
    signingKeyReference: signingFile.fileReference,
    gatewayOrigin,
    backendOrigin,
    upstreamIssuer: upstreamAuthority.issuer,
    upstreamAudience: upstreamAuthority.audience,
    upstreamJwksUri: upstreamAuthority.jwksUri
  }));
  let gateway: INestApplication | undefined;
  let backend: INestApplication | undefined;
  let backendStopped = false;
  const gatewayLogCapture = createLogCapture();
  const backendLogCapture = createLogCapture();
  const outboundObservation = observeGatewayOutboundAuthorization(backendOrigin);

  try {
    await provisionExplicitBindings(prisma, bindings);
    await prisma.gatewaySigningKey.create({
      data: {
        kid: signingFixture.kid,
        publicJwk: signingFixture.publicJwk as Prisma.InputJsonValue,
        keyReference: signingFile.fileReference,
        status: 'active',
        activatedAt: new Date()
      }
    });
    backend = await startBackend(backendPort, backendLogCapture.logger);
    gateway = await startGateway(gatewayPort, gatewayLogCapture.logger);
    gatewayLogCapture.clear();
    backendLogCapture.clear();
    return Object.freeze({
      gateway,
      backend,
      prisma,
      upstreamAuthority,
      signingFixture,
      gatewayOrigin,
      backendOrigin,
      bindings,
      outboundAuthorizations: outboundObservation.values,
      gatewayLogs: gatewayLogCapture.values,
      backendLogs: backendLogCapture.values,
      clearObservations: () => { gatewayLogCapture.clear(); backendLogCapture.clear(); outboundObservation.clear(); },
      stopBackend: async () => {
        if (backendStopped) return;
        backendStopped = true;
        await backend?.close();
      },
      dispose: () => dispose({ gateway, backend: backendStopped ? undefined : backend, restoreEnvironment, signingFile, upstreamAuthority, prisma, database, restoreFetch: outboundObservation.restore })
    });
  } catch (error) {
    await dispose({ gateway, backend, restoreEnvironment, signingFile, upstreamAuthority, prisma, database, restoreFetch: outboundObservation.restore });
    throw error;
  }
}

async function provisionExplicitBindings(prisma: ReturnType<typeof createGatewayPrismaClient>, bindings: readonly TrustChainBindingFixture[]): Promise<void> {
  await prisma.customer.createMany({ data: [...new Set(bindings.map((binding) => binding.customerId))].map((id) => ({ id })) });
  await prisma.integrationBinding.createMany({
    data: bindings.map((binding) => ({
      integrationId: binding.integrationId,
      customerId: binding.customerId,
      allowedHostApp: binding.allowedHostApp,
      enabled: binding.enabled ?? true
    }))
  });
}

async function startGateway(port: number, logger: LoggerService): Promise<INestApplication> {
  const app = await NestFactory.create(GatewayModule, { logger });
  await app.listen(port, '127.0.0.1');
  return app;
}

async function startBackend(port: number, logger: LoggerService): Promise<INestApplication> {
  jest.resetModules();
  const [{ AppModule }, { GlobalExceptionFilter }, { RequestIdInterceptor }, { ResponseEnvelopeInterceptor }] = await Promise.all([
    import('../../src/app.module'),
    import('../../src/common/errors/global-exception.filter'),
    import('../../src/common/request-id/request-id.interceptor'),
    import('../../src/common/response/response-envelope.interceptor')
  ]);
  const app = await NestFactory.create(AppModule, { logger });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }));
  app.useGlobalInterceptors(new RequestIdInterceptor(), new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.listen(port, '127.0.0.1');
  return app;
}

function validateBindings(bindings: readonly TrustChainBindingFixture[]): readonly TrustChainBindingFixture[] {
  if (bindings.length === 0) throw new Error('Phase 8 trust-chain harness requires at least one explicit binding.');
  const integrationIds = new Set<string>();
  for (const binding of bindings) {
    if (![binding.customerId, binding.integrationId, binding.allowedHostApp].every(isNonBlank) || integrationIds.has(binding.integrationId)) {
      throw new Error('Phase 8 trust-chain harness received invalid explicit bindings.');
    }
    integrationIds.add(binding.integrationId);
  }
  return Object.freeze(bindings.map((binding) => Object.freeze({ ...binding, enabled: binding.enabled ?? true })));
}

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}

async function reservePorts(count: number): Promise<number[]> {
  const servers = await Promise.all(Array.from({ length: count }, () => new Promise<Server>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(server));
  })));
  try {
    return servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Could not reserve a Phase 8 listener port.');
      return address.port;
    });
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  }
}

function environmentFor(input: Readonly<{
  databaseUrl: string;
  signingKeyReference: string;
  gatewayOrigin: string;
  backendOrigin: string;
  upstreamIssuer: string;
  upstreamAudience: string;
  upstreamJwksUri: string;
}>): Record<string, string> {
  return {
    NODE_ENV: 'test', DATABASE_URL: input.databaseUrl, POSTGRES_USER: 'assistant', POSTGRES_PASSWORD: 'assistant_test_password', POSTGRES_DB: 'assistant_test',
    LLM_PROVIDER: 'openai', LLM_MODEL: 'phase8-test-model', OPENAI_API_KEY: 'phase8-test-key',
    INTERNAL_IDENTITY_JWT_ISSUER: input.gatewayOrigin, INTERNAL_IDENTITY_JWT_AUDIENCE: 'feature003-phase8-backend',
    INTERNAL_IDENTITY_JWKS_URI: `${input.gatewayOrigin}/.well-known/jwks.json`, INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    ENABLE_RUNTIME_DEBUG: 'false', ENABLE_REDIS: 'false', ENABLE_SWAGGER_DOCS: 'false', SWAGGER_PATH: 'docs',
    GATEWAY_INTERNAL_JWT_ISSUER: input.gatewayOrigin, GATEWAY_INTERNAL_JWT_AUDIENCE: 'feature003-phase8-backend',
    GATEWAY_PUBLIC_JWKS_URL: `${input.gatewayOrigin}/.well-known/jwks.json`,
    GATEWAY_UPSTREAM_JWT_ISSUER: input.upstreamIssuer, GATEWAY_UPSTREAM_JWT_AUDIENCE: input.upstreamAudience,
    GATEWAY_UPSTREAM_JWKS_URI: input.upstreamJwksUri, GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300', GATEWAY_BACKEND_BASE_URL: input.backendOrigin,
    GATEWAY_SIGNING_KEY_REFERENCE: input.signingKeyReference, GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001', GATEWAY_PORT: '4000'
  };
}

function installEnvironment(values: Record<string, string>): () => void {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
}

async function dispose(input: Readonly<{
  gateway: INestApplication | undefined;
  backend: INestApplication | undefined;
  restoreEnvironment(): void;
  signingFile: Readonly<{ dispose(): Promise<void> }>;
  upstreamAuthority: GatewayUpstreamTestAuthority;
  prisma: ReturnType<typeof createGatewayPrismaClient>;
  database: GatewayRegistryDatabase;
  restoreFetch(): void;
}>): Promise<void> {
  await input.gateway?.close();
  await input.backend?.close();
  input.restoreEnvironment();
  await input.signingFile.dispose();
  await input.upstreamAuthority.dispose();
  await input.prisma.$disconnect();
  await input.database.dispose();
  input.restoreFetch();
}

function createLogCapture(): Readonly<{ logger: LoggerService; values: RuntimeLogEntry[]; clear(): void }> {
  const values: RuntimeLogEntry[] = [];
  const write = (level: string, args: unknown[]) => { values.push(Object.freeze({ level, values: Object.freeze([...args]) })); };
  return Object.freeze({
    values,
    logger: {
      log: (...args: unknown[]) => write('log', args),
      error: (...args: unknown[]) => write('error', args),
      warn: (...args: unknown[]) => write('warn', args),
      debug: (...args: unknown[]) => write('debug', args),
      verbose: (...args: unknown[]) => write('verbose', args)
    },
    clear: () => { values.splice(0, values.length); }
  });
}

function observeGatewayOutboundAuthorization(backendOrigin: string): Readonly<{ values: string[]; clear(): void; restore(): void }> {
  const originalFetch = globalThis.fetch;
  const values: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = init?.headers;
    const authorization = headers instanceof Headers
      ? headers.get('authorization')
      : Array.isArray(headers)
        ? headers.find(([name]) => name.toLowerCase() === 'authorization')?.[1]
        : headers && typeof headers === 'object'
          ? (headers as Record<string, string>)['authorization'] ?? (headers as Record<string, string>).Authorization
          : undefined;
    if (url.startsWith(backendOrigin) && typeof authorization === 'string') values.push(authorization);
    return originalFetch(input, init);
  };
  return Object.freeze({ values, clear: () => { values.splice(0, values.length); }, restore: () => { globalThis.fetch = originalFetch; } });
}
