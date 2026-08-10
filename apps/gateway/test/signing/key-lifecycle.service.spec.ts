import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEphemeralRsaFixture } from './ephemeral-rsa.fixture';

const lifecyclePath = resolve(__dirname, '../../src/signing/key-lifecycle.service.ts');

type KeyStatus = 'new' | 'published' | 'active' | 'retiring' | 'retired';
type LifecycleInput = Readonly<{ kid: string; keyReference: string; requestId: string }>;
type TransitionInput = Readonly<{ kid: string; to: KeyStatus; requestId: string }>;
type LifecycleService = Readonly<{
  register(input: LifecycleInput): Promise<unknown>;
  transition(input: TransitionInput): Promise<unknown>;
  transitionInTransaction(transaction: unknown, input: TransitionInput): Promise<unknown>;
  restorePriorActiveInTransaction(transaction: unknown, input: Readonly<{ kid: string; requestId: string }>): Promise<unknown>;
}>;

describe('Signing-key lifecycle registration and transition contract (T054)', () => {
  it('requires the Phase 6 lifecycle production surface', () => {
    expect(existsSync(lifecyclePath)).toBe(true);
  });

  it('registers only a provider-derived public RSA JWK as a new key', async () => {
    const providerFixture = await createEphemeralRsaFixture({ kid: 'registration-kid-a' });
    const repository = createRepository();
    const provider = { load: jest.fn(async () => providerFixture.privateKey) };
    const auditWriter = { append: jest.fn(async () => undefined) };
    const lifecycle = createLifecycleService(repository, provider, auditWriter);

    await lifecycle.register({ kid: providerFixture.kid, keyReference: 'file:/test/key-a.pem', requestId: 'request-registration-a' });

    expect(provider.load).toHaveBeenCalledWith('file:/test/key-a.pem');
    expect(repository.create).toHaveBeenCalledTimes(1);
    const payload = repository.create.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({
      kid: providerFixture.kid,
      keyReference: 'file:/test/key-a.pem',
      status: 'new',
      publicJwk: expect.objectContaining({
        kty: 'RSA', kid: providerFixture.kid, alg: 'RS256', use: 'sig',
        n: providerFixture.publicJwk.n, e: providerFixture.publicJwk.e
      })
    }));
    expect(Object.keys(payload.publicJwk as Record<string, unknown>).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
    expect(JSON.stringify(payload)).not.toMatch(/private|"(?:d|p|q|dp|dq|qi|oth)"/i);
  });

  it.each([
    { kid: ' ', keyReference: 'file:/test/key-a.pem', requestId: 'request-blank-kid' },
    { kid: 'key-a', keyReference: 'file:/test/key-a.pem', requestId: 'request-extra', privatePem: 'private-pem-sentinel' },
    { kid: 'key-a', keyReference: 'file:/test/key-a.pem', requestId: 'request-extra', privateJwk: { d: 'private-jwk-sentinel' } },
    { kid: 'key-a', keyReference: 'file:/test/key-a.pem', requestId: 'request-attacker-public-jwk', publicJwk: { kty: 'RSA', kid: 'key-a', alg: 'RS256', use: 'sig', n: 'attacker-n', e: 'AQAB' } },
    { kid: 'key-a', keyReference: 'file:/test/key-a.pem', requestId: 'request-extra', status: 'active' },
    { kid: 'key-a', keyReference: 'file:/test/key-a.pem', requestId: 'request-extra', active: true },
    { kid: 'key-a', keyReference: 'file:/test/key-a.pem', requestId: 'request-extra', customerId: 'customer-b', integrationId: 'integration-b' }
  ])('rejects non-authority registration input without provider or persistence work', async (input) => {
    const fixture = await createEphemeralRsaFixture();
    const repository = createRepository();
    const provider = { load: jest.fn(async () => fixture.privateKey) };
    const lifecycle = createLifecycleService(repository, provider, { append: jest.fn(async () => undefined) });

    await expect(lifecycle.register(input as LifecycleInput)).rejects.toThrow();
    expect(provider.load).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('does not duplicate or silently rebind an existing kid', async () => {
    const first = await createEphemeralRsaFixture({ kid: 'duplicate-kid' });
    const second = await createEphemeralRsaFixture({ kid: 'duplicate-kid' });
    const repository = createRepository({
      'duplicate-kid': keyRecord('duplicate-kid', 'new', first.publicJwk, 'file:/test/key-a.pem')
    });
    const provider = { load: jest.fn(async () => second.privateKey) };
    const lifecycle = createLifecycleService(repository, provider, { append: jest.fn(async () => undefined) });

    await expect(lifecycle.register({ kid: 'duplicate-kid', keyReference: 'file:/test/key-a.pem', requestId: 'request-exact' })).rejects.toThrow();
    await expect(lifecycle.register({ kid: 'duplicate-kid', keyReference: 'file:/test/key-b.pem', requestId: 'request-conflict' })).rejects.toThrow();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('allows only the direct new → published operation', async () => {
    const fixture = await createEphemeralRsaFixture({ kid: 'direct-new-published' });
    const repository = createRepository({ [fixture.kid]: keyRecord(fixture.kid, 'new', fixture.publicJwk, 'file:/test/key.pem') });
    const lifecycle = createLifecycleService(repository, { load: jest.fn(async () => fixture.privateKey) }, { append: jest.fn(async () => undefined) });

    await expect(lifecycle.transition({ kid: fixture.kid, to: 'published', requestId: 'request-direct-publish' })).resolves.toEqual(expect.objectContaining({ status: 'published' }));
  });

  it.each([
    ['published', 'active'], ['active', 'retiring'], ['retiring', 'retired'], ['new', 'active'], ['new', 'retiring'], ['published', 'retired'], ['retired', 'active'], ['retired', 'published']
  ] as const)('rejects direct lifecycle transition %s → %s without mutation', async (from, to) => {
    const fixture = await createEphemeralRsaFixture({ kid: `direct-denied-${from}-${to}` });
    const repository = createRepository({ [fixture.kid]: keyRecord(fixture.kid, from, fixture.publicJwk, 'file:/test/key.pem') });
    const lifecycle = createLifecycleService(repository, { load: jest.fn(async () => fixture.privateKey) }, { append: jest.fn(async () => undefined) });

    await expect(lifecycle.transition({ kid: fixture.kid, to, requestId: `request-direct-denied-${from}-${to}` })).rejects.toThrow();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([
    ['published', 'active'], ['active', 'retiring'], ['retiring', 'retired']
  ] as const)('keeps legal state-machine transitions available only to the rotation transaction primitive: %s → %s', async (from, to) => {
    const fixture = await createEphemeralRsaFixture({ kid: `internal-${from}-${to}` });
    const repository = createRepository({ [fixture.kid]: keyRecord(fixture.kid, from, fixture.publicJwk, 'file:/test/key.pem') });
    const lifecycle = createLifecycleService(repository, { load: jest.fn(async () => fixture.privateKey) }, { append: jest.fn(async () => undefined) });

    await expect(lifecycle.transitionInTransaction(repository, { kid: fixture.kid, to, requestId: `request-internal-${from}-${to}` })).resolves.toEqual(expect.objectContaining({ status: to }));
  });

  it('defines post-activation rollback state compatibility without making lifecycle the operational rollback owner', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'prior-active' });
    const candidate = await createEphemeralRsaFixture({ kid: 'candidate-active' });
    const repository = createRepository({
      [prior.kid]: keyRecord(prior.kid, 'retiring', prior.publicJwk, 'file:/secret-reference-sentinel.pem'),
      [candidate.kid]: keyRecord(candidate.kid, 'active', candidate.publicJwk, 'file:/secret-reference-sentinel.pem')
    });
    const lifecycle = createLifecycleService(repository, { load: jest.fn(async () => candidate.privateKey) }, { append: jest.fn(async () => undefined) });

    await lifecycle.transitionInTransaction(repository, { kid: candidate.kid, to: 'retiring', requestId: 'request-candidate-retiring' });
    await lifecycle.restorePriorActiveInTransaction(repository, { kid: prior.kid, requestId: 'request-prior-restored' });
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(1);
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active' }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'retiring' }));
  });
});

function createLifecycleService(repository: ReturnType<typeof createRepository>, provider: Readonly<{ load(reference: string): Promise<unknown> }>, _auditWriter: Readonly<{ append(input: unknown): Promise<unknown> }>): LifecycleService {
  if (!existsSync(lifecyclePath)) throw new Error('Required Phase 6 lifecycle production surface missing: KeyLifecycleService.');
  const target = require(lifecyclePath) as {
    KeyLifecycleService?: new (dependencies: Readonly<{ repository: unknown; signingKeyProvider: unknown; retirementPolicy: unknown; now: () => Date }>) => LifecycleService;
  };
  if (!target.KeyLifecycleService) throw new Error('Required Phase 6 lifecycle production surface missing: KeyLifecycleService.');
  return new target.KeyLifecycleService({
    repository,
    signingKeyProvider: provider,
    retirementPolicy: { calculateRetireAfter: (now: Date) => new Date(now.getTime() + 1500_000) },
    now: () => new Date('2026-08-10T00:00:00.000Z')
  });
}

function createRepository(initial: Record<string, Record<string, unknown>> = {}) {
  const records = new Map(Object.entries(initial));
  const repository = {
    records,
    gatewayIdentityAuditEvent: { create: jest.fn(async ({ data }: { data: unknown }) => ({ data })) },
    transaction: jest.fn(),
    findByKid: jest.fn(async (kid: string) => records.get(kid) ?? null),
    findActive: jest.fn(async () => [...records.values()].find((record) => record.status === 'active') ?? null),
    create: jest.fn(async (data: Record<string, unknown>) => {
      records.set(data.kid as string, data);
      return data;
    }),
    update: jest.fn(async (kid: string, data: Record<string, unknown>) => {
      const next = { ...(records.get(kid) ?? {}), ...data };
      records.set(kid, next);
      return next;
    }),
    delete: jest.fn(async (kid: string) => records.delete(kid))
  };
  repository.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback(repository));
  return repository;
}

function keyRecord(kid: string, status: KeyStatus, publicJwk: Readonly<Record<string, unknown>>, keyReference: string) {
  return { kid, status, publicJwk, keyReference, notBefore: null, activatedAt: null, retireAfter: null, retiredAt: null };
}
