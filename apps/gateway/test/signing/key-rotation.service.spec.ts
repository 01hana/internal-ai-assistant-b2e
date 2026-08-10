import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwksService } from '../../src/jwks/jwks.service';
import { ActiveSigningKeyResolver } from '../../src/signing/active-signing-key-resolver';
import type { GatewaySigningKeyRepository } from '../../src/signing/gateway-signing-key.repository';
import { createEphemeralRsaFixture } from './ephemeral-rsa.fixture';

const lifecyclePath = resolve(__dirname, '../../src/signing/key-lifecycle.service.ts');
const rotationPath = resolve(__dirname, '../../src/signing/key-rotation.service.ts');
const now = new Date('2026-08-10T00:00:00.000Z');

describe('Signing-key rotation orchestration contract (T058)', () => {
  it('requires the Phase 6 KeyRotationService production surface', () => {
    expect(existsSync(rotationPath)).toBe(true);
  });

  it('fails closed when the T061 concrete propagation probe has not been wired', async () => {
    const target = require(resolve(__dirname, '../../src/signing/signing-key-propagation-verifier.ts')) as {
      UnavailableSigningKeyPropagationVerifier: new () => { verifyPublished(input: unknown): Promise<void> };
    };
    const verifier = new target.UnavailableSigningKeyPropagationVerifier();

    await expect(verifier.verifyPublished({ kid: 'unproven-key', publicJwk: {} })).rejects.toMatchObject(genericUnavailable());
  });

  it('rejects an unpublished candidate before propagation proof or mutation', async () => {
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-new' });
    const repository = createRepository([keyRow(candidate.kid, 'new', candidate.publicJwk)]);
    const propagation = propagationVerifier();
    const rotation = createRotation(repository, propagation);

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-unpublished' })).rejects.toMatchObject(genericUnavailable());
    expect(propagation.verifyPublished).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('keeps a published candidate and prior active key unchanged when pre-activation proof fails', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'rotation-prior-preproof' });
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-candidate-preproof' });
    const repository = createRepository([keyRow(prior.kid, 'active', prior.publicJwk), keyRow(candidate.kid, 'published', candidate.publicJwk)]);
    const propagation = propagationVerifier({ publishedFailure: true });
    const rotation = createRotation(repository, propagation);

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-preproof' })).rejects.toMatchObject(genericUnavailable());
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active', retireAfter: null }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'published' }));
    expect(propagation.verifyActivated).not.toHaveBeenCalled();
  });

  it('atomically retires the prior active key and activates a proven published candidate', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'rotation-prior-active' });
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-candidate-active' });
    const repository = createRepository([keyRow(prior.kid, 'active', prior.publicJwk), keyRow(candidate.kid, 'published', candidate.publicJwk)]);
    const propagation = propagationVerifier();
    const rotation = createRotation(repository, propagation);

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-activate' })).resolves.toEqual({ activeKid: candidate.kid });
    expect(propagation.verifyPublished).toHaveBeenCalledWith({ kid: candidate.kid, publicJwk: candidate.publicJwk });
    expect(propagation.verifyActivated).toHaveBeenCalledWith({ kid: candidate.kid, publicJwk: candidate.publicJwk });
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'retiring', retireAfter: new Date(now.getTime() + 1_500_000) }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'active', retireAfter: null }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(1);
  });

  it('activates a proven published candidate when no prior active key exists', async () => {
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-first-active' });
    const repository = createRepository([keyRow(candidate.kid, 'published', candidate.publicJwk)]);
    const propagation = propagationVerifier();
    const rotation = createRotation(repository, propagation);

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-first-active' })).resolves.toEqual({ activeKid: candidate.kid });
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'active', retireAfter: null }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(1);
  });

  it('retires a first active candidate after post-activation proof failure, leaving no signer and a visible JWKS key', async () => {
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-first-active-proof-failure' });
    const repository = createRepository([keyRow(candidate.kid, 'published', candidate.publicJwk)]);
    const propagation = propagationVerifier({ activatedFailure: true });
    const rotation = createRotation(repository, propagation);

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-first-active-proof-failure' })).rejects.toMatchObject(genericUnavailable());
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({
      status: 'retiring',
      retireAfter: new Date(now.getTime() + 1_500_000)
    }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(0);
    expect(repository.delete).not.toHaveBeenCalled();
    await expect(new JwksService(repository as unknown as Pick<GatewaySigningKeyRepository, 'findJwksVisible'>).getDocument()).resolves.toEqual({
      keys: [expect.objectContaining({ kid: candidate.kid })]
    });
    const activeResolver = new ActiveSigningKeyResolver(repository as unknown as Pick<GatewaySigningKeyRepository, 'findActive'>, {
      load: jest.fn(async () => candidate.privateKey)
    });
    await expect(activeResolver.resolveActiveSigningKey()).rejects.toMatchObject(genericUnavailable());
  });

  it('keeps the first-key safety compensation committed when its separate audit fails', async () => {
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-first-active-compensation-audit-failure' });
    const repository = createRepository([keyRow(candidate.kid, 'published', candidate.publicJwk)]);
    const rotation = createRotation(repository, propagationVerifier({ activatedFailure: true }), { failCompensationAudit: true });

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-first-compensation-audit-failure' })).rejects.toMatchObject(genericUnavailable());
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'retiring', retireAfter: new Date(now.getTime() + 1_500_000) }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(0);
    expect(repository.delete).not.toHaveBeenCalled();
    await expect(new JwksService(repository as unknown as Pick<GatewaySigningKeyRepository, 'findJwksVisible'>).getDocument()).resolves.toEqual({ keys: [expect.objectContaining({ kid: candidate.kid })] });
  });

  it('rolls back a failed post-activation proof without deleting either visible key', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'rotation-prior-rollback' });
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-candidate-rollback' });
    const repository = createRepository([keyRow(prior.kid, 'active', prior.publicJwk), keyRow(candidate.kid, 'published', candidate.publicJwk)]);
    const propagation = propagationVerifier({ activatedFailure: true });
    const rotation = createRotation(repository, propagation);

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-postproof' })).rejects.toMatchObject(genericUnavailable());
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active', retireAfter: null }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'retiring', retireAfter: new Date(now.getTime() + 1_500_000) }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(1);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('keeps prior-key rollback safety state committed when its separate compensation audit fails', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'rotation-prior-compensation-audit-failure' });
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-candidate-compensation-audit-failure' });
    const repository = createRepository([keyRow(prior.kid, 'active', prior.publicJwk), keyRow(candidate.kid, 'published', candidate.publicJwk)]);
    const rotation = createRotation(repository, propagationVerifier({ activatedFailure: true }), { failCompensationAudit: true });

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-prior-compensation-audit-failure' })).rejects.toMatchObject(genericUnavailable());
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active', retireAfter: null }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'retiring', retireAfter: new Date(now.getTime() + 1_500_000) }));
    expect([...repository.records.values()].filter((key) => key.status === 'active')).toHaveLength(1);
    await expect(new JwksService(repository as unknown as Pick<GatewaySigningKeyRepository, 'findJwksVisible'>).getDocument()).resolves.toEqual({
      keys: expect.arrayContaining([expect.objectContaining({ kid: prior.kid }), expect.objectContaining({ kid: candidate.kid })])
    });
  });

  it('rolls back the activation transaction when lifecycle audit persistence fails', async () => {
    const prior = await createEphemeralRsaFixture({ kid: 'rotation-prior-audit' });
    const candidate = await createEphemeralRsaFixture({ kid: 'rotation-candidate-audit' });
    const repository = createRepository([keyRow(prior.kid, 'active', prior.publicJwk), keyRow(candidate.kid, 'published', candidate.publicJwk)], { failAudit: true });
    const propagation = propagationVerifier();
    const rotation = createRotation(repository, propagation);

    await expect(rotation.activatePublished({ kid: candidate.kid, requestId: 'request-audit-rollback' })).rejects.toMatchObject(genericUnavailable());
    expect(repository.records.get(prior.kid)).toEqual(expect.objectContaining({ status: 'active', retireAfter: null }));
    expect(repository.records.get(candidate.kid)).toEqual(expect.objectContaining({ status: 'published', retireAfter: null }));
    expect(propagation.verifyActivated).not.toHaveBeenCalled();
  });
});

