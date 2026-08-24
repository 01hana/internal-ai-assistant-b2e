import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, type KeyLike } from 'jose';
import request from 'supertest';
import { ManagedExchangeInfrastructureError } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedJwksController } from '../../src/managed-identity-exchange/issuer/managed-jwks.controller';
import { ManagedJwksService } from '../../src/managed-identity-exchange/issuer/managed-jwks.service';
import { ManagedUpstreamTokenIssuer } from '../../src/managed-identity-exchange/issuer/managed-upstream-token-issuer';
import { ManagedUpstreamSigningKeyRepository } from '../../src/managed-identity-exchange/persistence/managed-exchange.repository';
import { createManagedSigningJwksFixture } from './fixtures/managed-signing-jwks.fixture';

const servicePath = resolve(__dirname, '../../src/managed-identity-exchange/issuer/managed-jwks.service.ts');
const controllerPath = resolve(__dirname, '../../src/managed-identity-exchange/issuer/managed-jwks.controller.ts');
const repositoryPath = resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange.repository.ts');
const privateSentinel = 'DO_NOT_LEAK_MANAGED_JWKS_PRIVATE_VALUE';
const publicBoundaryCases: readonly [string, Record<string, unknown>][] = [
  ['non-RSA kty', { publicJwk: { ...publicKey('managed-kid'), kty: 'EC' } }],
  ['blank modulus', { publicJwk: { ...publicKey('managed-kid'), n: '   ' } }],
  ['blank exponent', { publicJwk: { ...publicKey('managed-kid'), e: '   ' } }],
  ['invalid algorithm', { publicJwk: { ...publicKey('managed-kid'), alg: 'RS512' } }],
  ['invalid use', { publicJwk: { ...publicKey('managed-kid'), use: 'enc' } }],
  ['mismatched JWK kid', { publicJwk: publicKey('different-kid') }],
  ...['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].map((member): [string, Record<string, unknown>] => [
    `private member ${member}`, { publicJwk: { ...publicKey('managed-kid'), [member]: privateSentinel } }
  ])
];

