import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import { BRIDGE_ENVIRONMENT, BridgeConfigService } from '../../src/config/bridge-config.service';
import { ExchangeIdentityDeniedError } from '../../src/exchange/redaction';
import { ExchangeModule } from '../../src/exchange/exchange.module';
import { ExchangeService, type ExchangeResult } from '../../src/exchange/exchange.service';
import { BridgeReadinessRegistry, BridgeReadinessService } from '../../src/health/readiness.service';
import { MenuDetailTransport, type MenuDetailRequestOptions } from '../../src/idx/transport/menu-detail.transport';
import { JwksService } from '../../src/jwks/jwks.service';
import { CanonicalTokenIssuer } from '../../src/signing/canonical-token.issuer';
import { createTwoDeploymentFixtures, type DeploymentFixture } from '../fixtures/two-deployment.fixture';

type CapturedRequest = Readonly<{ url: string; authorization: string }>;
type RuntimeContext = Readonly<{
  fixture: DeploymentFixture;
  app: INestApplication;
  environmentInput: Record<string, unknown>;
  requests: CapturedRequest[];
  resolverHosts: string[];
  requestsAtReady: number;
  exchange: ExchangeService;
  issuer: CanonicalTokenIssuer;
  config: BridgeConfigService;
  jwks: JwksService;
  registry: BridgeReadinessRegistry;
  readiness: BridgeReadinessService;
}>;

describe('Feature 007 two-deployment isolation', () => {
  const [fixtureA, fixtureB] = createTwoDeploymentFixtures();
  let contextA: RuntimeContext;
  let contextB: RuntimeContext;
  let resultA: ExchangeResult;
  let resultB: ExchangeResult;

  beforeAll(async () => {
    [contextA, contextB] = await Promise.all([createRuntime(fixtureA), createRuntime(fixtureB)]);
    [resultA, resultB] = await Promise.all([
      contextA.exchange.exchange(fixtureA.nativeToken),
      contextB.exchange.exchange(fixtureB.nativeToken)
    ]);
  });

  afterAll(async () => { await Promise.all([contextA.app.close(), contextB.app.close()]); });

  it('uses only each configured endpoint and bearer for its independent exchange', () => {
    expect(contextA.requestsAtReady).toBe(0);
    expect(contextB.requestsAtReady).toBe(0);
    expect(contextA.requests).toEqual([{ url: fixtureA.endpoint, authorization: `Bearer ${fixtureA.nativeToken}` }]);
    expect(contextB.requests).toEqual([{ url: fixtureB.endpoint, authorization: `Bearer ${fixtureB.nativeToken}` }]);
    expect(contextA.requests.some((request) => request.url === fixtureB.endpoint)).toBe(false);
    expect(contextB.requests.some((request) => request.url === fixtureA.endpoint)).toBe(false);
    expect(contextA.resolverHosts).toEqual(['idx-a.example.test', 'idx-a.example.test']);
    expect(contextB.resolverHosts).toEqual(['idx-b.example.test', 'idx-b.example.test']);
  });

  it('isolates identity, deployment authority, and MenuDetail-only permissions', () => {
    expect(decodeJwt(resultA.accessToken)).toMatchObject({
      sub: fixtureA.subject, org_id: fixtureA.organization, integration_id: fixtureA.integrationId,
      host_app: fixtureA.hostApp, iss: fixtureA.issuer, aud: fixtureA.audience,
      roles: [], permission_scopes: fixtureA.permissionScopes
    });
    expect(decodeJwt(resultB.accessToken)).toMatchObject({
      sub: fixtureB.subject, org_id: fixtureB.organization, integration_id: fixtureB.integrationId,
      host_app: fixtureB.hostApp, iss: fixtureB.issuer, aud: fixtureB.audience,
      roles: [], permission_scopes: fixtureB.permissionScopes
    });
    expect(decodeJwt(resultA.accessToken).permission_scopes).not.toEqual(expect.arrayContaining(fixtureB.permissionScopes));
    expect(decodeJwt(resultB.accessToken).permission_scopes).not.toEqual(expect.arrayContaining(fixtureA.permissionScopes));
  });

  it('uses cryptographically isolated signing keys and isolated JWKS documents', async () => {
    const publicA = await importJWK(fixtureA.signing.record.publicJwk as unknown as JWK, 'RS256');
    const publicB = await importJWK(fixtureB.signing.record.publicJwk as unknown as JWK, 'RS256');
    expect(decodeProtectedHeader(resultA.accessToken)).toEqual({ alg: 'RS256', kid: fixtureA.kid });
    expect(decodeProtectedHeader(resultB.accessToken)).toEqual({ alg: 'RS256', kid: fixtureB.kid });
    await expect(jwtVerify(resultA.accessToken, publicA, { issuer: fixtureA.issuer, audience: fixtureA.audience })).resolves.toBeDefined();
    await expect(jwtVerify(resultB.accessToken, publicB, { issuer: fixtureB.issuer, audience: fixtureB.audience })).resolves.toBeDefined();
    await expect(jwtVerify(resultA.accessToken, publicB)).rejects.toThrow();
    await expect(jwtVerify(resultB.accessToken, publicA)).rejects.toThrow();

    const [jwksA, jwksB] = await Promise.all([contextA.jwks.document(), contextB.jwks.document()]);
    expect(jwksA.keys.map((key) => key.kid)).toEqual([fixtureA.kid]);
    expect(jwksB.keys.map((key) => key.kid)).toEqual([fixtureB.kid]);
    expect(jwksA.keys.some((key) => key.kid === fixtureB.kid || key.n === fixtureB.signing.record.publicJwk.n)).toBe(false);
    expect(jwksB.keys.some((key) => key.kid === fixtureA.kid || key.n === fixtureA.signing.record.publicJwk.n)).toBe(false);
  });

  it('accepts both local Entries and denies every cross-deployment Entry after MenuDetail acceptance without issuing', async () => {
    const issueA = jest.spyOn(contextA.issuer, 'issue');
    const issueB = jest.spyOn(contextB.issuer, 'issue');
    for (const nativeToken of fixtureA.nativeTokens) {
      const result = await contextA.exchange.exchange(nativeToken);
      expect(decodeJwt(result.accessToken)).not.toHaveProperty('UUID_Entry');
      expect(decodeJwt(result.accessToken)).not.toHaveProperty('entry');
    }
    for (const nativeToken of fixtureB.nativeTokens) {
      const result = await contextB.exchange.exchange(nativeToken);
      expect(decodeJwt(result.accessToken)).not.toHaveProperty('UUID_Entry');
      expect(decodeJwt(result.accessToken)).not.toHaveProperty('entry');
    }
    issueA.mockClear();
    issueB.mockClear();
    for (const nativeToken of fixtureA.nativeTokens) await expect(contextB.exchange.exchange(nativeToken)).rejects.toBeInstanceOf(ExchangeIdentityDeniedError);
    for (const nativeToken of fixtureB.nativeTokens) await expect(contextA.exchange.exchange(nativeToken)).rejects.toBeInstanceOf(ExchangeIdentityDeniedError);
    expect(issueA).not.toHaveBeenCalled();
    expect(issueB).not.toHaveBeenCalled();
  });

  it('snapshots configuration per instance and shares no mutable readiness state', () => {
    expect(Object.isFrozen(fixtureA)).toBe(true);
    expect(Object.isFrozen(fixtureB)).toBe(true);
    expect(contextA.config.configuration).not.toBe(contextB.config.configuration);
    contextA.environmentInput.BRIDGE_INTEGRATION_ID = 'replacement-a';
    contextA.environmentInput.BRIDGE_IDX_ALLOWED_ENTRIES = '["replacement-entry-a"]';
    expect(contextA.config.configuration.integrationId).toBe(fixtureA.integrationId);
    expect(contextA.config.configuration.allowedEntries).toEqual(fixtureA.allowedEntries);
    expect(Object.isFrozen(contextA.config.configuration.allowedEntries)).toBe(true);
    expect(contextB.config.configuration.integrationId).toBe(fixtureB.integrationId);
    expect(contextB.config.configuration.allowedEntries).toEqual(fixtureB.allowedEntries);
    expect(Object.isFrozen(contextB.config.configuration.allowedEntries)).toBe(true);

    expect(contextA.readiness.getPublicReadiness()).toMatchObject({ status: 'ready', productionReady: true });
    expect(contextB.readiness.getPublicReadiness()).toMatchObject({ status: 'ready', productionReady: true });
    contextA.registry.setReady('signing', false);
    expect(contextA.readiness.getPublicReadiness()).toMatchObject({ status: 'not_ready', productionReady: false });
    expect(contextB.readiness.getPublicReadiness()).toMatchObject({ status: 'ready', productionReady: true });
    contextA.registry.setReady('signing', true);
    expect(contextA.readiness.getPublicReadiness()).toMatchObject({ status: 'ready', productionReady: true });
  });
});

