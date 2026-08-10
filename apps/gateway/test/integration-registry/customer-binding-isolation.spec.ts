import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { createVerifiedUpstreamIdentity } from '../../src/upstream-auth/verified-upstream-identity';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';
import { GATEWAY_IDENTITY_FIXTURES } from '../../../../test/support/gateway-identity-fixtures';
import { GATEWAY_INTEGRATION_BINDING_SEEDS } from '../../../../scripts/gateway-identity-fixtures';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('Customer A/B IntegrationBinding isolation (T037)', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('canonical-binding-isolation');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    await prisma.customer.createMany({ data: [{ id: 'customer-a' }, { id: 'customer-b' }] });
    await prisma.integrationBinding.createMany({ data: [...GATEWAY_INTEGRATION_BINDING_SEEDS] });
  });

  afterEach(async () => {
    if (prisma) await prisma.$disconnect();
    if (database) await database.dispose();
  });

  it('maps A and B to distinct Customers despite identical lower-level identity attributes', async () => {
    const resolver = createResolver(prisma);

    const customerA = await resolver.resolve({
      identity: verifiedIdentity(GATEWAY_IDENTITY_FIXTURES.customerA.integrationId),
      requestId: 'request-a',
      customerId: 'customer-b',
      requestedCustomerId: 'customer-b',
      headers: { 'x-customer-id': 'customer-b' },
      body: { customer_id: 'customer-b' },
      metadata: { customer_id: 'customer-b' }
    } as never);
    const customerB = await resolver.resolve({ identity: verifiedIdentity(GATEWAY_IDENTITY_FIXTURES.customerB.integrationId), requestId: 'request-b' });

    expect(customerA).toMatchObject({ customerId: 'customer-a', integrationId: 'integration-a' });
    expect(customerB).toMatchObject({ customerId: 'customer-b', integrationId: 'integration-b' });
    expect(customerA).toMatchObject(lowerIdentity());
    expect(customerB).toMatchObject(lowerIdentity());
  });

  it('denies disabled A without falling back to enabled B and persists no Customer on the denial audit', async () => {
    await prisma.integrationBinding.update({ where: { integrationId: 'integration-a' }, data: { enabled: false } });
    const resolver = createResolver(prisma);

    await expect(resolver.resolve({ identity: verifiedIdentity('integration-a'), requestId: 'request-disabled-a' })).rejects.toMatchObject({
      status: 403,
      code: 'IDENTITY_ISSUANCE_DENIED',
      message: 'Identity issuance cannot be completed.'
    });
    await expect(resolver.resolve({ identity: verifiedIdentity('integration-b'), requestId: 'request-b-still-enabled' })).resolves.toMatchObject({ customerId: 'customer-b' });

    const deniedAudit = await prisma.gatewayIdentityAuditEvent.findFirst({ where: { requestId: 'request-disabled-a' } });
    expect(deniedAudit).toMatchObject({
      customerId: null,
      integrationId: 'integration-a',
      actorId: 'actor-shared',
      hostApp: 'admin',
      eventType: 'identity_resolution_denied',
      outcome: 'denied',
      reasonCode: 'identity_issuance_denied'
    });
  });
});

function createResolver(prisma: ReturnType<typeof createGatewayPrismaClient>) {
  const resolverPath = resolve(__dirname, '../../src/integration-registry/canonical-identity-resolver.service.ts');
  if (!existsSync(resolverPath)) throw new Error('Expected Phase 4 CanonicalIdentityResolver production surface.');
  const target = require('../../src/integration-registry/canonical-identity-resolver.service') as {
    CanonicalIdentityResolver?: new (repository: unknown, telemetry: unknown) => { resolve(input: unknown): Promise<any> };
  };
  if (!target.CanonicalIdentityResolver) throw new Error('Expected Phase 4 CanonicalIdentityResolver production surface.');
  const { GatewayIdentityAuditWriter } = require('../../src/audit/gateway-identity-audit.writer') as {
    GatewayIdentityAuditWriter?: new (client: unknown) => unknown;
  };
  return new target.CanonicalIdentityResolver(new IntegrationBindingRepository(prisma), new (GatewayIdentityAuditWriter as new (client: unknown) => unknown)(prisma));
}

function verifiedIdentity(integrationId: string) {
  const shared = GATEWAY_IDENTITY_FIXTURES.shared;
  return createVerifiedUpstreamIdentity({
    integration_id: integrationId,
    sub: shared.actorId,
    org_id: shared.organizationId,
    host_app: shared.hostApp,
    roles: [...shared.roles],
    permission_scopes: [...shared.permissionScopes]
  });
}

function lowerIdentity() {
  const shared = GATEWAY_IDENTITY_FIXTURES.shared;
  return {
    subject: shared.actorId,
    organizationId: shared.organizationId,
    hostApp: shared.hostApp,
    roles: [...shared.roles],
    permissionScopes: [...shared.permissionScopes]
  };
}
