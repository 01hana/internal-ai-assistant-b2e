import type { Prisma, PrismaClient } from '../generated/prisma/client';

export type GatewayRegistryTransaction = Pick<Prisma.TransactionClient, 'customer' | 'integrationBinding' | 'gatewayIdentityAuditEvent'>;
export type GatewayRegistryClient = Pick<PrismaClient, 'customer' | 'integrationBinding' | 'gatewayIdentityAuditEvent' | '$transaction'>;

export class IntegrationBindingRepository {
  constructor(private readonly client: GatewayRegistryClient) {}

  findByIntegrationId(integrationId: string) {
    return this.client.integrationBinding.findUnique({ where: { integrationId } });
  }

  transaction<T>(callback: (transaction: GatewayRegistryTransaction) => Promise<T>) {
    return this.client.$transaction((transaction) => callback(transaction));
  }

  auditClient(): Pick<PrismaClient, 'gatewayIdentityAuditEvent'> {
    return this.client;
  }
}
