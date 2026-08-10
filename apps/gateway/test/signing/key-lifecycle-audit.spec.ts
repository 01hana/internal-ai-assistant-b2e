import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwksService } from '../../src/jwks/jwks.service';
import type { GatewaySigningKeyRepository } from '../../src/signing/gateway-signing-key.repository';
import { IdentityServiceUnavailableError } from '../../src/signing/identity-service-unavailable.error';
import { createEphemeralRsaFixture } from './ephemeral-rsa.fixture';

const rotationPath = resolve(__dirname, '../../src/signing/key-rotation.service.ts');

type RotationService = Readonly<{
  retire(input: Readonly<{ kid: string; requestId: string }>): Promise<unknown>;
  rollbackToPriorActive(input: Readonly<{ priorKid: string; candidateKid: string; requestId: string }>): Promise<unknown>;
}>;

describe('Signing-key lifecycle audit and retained-JWKS contract (T056)', () => {
  it('requires the Phase 6 operational rotation production surface', () => {
    expect(existsSync(rotationPath)).toBe(true);
  });

  it('writes only safe scalar lifecycle audit data', async () => {
    const fixture = await createEphemeralRsaFixture({ kid: 'audit-retiring-key' });
    const repository = createRepository([keyRow(fixture.kid, 'retiring', fixture.publicJwk, new Date('2026-08-10T00:25:00.000Z'), 'file:/secret-reference-sentinel.pem')]);
    const rotation = createRotationService(repository, new Date('2026-08-10T00:25:00.000Z'));

    await rotation.retire({ kid: fixture.kid, requestId: 'request-lifecycle-audit' });

    const audit = repository.gatewayIdentityAuditEvent.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    const data = audit.data;
    expect(data).toEqual(expect.objectContaining({ requestId: 'request-lifecycle-audit', kid: fixture.kid }));
    expect(data.eventType).toEqual(expect.stringMatching(/^[a-z][a-z0-9_:-]{0,127}$/));
    expect(data.outcome).toEqual(expect.stringMatching(/^[a-z][a-z0-9_:-]{0,127}$/));
    expect(data.reasonCode).toEqual(expect.stringMatching(/^[a-z][a-z0-9_:-]{0,127}$/));
    expect(JSON.stringify(data)).not.toMatch(/keyreference|private|authorization|bearer|credential|path|pem|jwt|signature|secret-reference-sentinel|file:\/secret-reference-sentinel\.pem/i);
    expect(data).not.toHaveProperty('customerId');
    expect(data).not.toHaveProperty('integrationId');
    expect(data).not.toHaveProperty('actorId');
    expect(data).not.toHaveProperty('hostApp');
    expect(data).not.toHaveProperty('jti');
    await expect(new JwksService(repository as unknown as Pick<GatewaySigningKeyRepository, 'findJwksVisible'>).getDocument()).resolves.toEqual({ keys: [] });
  });

  it('fails premature retirement without changing state, hiding the key, or leaking diagnostics', async () => {
    const fixture = await createEphemeralRsaFixture({ kid: 'still-needed-key' });
    const repository = createRepository([keyRow(fixture.kid, 'retiring', fixture.publicJwk, new Date('2026-08-10T00:25:00.000Z'), 'file:/secret-reference-sentinel.pem')]);
    const rotation = createRotationService(repository, new Date('2026-08-10T00:24:59.000Z'));

    const error = await rejectionOf(() => rotation.retire({ kid: fixture.kid, requestId: 'request-premature' }));
    expect(error).toMatchObject(genericUnavailable());
    expect(JSON.stringify(error)).not.toMatch(/secret-reference-sentinel|file:\/secret-reference-sentinel\.pem/i);
    expect(repository.update).not.toHaveBeenCalled();
    await expect(new JwksService(repository as unknown as Pick<GatewaySigningKeyRepository, 'findJwksVisible'>).getDocument()).resolves.toEqual({ keys: [expect.objectContaining({ kid: fixture.kid })] });
  });

  it('keeps the prior public JWK visible after rollback from a failed candidate rollout', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'prior-visible-key' });
    const candidate = await createEphemeralRsaFixture({ kid: 'candidate-failed-key' });
    const repository = createRepository([
      keyRow(prior.kid, 'retiring', prior.publicJwk, new Date('2026-08-10T00:25:00.000Z'), 'file:/secret-reference-sentinel.pem'),
      keyRow(candidate.kid, 'active', candidate.publicJwk, null, 'file:/secret-reference-sentinel.pem')
    ]);
    const rotation = createRotationService(repository);

    await expect(rotation.rollbackToPriorActive({ priorKid: prior.kid, candidateKid: candidate.kid, requestId: 'request-rollback-visible' })).resolves.toEqual(expect.objectContaining({ activeKid: prior.kid }));
    expect(repository.delete).not.toHaveBeenCalled();
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active' }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'retiring' }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(1);
    await expect(new JwksService(repository as unknown as Pick<GatewaySigningKeyRepository, 'findJwksVisible'>).getDocument()).resolves.toEqual({ keys: expect.arrayContaining([expect.objectContaining({ kid: prior.kid }), expect.objectContaining({ kid: candidate.kid })]) });
  });

  it('keeps safe rollback state committed but rejects direct rollback when compensation audit persistence fails', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'prior-direct-audit-failure' });
    const candidate = await createEphemeralRsaFixture({ kid: 'candidate-direct-audit-failure' });
    const repository = createRepository([
      keyRow(prior.kid, 'retiring', prior.publicJwk, new Date('2026-08-10T00:25:00.000Z'), 'file:/secret-reference-sentinel.pem'),
      keyRow(candidate.kid, 'active', candidate.publicJwk, null, 'file:/secret-reference-sentinel.pem')
    ]);
    const rotation = createRotationService(repository, new Date('2026-08-10T00:00:00.000Z'), { failCompensationAudit: true });

    const error = await rejectionOf(() => rotation.rollbackToPriorActive({ priorKid: prior.kid, candidateKid: candidate.kid, requestId: 'request-direct-audit-failure' }));
    expect(error).toMatchObject(genericUnavailable());
    expect(JSON.stringify(error)).not.toMatch(/secret-reference-sentinel|file:|private|pem|jwt|authorization|credential/i);
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active', retireAfter: null }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'retiring', retireAfter: new Date('2026-08-10T00:25:00.000Z') }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toEqual([expect.objectContaining({ kid: prior.kid })]);
    expect(repository.delete).not.toHaveBeenCalled();
    await expect(new JwksService(repository as unknown as Pick<GatewaySigningKeyRepository, 'findJwksVisible'>).getDocument()).resolves.toEqual({
      keys: expect.arrayContaining([expect.objectContaining({ kid: prior.kid }), expect.objectContaining({ kid: candidate.kid })])
    });
  });

  it('rejects caller-controlled retirement time before any mutation', async () => {
    const fixture = await createEphemeralRsaFixture({ kid: 'attacker-retirement-time-key' });
    const repository = createRepository([keyRow(fixture.kid, 'retiring', fixture.publicJwk, new Date('2026-08-10T00:25:00.000Z'), 'file:/secret-reference-sentinel.pem')]);
    const rotation = createRotationService(repository, new Date('2026-08-10T00:24:59.000Z'));

    await expect(Promise.resolve().then(() => rotation.retire({ kid: fixture.kid, requestId: 'request-attacker-time', now: new Date('2099-01-01T00:00:00.000Z') } as never))).rejects.toMatchObject(genericUnavailable());
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.records.get(fixture.kid)).toEqual(expect.objectContaining({ status: 'retiring' }));
  });

  it('rejects an invalid rollback topology without state or audit mutation', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'prior-invalid-topology' });
    const candidate = await createEphemeralRsaFixture({ kid: 'candidate-invalid-topology' });
    const repository = createRepository([
      keyRow(prior.kid, 'active', prior.publicJwk, null, 'file:/secret-reference-sentinel.pem'),
      keyRow(candidate.kid, 'published', candidate.publicJwk, null, 'file:/secret-reference-sentinel.pem')
    ]);
    const rotation = createRotationService(repository);

    await expect(rotation.rollbackToPriorActive({ priorKid: prior.kid, candidateKid: candidate.kid, requestId: 'request-invalid-rollback' })).rejects.toMatchObject(genericUnavailable());
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active' }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'published' }));
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.gatewayIdentityAuditEvent.create).not.toHaveBeenCalled();
  });
});

