import { join } from 'node:path';
import { ProvisionIntegrationBindingCommand, ProvisionIntegrationBindingError, ProvisionIntegrationBindingService } from '../../apps/gateway/src/commands/provision-integration-binding';
import { IntegrationBindingRepository } from '../../apps/gateway/src/integration-registry/integration-binding.repository';
import { createGatewayPrismaClient } from '../../apps/gateway/src/integration-registry/gateway-prisma-client.factory';
import { createGatewayRegistryDatabase } from '../support/gateway-registry-db.helper';

const commandTarget = join(process.cwd(), 'apps', 'gateway', 'src', 'commands', 'provision-integration-binding');

describe('Gateway controlled IntegrationBinding provisioning contract (T019)', () => {
  it('provides an internal command surface rather than a public controller', () => {
    const target = require(commandTarget) as { ProvisionIntegrationBindingCommand?: unknown; ProvisionIntegrationBindingService?: unknown };
    expect(target.ProvisionIntegrationBindingCommand).toEqual(expect.any(Function));
    expect(target.ProvisionIntegrationBindingService).toEqual(expect.any(Function));
  });

  it('requires an existing Customer, is idempotent, permits state changes, and never rebinds', async () => {
    if (process.env.RUN_GATEWAY_REGISTRY_DB_TESTS !== 'true') return;
    const database = await createGatewayRegistryDatabase('provisioning');
    const prisma = createGatewayPrismaClient(database.databaseUrl);
    const command = new ProvisionIntegrationBindingCommand(new ProvisionIntegrationBindingService(new IntegrationBindingRepository(prisma)));
    try {
      await prisma.customer.create({ data: { id: 'customer-a' } });
      await prisma.customer.create({ data: { id: 'customer-b' } });
      await expect(command.execute({ customerId: 'unknown-customer', integrationId: 'integration-a', allowedHostApp: 'admin', enabled: true, requestId: 'request-unknown' }))
        .rejects.toBeInstanceOf(ProvisionIntegrationBindingError);
      expect(await prisma.customer.count()).toBe(2);

      await expect(command.execute({ customerId: 'customer-a', integrationId: 'integration-a', allowedHostApp: 'admin', enabled: true, requestId: 'request-create' }))
        .resolves.toMatchObject({ changed: true, customerId: 'customer-a', integrationId: 'integration-a', enabled: true });
      await expect(command.execute({ customerId: 'customer-a', integrationId: 'integration-a', allowedHostApp: 'admin', enabled: true, requestId: 'request-replay' }))
        .resolves.toMatchObject({ changed: false });
      await expect(command.execute({ customerId: 'customer-a', integrationId: 'integration-a', allowedHostApp: 'admin', enabled: false, requestId: 'request-disable' }))
        .resolves.toMatchObject({ changed: true, enabled: false });
      await expect(command.execute({ customerId: 'customer-a', integrationId: 'integration-a', allowedHostApp: 'admin', enabled: true, requestId: 'request-enable' }))
        .resolves.toMatchObject({ changed: true, enabled: true });
      await expect(command.execute({ customerId: 'customer-b', integrationId: 'integration-a', allowedHostApp: 'admin', enabled: true, requestId: 'request-conflict-customer' }))
        .rejects.toHaveProperty('message', 'Integration binding provisioning cannot be completed.');
      await expect(command.execute({ customerId: 'customer-a', integrationId: 'integration-a', allowedHostApp: 'other', enabled: true, requestId: 'request-conflict-host' }))
        .rejects.toHaveProperty('message', 'Integration binding provisioning cannot be completed.');
      await expect(prisma.integrationBinding.findUnique({ where: { integrationId: 'integration-a' } })).resolves.toMatchObject({ customerId: 'customer-a', allowedHostApp: 'admin', enabled: true });
      expect(await prisma.gatewayIdentityAuditEvent.count()).toBeGreaterThanOrEqual(5);
    } finally {
      await prisma.$disconnect();
      await database.dispose();
    }
  });
});
