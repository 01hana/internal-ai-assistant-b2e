import { createServer, type Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { decodeJwt, type JSONWebKeySet } from 'jose';
import { GatewayAssistantController } from '../../src/operations/gateway-assistant.controller';
import { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import { GatewayBackendClient } from '../../src/backend-client/gateway-backend-client.service';
import { InternalIdentityTokenIssuer } from '../../src/identity/internal-identity-token-issuer.service';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { CanonicalIdentityResolver } from '../../src/integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileCache } from '../../src/integration-registry/trust-profile-cache';
import { TrustProfileRepository, type TrustProfileRecord } from '../../src/integration-registry/trust-profile.repository';
import { MultiProfileUpstreamTokenVerifier } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../src/upstream-auth/routing-metadata.parser';
import { UpstreamAuthTelemetry } from '../../src/upstream-auth/upstream-auth-telemetry';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { createDirectJwtFixture, type DirectJwtFixture } from '../upstream-auth/direct-jwt.fixture';
import { createTokenExchangeFixture, type TokenExchangeFixture } from '../upstream-auth/token-exchange.fixture';
import { createEphemeralRsaFixture, type EphemeralRsaFixture } from '../signing/ephemeral-rsa.fixture';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';
import { createUs1TestAppWithState, parseSseResponse, type Us1TestState } from '../../../../test/support/us1-test-app.helper';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, type InternalIdentityTokenVerifier } from '../../../../src/identity/identity-token.types';
import { RemoteJwksInternalIdentityTokenVerifier } from '../../../../src/identity/internal-identity-token-verifier';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const registryDatabaseUrl = process.env.DATABASE_URL;

describeRegistry('Feature 004 Gateway → Backend E2E (T058/T059)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let direct: DirectJwtFixture;
  let exchange: TokenExchangeFixture;
  let internal: EphemeralRsaFixture;
  let internalJwks: Server;
  let backend: INestApplication;
  let gateway: INestApplication;
  let state: Us1TestState;
  let outbound: Array<Record<string, string>>;

  beforeEach(async () => {
    if (registryDatabaseUrl === undefined) throw new Error('Gateway registry DB test configuration is required.');
    process.env.DATABASE_URL = registryDatabaseUrl;
    database = await createGatewayRegistryDatabase('feature004-gateway-backend');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    direct = await createDirectJwtFixture();
    exchange = await createTokenExchangeFixture();
    internal = await createEphemeralRsaFixture({ kid: 'feature004-internal-kid' });
    internalJwks = await startJwksServer(internal);
    const jwksUri = `http://127.0.0.1:${port(internalJwks)}/jwks`;
    ({ app: backend, state } = await createUs1TestAppWithState({
      internalIdentityVerifierMode: 'remote',
      internalIdentity: { issuer: 'https://feature004-gateway.internal', audience: 'feature004-backend', jwksUri, jwks: { keys: [internal.publicJwk] } }
    }));
    expect(backend.get<InternalIdentityTokenVerifier>(INTERNAL_IDENTITY_TOKEN_VERIFIER)).toBeInstanceOf(RemoteJwksInternalIdentityTokenVerifier);
    await backend.listen(0, '127.0.0.1');
    await seedRegistry(prisma, direct, exchange);
    outbound = [];
    gateway = await createGateway(prisma, internal, `http://127.0.0.1:${port(backend.getHttpServer())}`, outbound);
  });

  afterEach(async () => {
    await gateway?.close();
    await backend?.close();
    await close(internalJwks);
    await direct?.close();
    await exchange?.close();
    await prisma?.$disconnect();
    await database?.dispose();
    if (registryDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = registryDatabaseUrl;
  });

  it('runs Direct A and Token Exchange B through Gateway HTTP, internal JWT, Backend HTTP, and CustomerScope', async () => {
    const aToken = await direct.issue({ sub: 'actor-shared', org_id: 'org-shared', roles: [], permission_scopes: [] });
    const bToken = await exchange.exchange(exchange.issueTrustedNativeCredential({ principal: 'actor-shared', organization: 'org-shared', roles: [], permissionScopes: [] }));
    const a = await exerciseAllRoutes(aToken, 'a', 'customer-a');
    const b = await exerciseAllRoutes(bToken, 'b', 'customer-b');

    expect(state.sessions.find((session) => session.id === a.sessionId)).toMatchObject({ customerId: 'customer-a', actorId: 'actor-shared', organizationId: 'org-shared' });
    expect(state.sessions.find((session) => session.id === b.sessionId)).toMatchObject({ customerId: 'customer-b', actorId: 'actor-shared', organizationId: 'org-shared' });
    expect(state.messages.filter((message) => message.sessionId === a.sessionId).every((message) => message.customerId === 'customer-a')).toBe(true);
    expect(state.messages.filter((message) => message.sessionId === b.sessionId).every((message) => message.customerId === 'customer-b')).toBe(true);

    const internalTokens = outbound.map((headers) => headers.authorization?.replace(/^Bearer /, '')).filter((value): value is string => Boolean(value));
    expect(new Set(internalTokens).size).toBe(internalTokens.length);
    const claims = internalTokens.map((token) => decodeJwt(token));
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ customer_id: 'customer-a', integration_id: 'integration-a', sub: 'actor-shared', org_id: 'org-shared', host_app: 'admin', roles: [], permission_scopes: [] }),
      expect.objectContaining({ customer_id: 'customer-b', integration_id: 'integration-b', sub: 'actor-shared', org_id: 'org-shared', host_app: 'admin', roles: [], permission_scopes: [] })
    ]));
    expect(outbound.every((headers) => headers.authorization !== `Bearer ${aToken}` && headers.authorization !== `Bearer ${bToken}` && !('cookie' in headers) && !('x-customer-id' in headers))).toBe(true);
    expect(outbound.map((headers) => headers['x-request-id'])).toEqual(expect.arrayContaining([
      'a-create', 'a-read', 'a-history', 'a-sse', 'b-create', 'b-read', 'b-history', 'b-sse'
    ]));
  });

  it('keeps CustomerScope isolation and public Customer hints non-authoritative', async () => {
    const aToken = await direct.issue({ sub: 'actor-shared', org_id: 'org-shared' });
    const bToken = await exchange.exchange(exchange.issueTrustedNativeCredential({ principal: 'actor-shared', organization: 'org-shared' }));
    const a = await create(aToken, 'a-create-hint', {}, { 'x-customer-id': 'customer-b', 'x-integration-id': 'integration-b' });
    const b = await create(bToken, 'b-create');
    expect(state.sessions.find((session) => session.id === a)).toMatchObject({ customerId: 'customer-a' });
    const before = customerStateSnapshot(state, 'customer-b');

    const foreignRead = await get(aToken, b, 'a-foreign-read');
    const missingRead = await get(aToken, 'missing-session-404', 'a-missing-read');
    expect(safeResponseShape(foreignRead)).toEqual(safeResponseShape(missingRead));
    await expectHistoryDenied(aToken, b);
    const deniedSse = await request(gateway.getHttpServer()).post(`/api/v1/assistant/sessions/${b}/messages`).set('authorization', `Bearer ${aToken}`).set('x-request-id', 'a-foreign-sse').send({ message: 'do not write' });
    expect(deniedSse.status).not.toBe(200);
    expect(customerStateSnapshot(state, 'customer-b')).toEqual(before);
    expect(JSON.stringify([foreignRead.body, deniedSse.body])).not.toMatch(/customer-b|actor-shared|do not write|feature004-internal/i);

    const bForeign = await get(bToken, a, 'b-foreign-read');
    expect(safeResponseShape(bForeign)).toEqual(safeResponseShape(missingRead));
  });

  async function exerciseAllRoutes(token: string, label: 'a' | 'b', customerId: string) {
    const sessionId = await create(token, `${label}-create`);
    const read = await get(token, sessionId, `${label}-read`);
    expect(read.status).toBe(200);
    expect(read.body.requestId).toBe(`${label}-read`);
    const history = await request(gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}/messages`).set('authorization', `Bearer ${token}`).set('x-request-id', `${label}-history`);
    expect(history.status).toBe(200);
    expect(history.body.requestId).toBe(`${label}-history`);
    const sse = await request(gateway.getHttpServer()).post(`/api/v1/assistant/sessions/${sessionId}/messages`).set('authorization', `Bearer ${token}`).set('x-request-id', `${label}-sse`).send({ message: `message-${label}` });
    expect(sse.status).toBe(200);
    expect(sse.headers['content-type']).toMatch(/^text\/event-stream/);
    const final = parseSseResponse(sse.text).at(-1);
    expect(final?.event).toBe('final');
    expect(final?.data).toEqual(expect.objectContaining({ requestId: `${label}-sse` }));
    expect(state.sessions.find((session) => session.id === sessionId)?.customerId).toBe(customerId);
    return { sessionId };
  }

  async function create(token: string, requestId: string, pageContext: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const response = await request(gateway.getHttpServer()).post('/api/v1/assistant/sessions').set('authorization', `Bearer ${token}`).set('x-request-id', requestId).set(headers).send({ pageContext });
    expect(response.status).toBe(201);
    expect(response.body.requestId).toBe(requestId);
    return response.body.data.sessionId as string;
  }

  async function get(token: string, sessionId: string, requestId: string) {
    return request(gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}`).set('authorization', `Bearer ${token}`).set('x-request-id', requestId);
  }

  async function expectHistoryDenied(token: string, sessionId: string) {
    const foreign = await request(gateway.getHttpServer()).get(`/api/v1/assistant/sessions/${sessionId}/messages`).set('authorization', `Bearer ${token}`).set('x-request-id', 'a-foreign-history');
    const missing = await request(gateway.getHttpServer()).get('/api/v1/assistant/sessions/missing-session-404/messages').set('authorization', `Bearer ${token}`).set('x-request-id', 'a-missing-history');
    expect(safeResponseShape(foreign)).toEqual(safeResponseShape(missing));
  }
});