function createRotationService(
  repository: ReturnType<typeof createRepository>,
  currentTime = new Date('2026-08-10T00:00:00.000Z'),
  options: Readonly<{ failCompensationAudit?: boolean }> = {}
): RotationService {
  if (!existsSync(rotationPath)) throw new Error('Required Phase 6 rotation production surface missing: KeyRotationService.');
  const target = require(rotationPath) as {
    KeyRotationService?: new (dependencies: Readonly<{ repository: unknown; lifecycle: unknown; retirementPolicy: unknown; propagationVerifier: unknown; compensationAuditWriter: unknown; now: () => Date }>) => RotationService;
  };
  if (!target.KeyRotationService) throw new Error('Required Phase 6 rotation production surface missing: KeyRotationService.');
  const lifecycleTarget = require(resolve(__dirname, '../../src/signing/key-lifecycle.service.ts')) as {
    KeyLifecycleService: new (dependencies: Readonly<{ repository: unknown; signingKeyProvider: unknown; retirementPolicy: unknown; now: () => Date }>) => { transitionInTransaction(transaction: unknown, input: unknown): Promise<unknown> };
  };
  const retirementPolicy = { calculateRetireAfter: (now: Date) => new Date(now.getTime() + 1500_000), isRetirementEligible: ({ retireAfter, now }: { retireAfter: Date; now: Date }) => now.getTime() >= retireAfter.getTime() };
  const lifecycle = new lifecycleTarget.KeyLifecycleService({ repository, signingKeyProvider: { load: jest.fn() }, retirementPolicy, now: () => new Date('2026-08-10T00:00:00.000Z') });
  return new target.KeyRotationService({
    repository,
    lifecycle,
    retirementPolicy,
    propagationVerifier: { verifyPublished: jest.fn(async () => undefined), verifyActivated: jest.fn(async () => undefined) },
    compensationAuditWriter: { append: jest.fn(async () => {
      if (options.failCompensationAudit) throw new Error('compensation-audit-failure');
    }) },
    now: () => currentTime
  });
}

