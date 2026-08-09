import { resetConfiguredTestDatabaseSchema, runTestDatabaseInitialization } from '../support/customer-migration-db.helper';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { GATEWAY_IDENTITY_FIXTURES } from '../support/gateway-identity-fixtures';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('Gateway deterministic A/B IntegrationBinding seed contract (T020/T025)', () => {
  it('rebuilds the exact A/B bindings without inference or duplicates', async () => {
    await resetConfiguredTestDatabaseSchema();
    await runTestDatabaseInitialization();
    const first = await snapshot();
    await runTestDatabaseInitialization();
    const second = await snapshot();

    expect(second).toEqual(first);
    expect(first).toEqual([
      { customerId: GATEWAY_IDENTITY_FIXTURES.customerA.customerId, integrationId: GATEWAY_IDENTITY_FIXTURES.customerA.integrationId, allowedHostApp: 'admin', enabled: true },
      { customerId: GATEWAY_IDENTITY_FIXTURES.customerB.customerId, integrationId: GATEWAY_IDENTITY_FIXTURES.customerB.integrationId, allowedHostApp: 'admin', enabled: true }
    ]);
  });
});

async function snapshot() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for Gateway seed contract.');
  const prisma = createPrismaClient(databaseUrl);
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