function createRotation(
  repository: ReturnType<typeof createRepository>,
  verifier: ReturnType<typeof propagationVerifier>,
  options: Readonly<{ failCompensationAudit?: boolean }> = {}
) {
  const lifecycleTarget = require(lifecyclePath) as { KeyLifecycleService: new (dependencies: Readonly<{ repository: unknown; signingKeyProvider: unknown; retirementPolicy: unknown; now: () => Date }>) => unknown };
  const rotationTarget = require(rotationPath) as { KeyRotationService: new (dependencies: Readonly<{ repository: unknown; lifecycle: unknown; retirementPolicy: unknown; propagationVerifier: unknown; compensationAuditWriter: unknown; now: () => Date }>) => { activatePublished(input: Readonly<{ kid: string; requestId: string }>): Promise<unknown> } };
  const policy = {
    calculateRetireAfter: (time: Date) => new Date(time.getTime() + 1_500_000),
    isRetirementEligible: ({ retireAfter, now: current }: { retireAfter: Date; now: Date }) => current.getTime() >= retireAfter.getTime()
  };
  const lifecycle = new lifecycleTarget.KeyLifecycleService({ repository, signingKeyProvider: { load: jest.fn() }, retirementPolicy: policy, now: () => now });
  const compensationAuditWriter = {
    append: jest.fn(async () => {
      if (options.failCompensationAudit) throw new Error('compensation-audit-failure');
    })
  };
  return new rotationTarget.KeyRotationService({ repository, lifecycle, retirementPolicy: policy, propagationVerifier: verifier, compensationAuditWriter, now: () => now });
}

