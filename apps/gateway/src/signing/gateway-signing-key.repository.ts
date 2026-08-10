import type { GatewaySigningKey, Prisma, PrismaClient } from '../generated/prisma/client';

export type ActiveSigningKeyRecord = Pick<GatewaySigningKey, 'kid' | 'publicJwk' | 'keyReference' | 'status'>;
export type JwksVisibleSigningKeyRecord = Pick<GatewaySigningKey, 'kid' | 'publicJwk' | 'status'>;
export type GatewaySigningKeyReadClient = Pick<PrismaClient, 'gatewaySigningKey'>;
export type GatewaySigningKeyTransaction = Pick<Prisma.TransactionClient, 'gatewaySigningKey'>;

/** Phase 5 read-only key metadata boundary. Lifecycle writes stay in Phase 6. */
export class GatewaySigningKeyRepository {
  constructor(private readonly client: GatewaySigningKeyReadClient) {}

  findActive(): Promise<ActiveSigningKeyRecord | null> {
    return this.client.gatewaySigningKey.findFirst({
      where: { status: 'active' },
      select: { kid: true, publicJwk: true, keyReference: true, status: true }
    });
  }

  findJwksVisible(): Promise<JwksVisibleSigningKeyRecord[]> {
    return this.client.gatewaySigningKey.findMany({
      where: { status: { in: ['published', 'active', 'retiring'] } },
      orderBy: { kid: 'asc' },
      select: { kid: true, publicJwk: true, status: true }
    });
  }
}
