import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeJwt, decodeProtectedHeader, generateKeyPair, jwtVerify, type KeyLike } from 'jose';
import { ProvisionManagedUpstreamSigningKeyCommand } from '../../src/commands/provision-managed-upstream-signing-key';
import { ManagedExchangeInfrastructureError, ManagedExchangeIssuanceError } from '../../src/managed-identity-exchange/domain/managed-exchange.domain';
import { ManagedSigningKeyRuntimeProvider } from '../../src/managed-identity-exchange/issuer/managed-signing-key.provider';
import { ManagedUpstreamTokenIssuer } from '../../src/managed-identity-exchange/issuer/managed-upstream-token-issuer';
import { GatewaySigningAuthorityReader } from '../../src/managed-identity-exchange/persistence/gateway-signing-authority.reader';
import { ManagedExchangeActivationValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { createManagedSigningJwksFixture } from './fixtures/managed-signing-jwks.fixture';

const providerPath = resolve(__dirname, '../../src/managed-identity-exchange/issuer/managed-signing-key.provider.ts');
const keyReference = 'managed-secret-reference';
const privateMaterial = 'DO_NOT_LEAK_MANAGED_PRIVATE_KEY';
const managedReference = 'managed-key-reference-sentinel';
const gatewayReference = 'gateway-key-reference-sentinel';
const managedPrivateSentinel = 'MANAGED_PRIVATE_SENTINEL';
const gatewayPrivateSentinel = 'GATEWAY_PRIVATE_SENTINEL';
const issuerPath = resolve(__dirname, '../../src/managed-identity-exchange/issuer/managed-upstream-token-issuer.ts');
const runtimePublicBoundaryCases: readonly [string, Record<string, unknown>][] = [
  ...['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].map((field): [string, Record<string, unknown>] => [`private member ${field}`, { publicJwk: { kty: 'RSA', n: 'public-n', e: 'AQAB', [field]: privateMaterial } }]),
  ['invalid algorithm', { publicJwk: { kty: 'RSA', n: 'public-n', e: 'AQAB', alg: 'RS512' } }],
  ['invalid use', { publicJwk: { kty: 'RSA', n: 'public-n', e: 'AQAB', use: 'enc' } }]
];

describe('Managed signing-key runtime provider (T029)', () => {
  it.each([
    ['published', 'VISIBLE'],
    ['retiring', 'VISIBLE'],
    ['retired', 'HIDDEN'],
    ['new', 'HIDDEN']
  ] as const)('keeps %s keys non-signable while JWKS is %s', async (status, visibility) => {
    const fixture = await createManagedSigningJwksFixture({ keys: [{ kid: `${status}-kid`, status }] });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    const document = await fixture.jwks.getDocument();
    expect(document.keys).toHaveLength(visibility === 'VISIBLE' ? 1 : 0);
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it('rejects a hostile multiple-active response while allowing JWKS to publish both public keys', async () => {
    const fixture = await createManagedSigningJwksFixture({ keys: [{ kid: 'active-a', status: 'active' }, { kid: 'active-b', status: 'active' }] });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    await expect(fixture.jwks.getDocument()).resolves.toMatchObject({ keys: [{ kid: 'active-a' }, { kid: 'active-b' }] });
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it('fails closed for a disabled managed issuer without selecting stale or Gateway authority', async () => {
    const fixture = await createManagedSigningJwksFixture({ keys: [{ kid: 'active-key', status: 'active' }], issuerEnabled: false });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    await expect(fixture.jwks.getDocument()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.load).not.toHaveBeenCalled();
  });
  it('resolves exactly one active managed issuer and key through one opaque load', async () => {
    const fixture = createFixture();
    const result = await fixture.provider.findActive();

    expect(result).toEqual(expect.objectContaining({ issuer: 'https://managed.example.test', audience: 'managed-audience', kid: 'managed-kid', privateKey: fixture.handle }));
    expect(Object.keys(result).sort()).toEqual(['audience', 'issuer', 'kid', 'privateKey']);
    expect(Object.isFrozen(result)).toBe(true);
    expect(fixture.findIssuers).toHaveBeenCalledTimes(1);
    expect(fixture.findKeys).toHaveBeenCalledWith('issuer-a');
    expect(fixture.load).toHaveBeenCalledTimes(1);
    expect(fixture.load).toHaveBeenCalledWith(keyReference);
    expect(JSON.stringify(result)).not.toContain(keyReference);
    expect(JSON.stringify(result)).not.toContain(privateMaterial);
  });

  it.each([
    ['no active issuer', []],
    ['multiple active issuers', [issuer(), issuer({ id: 'issuer-b' })]]
  ])('fails closed for %s', async (_name, issuers) => {
    const fixture = createFixture({ issuers });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.findKeys).not.toHaveBeenCalled();
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it.each([
    ['no active key', []],
    ['multiple active keys', [key(), key({ kid: 'managed-kid-b' })]]
  ])('fails closed for %s', async (_name, keys) => {
    const fixture = createFixture({ keys });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it.each([
    key({ enabled: false }),
    key({ lifecycle: 'draft', status: 'published', enabled: false }),
    key({ lifecycle: 'disabled', status: 'retiring', enabled: false }),
    key({ lifecycle: 'disabled', status: 'retired', enabled: false })
  ])('rejects non-active key states returned by a dependency', async (unsafeKey) => {
    const fixture = createFixture({ keys: [unsafeKey] });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed issuer', { issuer: ' \u0000' }],
    ['malformed audience', { expectedAudience: '   ' }]
  ])('rejects %s', async (_name, overrides) => {
    const fixture = createFixture({ issuers: [issuer(overrides)] });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it.each(runtimePublicBoundaryCases)('applies the public-key boundary at runtime for %s', async (_name, overrides) => {
    const fixture = createFixture({ keys: [key(overrides)] });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it.each([
    ['blank kid', { kid: '   ' }],
    ['blank reference', { keyReference: '   ' }],
    ['wrong issuer linkage', { issuerId: 'issuer-b' }],
    ['non-RSA public material', { publicJwk: { kty: 'EC', n: 'public-n', e: 'AQAB' } }],
    ['blank public modulus', { publicJwk: { kty: 'RSA', n: '   ', e: 'AQAB' } }],
    ['private public material field', { publicJwk: { kty: 'RSA', n: 'public-n', e: 'AQAB', d: privateMaterial } }]
  ])('rejects %s', async (_name, overrides) => {
    const fixture = createFixture({ keys: [key(overrides)] });
    await expect(fixture.provider.findActive()).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.load).not.toHaveBeenCalled();
  });

  it('remaps loader failures without exposing managed reference or private material', async () => {
    const fixture = createFixture({ loadFailure: new Error(`${keyReference}:${privateMaterial}`) });
    const error = await fixture.provider.findActive().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(String(error)).not.toContain(keyReference);
    expect(String(error)).not.toContain(privateMaterial);
    expect(JSON.stringify(error)).not.toContain(keyReference);
    expect(JSON.stringify(error)).not.toContain(privateMaterial);
    expect(fixture.load).toHaveBeenCalledTimes(1);
  });

  it('performs fresh managed reads and loading on every invocation', async () => {
    const fixture = createFixture();
    await fixture.provider.findActive();
    await fixture.provider.findActive();

    expect(fixture.findIssuers).toHaveBeenCalledTimes(2);
    expect(fixture.findKeys).toHaveBeenCalledTimes(2);
    expect(fixture.load).toHaveBeenCalledTimes(2);
  });

  it('contains no Gateway signing authority or token-issuance behavior', () => {
    const source = readFileSync(providerPath, 'utf8');
    expect(source).not.toMatch(/GatewaySigningKeyRepository|ActiveSigningKeyResolver|GatewayConfig|internalIssuer|SignJWT|jwt\.sign|accessToken|keyReference.*return|cache|fallback/i);
  });
});

describe('Managed and Gateway signer-domain separation (T030)', () => {
  it.each([
    ['key reference', managedKey({ keyReference: gatewayReference }), gatewayKey({ keyReference: gatewayReference })],
    ['kid', managedKey({ kid: 'gateway-kid' }), gatewayKey({ kid: 'gateway-kid' })],
    ['equivalent RSA identity with different metadata order', managedKey({ publicJwk: { kty: 'RSA', n: 'same-rsa-n', e: 'AQAB', alg: 'RS256', use: 'sig' } }), gatewayKey({ publicJwk: { use: 'sig', e: 'AQAB', alg: 'RS256', kid: 'gateway-kid', n: 'same-rsa-n', kty: 'RSA' } })]
  ])('fails closed for Gateway %s collision without mutating either domain', async (_name, managed, gateway) => {
    const harness = collisionHarness([gateway]);
    const before = structuredClone(harness.gatewayKeys);
    const error = await harness.command.registerKey({ ...managed, requestId: 'register' }).catch((caught: unknown) => caught);

    expect(error).toBeDefined();
    expect(harness.rows.size).toBe(0);
    expect(harness.gatewayKeys).toEqual(before);
    expectRedacted(error);
  });

  it('rejects a late Gateway collision before activation and preserves the published state', async () => {
    const harness = collisionHarness();
    const registered = await harness.command.registerKey({ ...managedKey(), requestId: 'register' });
    await harness.command.transitionKey({ id: String(registered.id), to: 'published', requestId: 'publish' });
    harness.gatewayKeys.push(gatewayKey({ publicJwk: { e: 'AQAB', n: 'managed-rsa-n', kty: 'RSA', kid: 'gateway-kid' } }));

    const error = await harness.command.transitionKey({ id: String(registered.id), to: 'active', requestId: 'activate' }).catch((caught: unknown) => caught);
    expect(error).toBeDefined();
    expect(harness.rows.get(String(registered.id))).toMatchObject({ status: 'published', enabled: false, lifecycle: 'draft' });
    expectRedacted(error);
  });

  it('rejects Gateway internal issuer reuse and permits a distinct managed issuer', () => {
    const reader = new GatewaySigningAuthorityReader({
      config: { config: { internalIssuer: 'https://gateway.internal.example' } } as never,
      signingKeys: { findAllForCollision: async () => [] } as never
    });
    let error: unknown;
    try { reader.assertDistinctIssuer('https://gateway.internal.example'); } catch (caught) { error = caught; }
    expect(error).toBeDefined();
    expectRedacted(error);
    expect(() => reader.assertDistinctIssuer('https://managed.example.test')).not.toThrow();
  });

  it('retains replaceKey lineage: the predecessor is retired/replaced and only the successor is active', async () => {
    const harness = collisionHarness([gatewayKey()]);
    const predecessor = await harness.command.registerKey({ ...managedKey(), requestId: 'register' });
    await harness.command.transitionKey({ id: String(predecessor.id), to: 'published', requestId: 'publish' });
    await harness.command.transitionKey({ id: String(predecessor.id), to: 'active', requestId: 'activate' });
    const gatewayBefore = structuredClone(harness.gatewayKeys);
    const successor = await harness.command.replaceKey({
      predecessorId: String(predecessor.id), requestId: 'replace',
      successor: managedKey({ kid: 'managed-kid-v2', keyReference: 'managed-ref-v2', publicJwk: { kty: 'RSA', n: 'managed-rsa-n-v2', e: 'AQAB' } })
    });

    expect(harness.rows.get(String(predecessor.id))).toMatchObject({ status: 'retired', enabled: false, lifecycle: 'replaced' });
    expect(successor).toMatchObject({ status: 'active', enabled: true, lifecycle: 'active', replacesKeyId: predecessor.id });
    expect(harness.gatewayKeys).toEqual(gatewayBefore);
  });

  it.each(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])('rejects private public-JWK member %s without disclosure', (member) => {
    const validator = new ManagedExchangeActivationValidator();
    const error = capture(() => validator.validateSigningKey(managedKey({ publicJwk: { kty: 'RSA', n: 'managed-rsa-n', e: 'AQAB', [member]: managedPrivateSentinel } })));
    expect(error).toBeDefined();
    expectRedacted(error);
  });

  it('enforces optional RS256 and signing-use values while permitting their omission', () => {
    const validator = new ManagedExchangeActivationValidator();
    expect(() => validator.validateSigningKey(managedKey())).not.toThrow();
    expect(() => validator.validateSigningKey(managedKey({ publicJwk: { kty: 'RSA', n: 'managed-rsa-n', e: 'AQAB', alg: 'RS256', use: 'sig' } }))).not.toThrow();
    expect(() => validator.validateSigningKey(managedKey({ publicJwk: { kty: 'RSA', n: 'managed-rsa-n', e: 'AQAB', alg: 'RS512' } }))).toThrow();
    expect(() => validator.validateSigningKey(managedKey({ publicJwk: { kty: 'RSA', n: 'managed-rsa-n', e: 'AQAB', use: 'enc' } }))).toThrow();
  });

  it('defines a public-only managed JWK projection contract', () => {
    const publicJwk = { kty: 'RSA', kid: 'managed-kid', alg: 'RS256', use: 'sig', n: 'managed-rsa-n', e: 'AQAB' };
    const allowed = new Set(['kty', 'kid', 'alg', 'use', 'n', 'e']);
    const forbidden = ['keyReference', 'privateKey', 'd', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];
    expect(Object.keys(publicJwk).every((field) => allowed.has(field))).toBe(true);
    expect(forbidden.every((field) => !Object.prototype.hasOwnProperty.call(publicJwk, field))).toBe(true);
  });
});

describe('Managed upstream token issuer (T031)', () => {
  it('uses only the managed provider signing handle and managed header identity', async () => {
    const fixture = await issuerFixture();
    const result = await fixture.issuer.issue(canonicalIdentity());
    expect(fixture.findActive).toHaveBeenCalledTimes(1);
    expect(decodeProtectedHeader(result.accessToken)).toMatchObject({ alg: 'RS256', kid: 'managed-kid' });
  });

  it('uses issuer and audience solely from the managed provider', async () => {
    const fixture = await issuerFixture();
    const result = await fixture.issuer.issue(canonicalIdentity());
    expect(decodeJwt(result.accessToken)).toMatchObject({ iss: 'https://managed.example.test', aud: 'managed-audience' });
  });

  it('does not substitute Gateway signing identity when managed values are distinct', async () => {
    const fixture = await issuerFixture();
    const result = await fixture.issuer.issue(canonicalIdentity());
    const header = decodeProtectedHeader(result.accessToken);
    const payload = decodeJwt(result.accessToken);
    expect(header.kid).not.toBe('gateway-kid');
    expect(payload.iss).not.toBe('https://gateway.internal.example');
  });

  it('signs the exact canonical and registered claim shape with fixed lifetime', async () => {
    const fixture = await issuerFixture();
    const result = await fixture.issuer.issue(canonicalIdentity());
    const header = decodeProtectedHeader(result.accessToken);
    const payload = decodeJwt(result.accessToken);

    expect(header).toEqual({ alg: 'RS256', kid: 'managed-kid' });
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'host_app', 'iat', 'integration_id', 'iss', 'jti', 'org_id', 'permission_scopes', 'roles', 'sub']);
    expect(payload).toMatchObject({ integration_id: 'integration-a', sub: 'actor-a', org_id: 'organization-a', host_app: 'admin', roles: [], permission_scopes: ['orders:read'], iss: 'https://managed.example.test', aud: 'managed-audience' });
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(payload.nbf).toBeUndefined();
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result).toEqual({ accessToken: result.accessToken, tokenType: 'Bearer', expiresIn: 300, jti: payload.jti, kid: header.kid });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('allows an authoritative empty permission-scope array', async () => {
    const fixture = await issuerFixture();
    const result = await fixture.issuer.issue(canonicalIdentity({ permissionScopes: Object.freeze([]) }));
    expect(decodeJwt(result.accessToken).permission_scopes).toEqual([]);
  });

  it('preserves valid permission scopes exactly and in their canonical order', async () => {
    const fixture = await issuerFixture();
    const scopes = Object.freeze(['orders:update', 'orders:read']);
    const result = await fixture.issuer.issue(canonicalIdentity({ permissionScopes: scopes }));
    expect(decodeJwt(result.accessToken).permission_scopes).toEqual(['orders:update', 'orders:read']);
  });

  it('generates distinct result-matching jtis for successful issuances', async () => {
    const fixture = await issuerFixture();
    const first = await fixture.issuer.issue(canonicalIdentity());
    const second = await fixture.issuer.issue(canonicalIdentity());
    expect(first.jti).not.toBe(second.jti);
    expect(decodeJwt(first.accessToken).jti).toBe(first.jti);
    expect(decodeJwt(second.accessToken).jti).toBe(second.jti);
    expect(fixture.findActive).toHaveBeenCalledTimes(2);
  });

  it('produces a verifiable managed RS256 token and fails with another public key', async () => {
    const fixture = await issuerFixture();
    const result = await fixture.issuer.issue(canonicalIdentity());
    await expect(jwtVerify(result.accessToken, fixture.publicKey, { algorithms: ['RS256'], issuer: 'https://managed.example.test', audience: 'managed-audience' })).resolves.toBeDefined();
    const other = await generateKeyPair('RS256');
    await expect(jwtVerify(result.accessToken, other.publicKey, { algorithms: ['RS256'] })).rejects.toThrow();
  });

  it.each([
    ['extra field', { extra: 'DO_NOT_LEAK_CANONICAL' }],
    ['blank scalar', { subject: '   ' }],
    ['control scalar', { hostApp: 'admin\u0000' }],
    ['non-empty roles', { roles: ['admin'] }],
    ['non-array roles', { roles: 'admin' }],
    ['blank scope', { permissionScopes: ['   '] }],
    ['leading-whitespace scope', { permissionScopes: [' orders:read'] }],
    ['trailing-whitespace scope', { permissionScopes: ['orders:read '] }],
    ['control scope', { permissionScopes: ['orders\u0000read'] }],
    ['non-array scopes', { permissionScopes: 'orders:read' }]
  ])('rejects malformed canonical %s before resolving signing authority', async (_name, overrides) => {
    const fixture = await issuerFixture();
    const error = await fixture.issuer.issue(canonicalIdentity(overrides)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ManagedExchangeIssuanceError);
    expect(fixture.findActive).not.toHaveBeenCalled();
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain('DO_NOT_LEAK_CANONICAL');
  });

  it('preserves provider infrastructure failures', async () => {
    const fixture = await issuerFixture({ providerFailure: new ManagedExchangeInfrastructureError() });
    await expect(fixture.issuer.issue(canonicalIdentity())).rejects.toBeInstanceOf(ManagedExchangeInfrastructureError);
    expect(fixture.findActive).toHaveBeenCalledTimes(1);
  });

  it('fails closed for malformed provider metadata and signing failures without leakage', async () => {
    const malformed = await issuerFixture({ active: { issuer: 'managed-issuer-sentinel', audience: 'managed-audience', kid: '   ', privateKey: {} as KeyLike } });
    const malformedError = await malformed.issuer.issue(canonicalIdentity()).catch((caught: unknown) => caught);
    expect(malformedError).toBeInstanceOf(ManagedExchangeIssuanceError);
    expect(`${String(malformedError)} ${JSON.stringify(malformedError)}`).not.toContain('managed-issuer-sentinel');

    const signing = await issuerFixture({ active: { issuer: 'https://managed.example.test', audience: 'managed-audience', kid: 'managed-kid', privateKey: { d: managedPrivateSentinel } as unknown as KeyLike } });
    const signingError = await signing.issuer.issue(canonicalIdentity()).catch((caught: unknown) => caught);
    expect(signingError).toBeInstanceOf(ManagedExchangeIssuanceError);
    expect(`${String(signingError)} ${JSON.stringify(signingError)}`).not.toContain(managedPrivateSentinel);
  });

  it('has no Gateway, Feature 004, selection, or loading authority dependency', () => {
    const source = readFileSync(issuerPath, 'utf8');
    expect(source).not.toMatch(/GatewaySigningKeyRepository|ActiveSigningKeyResolver|InternalIdentityTokenIssuer|GatewayConfig|TrustProfile|Customer|IntegrationBinding|integrationSelector|nativeCredential|Authorization|PageContext|findActiveSigning|fs\/promises|readFile|importPKCS8|keyReference|GatewaySigningAuthorityReader|admit\(|canonicalize\(|resolve\(/i);
    expect(source).toContain('permissionScopes: Object.freeze(value.permissionScopes.map(scope))');
    expect(source).not.toContain('permissionScopes: Object.freeze(value.permissionScopes.map(text))');
    expect(source).not.toMatch(/permissionScopes[^\n]*(?:sort\(|new Set\(|toLowerCase\(|toUpperCase\()/);
  });
});

function createFixture(overrides: Readonly<{ issuers?: readonly Record<string, unknown>[]; keys?: readonly Record<string, unknown>[]; loadFailure?: Error }> = {}) {
  const handle = Object.freeze({ opaqueHandle: true });
  const findIssuers = jest.fn(async () => overrides.issuers ?? [issuer()]);
  const findKeys = jest.fn(async () => overrides.keys ?? [key()]);
  const load = jest.fn(async () => {
    if (overrides.loadFailure) throw overrides.loadFailure;
    return handle;
  });
  const provider = new ManagedSigningKeyRuntimeProvider({
    issuers: { findEnabledActive: findIssuers } as never,
    signingKeys: { findEnabledActiveByIssuerId: findKeys } as never,
    keyLoader: { load } as never
  });
  return { provider, findIssuers, findKeys, load, handle };
}

function issuer(overrides: Record<string, unknown> = {}) {
  return { id: 'issuer-a', issuer: 'https://managed.example.test', expectedAudience: 'managed-audience', enabled: true, lifecycle: 'active', ...overrides };
}

function key(overrides: Record<string, unknown> = {}) {
  return {
    issuerId: 'issuer-a', kid: 'managed-kid', keyReference,
    publicJwk: { kty: 'RSA', n: 'public-n', e: 'AQAB' }, status: 'active', enabled: true, lifecycle: 'active', ...overrides
  };
}

function managedKey(overrides: Record<string, unknown> = {}) {
  return {
    issuerId: 'issuer-a', kid: 'managed-kid', keyReference: managedReference,
    publicJwk: { kty: 'RSA', n: 'managed-rsa-n', e: 'AQAB' }, ...overrides
  };
}

function gatewayKey(overrides: Record<string, unknown> = {}) {
  return {
    kid: 'gateway-kid', keyReference: gatewayReference,
    publicJwk: { kty: 'RSA', n: 'gateway-rsa-n', e: 'AQAB', d: gatewayPrivateSentinel }, ...overrides
  };
}

function collisionHarness(initialGatewayKeys: Row[] = []) {
  const rows = new Map<string, Row>();
  const gatewayKeys = [...initialGatewayKeys];
  let serial = 0;
  const repository = {
    transaction: async (callback: (transaction: object) => Promise<Row>) => callback({}),
    create: async (_kind: string, data: Row) => {
      const row = { id: `managed-key-${++serial}`, ...data };
      rows.set(String(row.id), row);
      return { ...row };
    },
    findById: async (_kind: string, id: string) => rows.get(id) ?? null,
    transitionSigningKey: async (id: string, from: string, to: string) => {
      const row = rows.get(id);
      if (!row || row.status !== from || !legal(row, to)) throw new Error('illegal transition');
      if (to === 'published') Object.assign(row, { status: 'published' });
      if (to === 'active') Object.assign(row, { status: 'active', enabled: true, lifecycle: 'active' });
      if (to === 'retiring') Object.assign(row, { status: 'retiring', enabled: false, lifecycle: 'disabled' });
      if (to === 'retired') Object.assign(row, { status: 'retired' });
      return { ...row };
    },
    replaceSigningKey: async (predecessorId: string, successor: Row) => {
      const predecessor = rows.get(predecessorId);
      if (!predecessor || predecessor.status !== 'active' || predecessor.enabled !== true || predecessor.lifecycle !== 'active') throw new Error('invalid predecessor');
      Object.assign(predecessor, { status: 'retired', enabled: false, lifecycle: 'replaced' });
      const row = { id: `managed-key-${++serial}`, ...successor, status: 'active', enabled: true, lifecycle: 'active', version: Number(predecessor.version) + 1, replacesKeyId: predecessor.id };
      rows.set(String(row.id), row);
      return { ...row };
    }
  };
  const reader = new GatewaySigningAuthorityReader({
    config: { config: { internalIssuer: 'https://gateway.internal.example' } } as never,
    signingKeys: { findAllForCollision: async () => gatewayKeys as never }
  });
  return {
    rows,
    gatewayKeys,
    command: new ProvisionManagedUpstreamSigningKeyCommand({
      repository: repository as never,
      audit: { append: async () => undefined },
      invalidation: { invalidate: async () => undefined },
      gatewaySigningAuthority: reader
    })
  };
}

function legal(row: Row, to: string): boolean {
  return (row.status === 'new' && row.enabled === false && row.lifecycle === 'draft' && to === 'published') ||
    (row.status === 'published' && row.enabled === false && row.lifecycle === 'draft' && to === 'active') ||
    (row.status === 'active' && row.enabled === true && row.lifecycle === 'active' && to === 'retiring') ||
    (row.status === 'retiring' && row.enabled === false && row.lifecycle === 'disabled' && to === 'retired');
}

function capture(callback: () => void): unknown {
  try { callback(); } catch (error) { return error; }
  return undefined;
}

function expectRedacted(error: unknown): void {
  const rendered = `${String(error)} ${JSON.stringify(error)}`;
  for (const sentinel of [managedPrivateSentinel, gatewayPrivateSentinel, managedReference, gatewayReference]) {
    expect(rendered).not.toContain(sentinel);
  }
}

type Row = Record<string, unknown>;

async function issuerFixture(overrides: Readonly<{ providerFailure?: Error; active?: Readonly<{ issuer: string; audience: string; kid: string; privateKey: KeyLike }> }> = {}) {
  const keys = await generateKeyPair('RS256');
  const active = overrides.active ?? Object.freeze({ issuer: 'https://managed.example.test', audience: 'managed-audience', kid: 'managed-kid', privateKey: keys.privateKey as KeyLike });
  const findActive = jest.fn(async () => {
    if (overrides.providerFailure) throw overrides.providerFailure;
    return active;
  });
  return { issuer: new ManagedUpstreamTokenIssuer({ findActive }), findActive, publicKey: keys.publicKey };
}

function canonicalIdentity(overrides: Record<string, unknown> = {}) {
  return Object.freeze({
    integrationId: 'integration-a', subject: 'actor-a', organizationId: 'organization-a', hostApp: 'admin', roles: Object.freeze([]), permissionScopes: Object.freeze(['orders:read']), ...overrides
  }) as never;
}
