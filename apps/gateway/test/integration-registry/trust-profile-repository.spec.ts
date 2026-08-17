import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeRegistry('Trust-profile repository persistence (T005)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let repository: TrustProfileRepository;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('trust-profile-repository');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    repository = new TrustProfileRepository(prisma);
    await prisma.customer.createMany({ data: [{ id: 'customer-a' }, { id: 'customer-b' }] });
    await prisma.integrationBinding.createMany({ data: [
      { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true },
      { integrationId: 'integration-b', customerId: 'customer-b', allowedHostApp: 'admin', enabled: true }
    ] });
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('creates, reads, updates, disables, and preserves valid shared IdP policy', async () => {
    await repository.create(profile('profile-a', 'integration-a', 1), prisma);
    await repository.create(profile('profile-b', 'integration-b', 1), prisma);

    await expect(repository.findById('profile-a')).resolves.toMatchObject({ id: 'profile-a', integrationId: 'integration-a', enabled: true });
    await expect(repository.findByIntegrationId('integration-b')).resolves.toEqual([expect.objectContaining({ id: 'profile-b' })]);
    await expect(repository.findEnabledByIssuer('https://issuer.example.test')).resolves.toHaveLength(2);

    await repository.update('profile-a', { expectedAudience: 'gateway-audience-updated' }, prisma);
    await expect(repository.findById('profile-a')).resolves.toMatchObject({ expectedAudience: 'gateway-audience-updated' });
    await repository.disable('profile-a', prisma);
    await expect(repository.findEnabledByIssuer('https://issuer.example.test')).resolves.toEqual([expect.objectContaining({ id: 'profile-b' })]);
    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it('does not permit a generic update to change the immutable integration anchor', async () => {
    await repository.create(profile('profile-a', 'integration-a', 1), prisma);
    await repository.update('profile-a', { integrationId: 'integration-b' } as never, prisma);
    await expect(repository.findById('profile-a')).resolves.toMatchObject({ integrationId: 'integration-a' });
  });

  it('finds exact active-policy duplicates without rejecting shared policy across integrations', async () => {
    await repository.create(profile('profile-a', 'integration-a', 1), prisma);
    await repository.create(profile('profile-b', 'integration-b', 1), prisma);

    await expect(repository.findEnabledExactPolicy({ ...profile('profile-c', 'integration-a', 2) })).resolves.toEqual([expect.objectContaining({ id: 'profile-a' })]);
    await expect(repository.findEnabledExactPolicy({ ...profile('profile-c', 'integration-b', 2) })).resolves.toEqual([expect.objectContaining({ id: 'profile-b' })]);
  });

  it('returns only enabled active profiles through the real candidate-resolver and repository composition', async () => {
    await repository.create(profile('profile-a', 'integration-a', 1), prisma);
    await repository.create(profile('profile-b', 'integration-b', 1), prisma);
    await repository.create({ ...profile('profile-disabled', 'integration-a', 2), enabled: false, lifecycle: 'disabled' }, prisma);
    const resolver = new CandidateTrustProfileResolver(repository);

    await expect(resolver.resolve({ issuerHint: 'https://issuer.example.test' })).resolves.toEqual([
      expect.objectContaining({ id: 'profile-a', enabled: true, lifecycle: 'active' }),
      expect.objectContaining({ id: 'profile-b', enabled: true, lifecycle: 'active' })
    ]);
    await expect(resolver.resolve({ issuerHint: 'https://issuer.example.test' })).resolves.not.toContainEqual(expect.objectContaining({ id: 'profile-disabled' }));
  });
});

function profile(id: string, integrationId: string, version: number) {
  return { id, integrationId, expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks.json', algorithm: 'RS256' as const, enabled: true, lifecycle: 'active' as const, version, replacesProfileId: null };
}