describe('Managed JWKS service and controller (T032)', () => {
  it('preserves planned rotation verification overlap then fails closed after old-key retirement', async () => {
    const fixture = await createManagedSigningJwksFixture({ keys: [{ kid: 'old-key', status: 'active' }, { kid: 'new-key', status: 'published' }] });
    const issuer = new ManagedUpstreamTokenIssuer({ findActive: () => fixture.provider.findActive() });
    const oldToken = await issuer.issue(canonicalIdentity());

    fixture.setStatus('old-key', 'retiring');
    fixture.setStatus('new-key', 'active');
    const overlap = await fixture.jwks.getDocument();
    const newToken = await issuer.issue(canonicalIdentity());
    expect((await import('jose')).decodeProtectedHeader(newToken.accessToken).kid).toBe('new-key');
    expect(overlap.keys.map((key) => key.kid)).toEqual(['new-key', 'old-key']);
    await expect(jwtVerify(oldToken.accessToken, createLocalJWKSet(overlap as never), { algorithms: ['RS256'] })).resolves.toBeDefined();
    await expect(jwtVerify(newToken.accessToken, createLocalJWKSet(overlap as never), { algorithms: ['RS256'] })).resolves.toBeDefined();

    fixture.setStatus('old-key', 'retired');
    const retired = await fixture.jwks.getDocument();
    expect(retired.keys.map((key) => key.kid)).toEqual(['new-key']);
    await expect(jwtVerify(newToken.accessToken, createLocalJWKSet(retired as never), { algorithms: ['RS256'] })).resolves.toBeDefined();
    await expect(jwtVerify(oldToken.accessToken, createLocalJWKSet(retired as never), { algorithms: ['RS256'] })).rejects.toThrow();
  });

  it('keeps managed tokens cryptographically separate from a Gateway public key', async () => {
    const fixture = await createManagedSigningJwksFixture({ keys: [{ kid: 'managed-key', status: 'active' }] });
    const issuer = new ManagedUpstreamTokenIssuer({ findActive: () => fixture.provider.findActive() });
    const token = await issuer.issue(canonicalIdentity());
    const gateway = await generateKeyPair('RS256');
    await expect(jwtVerify(token.accessToken, gateway.publicKey, { algorithms: ['RS256'] })).rejects.toThrow();
    const document = await fixture.jwks.getDocument();
    expect(document.keys.map((key) => key.kid)).toEqual(['managed-key']);
  });
  it('publishes deterministic immutable public projections for all visible key statuses', async () => {
    const fixture = jwksFixture({
      keys: [
        key('z-active', 'active', { enabled: true, lifecycle: 'active' }),
        key('a-published', 'published', { enabled: false, lifecycle: 'draft' }),
        key('m-retiring', 'retiring', { enabled: false, lifecycle: 'disabled' })
      ]
    });
    const document = await fixture.service.getDocument();

    expect(document).toEqual({ keys: [publicKey('a-published'), publicKey('m-retiring'), publicKey('z-active')] });
    expect(Object.keys(document.keys[0]).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.keys)).toBe(true);
    expect(document.keys.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(document)).not.toMatch(/keyReference|privateKey|status|issuerId|unknown-metadata/i);
  });

  it('excludes non-visible new, retired, and replaced-predecessor rows without fallback', async () => {
    const fixture = jwksFixture({
      keys: [key('new-key', 'new'), key('retired-key', 'retired'), key('replaced-key', 'retired', { lifecycle: 'replaced' })]
    });
    await expect(fixture.service.getDocument()).resolves.toEqual({ keys: [] });
  });

  it('returns an immutable empty document for the one-issuer/no-visible-key state', async () => {
    const fixture = jwksFixture({ keys: [] });
    const document = await fixture.service.getDocument();
    expect(document).toEqual({ keys: [] });
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.keys)).toBe(true);
  });

  it.each([
    ['zero active issuers', []],
    ['multiple active issuers', [issuer(), issuer({ id: 'issuer-b' })]]
  ])('fails closed for %s', async (_label, issuers) => {
    const fixture = jwksFixture({ issuers });
    await expect(fixture.service.getDocument()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.findKeys).not.toHaveBeenCalled();
  });

  it.each(publicBoundaryCases)('rejects persisted public-key boundary corruption: %s', async (_label, override) => {
    const fixture = jwksFixture({ keys: [key('managed-kid', 'active', override)] });
    const error = await fixture.service.getDocument().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(privateSentinel);
  });

  it('rejects duplicate visible kids rather than selecting a winner', async () => {
    const fixture = jwksFixture({ keys: [key('same-kid', 'active'), key('same-kid', 'retiring')] });
    await expect(fixture.service.getDocument()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
  });

  it('performs fresh issuer and public-key reads for every document request', async () => {
    const fixture = jwksFixture({ keys: [key('managed-kid', 'active')] });
    await fixture.service.getDocument();
    await fixture.service.getDocument();
    expect(fixture.findIssuers).toHaveBeenCalledTimes(2);
    expect(fixture.findKeys).toHaveBeenCalledTimes(2);
  });

  it('uses the exact public route, fixed cache policy, and no authorization requirement', async () => {
    const service = jwksFixture({ keys: [] }).service;
    const module = await Test.createTestingModule({
      controllers: [ManagedJwksController],
      providers: [{ provide: ManagedJwksService, useValue: service }]
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const response = await request(app.getHttpServer()).get('/.well-known/managed-identity-exchange-jwks.json');
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=60, must-revalidate');
      expect(response.body).toEqual({ keys: [] });
    } finally {
      await app.close();
    }
  });

  it('projects unavailable managed metadata to a generic redacted HTTP 503', async () => {
    const service = { getDocument: jest.fn(async () => { throw new Error(`database ${privateSentinel}`); }) };
    const module = await Test.createTestingModule({
      controllers: [ManagedJwksController],
      providers: [{ provide: ManagedJwksService, useValue: service }]
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const response = await request(app.getHttpServer()).get('/.well-known/managed-identity-exchange-jwks.json');
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ statusCode: 503, code: 'MANAGED_JWKS_UNAVAILABLE', message: 'Managed JWKS is unavailable.' });
      expect(JSON.stringify(response.body)).not.toContain(privateSentinel);
    } finally {
      await app.close();
    }
  });

  it('verifies a T031 token using only its managed JWKS public projection and fails closed for a hidden kid', async () => {
    const keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    const kid = 'managed-rs256-kid';
    const fixture = jwksFixture({ keys: [key(kid, 'active', { publicJwk: { ...jwk, kid } })] });
    const document = await fixture.service.getDocument();
    const issuer = new ManagedUpstreamTokenIssuer({
      findActive: async () => Object.freeze({ issuer: 'https://managed.example.test', audience: 'managed-audience', kid, privateKey: keys.privateKey as KeyLike })
    });
    const token = await issuer.issue(canonicalIdentity());
    await expect(jwtVerify(token.accessToken, createLocalJWKSet(document as never), { algorithms: ['RS256'], issuer: 'https://managed.example.test', audience: 'managed-audience' })).resolves.toBeDefined();
    const hiddenIssuer = new ManagedUpstreamTokenIssuer({
      findActive: async () => Object.freeze({ issuer: 'https://managed.example.test', audience: 'managed-audience', kid: 'new-hidden-kid', privateKey: keys.privateKey as KeyLike })
    });
    const hiddenToken = await hiddenIssuer.issue(canonicalIdentity());
    await expect(jwtVerify(hiddenToken.accessToken, createLocalJWKSet(document as never), { algorithms: ['RS256'] })).rejects.toThrow();
  });

  it('uses a public-only repository query with visibility determined by status, not enabled lifecycle state', async () => {
    const findMany = jest.fn(async () => []);
    const repository = new ManagedUpstreamSigningKeyRepository({ managedUpstreamSigningKey: { findMany }, $transaction: jest.fn() } as never);
    await repository.findJwksVisibleByIssuerId('issuer-a');
    expect(findMany).toHaveBeenCalledWith({
      where: { issuerId: 'issuer-a', status: { in: ['published', 'active', 'retiring'] } },
      select: { issuerId: true, kid: true, publicJwk: true, status: true }
    });
  });

  it('has no Gateway, loader, private-key, or request authority dependency', () => {
    const source = `${readFileSync(servicePath, 'utf8')}\n${readFileSync(controllerPath, 'utf8')}`;
    expect(source).not.toMatch(/GatewaySigningKeyRepository|ActiveSigningKeyResolver|InternalIdentityTokenIssuer|GatewayConfig|Customer|CustomerScope|IntegrationBinding|CanonicalIdentityResolver|TrustProfile|nativeCredential|Authorization|PageContext|keyReference|SigningKeyProvider|privateKey|fallback/i);
    expect(readFileSync(repositoryPath, 'utf8')).toContain("findJwksVisibleByIssuerId");
  });

  it('keeps Phase 6 focused evidence free of skip, todo, and only markers', () => {
    const focused = [
      readFileSync(resolve(__dirname, 'managed-signing.spec.ts'), 'utf8'),
      readFileSync(resolve(__dirname, 'managed-jwks.spec.ts'), 'utf8')
    ].join('\n');
    expect(focused).not.toMatch(/\b(?:describe|it|test)\.(?:skip|todo|only)\b/);
  });
});

