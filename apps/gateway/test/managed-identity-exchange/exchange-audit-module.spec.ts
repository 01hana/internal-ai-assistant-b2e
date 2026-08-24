import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  ManagedExchangeIssuanceError,
  createVerifiedExternalIdentity
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { IntegrationAdmissionService } from '../../src/managed-identity-exchange/admission/integration-admission.service';
import { ManagedCanonicalizationService } from '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service';
import { ManagedIdentityExchangeService } from '../../src/managed-identity-exchange/exchange.service';
import { ManagedUpstreamTokenIssuer } from '../../src/managed-identity-exchange/issuer/managed-upstream-token-issuer';
import { ManagedIdentityExchangeModule } from '../../src/managed-identity-exchange/managed-identity-exchange.module';
import { ManagedPermissionService } from '../../src/managed-identity-exchange/permissions/managed-permission.service';
import { ManagedExchangeAuditWriter } from '../../src/managed-identity-exchange/persistence/managed-exchange-audit.writer';
import {
  ManagedExchangeAuditRepository,
  ManagedIdentityProviderInstanceRepository,
  ManagedIntegrationExchangeConfigRepository,
  ManagedPermissionPolicyRepository
} from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';
import { ManagedExchangeReadinessValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.validator';
import { IdentityProviderAdapterRegistry } from '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry';
import { GATEWAY_PRISMA_CLIENT } from '../../src/signing/gateway-signing-key-persistence.module';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const writerPath = resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-audit.writer.ts');
const modulePath = resolve(__dirname, '../../src/managed-identity-exchange/managed-identity-exchange.module.ts');
const sentinel = 'DO_NOT_LEAK_DB_DIAGNOSTIC';
const runtimeSentinels = Object.freeze([
  'DO_NOT_LEAK_NATIVE_CREDENTIAL',
  'DO_NOT_LEAK_PROVIDER_RESPONSE',
  'DO_NOT_LEAK_PERMISSION',
  'DO_NOT_LEAK_ANCHOR',
  'DO_NOT_LEAK_CUSTOMER',
  'DO_NOT_LEAK_PRIVATE_KEY',
  'DO_NOT_LEAK_KEY_REFERENCE'
]);

describe('Managed exchange audit writer and production composition (T038)', () => {
  it('projects exact validated safe audit data to the existing repository', async () => {
    const append = jest.fn(async (data) => data);
    const writer = new ManagedExchangeAuditWriter({ append } as never);
    await writer.append({ requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued', integrationId: 'integration-a', integrationConfigId: 'config-a', providerType: 'delegated_http', providerInstanceId: 'provider-a', jti: 'jti-a', kid: 'kid-a' });
    expect(append).toHaveBeenCalledWith({ requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued', integrationId: 'integration-a', integrationConfigId: 'config-a', providerType: 'delegated_http', providerInstanceId: 'provider-a', jti: 'jti-a', kid: 'kid-a' });
  });

  it.each([
    { requestId: 'request-a', outcome: 'denied', reasonCode: 'managed_exchange_identity_invalid' },
    { requestId: 'request-a', outcome: 'denied', reasonCode: 'managed_exchange_identity_denied' },
    { requestId: 'request-a', outcome: 'unavailable', reasonCode: 'managed_exchange_unavailable' },
    { requestId: 'request-a', outcome: 'unavailable', reasonCode: 'managed_exchange_issuance_failed' }
  ])('persists each allowed failure classification', async (input) => {
    const append = jest.fn(async (data) => data);
    await new ManagedExchangeAuditWriter({ append } as never).append(input as never);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it.each([
    { requestId: 'request-a', outcome: 'forged', reasonCode: 'managed_exchange_unavailable' },
    { requestId: 'request-a', outcome: 'success', reasonCode: 'provider diagnostic' },
    { requestId: ' ', outcome: 'success', reasonCode: 'managed_exchange_issued' },
    { requestId: 'request-a\n', outcome: 'success', reasonCode: 'managed_exchange_issued' },
    { requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued', extra: sentinel }
  ])('fails closed without repository access for invalid or extra runtime input', async (input) => {
    const append = jest.fn();
    await expect(new ManagedExchangeAuditWriter({ append } as never).append(input as never)).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(append).not.toHaveBeenCalled();
  });

  it('redacts repository diagnostics and retains no sensitive persistence vocabulary', async () => {
    const writer = new ManagedExchangeAuditWriter({ append: async () => { throw new Error(sentinel); } } as never);
    const error = await writer.append({ requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(sentinel);
    const source = readFileSync(writerPath, 'utf8');
    expect(source).not.toMatch(/nativeCredential|authorization|accessToken|refreshToken|rawProviderResponse|permissionScopes|permissionMaterial|anchors|customerId|keyReference|privateKey/i);
  });

  it('keeps production module composition additive and shared-client based', async () => {
    const fake = fakeClient();
    const module = await Test.createTestingModule({ imports: [ManagedIdentityExchangeModule] })
      .overrideProvider(GATEWAY_PRISMA_CLIENT).useValue(fake)
      .compile();
    expect(module.get(ManagedExchangeAuditWriter)).toBeInstanceOf(ManagedExchangeAuditWriter);
    expect(module.get(ManagedExchangeAuditRepository)).toBeInstanceOf(ManagedExchangeAuditRepository);
    const source = readFileSync(modulePath, 'utf8');
    expect(source).toContain('GATEWAY_PRISMA_CLIENT');
    expect(source).not.toMatch(/new PrismaClient|GatewaySigningKeyRepository|ActiveSigningKeyResolver|InternalIdentityTokenIssuer|CanonicalIdentityResolver|MultiProfileUpstreamTokenVerifier|Customer/i);
  });

  it('registers both managed public routes and leaves the root Feature 004 route wiring additive', async () => {
    const module = await Test.createTestingModule({ imports: [ManagedIdentityExchangeModule] })
      .overrideProvider(GATEWAY_PRISMA_CLIENT).useValue(fakeClient())
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      expect((await request(app.getHttpServer()).post('/api/v1/identity/exchange').send({ integrationSelector: 'selector-a' })).status).toBe(400);
      expect((await request(app.getHttpServer()).get('/.well-known/managed-identity-exchange-jwks.json')).status).toBe(503);
    } finally { await app.close(); }
    const root = readFileSync(resolve(__dirname, '../../src/gateway.module.ts'), 'utf8');
    expect(root).toContain('ManagedIdentityExchangeModule');
    expect(root).toContain('GatewayAssistantController');
  });
});

describeRegistry('Managed exchange audit database persistence (T038)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  beforeEach(async () => { database = await createGatewayRegistryDatabase('managed-exchange-audit'); prisma = createGatewayPrismaClient(database.databaseUrl); });
  afterEach(async () => { await prisma?.$disconnect(); await database?.dispose(); });

  it('writes and reads one safe managed audit event through the existing repository', async () => {
    const writer = new ManagedExchangeAuditWriter(new ManagedExchangeAuditRepository(prisma));
    await writer.append({ requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued', integrationId: 'integration-a', integrationConfigId: 'config-a', providerType: 'delegated_http', providerInstanceId: 'provider-a', jti: 'jti-a', kid: 'kid-a' });
    const row = await prisma.managedExchangeAuditEvent.findFirstOrThrow({ where: { requestId: 'request-a' } });
    expect(row).toMatchObject({ requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued', integrationId: 'integration-a', integrationConfigId: 'config-a', providerType: 'delegated_http', providerInstanceId: 'provider-a', jti: 'jti-a', kid: 'kid-a' });
    expect(JSON.stringify(row)).not.toMatch(/nativeCredential|authorization|accessToken|privateKey|customerId/i);
  });

  it('carries a supplied request ID through the production HTTP, service, writer, and database boundaries', async () => {
    const fixture = await runtimeFixture(prisma);
    try {
      const response = await request(fixture.app.getHttpServer())
        .post('/api/v1/identity/exchange')
        .set('Authorization', 'Bearer DO_NOT_LEAK_NATIVE_CREDENTIAL')
        .set('x-request-id', 'request-a')
        .send({ integrationSelector: 'selector-a' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ accessToken: 'synthetic-managed-access-token', tokenType: 'Bearer', expiresIn: 300, requestId: 'request-a' });
      expect(fixture.exchange).toHaveBeenCalledTimes(1);
      expect(fixture.exchange).toHaveBeenCalledWith({ integrationSelector: 'selector-a', nativeCredential: 'DO_NOT_LEAK_NATIVE_CREDENTIAL', requestId: 'request-a' });
      const rows = await prisma.managedExchangeAuditEvent.findMany({ where: { requestId: 'request-a' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        requestId: 'request-a', outcome: 'success', reasonCode: 'managed_exchange_issued',
        integrationId: 'integration-a', integrationConfigId: 'config-a', providerType: 'delegated_http',
        providerInstanceId: 'provider-a', jti: 'jti-a', kid: 'kid-a'
      });
      expectRedacted(response, rows);
    } finally { await fixture.close(); }
  });

  it.each([undefined, '   '])('uses one controller-generated request ID consistently when the header is %p', async (requestId) => {
    const fixture = await runtimeFixture(prisma);
    try {
      let call = request(fixture.app.getHttpServer())
        .post('/api/v1/identity/exchange')
        .set('Authorization', 'Bearer DO_NOT_LEAK_NATIVE_CREDENTIAL')
        .send({ integrationSelector: 'selector-a' });
      if (requestId !== undefined) call = call.set('x-request-id', requestId);
      const response = await call;

      expect(response.status).toBe(200);
      expect(response.body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(fixture.exchange).toHaveBeenCalledWith(expect.objectContaining({ requestId: response.body.requestId }));
      const rows = await prisma.managedExchangeAuditEvent.findMany({ where: { requestId: response.body.requestId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ requestId: response.body.requestId, outcome: 'success', reasonCode: 'managed_exchange_issued' });
      expectRedacted(response, rows);
    } finally { await fixture.close(); }
  });

  it.each([
    ['provider credential failure', 'provider', 401, 'EXCHANGE_IDENTITY_INVALID', 'denied', 'managed_exchange_identity_invalid'],
    ['permission identity denial', 'permission', 403, 'EXCHANGE_IDENTITY_DENIED', 'denied', 'managed_exchange_identity_denied'],
    ['infrastructure failure', 'infrastructure', 503, 'EXCHANGE_SERVICE_UNAVAILABLE', 'unavailable', 'managed_exchange_unavailable'],
    ['issuance failure', 'issuance', 503, 'EXCHANGE_SERVICE_UNAVAILABLE', 'unavailable', 'managed_exchange_issuance_failed']
  ] as const)('writes exactly one safe failure audit row for %s', async (_label, failure, status, code, outcome, reasonCode) => {
    const fixture = await runtimeFixture(prisma, failure);
    try {
      const response = await request(fixture.app.getHttpServer())
        .post('/api/v1/identity/exchange')
        .set('Authorization', 'Bearer DO_NOT_LEAK_NATIVE_CREDENTIAL')
        .set('x-request-id', 'request-a')
        .send({ integrationSelector: 'selector-a' });

      expect(response.status).toBe(status);
      expect(response.body).toEqual(expect.objectContaining({ statusCode: status, code }));
      expect(response.body).not.toHaveProperty('accessToken');
      const rows = await prisma.managedExchangeAuditEvent.findMany({ where: { requestId: 'request-a' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ requestId: 'request-a', outcome, reasonCode });
      expectRedacted(response, rows);
    } finally { await fixture.close(); }
  });

  it('rejects invalid HTTP input before the real service and audit writer execute', async () => {
    const fixture = await runtimeFixture(prisma);
    try {
      const response = await request(fixture.app.getHttpServer())
        .post('/api/v1/identity/exchange')
        .set('x-request-id', 'request-a')
        .send({ integrationSelector: 'selector-a' });
      expect(response.status).toBe(400);
      expect(fixture.exchange).not.toHaveBeenCalled();
      expect(await prisma.managedExchangeAuditEvent.count()).toBe(0);
      expectRedacted(response, []);
    } finally { await fixture.close(); }
  });
});

type RuntimeFailure = 'provider' | 'permission' | 'infrastructure' | 'issuance';

async function runtimeFixture(prisma: ReturnType<typeof createGatewayPrismaClient>, failure?: RuntimeFailure) {
  const identity = createVerifiedExternalIdentity({
    subject: 'subject-a', organization: 'organization-a',
    anchors: [{ kind: 'account', value: 'anchor-a' }]
  });
  const config = { id: 'config-a', integrationId: 'integration-a', providerInstanceId: 'provider-a', canonicalHostApp: 'host-a' };
  const provider = {
    id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify',
    httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000,
    responseContractVersion: 'delegated-http/v1', contractConfig: {}, declaredAnchorKinds: ['account']
  };
  const builder = Test.createTestingModule({ imports: [ManagedIdentityExchangeModule] })
    .overrideProvider(GATEWAY_PRISMA_CLIENT).useValue(prisma)
    .overrideProvider(ManagedIntegrationExchangeConfigRepository).useValue({ findEnabledActiveByPublicSelector: jest.fn(async () => config) })
    .overrideProvider(ManagedIdentityProviderInstanceRepository).useValue({ findEnabledActiveById: jest.fn(async () => provider) })
    .overrideProvider(ManagedExchangeReadinessValidator).useValue({ assertReady: jest.fn(async () => { if (failure === 'infrastructure') throw new ManagedExchangeInfrastructureError(); }) })
    .overrideProvider(IdentityProviderAdapterRegistry).useValue({
      resolve: jest.fn(() => ({ verify: jest.fn(async () => {
        if (failure === 'provider') throw new ManagedExchangeCredentialError();
        return identity;
      }) }))
    })
    .overrideProvider(IntegrationAdmissionService).useValue({ admit: jest.fn(async () => undefined) })
    .overrideProvider(ManagedPermissionPolicyRepository).useValue({
      findEnabledActiveByConfigId: jest.fn(async () => [{ id: 'permission-a', integrationConfigId: 'config-a', mode: 'allow_empty', permissionSourceInstanceId: null, normalizerType: null, projectionContractVersion: null, projectionContract: null }])
    })
    .overrideProvider(ManagedPermissionService).useValue({
      resolve: jest.fn(async () => {
        if (failure === 'permission') throw new ManagedExchangeIdentityDeniedError();
        return Object.freeze([]);
      })
    })
    .overrideProvider(ManagedCanonicalizationService).useValue({
      canonicalize: jest.fn(async () => Object.freeze({ integrationId: 'integration-a', subject: 'subject-a', organizationId: 'organization-a', hostApp: 'host-a', roles: Object.freeze([]), permissionScopes: Object.freeze([]) }))
    })
    .overrideProvider(ManagedUpstreamTokenIssuer).useValue({
      issue: jest.fn(async () => {
        if (failure === 'issuance') throw new ManagedExchangeIssuanceError();
        return Object.freeze({ accessToken: 'synthetic-managed-access-token', tokenType: 'Bearer', expiresIn: 300, jti: 'jti-a', kid: 'kid-a' });
      })
    });
  const module = await builder.compile();
  const app = module.createNestApplication();
  await app.init();
  const service = module.get(ManagedIdentityExchangeService);
  return Object.freeze({ app, exchange: jest.spyOn(service, 'exchange'), close: () => app.close() });
}

function expectRedacted(response: request.Response, rows: readonly unknown[]) {
  const bodyAndHeaders = `${JSON.stringify(response.body)} ${JSON.stringify(response.headers)} ${JSON.stringify(rows)}`;
  for (const value of runtimeSentinels) expect(bodyAndHeaders).not.toContain(value);
  expect(JSON.stringify(rows)).not.toContain('synthetic-managed-access-token');
}

function fakeClient() {
  const empty = { findFirst: async () => null, findMany: async () => [], findUnique: async () => null, create: async () => ({}), $transaction: async () => ({}) };
  return {
    ...empty,
    integrationBinding: empty, registeredUpstreamTrustProfile: empty,
    managedIdentityProviderInstance: empty, managedIntegrationExchangeConfig: empty,
    managedIntegrationAdmissionPolicy: empty, managedPermissionSourceInstance: empty,
    managedPermissionPolicy: empty, managedUpstreamIssuer: empty,
    managedUpstreamSigningKey: empty, managedExchangeAuditEvent: empty
  };
}
