import { resetConfiguredTestDatabaseSchema, runTestDatabaseInitialization } from '../support/customer-migration-db.helper';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { seedCoreData } from '../../scripts/seed';
import { GATEWAY_IDENTITY_FIXTURES } from '../support/gateway-identity-fixtures';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('Gateway deterministic A/B IntegrationBinding seed contract (T020/T025)', () => {
  it('rebuilds the exact A/B bindings without inference or duplicates across same-state and clean-reset reruns', async () => {
    await resetConfiguredTestDatabaseSchema();
    await runTestDatabaseInitialization();
    const first = await snapshot();

    await seedWithoutReset();
    const sameState = await snapshot();
    expect(sameState).toEqual(first);

    await resetConfiguredTestDatabaseSchema();
    await runTestDatabaseInitialization();
    const resetSeed = await snapshot();

    expect(resetSeed).toEqual(first);
    expect(first).toEqual([
      { customerId: GATEWAY_IDENTITY_FIXTURES.customerA.customerId, integrationId: GATEWAY_IDENTITY_FIXTURES.customerA.integrationId, allowedHostApp: 'admin', enabled: true },
      { customerId: GATEWAY_IDENTITY_FIXTURES.customerB.customerId, integrationId: GATEWAY_IDENTITY_FIXTURES.customerB.integrationId, allowedHostApp: 'admin', enabled: true }
    ]);
  }, 30_000);

  it('rejects conflicting explicit bindings without rebind or Customer inference', async () => {
    await resetConfiguredTestDatabaseSchema();
    await runTestDatabaseInitialization();
    const databaseUrl = requireDatabaseUrl();
    const prisma = createPrismaClient(databaseUrl);
    try {
      await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { customerId: 'customer-b' } });

      await expect(seedCoreData(prisma)).rejects.toThrow('Seed IntegrationBinding mapping conflicts with an existing explicit binding.');

      await expect(prisma.integrationBinding.findUnique({ where: { integrationId: 'integration-a' } })).resolves.toMatchObject({
        customerId: 'customer-b', allowedHostApp: 'admin', enabled: true
      });
      await expect(prisma.integrationBinding.count()).resolves.toBe(2);
      await expect(prisma.customer.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: 'customer-a' }, { id: 'customer-b' }
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('rejects a conflicting HostApp without changing the explicit Customer mapping or creating roots', async () => {
    await resetConfiguredTestDatabaseSchema();
    await runTestDatabaseInitialization();
    const prisma = createPrismaClient(requireDatabaseUrl());
    try {
      await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { allowedHostApp: 'seed-hostapp-conflict' } });

      await expect(seedCoreData(prisma)).rejects.toThrow('Seed IntegrationBinding mapping conflicts with an existing explicit binding.');

      await expect(prisma.integrationBinding.findUnique({ where: { integrationId: 'integration-a' } })).resolves.toMatchObject({
        customerId: 'customer-a', allowedHostApp: 'seed-hostapp-conflict', enabled: true
      });
      await expect(prisma.integrationBinding.count()).resolves.toBe(2);
      await expect(prisma.customer.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).resolves.toEqual([
        { id: 'customer-a' }, { id: 'customer-b' }
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function seedWithoutReset() {
  const prisma = createPrismaClient(requireDatabaseUrl());
  try {
    await seedCoreData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function snapshot() {
  const prisma = createPrismaClient(requireDatabaseUrl());
  try {
    const customers = await prisma.customer.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    expect(customers.map((customer) => customer.id)).toEqual(['customer-a', 'customer-b']);
    return prisma.integrationBinding.findMany({
      select: { customerId: true, integrationId: true, allowedHostApp: true, enabled: true },
      orderBy: { integrationId: 'asc' }
    });
  } finally {
    await prisma.$disconnect();
  }
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for Gateway seed contract.');
  return databaseUrl;
}
