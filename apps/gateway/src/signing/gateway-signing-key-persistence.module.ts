import { Module, OnApplicationShutdown } from '@nestjs/common';
import type { PrismaClient } from '../generated/prisma/client';
import { createGatewayPrismaClient } from '../integration-registry/gateway-prisma-client.factory';
import { IdentityServiceUnavailableError } from './identity-service-unavailable.error';
import { GatewaySigningKeyRepository } from './gateway-signing-key.repository';

export const GATEWAY_PRISMA_CLIENT = Symbol('GATEWAY_PRISMA_CLIENT');
export const GATEWAY_SIGNING_KEY_READ_CLIENT = Symbol('GATEWAY_SIGNING_KEY_READ_CLIENT');

class GatewaySigningKeyPrismaLifecycle implements OnApplicationShutdown {
  private client: PrismaClient | undefined;

  getClient(): PrismaClient {
    if (!this.client) {
      const databaseUrl = process.env.DATABASE_URL;
      if (typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
        throw new IdentityServiceUnavailableError();
      }
      this.client = createGatewayPrismaClient(databaseUrl);
    }
    return this.client;
  }

  async onApplicationShutdown() {
    await this.client?.$disconnect();
  }
}

@Module({
  providers: [
    GatewaySigningKeyPrismaLifecycle,
    {
      provide: GATEWAY_SIGNING_KEY_READ_CLIENT,
      inject: [GatewaySigningKeyPrismaLifecycle],
      useFactory: (lifecycle: GatewaySigningKeyPrismaLifecycle) => lifecycle.getClient()
    },
    {
      provide: GATEWAY_PRISMA_CLIENT,
      useExisting: GATEWAY_SIGNING_KEY_READ_CLIENT
    },
    {
      provide: GatewaySigningKeyRepository,
      inject: [GATEWAY_SIGNING_KEY_READ_CLIENT],
      useFactory: (client: PrismaClient) => new GatewaySigningKeyRepository(client)
    }
  ],
  exports: [GatewaySigningKeyRepository, GATEWAY_PRISMA_CLIENT, GATEWAY_SIGNING_KEY_READ_CLIENT]
})
export class GatewaySigningKeyPersistenceModule {}