function jwksFixture(overrides: Readonly<{ issuers?: readonly Record<string, unknown>[]; keys?: readonly Record<string, unknown>[] }> = {}) {
  const findIssuers = jest.fn(async () => overrides.issuers ?? [issuer()]);
  const findKeys = jest.fn(async () => overrides.keys ?? [key('managed-kid', 'active')]);
  const service = new ManagedJwksService({
    issuers: { findEnabledActive: findIssuers } as never,
    signingKeys: { findJwksVisibleByIssuerId: findKeys } as never
  });
  return { service, findIssuers, findKeys };
}

function issuer(overrides: Record<string, unknown> = {}) {
  return { id: 'issuer-a', issuer: 'https://managed.example.test', expectedAudience: 'managed-audience', enabled: true, lifecycle: 'active', ...overrides };
}

function key(kid: string, status: string, overrides: Record<string, unknown> = {}) {
  return {
    issuerId: 'issuer-a', kid, publicJwk: { ...publicKey(kid), 'unknown-metadata': 'ignored' }, status,
    enabled: status === 'active', lifecycle: status === 'active' ? 'active' : status === 'published' ? 'draft' : 'disabled', ...overrides
  };
}

function publicKey(kid: string) {
  return { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: `modulus-${kid}`, e: 'AQAB' };
}

function canonicalIdentity() {
  return Object.freeze({
    integrationId: 'integration-a', subject: 'subject-a', organizationId: 'organization-a', hostApp: 'admin', roles: Object.freeze([]), permissionScopes: Object.freeze(['orders:read'])
  }) as never;
}
