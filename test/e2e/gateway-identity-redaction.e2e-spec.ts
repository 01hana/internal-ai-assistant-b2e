import { exportJWK, importPKCS8 } from 'jose';
import request = require('supertest');
import { createGatewayBackendTrustChainHarness, type GatewayBackendTrustChainHarness, type TrustChainBindingFixture } from '../support/gateway-backend-trust-chain-harness';

const binding: TrustChainBindingFixture = Object.freeze({ customerId: 'phase8-redaction-customer-a', integrationId: 'phase8-redaction-integration-a', allowedHostApp: 'admin' });
const identity = Object.freeze({ subject: 'phase8-redaction-actor', organizationId: 'phase8-redaction-org', hostApp: 'admin', roles: ['planner'], permissionScopes: ['orders:read'] });

describe('Gateway identity/token non-exposure E2E (T074)', () => {
  let harness: GatewayBackendTrustChainHarness;

  beforeAll(async () => { harness = await createGatewayBackendTrustChainHarness({ label: 'gateway-identity-redaction', bindings: [binding] }); });
  afterAll(async () => { await harness.dispose(); });

  it('keeps real upstream/internal credentials and private signing material out of happy Host output, logs, audits, cookies, redirects, and public JWKS', async () => {
    harness.clearObservations();
    const upstreamToken = await issue(harness, binding.integrationId);
    const response = await request(harness.gateway.getHttpServer()).post('/api/v1/assistant/sessions')
      .set('authorization', `Bearer ${upstreamToken}`).set('x-request-id', 'phase8-redaction-happy').send({ pageContext: { module: 'orders' } });
    expect(response.status).toBe(201);
    expect(harness.outboundAuthorizations).toHaveLength(1);
    const internalAuthorization = harness.outboundAuthorizations[0];
    expect(internalAuthorization).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const privateJwk = await exportJWK(await importPKCS8(harness.signingFixture.privatePem, 'RS256'));
    const gatewayAudit = await harness.prisma.gatewayIdentityAuditEvent.findMany();
    const backendAudit = await harness.prisma.auditEvent.findMany();
    const jwks = await (await fetch(`${harness.gatewayOrigin}/.well-known/jwks.json`)).json();
    assertNoSensitiveLeaks([
      ['host-response', { body: response.body, headers: response.headers, cookie: response.headers['set-cookie'], location: response.headers.location }],
      ['gateway-logs', harness.gatewayLogs], ['backend-logs', harness.backendLogs], ['gateway-audit', gatewayAudit], ['backend-audit', backendAudit], ['public-jwks', jwks]
    ], secretCategories(upstreamToken, internalAuthorization, harness.signingFixture.privatePem, privateJwk));
    expect(harness.gatewayLogs).toEqual([]);
    expect(harness.backendLogs).toEqual([]);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(jwks).toEqual({ keys: [expect.objectContaining({ kty: 'RSA', kid: harness.signingFixture.kid, alg: 'RS256', use: 'sig' })] });
  });

  it('streams the fixed Host SSE operation without credential/key leakage in any received chunk', async () => {
    const upstreamToken = await issue(harness, binding.integrationId);
    const created = await request(harness.gateway.getHttpServer()).post('/api/v1/assistant/sessions')
      .set('authorization', `Bearer ${upstreamToken}`).set('x-request-id', 'phase8-redaction-sse-create').send({ pageContext: { module: 'orders' } });
    harness.clearObservations();
    const sseResponse = await fetch(`${harness.gatewayOrigin}/api/v1/assistant/sessions/${created.body.data.sessionId}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${upstreamToken}`, 'content-type': 'application/json', accept: 'text/event-stream', 'x-request-id': 'phase8-redaction-sse' }, body: JSON.stringify({ message: '?' })
    });
    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get('content-type')).toContain('text/event-stream');
    expect(harness.outboundAuthorizations).toHaveLength(1);
    const internalAuthorization = harness.outboundAuthorizations[0];
    const chunks = await readChunks(sseResponse.body);
    expect(chunks).not.toHaveLength(0);
    const privateJwk = await exportJWK(await importPKCS8(harness.signingFixture.privatePem, 'RS256'));
    assertNoSensitiveLeaks([
      ['sse-response-headers', Object.fromEntries(sseResponse.headers)],
      ['sse-response-cookie', sseResponse.headers.get('set-cookie')],
      ['sse-response-location', sseResponse.headers.get('location')]
    ], secretCategories(upstreamToken, internalAuthorization, harness.signingFixture.privatePem, privateJwk));
    expect(sseResponse.headers.get('set-cookie')).toBeNull();
    expect(sseResponse.headers.get('location')).toBeNull();
    for (const [index, chunk] of chunks.entries()) {
      assertNoSensitiveLeaks([[`sse-chunk-${index}`, chunk]], secretCategories(upstreamToken, internalAuthorization, harness.signingFixture.privatePem, privateJwk));
    }
    assertNoSensitiveLeaks([['gateway-logs', harness.gatewayLogs], ['backend-logs', harness.backendLogs], ['backend-audit', await harness.prisma.auditEvent.findMany()]], secretCategories(upstreamToken, internalAuthorization, harness.signingFixture.privatePem, privateJwk));
  });

  it('projects representative upstream and binding denials without credentials or internal diagnostics', async () => {
    const malformed = await fetch(`${harness.gatewayOrigin}/api/v1/assistant/sessions`, { method: 'POST', headers: { authorization: 'Bearer not.a.jwt', 'content-type': 'application/json' }, body: '{}' });
    const unboundToken = await issue(harness, 'phase8-redaction-unbound');
    const resolution = await fetch(`${harness.gatewayOrigin}/api/v1/assistant/sessions`, { method: 'POST', headers: { authorization: `Bearer ${unboundToken}`, 'content-type': 'application/json' }, body: '{}' });
    expect(malformed.status).toBe(401);
    expect(resolution.status).toBe(403);
    const [malformedBody, resolutionBody] = await Promise.all([malformed.json(), resolution.json()]);
    const gatewayAudit = await harness.prisma.gatewayIdentityAuditEvent.findMany();
    assertNoSensitiveLeaks([
      ['upstream-denial', { body: malformedBody, headers: Object.fromEntries(malformed.headers), cookie: malformed.headers.get('set-cookie'), location: malformed.headers.get('location') }],
      ['resolution-denial', { body: resolutionBody, headers: Object.fromEntries(resolution.headers), cookie: resolution.headers.get('set-cookie'), location: resolution.headers.get('location') }],
      ['gateway-audit', gatewayAudit], ['gateway-logs', harness.gatewayLogs], ['backend-logs', harness.backendLogs]
    ], secretCategories(unboundToken, undefined, harness.signingFixture.privatePem, undefined));
    expect(gatewayAudit.some((event) => event.eventType === 'identity_resolution_denied')).toBe(true);
  });

  it('projects a real Backend listener outage as safe BACKEND_UNAVAILABLE without leaking the internal credential', async () => {
    await harness.stopBackend();
    harness.clearObservations();
    const upstreamToken = await issue(harness, binding.integrationId);
    const response = await fetch(`${harness.gatewayOrigin}/api/v1/assistant/sessions`, { method: 'POST', headers: { authorization: `Bearer ${upstreamToken}`, 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(503);
    expect(harness.outboundAuthorizations).toHaveLength(1);
    const internalAuthorization = harness.outboundAuthorizations[0];
    const body = await response.json();
    assertNoSensitiveLeaks([['backend-unavailable', { body, headers: Object.fromEntries(response.headers), cookie: response.headers.get('set-cookie'), location: response.headers.get('location') }]], secretCategories(upstreamToken, internalAuthorization, harness.signingFixture.privatePem, undefined));
    expect(body).toEqual({ statusCode: 503, code: 'BACKEND_UNAVAILABLE', message: 'Backend is unavailable.' });
  });
});

async function issue(harness: GatewayBackendTrustChainHarness, integrationId: string): Promise<string> {
  return harness.upstreamAuthority.issue({ integrationId, ...identity });
}

async function readChunks(body: ReadableStream<Uint8Array> | null): Promise<string[]> {
  if (!body) throw new Error('T074 expected the real Gateway SSE response body.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return chunks;
    chunks.push(decoder.decode(next.value, { stream: true }));
  }
}

function secretCategories(upstreamToken: string, internalAuthorization: string | undefined, privatePem: string, privateJwk: object | undefined): readonly Readonly<{ category: string; value: string }>[] {
  return [
    { category: 'upstream-jwt', value: upstreamToken }, { category: 'upstream-authorization', value: `Bearer ${upstreamToken}` },
    ...(internalAuthorization ? [{ category: 'internal-jwt', value: internalAuthorization.replace(/^Bearer /, '') }, { category: 'internal-authorization', value: internalAuthorization }] : []),
    { category: 'private-pem', value: privatePem },
    ...(privateJwk ? Object.entries(privateJwk).filter(([key]) => ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].includes(key)).flatMap(([key, value]) => typeof value === 'string' ? [{ category: `private-jwk-${key}`, value }] : []) : [])
  ];
}

function assertNoSensitiveLeaks(surfaces: readonly (readonly [string, unknown])[], secrets: readonly Readonly<{ category: string; value: string }>[]): void {
  const leaks = surfaces.flatMap(([surface, value]) => {
    const serialized = JSON.stringify(value);
    return secrets.filter((secret) => serialized.includes(secret.value)).map((secret) => `${surface}:${secret.category}`);
  });
  expect(leaks).toEqual([]);
}