function createRepository(rows: readonly ReturnType<typeof keyRow>[]) {
  const records = new Map(rows.map((row) => [row.kid, row]));
  const repository = {
    records,
    gatewayIdentityAuditEvent: { create: jest.fn(async ({ data }: { data: unknown }) => ({ data })) },
    transaction: jest.fn(),
    findByKid: jest.fn(async (kid: string) => records.get(kid) ?? null),
    findActive: jest.fn(async () => [...records.values()].find((row) => row.status === 'active') ?? null),
    findJwksVisible: jest.fn(async () => [...records.values()].filter((row) => ['published', 'active', 'retiring'].includes(row.status))),
    update: jest.fn(async (kid: string, data: Record<string, unknown>) => {
      const next = { ...(records.get(kid) ?? {}), ...data } as ReturnType<typeof keyRow>;
      records.set(kid, next);
      return next;
    }),
    delete: jest.fn(async (kid: string) => records.delete(kid))
  };
  repository.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback(repository));
  return repository;
}

function keyRow(kid: string, status: 'published' | 'active' | 'retiring', publicJwk: Readonly<Record<string, unknown>>, retireAfter: Date | null, keyReference: string) {
  return { kid, status, publicJwk, retireAfter, keyReference };
}

async function rejectionOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('Expected lifecycle operation to reject.');
}

function genericUnavailable() {
  return {
    status: 503,
    code: 'IDENTITY_SERVICE_UNAVAILABLE',
    message: 'Identity service is unavailable.',
    auditReasonCode: 'signing_or_jwks_unavailable'
  } satisfies Pick<IdentityServiceUnavailableError, 'status' | 'code' | 'message' | 'auditReasonCode'>;
}