async function createGateway(prisma: ReturnType<typeof createGatewayPrismaClient>, internal: EphemeralRsaFixture, backendBaseUrl: string, outbound: Array<Record<string, string>>) {
  const profiles = new TrustProfileRepository(prisma);
  const cache = new TrustProfileCache({ repository: profiles });
  const candidates = new CandidateTrustProfileResolver(cache);
  const audit = new GatewayIdentityAuditWriter(prisma);
  const verifier = new MultiProfileUpstreamTokenVerifier({ parser: new RoutingMetadataParser(), candidateResolver: candidates, profileVerifier: new ProfileScopedVerifier({ transport: new LocalFixtureTransport() }), telemetry: new UpstreamAuthTelemetry(audit), clockToleranceSeconds: 0 });
  const resolver = new CanonicalIdentityResolver(new IntegrationBindingRepository(prisma), audit);
  const issuer = new InternalIdentityTokenIssuer({ internalIssuer: 'https://feature004-gateway.internal', internalAudience: 'feature004-backend', internalTokenTtlSeconds: 300 }, { resolveActiveSigningKey: async () => ({ kid: internal.kid, privateKey: internal.privateKey }) });
  const client = new GatewayBackendClient({ backendBaseUrl, timeoutMilliseconds: 5_000, internalTokenIssuer: issuer, fetch: async (url, init) => { outbound.push({ ...init.headers }); return globalThis.fetch(url, init); }, createTimeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds), createAbortController: () => new AbortController() });
  const handler = new GatewayTrustChainHandler({ upstreamTokenVerifier: verifier, canonicalIdentityResolver: resolver, gatewayBackendClient: client });
  const moduleRef = await Test.createTestingModule({ controllers: [GatewayAssistantController], providers: [{ provide: GatewayTrustChainHandler, useValue: handler }] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

async function seedRegistry(prisma: ReturnType<typeof createGatewayPrismaClient>, direct: DirectJwtFixture, exchange: TokenExchangeFixture) {
  await prisma.customer.createMany({ data: [{ id: 'customer-a' }, { id: 'customer-b' }] });
  await prisma.integrationBinding.createMany({ data: [{ integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true }, { integrationId: 'integration-b', customerId: 'customer-b', allowedHostApp: 'admin', enabled: true }] });
  await prisma.registeredUpstreamTrustProfile.createMany({ data: [profile('profile-a', 'integration-a', direct), profile('profile-b', 'integration-b', exchange)] });
}

function profile(id: string, integrationId: string, fixture: Pick<DirectJwtFixture | TokenExchangeFixture, 'issuer' | 'audience' | 'jwksUri'>): TrustProfileRecord {
  return { id, integrationId, expectedIssuer: fixture.issuer, expectedAudience: fixture.audience, jwksUri: fixture.jwksUri, algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null };
}

function customerStateSnapshot(state: Us1TestState, customerId: string) {
  const sessionIds = new Set(state.sessions.filter((session) => session.customerId === customerId).map((session) => session.id));
  const messageIds = new Set(state.messages.filter((message) => message.customerId === customerId || sessionIds.has(message.sessionId)).map((message) => message.id));
  const belongsToCustomer = (value: unknown) => {
    const record = value as { customerId?: string | null; sessionId?: string | null; messageId?: string | null };
    return record.customerId === customerId || (typeof record.sessionId === 'string' && sessionIds.has(record.sessionId)) || (typeof record.messageId === 'string' && messageIds.has(record.messageId));
  };
  return JSON.parse(JSON.stringify({
    sessions: state.sessions.filter(belongsToCustomer), contextStates: state.contextStates.filter(belongsToCustomer), messages: state.messages.filter(belongsToCustomer),
    actionDrafts: state.actionDrafts.filter(belongsToCustomer), approvalRequests: state.approvalRequests.filter(belongsToCustomer), escalationRequests: state.escalationRequests.filter(belongsToCustomer),
    toolCalls: state.toolCalls.filter(belongsToCustomer), evidenceRefs: state.evidenceRefs.filter(belongsToCustomer), auditEvents: state.auditEvents.filter(belongsToCustomer),
    queryUnderstandingResults: state.queryUnderstandingResults.filter(belongsToCustomer), executionPlans: state.executionPlans.filter(belongsToCustomer), groundingChecks: state.groundingChecks.filter(belongsToCustomer),
    answerDecisions: state.answerDecisions.filter(belongsToCustomer), clarificationQuestions: state.clarificationQuestions.filter(belongsToCustomer), reviewItems: state.reviewItems.filter(belongsToCustomer),
    feedbackEvents: state.feedbackEvents.filter(belongsToCustomer), retrievalRuns: state.retrievalRuns.filter(belongsToCustomer), retrievalCandidates: state.retrievalCandidates.filter(belongsToCustomer)
  }));
}

function safeResponseShape(response: { status: number; body: { requestId?: unknown; error?: unknown } }) {
  return { status: response.status, body: { ...(response.body.error === undefined ? {} : { error: response.body.error }) } };
}

class LocalFixtureTransport implements JwksTransport {
  async fetch(uri: string): Promise<JSONWebKeySet> { return await (await fetch(uri)).json() as JSONWebKeySet; }
}

async function startJwksServer(fixture: EphemeralRsaFixture): Promise<Server> {
  const server = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ keys: [fixture.publicJwk] })); });
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
  return server;
}
function port(server: Server): number { const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected local listener.'); return address.port; }
function close(server: Server | undefined): Promise<void> { return new Promise((resolve, reject) => !server || !server.listening ? resolve() : server.close((error) => error ? reject(error) : resolve())); }
