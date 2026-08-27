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
import { ManagedCanonicalizationService } from '../../src/managed-identity-exchange/canonicalization/managed-canonicalization.service';
import { projectManagedExchangeError } from '../../src/managed-identity-exchange/exchange-error.projector';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';
import { IdxMenuDetailValidator } from '../../src/managed-identity-exchange/providers/idx-menu-detail.validator';
import { DelegatedHttpTransport } from '../../src/managed-identity-exchange/providers/delegated-http.transport';
import { ManagedPermissionService } from '../../src/managed-identity-exchange/permissions/managed-permission.service';
import { IdxMenuDetailPermissionNormalizer } from '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer';
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
const idxSentinels = Object.freeze([
  'DO_NOT_LEAK_IDX_NATIVE_TOKEN', 'DO_NOT_LEAK_AUTHORIZATION', 'DO_NOT_LEAK_REFRESH_TOKEN',
  'DO_NOT_LEAK_RAW_CLAIM', 'DO_NOT_LEAK_PERMISSION_HASH', 'DO_NOT_LEAK_MENU_UUID',
  'DO_NOT_LEAK_MENU_MEMO', 'DO_NOT_LEAK_HTTP_BODY', 'DO_NOT_LEAK_PROVIDER_DIAGNOSTIC'
]);
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

