import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '../../src/generated/prisma/client';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { TrustProfileActivationValidator } from '../../src/integration-registry/trust-profile-activation.validator';
import { TrustProfileLifecycleService } from '../../src/integration-registry/trust-profile-lifecycle.service';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const lifecyclePath = resolve(__dirname, '../../src/integration-registry/trust-profile-lifecycle.service.ts');
const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const ISSUER_A = 'https://issuer-a.example.test';
const ISSUER_B = 'https://issuer-b.example.test';

describe('Trust-profile lifecycle boundary (T041)', () => {
  it('is direct-only and owns no binding, Customer, HostApp, cache, or runtime-verifier authority', () => {
    expect(existsSync(lifecyclePath)).toBe(true);
    const source = existsSync(lifecyclePath) ? readFileSync(lifecyclePath, 'utf8') : '';
    expect(source).not.toMatch(/@Controller|GatewayModule|MultiProfileUpstreamTokenVerifier|CanonicalIdentityResolver|customerId|allowedHostApp|TrustProfileCache/);
  });
});

describeRegistry('Trust-profile lifecycle transactions (T041/T042)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let repository: TrustProfileRepository;
  let service: TrustProfileLifecycleService;
  let audit: { append: jest.Mock };
  let invalidation: { invalidate: jest.Mock };

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('trust-profile-lifecycle');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    repository = new TrustProfileRepository(prisma);
    audit = { append: jest.fn(async () => undefined) };
    invalidation = { invalidate: jest.fn(async () => undefined) };
    service = new TrustProfileLifecycleService({
      repository,
      validator: new TrustProfileActivationValidator({ repository, jwksSourcePolicy: new (require('../../src/integration-registry/trust-profile-activation.validator') as typeof import('../../src/integration-registry/trust-profile-activation.validator')).ProductionJwksSourceRegistrationPolicy() }),
      auditWriter: audit,
      invalidation
    });
    await prisma.customer.createMany({ data: [{ id: 'customer-a' }, { id: 'customer-b' }] });
    await prisma.integrationBinding.createMany({ data: [
      { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: false },
      { integrationId: 'integration-b', customerId: 'customer-b', allowedHostApp: 'admin', enabled: true }
    ] });
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('disables an active profile without modifying its disabled IntegrationBinding and removes it from candidates', async () => {
    await repository.create(active('profile-a', 'integration-a', 1), prisma);

    await expect(service.disable({ profileId: 'profile-a', requestId: 'request-disable' })).resolves.toMatchObject({ id: 'profile-a', changed: true });
    await expect(repository.findById('profile-a')).resolves.toMatchObject({ enabled: false, lifecycle: 'disabled' });
    await expect(repository.findEnabledByIssuer(ISSUER_A)).resolves.toEqual([]);
    await expect(prisma.integrationBinding.findUnique({ where: { integrationId: 'integration-a' } })).resolves.toMatchObject({ enabled: false });
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-a');
    expect(JSON.stringify(audit.append.mock.calls)).not.toMatch(/jwks|token|secret|credential/i);
  });

  it('does not let an audit failure suppress disable invalidation after commit', async () => {
    await repository.create(active('profile-a', 'integration-a', 1), prisma);
    audit.append.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(service.disable({ profileId: 'profile-a', requestId: 'request-audit-failure' })).rejects.toMatchObject({
      name: 'TrustProfileLifecyclePostCommitError',
      committed: true,
      message: 'Trust profile lifecycle cannot be completed.'
    });
    await expect(repository.findById('profile-a')).resolves.toMatchObject({ enabled: false, lifecycle: 'disabled' });
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-a');
  });

  it('replaces an active predecessor with its validated draft successor atomically without touching other integrations', async () => {
    await repository.create(active('profile-v1', 'integration-a', 1), prisma);
    await repository.create(draft('profile-v2', 'integration-a', 2, 'profile-v1', ISSUER_B), prisma);
    await repository.create(active('profile-b', 'integration-b', 1), prisma);

    await expect(service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v2', requestId: 'request-replace' })).resolves.toMatchObject({ predecessorId: 'profile-v1', successorId: 'profile-v2', changed: true });
    await expect(repository.findById('profile-v1')).resolves.toMatchObject({ enabled: false, lifecycle: 'replaced' });
    await expect(repository.findById('profile-v2')).resolves.toMatchObject({ enabled: true, lifecycle: 'active', replacesProfileId: 'profile-v1' });
    await expect(repository.findByIntegrationId('integration-a')).resolves.toEqual([
      expect.objectContaining({ id: 'profile-v1', enabled: false, lifecycle: 'replaced' }),
      expect.objectContaining({ id: 'profile-v2', enabled: true, lifecycle: 'active' })
    ]);
    await expect(repository.findById('profile-b')).resolves.toMatchObject({ enabled: true, lifecycle: 'active', integrationId: 'integration-b' });
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-v1');
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-v2');
  });

  it('attempts successor invalidation when predecessor invalidation fails after replacement commit', async () => {
    await repository.create(active('profile-v1', 'integration-a', 1), prisma);
    await repository.create(draft('profile-v2', 'integration-a', 2, 'profile-v1', ISSUER_B), prisma);
    invalidation.invalidate.mockImplementation(async (profileId: string) => {
      if (profileId === 'profile-v1') throw new Error('predecessor invalidation unavailable');
    });

    await expect(service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v2', requestId: 'request-invalidation-failure' })).rejects.toMatchObject({
      name: 'TrustProfileLifecyclePostCommitError',
      committed: true,
      message: 'Trust profile lifecycle cannot be completed.'
    });
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-v1');
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-v2');
  });

  it('attempts both replacement invalidations when audit and one invalidation fail', async () => {
    await repository.create(active('profile-v1', 'integration-a', 1), prisma);
    await repository.create(draft('profile-v2', 'integration-a', 2, 'profile-v1', ISSUER_B), prisma);
    audit.append.mockRejectedValueOnce(new Error('audit unavailable'));
    invalidation.invalidate.mockImplementation(async (profileId: string) => {
      if (profileId === 'profile-v1') throw new Error('predecessor invalidation unavailable');
    });

    await expect(service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v2', requestId: 'request-multiple-failures' })).rejects.toMatchObject({
      name: 'TrustProfileLifecyclePostCommitError',
      committed: true,
      message: 'Trust profile lifecycle cannot be completed.'
    });
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-v1');
    expect(invalidation.invalidate).toHaveBeenCalledWith('profile-v2');
  });

  it.each([
    ['self replacement', draft('profile-v2', 'integration-a', 2, 'profile-v2')],
    ['cross-integration replacement', draft('profile-v2', 'integration-b', 2, 'profile-v1')],
    ['lower version', draft('profile-v2', 'integration-a', 0, 'profile-v1')],
    ['already active successor', active('profile-v2', 'integration-a', 2, 'profile-v1', ISSUER_B)]
  ])('rejects %s without changing the predecessor', async (_label, successor) => {
    await repository.create(active('profile-v1', 'integration-a', 1), prisma);
    await repository.create(successor, prisma);

    await expect(service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v2', requestId: 'request-replace' })).rejects.toThrow('Trust profile lifecycle cannot be completed.');
    await expect(repository.findById('profile-v1')).resolves.toMatchObject({ enabled: true, lifecycle: 'active' });
  });

  it('does not permit a same-version successor record for the immutable integration anchor', async () => {
    await repository.create(active('profile-v1', 'integration-a', 1), prisma);
    await expect(repository.create(draft('profile-v2', 'integration-a', 1, 'profile-v1'), prisma)).rejects.toThrow();
    await expect(repository.findById('profile-v1')).resolves.toMatchObject({ enabled: true, lifecycle: 'active' });
  });

  it('rejects another active profile and a stale predecessor without a dual active transition', async () => {
    await repository.create(active('profile-v1', 'integration-a', 1), prisma);
    await repository.create(active('profile-other', 'integration-a', 2, undefined, ISSUER_B), prisma);
    await repository.create(draft('profile-v3', 'integration-a', 3, 'profile-v1', 'https://issuer-c.example.test'), prisma);

    await expect(service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v3', requestId: 'request-ambiguous' })).rejects.toThrow();
    await repository.update('profile-other', { enabled: false, lifecycle: 'disabled' }, prisma);
    await service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v3', requestId: 'request-first' });
    await expect(service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v3', requestId: 'request-stale' })).rejects.toThrow();
    await expect(repository.findEnabledActiveByIntegrationId('integration-a')).resolves.toEqual([expect.objectContaining({ id: 'profile-v3' })]);
  });

  it('rolls back successor activation when predecessor replacement fails, without post-commit hooks', async () => {
    await repository.create(active('profile-v1', 'integration-a', 1), prisma);
    await repository.create(draft('profile-v2', 'integration-a', 2, 'profile-v1', ISSUER_B), prisma);
    await database.execute("CREATE FUNCTION fail_trust_profile_replace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lifecycle = 'replaced' THEN RAISE EXCEPTION 'forced replacement failure'; END IF; RETURN NEW; END; $$;");
    await database.execute('CREATE TRIGGER fail_trust_profile_replace_trigger BEFORE UPDATE ON "RegisteredUpstreamTrustProfile" FOR EACH ROW EXECUTE FUNCTION fail_trust_profile_replace();');

    await expect(service.replace({ predecessorId: 'profile-v1', successorId: 'profile-v2', requestId: 'request-rollback' })).rejects.toThrow('Trust profile lifecycle cannot be completed.');
    await expect(repository.findById('profile-v1')).resolves.toMatchObject({ enabled: true, lifecycle: 'active' });
    await expect(repository.findById('profile-v2')).resolves.toMatchObject({ enabled: false, lifecycle: 'draft' });
    expect(invalidation.invalidate).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
  });
});

function active(id: string, integrationId: string, version: number, replacesProfileId: string | undefined = undefined, expectedIssuer = ISSUER_A) {
  return profile({ id, integrationId, version, replacesProfileId: replacesProfileId ?? null, expectedIssuer, enabled: true, lifecycle: 'active' });
}

function draft(id: string, integrationId: string, version: number, replacesProfileId: string, expectedIssuer = ISSUER_A) {
  return profile({ id, integrationId, version, replacesProfileId, expectedIssuer, enabled: false, lifecycle: 'draft' });
}

function profile(overrides: Record<string, unknown>): Prisma.RegisteredUpstreamTrustProfileUncheckedCreateInput {
  return {
    id: 'profile-default',
    integrationId: 'integration-a',
    expectedIssuer: ISSUER_A,
    expectedAudience: 'gateway-audience',
    jwksUri: 'https://issuer.example.test/jwks.json',
    algorithm: 'RS256',
    enabled: false,
    lifecycle: 'draft',
    version: 1,
    replacesProfileId: null,
    ...overrides
  } as Prisma.RegisteredUpstreamTrustProfileUncheckedCreateInput;
}
