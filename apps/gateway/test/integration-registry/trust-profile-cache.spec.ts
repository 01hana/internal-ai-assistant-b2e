import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '../../src/generated/prisma/client';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { ProvisionTrustProfileCommand, type ProvisionTrustProfileInput } from '../../src/commands/provision-trust-profile';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { TrustProfileActivationValidator } from '../../src/integration-registry/trust-profile-activation.validator';
import { TrustProfileLifecycleService } from '../../src/integration-registry/trust-profile-lifecycle.service';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import type { TrustProfileRecord } from '../../src/integration-registry/trust-profile.repository';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const cachePath = resolve(__dirname, '../../src/integration-registry/trust-profile-cache.ts');
const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const ISSUER_A = 'https://issuer-a.example.test';
const ISSUER_B = 'https://issuer-b.example.test';

describe('Trust-profile candidate cache (T043)', () => {
  it('provides a profile-only cache boundary', () => {
    expect(existsSync(cachePath)).toBe(true);
    const source = existsSync(cachePath) ? readFileSync(cachePath, 'utf8') : '';
    expect(source).not.toMatch(/IntegrationBinding|customerId|Customer|allowedHostApp|CanonicalIdentityResolver|JWKS|createLocalJWKSet|jwtVerify/);
  });

  it('caches exact issuer candidates, including empty results, within a bounded TTL', async () => {
    const now = { value: 0 };
    const repository = { findEnabledByIssuer: jest.fn(async (issuer: string) => issuer === ISSUER_A ? [profile('profile-a')] : []) };
    const cache = createCache(repository, now);

    await expect(cache.findEnabledByIssuer(ISSUER_A)).resolves.toEqual([profile('profile-a')]);
    await expect(cache.findEnabledByIssuer(ISSUER_A)).resolves.toEqual([profile('profile-a')]);
    await expect(cache.findEnabledByIssuer(`${ISSUER_A}/`)).resolves.toEqual([]);
    await expect(cache.findEnabledByIssuer(`${ISSUER_A}/`)).resolves.toEqual([]);
    expect(repository.findEnabledByIssuer).toHaveBeenCalledTimes(2);

    now.value = 30_001;
    await cache.findEnabledByIssuer(ISSUER_A);
    expect(repository.findEnabledByIssuer).toHaveBeenCalledTimes(3);
  });

  it('does not serve stale candidates when an expired repository refresh fails', async () => {
    const now = { value: 0 };
    const repository = { findEnabledByIssuer: jest.fn(async () => [profile('profile-a')]) };
    const cache = createCache(repository, now);
    await cache.findEnabledByIssuer(ISSUER_A);
    now.value = 30_001;
    repository.findEnabledByIssuer.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(cache.findEnabledByIssuer(ISSUER_A)).rejects.toThrow('database unavailable');
  });

  it('globally clears positive and negative issuer entries on profile invalidation', async () => {
    const now = { value: 0 };
    const profiles = new Map<string, ReturnType<typeof profile>[]>([[ISSUER_A, [profile('profile-a')]], [ISSUER_B, []]]);
    const repository = { findEnabledByIssuer: jest.fn(async (issuer: string) => profiles.get(issuer) ?? []) };
    const cache = createCache(repository, now);
    await cache.findEnabledByIssuer(ISSUER_A);
    await cache.findEnabledByIssuer(ISSUER_B);
    profiles.set(ISSUER_A, []);
    profiles.set(ISSUER_B, [profile('profile-a', { expectedIssuer: ISSUER_B })]);

    await cache.invalidate('profile-a');
    await expect(cache.findEnabledByIssuer(ISSUER_A)).resolves.toEqual([]);
    await expect(cache.findEnabledByIssuer(ISSUER_B)).resolves.toEqual([profile('profile-a', { expectedIssuer: ISSUER_B })]);
    expect(repository.findEnabledByIssuer).toHaveBeenCalledTimes(4);
  });

  it('isolates cache instances and rejects TTL values above the hard maximum', async () => {
    const now = { value: 0 };
    const repository = { findEnabledByIssuer: jest.fn(async () => [profile('profile-a')]) };
    const first = createCache(repository, now);
    await first.findEnabledByIssuer(ISSUER_A);
    const second = createCache(repository, now);
    await second.findEnabledByIssuer(ISSUER_A);
    expect(repository.findEnabledByIssuer).toHaveBeenCalledTimes(2);
    expect(() => createCache(repository, now, 60_001)).toThrow();
  });

  it('returns immutable profile snapshots', async () => {
    const now = { value: 0 };
    const cache = createCache({ findEnabledByIssuer: jest.fn(async () => [profile('profile-a')]) }, now);
    const candidates = await cache.findEnabledByIssuer(ISSUER_A);
    expect(Object.isFrozen(candidates)).toBe(true);
    expect(Object.isFrozen(candidates[0])).toBe(true);
  });
});