describe('Feature 006 IDX transient-material and redaction guards (T034)', () => {
  it('reduces one accepted production-shaped response to semantic identity and provider-trusted scopes only', async () => {
    const execute = jest.fn(async () => idxAcceptedResponse());
    const validator = new IdxMenuDetailValidator();
    const validate = jest.spyOn(validator, 'validate');
    const identity = await new IdxDelegatedVerificationAdapter({ execute }, validator).verify(idxVerifyInput());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(identity).toEqual({
      subject: 'idx-subject', organization: 'idx-company',
      anchors: [{ kind: 'idx_entry', value: 'idx-entry' }],
      trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus: [{ menuId: 'SCM_ORDERS', actions: ['read', 'insert', 'update', 'delete'] }] }
    });
    expect(Object.isFrozen(identity)).toBe(true);

    const sourceLookup = jest.fn();
    const sourceExecute = jest.fn();
    const normalizer = new IdxMenuDetailPermissionNormalizer();
    const normalize = jest.spyOn(normalizer, 'normalize');
    const projector = new ManagedPermissionScopeProjector();
    const project = jest.spyOn(projector, 'project');
    const permissions = new ManagedPermissionService({
      permissionSources: { findEnabledActiveById: sourceLookup },
      permissionAdapters: { execute: sourceExecute },
      permissionNormalizers: new PermissionNormalizerRegistry([normalizer]), projector
    } as never);
    const scopes = await permissions.resolve({
      admittedIdentity: identity, integrationConfigId: 'config-idx', requestId: 'request-idx',
      serverOwnedIntegrationContext: Object.freeze({ integrationId: 'integration-idx', hostApp: 'assistant' }),
      policy: Object.freeze({ integrationConfigId: 'config-idx', mode: 'provider_trusted', permissionSourceInstanceId: null, normalizerType: 'idx-menu-detail/v1', projectionContractVersion: 'managed-permissions/v1', projectionContract: Object.freeze({ scopeSchema: 'managed-normalized-scopes/v1' }) })
    });
    expect(scopes).toEqual(['menu:SCM_ORDERS:read', 'menu:SCM_ORDERS:insert', 'menu:SCM_ORDERS:update', 'menu:SCM_ORDERS:delete']);
    expect(normalize).toHaveBeenCalledWith(identity.trustedPermissionMaterial);
    expect(project).toHaveBeenCalledTimes(1);
    expect(sourceLookup).not.toHaveBeenCalled();
    expect(sourceExecute).not.toHaveBeenCalled();

    const canonical = await new ManagedCanonicalizationService({
      findById: async () => ({ id: 'config-idx', integrationId: 'integration-idx', canonicalHostApp: 'assistant', organizationMode: 'verified', fixedOrganizationId: null, enabled: true, lifecycle: 'active' })
    } as never).canonicalize({ identity, integrationConfigId: 'config-idx', permissionScopes: scopes });
    expect(Object.keys(canonical).sort()).toEqual(['hostApp', 'integrationId', 'organizationId', 'permissionScopes', 'roles', 'subject']);
    expect(canonical).toEqual({ integrationId: 'integration-idx', subject: 'idx-subject', organizationId: 'idx-company', hostApp: 'assistant', roles: [], permissionScopes: scopes });

    const { privateKey } = await generateKeyPair('RS256');
    const issued = await new ManagedUpstreamTokenIssuer({ findActive: async () => ({ issuer: managedIssuer, audience: managedAudience, kid: 'idx-kid', privateKey }) }).issue(canonical);
    const jwtPayload = decodeJwtPayload(issued.accessToken);
    expect(jwtPayload).toMatchObject({ integration_id: 'integration-idx', sub: 'idx-subject', org_id: 'idx-company', host_app: 'assistant', roles: [], permission_scopes: scopes });

    const append = jest.fn(async (value) => value);
    await new ManagedExchangeAuditWriter({ append } as never).append({ requestId: 'request-idx', outcome: 'success', reasonCode: 'managed_exchange_issued', integrationId: 'integration-idx', integrationConfigId: 'config-idx', providerType: 'idx_delegated', providerInstanceId: 'provider-idx', jti: issued.jti, kid: issued.kid });
    expect(Object.keys(append.mock.calls[0][0]).sort()).toEqual(['integrationConfigId', 'integrationId', 'jti', 'kid', 'outcome', 'providerInstanceId', 'providerType', 'reasonCode', 'requestId']);
    assertIdxRedacted({ identity, scopes, canonical, jwtPayload, audit: append.mock.calls });
  });

  it.each([
    ['transport credential', 'transport', ManagedExchangeCredentialError],
    ['transport identity denial', 'transport', ManagedExchangeIdentityDeniedError],
    ['transport infrastructure', 'transport', ManagedExchangeInfrastructureError],
    ['MenuDetail infrastructure', 'validator', ManagedExchangeInfrastructureError],
    ['claim credential', 'parser', ManagedExchangeCredentialError],
    ['claim identity denial', 'parser', ManagedExchangeIdentityDeniedError]
  ] as const)('reconstructs a clean typed failure for %s', async (_label, seam, ErrorType) => {
    const tainted = taintedIdxError(new ErrorType());
    const transport = { execute: jest.fn(async () => {
      if (seam === 'transport') throw tainted;
      return idxAcceptedResponse();
    }) };
    const validator = { validate: jest.fn((body: unknown) => {
      if (seam === 'validator') throw tainted;
      return new IdxMenuDetailValidator().validate(body);
    }) };
    const parser = jest.fn(() => {
      if (seam === 'parser') throw tainted;
      return idxClaims();
    });
    const failure = await new IdxDelegatedVerificationAdapter(transport, validator, parser).verify(idxVerifyInput()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ErrorType);
    expect(failure).not.toBe(tainted);
    assertIdxRedacted(failure);
    const projected = projectManagedExchangeError(failure as ManagedExchangeCredentialError | ManagedExchangeIdentityDeniedError | ManagedExchangeInfrastructureError);
    const expected = ErrorType === ManagedExchangeCredentialError
      ? [401, 'EXCHANGE_IDENTITY_INVALID'] as const
      : ErrorType === ManagedExchangeIdentityDeniedError
        ? [403, 'EXCHANGE_IDENTITY_DENIED'] as const
        : [503, 'EXCHANGE_SERVICE_UNAVAILABLE'] as const;
    expectExactPublicEnvelope(projected, expected[0], expected[1]);
  });

  it.each(['transport', 'validator', 'parser'] as const)('normalizes unexpected %s diagnostics to a clean infrastructure failure', async (seam) => {
    const diagnostic = sentinelError(new Error(), idxSentinels[8]);
    const transport = { execute: jest.fn(async () => {
      if (seam === 'transport') throw diagnostic;
      return idxAcceptedResponse();
    }) };
    const validator = { validate: jest.fn((body: unknown) => {
      if (seam === 'validator') throw diagnostic;
      return new IdxMenuDetailValidator().validate(body);
    }) };
    const parser = jest.fn(() => {
      if (seam === 'parser') throw diagnostic;
      return idxClaims();
    });
    const failure = await new IdxDelegatedVerificationAdapter(transport, validator, parser).verify(idxVerifyInput()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ManagedExchangeInfrastructureError);
    assertIdxRedacted(failure);
  });

  it('keeps IDX runtime sources free of logging, secret telemetry, sensitive persistence, and Customer authority', () => {
    const runtime = [
      '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter.ts',
      '../../src/managed-identity-exchange/providers/idx-menu-detail.validator.ts',
      '../../src/managed-identity-exchange/providers/delegated-http.transport.ts',
      '../../src/managed-identity-exchange/permissions/managed-permission.service.ts',
      '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer.ts',
      '../../src/managed-identity-exchange/exchange.service.ts'
    ].map((file) => readFileSync(resolve(__dirname, file), 'utf8')).join('\n');
    expect(runtime).not.toMatch(/console\.|\bLogger\b|logger\.|telemetry\.|metrics\.|recordSpan|addEvent\(/i);
    expect(runtime).not.toMatch(/CustomerRepository|CustomerScope|findCustomer|resolveCustomer/);
    const schema = readFileSync(resolve(__dirname, '../../../../prisma/schema.prisma'), 'utf8');
    const managedModels = [...schema.matchAll(/model (Managed\w+) \{([\s\S]*?)\n\}/g)].map((match) => match[0]).join('\n');
    expect(managedModels).not.toMatch(/nativeCredential|Authorization|accessToken|refreshToken|rawJwt|rawClaims|MenuDetail|responseBody|permissionMaterial|trustedPermissionMaterial/i);
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

function taintedIdxError<T extends Error>(error: T): T {
  error.message = idxSentinels[8];
  Object.assign(error, {
    nativeCredential: idxSentinels[0], diagnostic: idxSentinels[8], responseBody: idxSentinels[7],
    rawClaims: idxSentinels[3], MenuDetail: { UUID: idxSentinels[5], Memo: idxSentinels[6] }
  });
  return error;
}

function assertIdxRedacted(value: unknown): void {
  const serialized = `${String(value)} ${JSON.stringify(value)} ${value instanceof Error ? value.stack ?? '' : ''}`;
  for (const marker of idxSentinels) expect(serialized).not.toContain(marker);
}

function idxVerifyInput() {
  return Object.freeze({
    nativeCredential: idxToken(idxClaims()), requestId: 'request-idx',
    providerInstancePolicy: Object.freeze({
      id: 'provider-idx', providerType: 'idx_delegated', endpointUri: 'https://provider.example.test/menu-detail', httpMethod: 'GET',
      credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1000, responseContractVersion: 'idx-menu-detail/v1',
      declaredAnchorKinds: Object.freeze(['idx_entry']), providerContract: Object.freeze({ responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' })
    })
  });
}

function idxClaims(): Record<string, unknown> {
  return {
    sub: 'idx-subject', UUID_User: 'idx-subject', UUID_Company: 'idx-company', UUID_Entry: 'idx-entry',
    rawClaim: idxSentinels[3], Permissions: idxSentinels[0], Permission_Hash: idxSentinels[4],
    Authorization: idxSentinels[1], RefreshToken: idxSentinels[2], customerId: 'forged-customer', roles: ['admin']
  };
}

function idxToken(payload: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify({ alg: 'ES512' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature-${idxSentinels[0]}`;
}

function idxMenuDetailBody() {
  return {
    Code: 200, ExecutionTime: '12ms', Message: idxSentinels[7], Version: '1.0.0',
    Data: [{
      UUID: idxSentinels[5], MenuID: 'SCM_ORDERS', Category: 'SCM', Patrilineal: null, Sorting: '120', Memo: idxSentinels[6],
      MenuNode: [{ UUID: idxSentinels[5], UUID_Menu: idxSentinels[5], Language: 'zh-TW', MenuName: 'Orders', Icon: 'orders', ProgramCode: null, ProgramPath: '/orders', StartMethod: null, Memo: idxSentinels[6] }],
      MenuPermission: { UUID: idxSentinels[5], UUID_Menu: idxSentinels[5], Insert: 'Y', Update: 'Y', Delete: 'Y', Print: 'N', Import: 'N', Export: 'N', Copy: 'N', Approval: 'N', Others: null, Memo: idxSentinels[6] }
    }]
  };
}

function idxAcceptedResponse() {
  return Object.freeze({ status: 200 as const, contentType: 'application/json' as const, body: idxMenuDetailBody() });
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
