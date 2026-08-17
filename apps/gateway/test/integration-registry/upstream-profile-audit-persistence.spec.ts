import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { UpstreamAuthTelemetry } from '../../src/upstream-auth/upstream-auth-telemetry';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('Upstream profile-verification audit persistence (T047–T049)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('upstream-profile-audit');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    await prisma.customer.create({ data: { id: 'customer-a' } });
    await prisma.integrationBinding.create({ data: { integrationId: 'integration-a', customerId: 'customer-a', allowedHostApp: 'admin', enabled: true } });
    await prisma.registeredUpstreamTrustProfile.createMany({ data: [
      profile('profile-a', 1), profile('profile-b', 2)
    ] });
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('distinguishes ambiguous profiles on the same integration without persisting Customer authority', async () => {
    const telemetry = new UpstreamAuthTelemetry(new GatewayIdentityAuditWriter(prisma));
    await telemetry.record({ requestId: 'request-ambiguous', outcome: 'denied', reasonCode: 'ambiguous_profile_decision', profileId: 'profile-a', integrationId: 'integration-a' });
    await telemetry.record({ requestId: 'request-ambiguous', outcome: 'denied', reasonCode: 'ambiguous_profile_decision', profileId: 'profile-b', integrationId: 'integration-a' });

    const rows = await prisma.gatewayIdentityAuditEvent.findMany({ where: { requestId: 'request-ambiguous' }, orderBy: { profileId: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.profileId)).toEqual(['profile-a', 'profile-b']);
    expect(rows.map((row) => row.integrationId)).toEqual(['integration-a', 'integration-a']);
    expect(rows.every((row) => row.customerId === null)).toBe(true);
  });
});

function profile(id: string, version: number) {
  return {
    id, integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-audience',
    jwksUri: 'https://issuer.example.test/jwks.json', algorithm: 'RS256' as const, enabled: true, lifecycle: 'active' as const,
    version, replacesProfileId: null
  };
}