function createRepository(rows: readonly ReturnType<typeof keyRow>[], options: Readonly<{ failAudit?: boolean }> = {}) {
  const records = new Map(rows.map((row) => [row.kid, { ...row }]));
  const repository = {
    records,
    transaction: jest.fn(),
    gatewayIdentityAuditEvent: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        if (options.failAudit) throw new Error('audit-failure');
        return { data };
      })
    },
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
  repository.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => {
    const snapshot = new Map([...records.entries()].map(([kid, row]) => [kid, { ...row }]));
    try {
      return await callback(repository);
    } catch (error) {
      records.clear();
      for (const [kid, row] of snapshot) records.set(kid, row);
      throw error;
    }
  });
  return repository;
}

function keyRow(kid: string, status: 'new' | 'published' | 'active' | 'retiring' | 'retired', publicJwk: Readonly<Record<string, unknown>>) {
  return { kid, status, publicJwk, keyReference: `file:/${kid}.pem`, notBefore: null, activatedAt: status === 'active' ? now : null, retireAfter: null, retiredAt: null };
}

function propagationVerifier(options: Readonly<{ publishedFailure?: boolean; activatedFailure?: boolean }> = {}) {
  return {
    verifyPublished: jest.fn(async () => {
      if (options.publishedFailure) throw new Error('published-proof-failure');
    }),
    verifyActivated: jest.fn(async () => {
      if (options.activatedFailure) throw new Error('activated-proof-failure');
    })
  };
}

function genericUnavailable() {
  return { status: 503, code: 'IDENTITY_SERVICE_UNAVAILABLE', message: 'Identity service is unavailable.', auditReasonCode: 'signing_or_jwks_unavailable' };
}
