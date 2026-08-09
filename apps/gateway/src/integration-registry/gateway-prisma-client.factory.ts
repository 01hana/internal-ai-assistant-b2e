import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Feature 003's only Prisma entry point. It deliberately uses the Gateway
 * generated client, not Backend's PrismaService or generated client.
 */
export function createGatewayPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
}