async function createRuntime(fixture: DeploymentFixture): Promise<RuntimeContext> {
  const environmentInput = { ...fixture.environment };
  const transportConfig = new BridgeConfigService(environmentInput);
  const requests: CapturedRequest[] = [];
  const resolverHosts: string[] = [];
  const transport = new MenuDetailTransport(transportConfig, {
    resolve: async (hostname) => { resolverHosts.push(hostname); return ['93.184.216.34']; },
    request: async (url: URL, options: MenuDetailRequestOptions) => {
      requests.push(Object.freeze({ url: url.toString(), authorization: options.headers.authorization }));
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: bytes(JSON.stringify(fixture.menuDetail)) };
    }
  });
  const module = await Test.createTestingModule({ imports: [ExchangeModule] })
    .overrideProvider(BRIDGE_ENVIRONMENT).useValue(environmentInput)
    .overrideProvider(MenuDetailTransport).useValue(transport)
    .compile();
  const app = module.createNestApplication();
  await app.init();
  return Object.freeze({
    fixture, app, environmentInput, requests, resolverHosts, requestsAtReady: requests.length,
    exchange: app.get(ExchangeService), issuer: app.get(CanonicalTokenIssuer), config: app.get(BridgeConfigService),
    jwks: app.get(JwksService), registry: app.get(BridgeReadinessRegistry), readiness: app.get(BridgeReadinessService)
  });
}

async function* bytes(value: string): AsyncIterable<Uint8Array> { yield new TextEncoder().encode(value); }
