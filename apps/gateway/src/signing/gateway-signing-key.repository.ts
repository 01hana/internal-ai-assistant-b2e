import type { GatewaySigningKey, Prisma, PrismaClient } from '../generated/prisma/client';

export type ActiveSigningKeyRecord = Pick<GatewaySigningKey, 'kid' | 'publicJwk' | 'keyReference' | 'status'>;
export type JwksVisibleSigningKeyRecord = Pick<GatewaySigningKey, 'kid' | 'publicJwk' | 'status'>;
export type GatewaySigningKeyRecord = Pick<GatewaySigningKey, 'kid' | 'publicJwk' | 'keyReference' | 'status' | 'notBefore' | 'activatedAt' | 'retireAfter' | 'retiredAt'>;
export type GatewaySigningKeyTransaction = Pick<Prisma.TransactionClient, 'gatewaySigningKey' | 'gatewayIdentityAuditEvent'>;
export type GatewaySigningKeyClient = Pick<PrismaClient, 'gatewaySigningKey' | 'gatewayIdentityAuditEvent' | '$transaction'>;
type GatewaySigningKeyDelegateClient = Pick<GatewaySigningKeyClient, 'gatewaySigningKey'> | Pick<GatewaySigningKeyTransaction, 'gatewaySigningKey'>;

/** Gateway-owned signing-key metadata boundary. No private key material is persisted. */
export class GatewaySigningKeyRepository {
  constructor(private readonly client: GatewaySigningKeyClient) {}

  findActive(client: GatewaySigningKeyDelegateClient = this.client): Promise<ActiveSigningKeyRecord | null> {
    return client.gatewaySigningKey.findFirst({
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

  findByKid(kid: string, client: GatewaySigningKeyDelegateClient = this.client): Promise<GatewaySigningKeyRecord | null> {
    return client.gatewaySigningKey.findUnique({
      where: { kid },
      select: { kid: true, publicJwk: true, keyReference: true, status: true, notBefore: true, activatedAt: true, retireAfter: true, retiredAt: true }
    });
  }

  transaction<T>(callback: (transaction: GatewaySigningKeyTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction((transaction) => callback(transaction));
  }

  create(data: Prisma.GatewaySigningKeyCreateInput, client: GatewaySigningKeyDelegateClient): Promise<GatewaySigningKeyRecord> {
    return client.gatewaySigningKey.create({
      data,
      select: { kid: true, publicJwk: true, keyReference: true, status: true, notBefore: true, activatedAt: true, retireAfter: true, retiredAt: true }
    });
  }

  update(kid: string, data: Prisma.GatewaySigningKeyUpdateInput, client: GatewaySigningKeyDelegateClient): Promise<GatewaySigningKeyRecord> {
    return client.gatewaySigningKey.update({
      where: { kid },
      data,
      select: { kid: true, publicJwk: true, keyReference: true, status: true, notBefore: true, activatedAt: true, retireAfter: true, retiredAt: true }
    });
  }
}
