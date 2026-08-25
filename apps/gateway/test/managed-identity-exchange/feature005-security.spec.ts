import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportJWK, generateKeyPair, type JWK, type JSONWebKeySet } from 'jose';
import {
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  ManagedExchangeIssuanceError,
  createVerifiedExternalIdentity,
  type IdentityProviderAdapter
} from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedIdentityExchangeService } from '../../src/managed-identity-exchange/exchange.service';
import { IntegrationAdmissionService } from '../../src/managed-identity-exchange/admission/integration-admission.service';
import { projectManagedExchangeError } from '../../src/managed-identity-exchange/exchange-error.projector';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';
import { DelegatedHttpTransport } from '../../src/managed-identity-exchange/providers/delegated-http.transport';
import { ManagedPermissionService } from '../../src/managed-identity-exchange/permissions/managed-permission.service';
import { PermissionSourceAdapterRegistry } from '../../src/managed-identity-exchange/permissions/permission-source-adapter.registry';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { SyntheticV1PermissionNormalizer } from '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer';
import { ManagedPermissionScopeProjector } from '../../src/managed-identity-exchange/permissions/managed-permission-scope.projector';
import { ManagedExchangeAuditWriter } from '../../src/managed-identity-exchange/persistence/managed-exchange-audit.writer';
import { ManagedExchangeAuditRepository } from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';
import { GatewaySigningAuthorityReader } from '../../src/managed-identity-exchange/persistence/gateway-signing-authority.reader';
import { ManagedJwksService } from '../../src/managed-identity-exchange/issuer/managed-jwks.service';
import { ManagedUpstreamTokenIssuer } from '../../src/managed-identity-exchange/issuer/managed-upstream-token-issuer';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { CanonicalIdentityResolver } from '../../src/integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileCache } from '../../src/integration-registry/trust-profile-cache';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { MultiProfileUpstreamTokenVerifier } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../src/upstream-auth/routing-metadata.parser';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import { UpstreamAuthTelemetry } from '../../src/upstream-auth/upstream-auth-telemetry';
import type { JwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { createSyntheticDelegatedProviderFixture } from './fixtures/synthetic-delegated-provider.fixture';
import { createSyntheticPermissionSourceFixture } from './fixtures/synthetic-permission-source.fixture';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';
import { createDirectJwtFixture, type DirectJwtFixture } from '../upstream-auth/direct-jwt.fixture';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const native = 'DO_NOT_LEAK_NATIVE';
const sentinels = Object.freeze([native, 'DO_NOT_LEAK_PROVIDER_DIAGNOSTIC', 'DO_NOT_LEAK_PERMISSION', 'DO_NOT_LEAK_ANCHOR', 'DO_NOT_LEAK_CUSTOMER', 'DO_NOT_LEAK_KEY_REFERENCE', 'DO_NOT_LEAK_PRIVATE_KEY', 'DO_NOT_LEAK_MANAGED_TOKEN']);
const managedIssuer = 'https://managed-security.example.test';
const managedAudience = 'managed-security-audience';
const managedJwksUri = 'https://managed-security.example.test/jwks';

describe('Feature 005 security and redaction matrix (T044)', () => {
  it('detects a deliberately unsafe test-only boundary and accepts the safe production-shaped projection', () => {
    expect(() => assertSafeBoundary({ body: `error ${native}`, headers: {} })).toThrow('unsafe boundary');
    expect(() => assertSafeBoundary({ body: { statusCode: 503, code: 'EXCHANGE_SERVICE_UNAVAILABLE', message: 'Managed identity exchange is unavailable.' }, headers: {} })).not.toThrow();
  });

  it('rejects a forged decodable credential before admission, permission, canonicalization, or issuance', async () => {
    const admission = jest.fn(); const permissions = jest.fn(); const canonicalizer = jest.fn(); const issuer = jest.fn();
    const adapter: IdentityProviderAdapter = { providerType: 'delegated_http', verify: async () => { throw new ManagedExchangeCredentialError(); } };
    const service = new ManagedIdentityExchangeService({
      configs: { findEnabledActiveByPublicSelector: async () => ({ id: 'config-a', integrationId: 'integration-a', providerInstanceId: 'provider-a', canonicalHostApp: 'admin' }) },
      providers: { findEnabledActiveById: async () => ({ id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://registered.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'delegated-http/v1', contractConfig: {}, declaredAnchorKinds: [] }) },
      readiness: { assertReady: async () => undefined }, providerAdapters: { resolve: () => adapter }, admission: { admit: admission },
      permissionPolicies: { findEnabledActiveByConfigId: async () => [] }, permissions: { resolve: permissions }, canonicalizer: { canonicalize: canonicalizer }, issuer: { issue: issuer }, audit: { append: async () => undefined }
    } as never);
    const forged = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ integration_id: 'forged', customer_id: 'DO_NOT_LEAK_CUSTOMER', host_app: 'evil', roles: ['admin'], permission_scopes: ['*'] })).toString('base64url')}.signature`;
    await expect(service.exchange({ integrationSelector: 'selector-a', nativeCredential: forged, requestId: 'request-forged' })).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
    expect(admission).not.toHaveBeenCalled(); expect(permissions).not.toHaveBeenCalled(); expect(canonicalizer).not.toHaveBeenCalled(); expect(issuer).not.toHaveBeenCalled();
  });

  it('rejects selector A credential replayed through selected config B before issuance', async () => {
    const issuer = jest.fn();
    const identity = createVerifiedExternalIdentity({ subject: 'subject-a', anchors: [{ kind: 'tenant', value: 'tenant-a' }] });
    const admission = new IntegrationAdmissionService({
      findEnabledActiveByConfigId: async () => [{ id: 'policy-b', integrationConfigId: 'config-b', enabled: true, lifecycle: 'active', anchorRequirements: [{ kind: 'tenant', allowedValues: ['tenant-b'] }] }]
    } as never);
    const service = new ManagedIdentityExchangeService({
      configs: { findEnabledActiveByPublicSelector: async () => ({ id: 'config-b', integrationId: 'integration-b', providerInstanceId: 'provider-shared', canonicalHostApp: 'admin' }) },
      providers: { findEnabledActiveById: async () => ({ id: 'provider-shared', providerType: 'delegated_http', endpointUri: 'https://registered.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'delegated-http/v1', contractConfig: {}, declaredAnchorKinds: ['tenant'] }) },
      readiness: { assertReady: async () => undefined }, providerAdapters: { resolve: () => ({ providerType: 'delegated_http', verify: async () => identity }) }, admission,
      permissionPolicies: { findEnabledActiveByConfigId: async () => [] }, permissions: { resolve: async () => [] }, canonicalizer: { canonicalize: async () => { throw new Error('must not canonicalize'); } }, issuer: { issue: issuer }, audit: { append: async () => undefined }
    } as never);
    await expect(service.exchange({ integrationSelector: 'selector-b', nativeCredential: 'credential-a', requestId: 'request-replay' })).rejects.toBeInstanceOf(ManagedExchangeCredentialError);
    expect(issuer).not.toHaveBeenCalled();
  });

  it('rejects managed Gateway issuer, kid, key-reference, and RSA-public collisions', async () => {
    const reader = new GatewaySigningAuthorityReader({
      config: { config: { internalIssuer: 'https://gateway.example.test/internal' } },
      signingKeys: { findAllForCollision: async () => [{ kid: 'gateway-kid', keyReference: 'gateway-reference', publicJwk: { kty: 'RSA', n: 'gateway-n', e: 'AQAB', metadata: 'ignored' } }] }
    } as never);
    expect(() => reader.assertDistinctIssuer('https://gateway.example.test/internal')).toThrow();
    await expect(reader.assertDistinctKey({ kid: 'managed-kid', keyReference: 'gateway-reference', publicJwk: { kty: 'RSA', n: 'managed-n', e: 'AQAB' } })).rejects.toThrow();
    await expect(reader.assertDistinctKey({ kid: 'gateway-kid', keyReference: 'managed-reference', publicJwk: { kty: 'RSA', n: 'managed-n', e: 'AQAB' } })).rejects.toThrow();
    await expect(reader.assertDistinctKey({ kid: 'managed-kid', keyReference: 'managed-reference', publicJwk: { e: 'AQAB', n: 'gateway-n', kty: 'RSA', unrelated: 'metadata' } })).rejects.toThrow();
  });

  it('publishes only active managed public JWKS fields and excludes retired keys', async () => {
    const service = new ManagedJwksService({
      issuers: { findEnabledActive: async () => [{ id: 'issuer-a', enabled: true, lifecycle: 'active' }] },
      signingKeys: { findJwksVisibleByIssuerId: async () => [
        { issuerId: 'issuer-a', kid: 'kid-active', status: 'active', publicJwk: { kty: 'RSA', n: 'active-n', e: 'AQAB', kid: 'kid-active', alg: 'RS256', use: 'sig', extra: 'ignored' } },
        { issuerId: 'issuer-a', kid: 'kid-retired', status: 'retired', publicJwk: { kty: 'RSA', n: 'retired-n', e: 'AQAB', kid: 'kid-retired' } }
      ] }
    } as never);
    const document = await service.getDocument();
    expect(document.keys).toHaveLength(1);
    expect(document.keys[0]).toEqual({ kty: 'RSA', kid: 'kid-active', alg: 'RS256', use: 'sig', n: 'active-n', e: 'AQAB' });
    expect(Object.keys(document.keys[0]).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
  });

  it('projects distinct internal 401, 403, and 503 causes to exact equivalent redacted public envelopes', () => {
    const credentialA = projectManagedExchangeError(sentinelError(new ManagedExchangeCredentialError(), 'DO_NOT_LEAK_CREDENTIAL_A'));
    const credentialB = projectManagedExchangeError(sentinelError(new ManagedExchangeCredentialError(), 'DO_NOT_LEAK_CREDENTIAL_B'));
    expectExactPublicEnvelope(credentialA, 401, 'EXCHANGE_IDENTITY_INVALID');
    expect(credentialA.getResponse()).toEqual(credentialB.getResponse());

    const denialA = projectManagedExchangeError(sentinelError(new ManagedExchangeIdentityDeniedError(), 'DO_NOT_LEAK_DENIAL_A'));
    const denialB = projectManagedExchangeError(sentinelError(new ManagedExchangeIdentityDeniedError(), 'DO_NOT_LEAK_DENIAL_B'));
    expectExactPublicEnvelope(denialA, 403, 'EXCHANGE_IDENTITY_DENIED');
    expect(denialA.getResponse()).toEqual(denialB.getResponse());

    const infrastructure503 = projectManagedExchangeError(sentinelError(new ManagedExchangeInfrastructureError(), 'DO_NOT_LEAK_INFRASTRUCTURE'));
    const issuance503 = projectManagedExchangeError(sentinelError(new ManagedExchangeIssuanceError(), 'DO_NOT_LEAK_ISSUANCE'));
    expectExactPublicEnvelope(infrastructure503, 503, 'EXCHANGE_SERVICE_UNAVAILABLE');
    expect(infrastructure503.getResponse()).toEqual(issuance503.getResponse());
  });

  it('uses registered provider routing once and redacts transport failures without retry', async () => {
    const fixture = createSyntheticDelegatedProviderFixture('five-hundred');
    const error = await fixture.adapter.verify(fixture.input()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0].endpoint).toBe(fixture.policy.endpointUri);
    expect(`${String(error)}${JSON.stringify(error)}`).not.toMatch(new RegExp(sentinels.join('|')));
    const timeout = createSyntheticDelegatedProviderFixture('timeout');
    await expect(timeout.adapter.verify(timeout.input())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(timeout.requests).toHaveLength(1);
  });

  it.each([
    ['private destination', async () => securityTransport({ resolve: async () => ['10.0.0.1'] })],
    ['loopback destination', async () => securityTransport({ resolve: async () => ['127.0.0.1'] })],
    ['mixed DNS', async () => securityTransport({ resolve: async () => ['8.8.8.8', '127.0.0.1'] })],
    ['DNS rebinding', async () => securityTransport({ resolve: jest.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1']), request: async (url: URL, options: { lookup(host: string): Promise<readonly string[]> }) => { await options.lookup(url.hostname); return rawResponse(); } })],
    ['redirect', async () => securityTransport({ request: async () => rawResponse(302) })],
    ['invalid MIME', async () => securityTransport({ request: async () => rawResponse(200, 'text/html') })],
    ['oversized body', async () => securityTransport({ request: async () => rawResponse(200, 'application/json', [Buffer.alloc(256 * 1024 + 1)]) })]
  ])('rejects representative delegated security failure: %s', async (_label, build) => {
    const transport = await build();
    const error = await transport.execute(transportInput()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(`${String(error)}${JSON.stringify(error)}`).not.toMatch(new RegExp(sentinels.join('|')));
  });

  it('does not let hostile endpoint-like values override the registered provider policy endpoint', async () => {
    const request = jest.fn(async () => rawResponse());
    const transport = securityTransport({ request });
    const input = transportInput();
    await transport.execute({ ...input, nativeCredential: `${native}.endpointUri=https://attacker.test providerUrl=https://attacker.test jwks_uri=https://attacker.test iss=attacker` });
    expect((request.mock.calls as unknown as readonly (readonly unknown[])[])[0][0]).toEqual(new URL('https://registered.example.test/verify'));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps permission-source input credential-free and preserves outage versus semantic-denial taxonomy', async () => {
    const source = createSyntheticPermissionSourceFixture('trusted');
    await source.adapter.resolve(Object.freeze({
      admittedIdentity: createVerifiedExternalIdentity({ subject: 'subject', anchors: [{ kind: 'tenant', value: 'tenant-a' }] }),
      serverOwnedIntegrationContext: Object.freeze({ integrationId: 'integration-a', hostApp: 'admin' }), permissionSourcePolicy: Object.freeze({ id: 'source-a', sourceType: 'synthetic', adapterContractReference: 'synthetic/v1' }), requestId: 'request-a'
    }));
    expect(JSON.stringify(source.adapter.input)).not.toMatch(/nativeCredential|Authorization|rawJwt|callbackData|cookie|customerId/i);
    await expect(permissionPipeline('outage').resolve(permissionInput())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    await expect(permissionPipeline('semantic-denial').resolve(permissionInput())).rejects.toBeInstanceOf(ManagedExchangeIdentityDeniedError);
  });

  it('keeps IDX disabled and production cores free of Customer, provider-name, transaction, retry, and fallback authority', async () => {
    await expect(new IdxDelegatedVerificationAdapter().verify({ nativeCredential: native, providerInstancePolicy: {} as never, requestId: 'request-idx' })).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    const files = [
      '../../src/managed-identity-exchange/exchange.service.ts', '../../src/managed-identity-exchange/admission/integration-admission.service.ts',
      '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service.ts', '../../src/managed-identity-exchange/permissions/managed-permission.service.ts',
      '../../src/managed-identity-exchange/issuer/managed-upstream-token-issuer.ts'
    ].map((file) => readFileSync(resolve(__dirname, file), 'utf8')).join('\n');
    expect(files).not.toMatch(/CustomerRepository|CustomerScope|findCustomer|resolveCustomer|Shinmone|UserType|IsAdmin|\$transaction|\.transaction\(|retry(?:Count|\s*\()|fallback/i);
    expect(files).not.toMatch(/(?:providerType|sourceType)\s*={2,3}\s*['"](?:delegated_http|idx_delegated|synthetic)/);
  });

  it('keeps managed persistence models and audit boundaries free of raw credential, token, key, and Customer fields', () => {
    const schema = readFileSync(resolve(__dirname, '../../../../prisma/schema.prisma'), 'utf8');
    const managedModels = [...schema.matchAll(/model (Managed\w+) \{([\s\S]*?)\n\}/g)].map((match) => match[0]).join('\n');
    const audit = [
      '../../src/managed-identity-exchange/persistence/managed-exchange-audit.writer.ts',
      '../../src/managed-identity-exchange/persistence/managed-exchange.repository.ts'
    ].map((file) => readFileSync(resolve(__dirname, file), 'utf8')).join('\n');
    expect(managedModels).not.toMatch(/\b(?:nativeCredential|authorization|accessToken|refreshToken|rawToken|privateKey|customerId)\b/);
    expect(audit).not.toMatch(/\b(?:nativeCredential|authorization|accessToken|refreshToken|rawToken|privateKey|customerId)\b/);
  });
});

describeRegistry('Feature 005 audit redaction (T044)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  beforeEach(async () => { database = await createGatewayRegistryDatabase('feature005-security'); prisma = createGatewayPrismaClient(database.databaseUrl); });
  afterEach(async () => { await prisma?.$disconnect(); await database?.dispose(); });

  it('persists only allowlisted audit metadata and never raw native, token, Customer, or key material', async () => {
    const writer = new ManagedExchangeAuditWriter(new ManagedExchangeAuditRepository(prisma));
    await writer.append({ requestId: 'request-security', outcome: 'success', reasonCode: 'managed_exchange_issued', integrationId: 'integration-a', integrationConfigId: 'config-a', providerType: 'delegated_http', providerInstanceId: 'provider-a', jti: 'jti-a', kid: 'kid-a' });
    const rows = await prisma.managedExchangeAuditEvent.findMany({ where: { requestId: 'request-security' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(sentinels.join('|')));
    expect(JSON.stringify(rows)).not.toMatch(/nativeCredential|authorization|accessToken|customerId|keyReference|privateKey/i);
  });

  it('keeps Customer and HostApp authority exclusively at the real Feature 004 binding for a managed JWT', async () => {
    await prisma.customer.create({ data: { id: 'customer-a' } });
    await prisma.integrationBinding.create({ data: { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true } });
    const runtime = await managedFeature004Runtime(prisma);
    const token = await runtime.issue();
    expect(decodeJwtPayload(token)).not.toHaveProperty('customer_id');

    const verified = await runtime.verifier.verify({ authorization: `Bearer ${token}`, requestId: 'request-security-managed' });
    const resolved = await runtime.resolver.resolve({ identity: verified, requestId: 'request-security-managed' });
    expect(resolved).toMatchObject({ integrationId: 'integration-a', customerId: 'customer-a', hostApp: 'admin' });
    expect(runtime.bindingLookup).toHaveBeenCalledWith('integration-a');

    await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { allowedHostApp: 'another-host' } });
    await expect(runtime.resolver.resolve({ identity: verified, requestId: 'request-security-managed-host' })).rejects.toMatchObject({ status: 403, code: 'IDENTITY_ISSUANCE_DENIED' });
  });

  it('fails an invalid Direct JWT through Feature 004 without a managed fallback or managed audit', async () => {
    const direct = await createDirectJwtFixture();
    try {
      await prisma.customer.create({ data: { id: 'customer-direct' } });
      await prisma.integrationBinding.create({ data: { integrationId: 'integration-direct', customerId: 'customer-direct', allowedHostApp: 'admin', enabled: true } });
      await prisma.registeredUpstreamTrustProfile.create({ data: directProfile(direct) });
      const runtime = directFeature004Runtime(prisma);
      await expect(runtime.verifier.verify({ authorization: `Bearer ${await direct.issueInvalidSignature()}`, requestId: 'request-security-direct-invalid' })).rejects.toBeInstanceOf(UpstreamAuthenticationError);
      expect(runtime.profileVerify).toHaveBeenCalledTimes(1);
      expect(await prisma.managedExchangeAuditEvent.count()).toBe(0);
    } finally {
      await direct.close();
    }
  });
});

function assertSafeBoundary(value: Readonly<{ body: unknown; headers: Readonly<Record<string, unknown>> }>): void {
  const serialized = `${typeof value.body === 'string' ? value.body : JSON.stringify(value.body)}${JSON.stringify(value.headers)}`;
  if (sentinels.some((sentinel) => serialized.includes(sentinel))) throw new Error('unsafe boundary');
}

function sentinelError<T extends Error>(error: T, marker = native): T {
  error.message = marker;
  return error;
}

function expectExactPublicEnvelope(projected: ReturnType<typeof projectManagedExchangeError>, statusCode: number, code: string): void {
  expect(projected.getStatus()).toBe(statusCode);
  expect(projected.getResponse()).toEqual({ statusCode, code, message: expect.any(String) });
  expect(Object.keys(projected.getResponse() as object).sort()).toEqual(['code', 'message', 'statusCode']);
  expect(`${String(projected)}${JSON.stringify(projected.getResponse())}`).not.toMatch(/DO_NOT_LEAK|requestId|reasonCode|diagnostic|stack/);
}

async function managedFeature004Runtime(prisma: ReturnType<typeof createGatewayPrismaClient>) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'security-managed-kid', alg: 'RS256', use: 'sig' } as JWK;
  await prisma.registeredUpstreamTrustProfile.create({ data: {
    id: 'security-managed-profile', integrationId: 'integration-a', expectedIssuer: managedIssuer, expectedAudience: managedAudience,
    jwksUri: managedJwksUri, algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null
  } });
  const jwks = new ManagedJwksService({
    issuers: { findEnabledActive: async () => [{ id: 'security-managed-issuer', issuer: managedIssuer, expectedAudience: managedAudience, enabled: true, lifecycle: 'active' }] as never },
    signingKeys: { findJwksVisibleByIssuerId: async () => [{ issuerId: 'security-managed-issuer', kid: 'security-managed-kid', publicJwk, status: 'active' }] as never }
  });
  const profiles = new TrustProfileRepository(prisma);
  const scoped = new ProfileScopedVerifier({ transport: { fetch: async () => await jwks.getDocument() as never } satisfies JwksTransport });
  const verifier = new MultiProfileUpstreamTokenVerifier({
    parser: new RoutingMetadataParser(), candidateResolver: new CandidateTrustProfileResolver(new TrustProfileCache({ repository: profiles, ttlMilliseconds: 0 })),
    profileVerifier: scoped, telemetry: new UpstreamAuthTelemetry(new GatewayIdentityAuditWriter(prisma)), clockToleranceSeconds: 0
  });
  const bindings = new IntegrationBindingRepository(prisma);
  const bindingLookup = jest.spyOn(bindings, 'findByIntegrationId');
  const resolver = new CanonicalIdentityResolver(bindings, new GatewayIdentityAuditWriter(prisma));
  const issuer = new ManagedUpstreamTokenIssuer({ findActive: async () => Object.freeze({ issuer: managedIssuer, audience: managedAudience, kid: 'security-managed-kid', privateKey }) });
  const issue = async () => (await issuer.issue(Object.freeze({
    integrationId: 'integration-a', subject: 'security-subject', organizationId: 'security-organization', hostApp: 'admin', roles: [] as [], permissionScopes: Object.freeze(['orders:read'])
  }))).accessToken;
  return Object.freeze({ verifier, resolver, bindingLookup, issue });
}

function directFeature004Runtime(prisma: ReturnType<typeof createGatewayPrismaClient>) {
  const scoped = new ProfileScopedVerifier({ transport: { fetch: async (uri) => await (await fetch(uri)).json() as JSONWebKeySet } satisfies JwksTransport });
  const profileVerify = jest.spyOn(scoped, 'verify');
  const verifier = new MultiProfileUpstreamTokenVerifier({
    parser: new RoutingMetadataParser(), candidateResolver: new CandidateTrustProfileResolver(new TrustProfileCache({ repository: new TrustProfileRepository(prisma), ttlMilliseconds: 0 })),
    profileVerifier: scoped, telemetry: new UpstreamAuthTelemetry(new GatewayIdentityAuditWriter(prisma)), clockToleranceSeconds: 0
  });
  return Object.freeze({ verifier, profileVerify });
}

function directProfile(direct: DirectJwtFixture) {
  return {
    id: 'security-direct-profile', integrationId: 'integration-direct', expectedIssuer: direct.issuer, expectedAudience: direct.audience,
    jwksUri: direct.jwksUri, algorithm: 'RS256' as const, enabled: true, lifecycle: 'active' as const, version: 1, replacesProfileId: null
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

function permissionPipeline(scenario: 'outage' | 'semantic-denial') {
  const fixture = createSyntheticPermissionSourceFixture(scenario);
  const normalizer = new SyntheticV1PermissionNormalizer();
  return new ManagedPermissionService({
    permissionSources: { findEnabledActiveById: async () => fixture.source }, permissionAdapters: new PermissionSourceAdapterRegistry([fixture.adapter]),
    permissionNormalizers: new PermissionNormalizerRegistry([normalizer]), projector: new ManagedPermissionScopeProjector()
  });
}

function permissionInput() {
  return Object.freeze({
    admittedIdentity: createVerifiedExternalIdentity({ subject: 'subject', anchors: [{ kind: 'tenant', value: 'tenant-a' }] }), integrationConfigId: 'config-a',
    serverOwnedIntegrationContext: Object.freeze({ integrationId: 'integration-a', hostApp: 'admin' }), requestId: 'request-a',
    policy: Object.freeze({ integrationConfigId: 'config-a', mode: 'allow_empty', permissionSourceInstanceId: 'synthetic-source', normalizerType: 'synthetic-normalizer/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' }) })
  });
}

function transportInput() {
  return { nativeCredential: native, requestId: 'request-transport', providerInstancePolicy: { id: 'provider-a', providerType: 'delegated_http', endpointUri: 'https://registered.example.test/verify', httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'delegated-http/v1', declaredAnchorKinds: [], providerContract: {} } } as const;
}

function securityTransport(overrides: Record<string, unknown> = {}) {
  return new DelegatedHttpTransport({ resolve: async () => ['8.8.8.8'], request: async () => rawResponse(), ...overrides } as never);
}

function rawResponse(statusCode = 200, contentType = 'application/json', chunks: readonly Uint8Array[] = [Buffer.from('{"ok":true}')]) {
  return { statusCode, headers: { 'content-type': contentType }, body: (async function* () { yield* chunks; })(), dispose: jest.fn() };
}
