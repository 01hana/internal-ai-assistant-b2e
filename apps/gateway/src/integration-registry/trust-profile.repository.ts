import type { Prisma, PrismaClient, RegisteredUpstreamTrustProfile } from '../generated/prisma/client';

export type TrustProfileRecord = Pick<RegisteredUpstreamTrustProfile, 'id' | 'integrationId' | 'expectedIssuer' | 'expectedAudience' | 'jwksUri' | 'algorithm' | 'enabled' | 'lifecycle' | 'version' | 'replacesProfileId'>;
export type TrustProfileMutablePolicyUpdate = Readonly<Partial<Pick<TrustProfileRecord, 'expectedIssuer' | 'expectedAudience' | 'jwksUri' | 'algorithm' | 'enabled' | 'lifecycle' | 'version' | 'replacesProfileId'>>>;
export type TrustProfileBindingRecord = Readonly<{ integrationId: string; enabled: boolean; allowedHostApp: string }>;
export type TrustProfileTransaction = Pick<Prisma.TransactionClient, 'registeredUpstreamTrustProfile' | 'integrationBinding'>;
export type TrustProfileClient = Pick<PrismaClient, 'registeredUpstreamTrustProfile' | 'integrationBinding' | '$transaction'>;
type TrustProfileDelegateClient = Pick<TrustProfileClient, 'registeredUpstreamTrustProfile'> | Pick<TrustProfileTransaction, 'registeredUpstreamTrustProfile'>;

const select = {
  id: true, integrationId: true, expectedIssuer: true, expectedAudience: true, jwksUri: true,
  algorithm: true, enabled: true, lifecycle: true, version: true, replacesProfileId: true
} as const;

/** Persistence boundary for upstream verification policy only; never Customer or HostApp authority. */
export class TrustProfileRepository {
  constructor(private readonly client: TrustProfileClient) {}

  findById(id: string, client: TrustProfileDelegateClient = this.client): Promise<TrustProfileRecord | null> {
    return client.registeredUpstreamTrustProfile.findUnique({ where: { id }, select });
  }

  findByIntegrationId(integrationId: string): Promise<TrustProfileRecord[]> {
    return this.client.registeredUpstreamTrustProfile.findMany({ where: { integrationId }, orderBy: { version: 'asc' }, select });
  }

  findEnabledByIssuer(expectedIssuer: string): Promise<TrustProfileRecord[]> {
    return this.client.registeredUpstreamTrustProfile.findMany({ where: { expectedIssuer, enabled: true, lifecycle: 'active' }, orderBy: { id: 'asc' }, select });
  }

  findEnabledExactPolicy(input: Pick<TrustProfileRecord, 'id' | 'integrationId' | 'expectedIssuer' | 'expectedAudience' | 'jwksUri' | 'algorithm'>): Promise<TrustProfileRecord[]> {
    return this.client.registeredUpstreamTrustProfile.findMany({
      where: {
        id: { not: input.id }, integrationId: input.integrationId, expectedIssuer: input.expectedIssuer,
        expectedAudience: input.expectedAudience, jwksUri: input.jwksUri, algorithm: input.algorithm,
        enabled: true, lifecycle: 'active'
      },
      select
    });
  }

  findBindingByIntegrationId(integrationId: string, client: Pick<TrustProfileClient, 'integrationBinding'> | Pick<TrustProfileTransaction, 'integrationBinding'> = this.client): Promise<TrustProfileBindingRecord | null> {
    return client.integrationBinding.findUnique({ where: { integrationId }, select: { integrationId: true, enabled: true, allowedHostApp: true } });
  }

  transaction<T>(callback: (transaction: TrustProfileTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction((transaction) => callback(transaction));
  }

  create(data: Prisma.RegisteredUpstreamTrustProfileUncheckedCreateInput, client: TrustProfileDelegateClient): Promise<TrustProfileRecord> {
    return client.registeredUpstreamTrustProfile.create({ data, select });
  }

  update(id: string, data: TrustProfileMutablePolicyUpdate, client: TrustProfileDelegateClient): Promise<TrustProfileRecord> {
    const update: Prisma.RegisteredUpstreamTrustProfileUncheckedUpdateInput = {};
    if (data.expectedIssuer !== undefined) update.expectedIssuer = data.expectedIssuer;
    if (data.expectedAudience !== undefined) update.expectedAudience = data.expectedAudience;
    if (data.jwksUri !== undefined) update.jwksUri = data.jwksUri;
    if (data.algorithm !== undefined) update.algorithm = data.algorithm;
    if (data.enabled !== undefined) update.enabled = data.enabled;
    if (data.lifecycle !== undefined) update.lifecycle = data.lifecycle;
    if (data.version !== undefined) update.version = data.version;
    if (data.replacesProfileId !== undefined) update.replacesProfileId = data.replacesProfileId;
    return client.registeredUpstreamTrustProfile.update({ where: { id }, data: update, select });
  }

  disable(id: string, client: TrustProfileDelegateClient): Promise<TrustProfileRecord> {
    return this.update(id, { enabled: false, lifecycle: 'disabled' }, client);
  }
}