describeRegistry('Trust-profile cache control-plane integration (T043/T044)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let repository: TrustProfileRepository;
  let cache: ReturnType<typeof createCache>;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('trust-profile-cache');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    repository = new TrustProfileRepository(prisma);
    cache = createCache(repository, { value: 0 });
    await prisma.customer.create({ data: { id: 'customer-a' } });
    await prisma.integrationBinding.create({ data: { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true } });
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('uses lifecycle invalidation to expose disablement and replacement without waiting for TTL', async () => {
    await repository.create(active('profile-v1', 1, ISSUER_A), prisma);
    await repository.create(draft('profile-v2', 2, 'profile-v1', ISSUER_B), prisma);
    await cache.findEnabledByIssuer(ISSUER_A);
    await cache.findEnabledByIssuer(ISSUER_B);
    const lifecycle = lifecycleService(repository, cache, prisma);

    await lifecycle.replace({ predecessorId: 'profile-v1', successorId: 'profile-v2', requestId: 'request-replace' });
    await expect(cache.findEnabledByIssuer(ISSUER_A)).resolves.toEqual([]);
    await expect(cache.findEnabledByIssuer(ISSUER_B)).resolves.toEqual([expect.objectContaining({ id: 'profile-v2', enabled: true, lifecycle: 'active' })]);
    await lifecycle.disable({ profileId: 'profile-v2', requestId: 'request-disable' });
    await expect(cache.findEnabledByIssuer(ISSUER_B)).resolves.toEqual([]);
  });

  it('uses provisioning invalidation for create, issuer update, and disable', async () => {
    const command = provisionCommand(repository, cache, prisma);
    await cache.findEnabledByIssuer(ISSUER_A);
    await cache.findEnabledByIssuer(ISSUER_B);
    await command.execute(provisionInput('create', ISSUER_A));
    await expect(cache.findEnabledByIssuer(ISSUER_A)).resolves.toEqual([expect.objectContaining({ id: 'profile-a', expectedIssuer: ISSUER_A })]);

    await command.execute(provisionInput('update', ISSUER_B));
    await expect(cache.findEnabledByIssuer(ISSUER_A)).resolves.toEqual([]);
    await expect(cache.findEnabledByIssuer(ISSUER_B)).resolves.toEqual([expect.objectContaining({ id: 'profile-a', expectedIssuer: ISSUER_B })]);

    await command.execute(provisionInput('disable', ISSUER_B));
    await expect(cache.findEnabledByIssuer(ISSUER_B)).resolves.toEqual([]);
  });
});

function createCache(repository: { findEnabledByIssuer(issuer: string): Promise<readonly TrustProfileRecord[]> }, now: { value: number }, ttlMilliseconds?: number) {
  if (!existsSync(cachePath)) throw new Error('Required Batch 5D production surface missing: TrustProfileCache.');
  const target = require(cachePath) as { TrustProfileCache?: new (dependencies: unknown) => { findEnabledByIssuer(issuer: string): Promise<readonly TrustProfileRecord[]>; invalidate(profileId: string): Promise<void> } };
  if (!target.TrustProfileCache) throw new Error('Required Batch 5D production surface missing: TrustProfileCache.');
  return new target.TrustProfileCache({ repository, now: () => now.value, ttlMilliseconds });
}

function lifecycleService(repository: TrustProfileRepository, cache: ReturnType<typeof createCache>, prisma: ReturnType<typeof createGatewayPrismaClient>) {
  return new TrustProfileLifecycleService({
    repository,
    validator: validator(repository),
    auditWriter: new GatewayIdentityAuditWriter(prisma),
    invalidation: cache
  });
}

function provisionCommand(repository: TrustProfileRepository, cache: ReturnType<typeof createCache>, prisma: ReturnType<typeof createGatewayPrismaClient>) {
  return new ProvisionTrustProfileCommand({
    repository,
    validator: validator(repository),
    auditWriter: new GatewayIdentityAuditWriter(prisma),
    invalidation: cache
  });
}

function validator(repository: TrustProfileRepository) {
  const target = require('../../src/integration-registry/trust-profile-activation.validator') as typeof import('../../src/integration-registry/trust-profile-activation.validator');
  return new TrustProfileActivationValidator({ repository, jwksSourcePolicy: new target.ProductionJwksSourceRegistrationPolicy() });
}

function provisionInput(action: 'create' | 'update' | 'disable', expectedIssuer: string): ProvisionTrustProfileInput {
  return { action, requestId: `request-${action}`, ...active('profile-a', 1, expectedIssuer) } as ProvisionTrustProfileInput;
}

function active(id: string, version: number, expectedIssuer: string, replacesProfileId: string | null = null): Prisma.RegisteredUpstreamTrustProfileUncheckedCreateInput {
  return { id, integrationId: 'integration-a', expectedIssuer, expectedAudience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks.json', algorithm: 'RS256', enabled: true, lifecycle: 'active', version, replacesProfileId };
}

function draft(id: string, version: number, replacesProfileId: string, expectedIssuer: string): Prisma.RegisteredUpstreamTrustProfileUncheckedCreateInput {
  return { ...active(id, version, expectedIssuer, replacesProfileId), enabled: false, lifecycle: 'draft' };
}

function profile(id: string, overrides: Record<string, unknown> = {}): TrustProfileRecord {
  return { id, integrationId: 'integration-a', expectedIssuer: ISSUER_A, expectedAudience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks.json', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null, ...overrides } as TrustProfileRecord;
}
