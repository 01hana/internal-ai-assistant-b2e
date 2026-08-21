import type {
  ManagedExchangeAuditEvent, ManagedIdentityProviderInstance, ManagedIntegrationAdmissionPolicy,
  ManagedIntegrationExchangeConfig, ManagedPermissionPolicy, ManagedPermissionSourceInstance,
  ManagedUpstreamIssuer, ManagedUpstreamSigningKey, ManagedSigningKeyStatus, ManagedExchangeLifecycle, Prisma, PrismaClient
} from '../../generated/prisma/client';

export type ManagedExchangeTransaction = Pick<Prisma.TransactionClient,
  'managedIdentityProviderInstance' | 'managedIntegrationExchangeConfig' | 'managedIntegrationAdmissionPolicy' |
  'managedPermissionSourceInstance' | 'managedPermissionPolicy' | 'managedUpstreamIssuer' |
  'managedUpstreamSigningKey' | 'managedExchangeAuditEvent'>;

export type ManagedExchangeClient = Pick<PrismaClient,
  'managedIdentityProviderInstance' | 'managedIntegrationExchangeConfig' | 'managedIntegrationAdmissionPolicy' |
  'managedPermissionSourceInstance' | 'managedPermissionPolicy' | 'managedUpstreamIssuer' |
  'managedUpstreamSigningKey' | 'managedExchangeAuditEvent' | '$transaction'>;

type ClientOrTransaction = ManagedExchangeClient | ManagedExchangeTransaction;
type Delegate<C extends keyof ManagedExchangeTransaction> = Pick<ManagedExchangeClient, C> | Pick<ManagedExchangeTransaction, C>;

export type ManagedIdentityProviderInstanceRecord = Pick<ManagedIdentityProviderInstance,
  'id' | 'providerType' | 'endpointUri' | 'httpMethod' | 'credentialPlacement' | 'timeoutMilliseconds' |
  'responseContractVersion' | 'contractConfig' | 'declaredAnchorKinds' | 'enabled' | 'lifecycle' | 'version' | 'replacesProviderId'>;
export type ManagedIntegrationExchangeConfigRecord = Pick<ManagedIntegrationExchangeConfig,
  'id' | 'publicSelector' | 'integrationId' | 'providerInstanceId' | 'canonicalHostApp' | 'organizationMode' |
  'fixedOrganizationId' | 'enabled' | 'lifecycle' | 'version' | 'replacesConfigId'>;
export type ManagedIntegrationAdmissionPolicyRecord = Pick<ManagedIntegrationAdmissionPolicy,
  'id' | 'integrationConfigId' | 'anchorRequirements' | 'enabled' | 'lifecycle' | 'version' | 'replacesPolicyId'>;
export type ManagedPermissionSourceInstanceRecord = Pick<ManagedPermissionSourceInstance,
  'id' | 'sourceType' | 'endpointUri' | 'providerInstanceId' | 'serviceCredentialReference' |
  'adapterContractReference' | 'contractConfig' | 'enabled' | 'lifecycle' | 'version' | 'replacesSourceId'>;
export type ManagedPermissionPolicyRecord = Pick<ManagedPermissionPolicy,
  'id' | 'integrationConfigId' | 'mode' | 'permissionSourceInstanceId' | 'normalizerType' |
  'projectionContractVersion' | 'projectionContract' | 'enabled' | 'lifecycle' | 'version' | 'replacesPolicyId'>;
export type ManagedUpstreamIssuerRecord = Pick<ManagedUpstreamIssuer,
  'id' | 'issuer' | 'expectedAudience' | 'publicJwksUri' | 'enabled' | 'lifecycle' | 'version' | 'replacesIssuerId'>;
export type ManagedUpstreamSigningKeyRecord = Pick<ManagedUpstreamSigningKey,
  'id' | 'issuerId' | 'kid' | 'publicJwk' | 'keyReference' | 'status' | 'enabled' | 'lifecycle' |
  'version' | 'replacesKeyId' | 'notBefore' | 'activatedAt' | 'retireAfter' | 'retiredAt'>;
export type ManagedExchangeAuditRecord = Pick<ManagedExchangeAuditEvent,
  'id' | 'timestamp' | 'requestId' | 'integrationId' | 'integrationConfigId' | 'providerType' |
  'providerInstanceId' | 'outcome' | 'reasonCode' | 'admissionResult' | 'permissionResult' |
  'issuanceResult' | 'jti' | 'kid' | 'latencyCategory'>;

const providerSelect = select<ManagedIdentityProviderInstanceRecord>('id', 'providerType', 'endpointUri', 'httpMethod', 'credentialPlacement', 'timeoutMilliseconds', 'responseContractVersion', 'contractConfig', 'declaredAnchorKinds', 'enabled', 'lifecycle', 'version', 'replacesProviderId');
const configSelect = select<ManagedIntegrationExchangeConfigRecord>('id', 'publicSelector', 'integrationId', 'providerInstanceId', 'canonicalHostApp', 'organizationMode', 'fixedOrganizationId', 'enabled', 'lifecycle', 'version', 'replacesConfigId');
const admissionSelect = select<ManagedIntegrationAdmissionPolicyRecord>('id', 'integrationConfigId', 'anchorRequirements', 'enabled', 'lifecycle', 'version', 'replacesPolicyId');
const sourceSelect = select<ManagedPermissionSourceInstanceRecord>('id', 'sourceType', 'endpointUri', 'providerInstanceId', 'serviceCredentialReference', 'adapterContractReference', 'contractConfig', 'enabled', 'lifecycle', 'version', 'replacesSourceId');
const permissionSelect = select<ManagedPermissionPolicyRecord>('id', 'integrationConfigId', 'mode', 'permissionSourceInstanceId', 'normalizerType', 'projectionContractVersion', 'projectionContract', 'enabled', 'lifecycle', 'version', 'replacesPolicyId');
const issuerSelect = select<ManagedUpstreamIssuerRecord>('id', 'issuer', 'expectedAudience', 'publicJwksUri', 'enabled', 'lifecycle', 'version', 'replacesIssuerId');
const keySelect = select<ManagedUpstreamSigningKeyRecord>('id', 'issuerId', 'kid', 'publicJwk', 'keyReference', 'status', 'enabled', 'lifecycle', 'version', 'replacesKeyId', 'notBefore', 'activatedAt', 'retireAfter', 'retiredAt');
const auditSelect = select<ManagedExchangeAuditRecord>('id', 'timestamp', 'requestId', 'integrationId', 'integrationConfigId', 'providerType', 'providerInstanceId', 'outcome', 'reasonCode', 'admissionResult', 'permissionResult', 'issuanceResult', 'jti', 'kid', 'latencyCategory');

/** Persistence boundary for server-owned provider configuration only. */
export class ManagedIdentityProviderInstanceRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  findById(id: string, client: Delegate<'managedIdentityProviderInstance'> = this.client): Promise<ManagedIdentityProviderInstanceRecord | null> {
    return client.managedIdentityProviderInstance.findUnique({ where: { id }, select: providerSelect });
  }
  findEnabledActiveById(id: string): Promise<ManagedIdentityProviderInstanceRecord | null> {
    return this.client.managedIdentityProviderInstance.findFirst({ where: { id, enabled: true, lifecycle: 'active' }, select: providerSelect });
  }
}

/** Selector lookup only: no decoding, fallback, Customer lookup, or HostApp admission. */
export class ManagedIntegrationExchangeConfigRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  findById(id: string, client: Delegate<'managedIntegrationExchangeConfig'> = this.client): Promise<ManagedIntegrationExchangeConfigRecord | null> {
    return client.managedIntegrationExchangeConfig.findUnique({ where: { id }, select: configSelect });
  }
  findEnabledActiveByPublicSelector(publicSelector: string): Promise<ManagedIntegrationExchangeConfigRecord | null> {
    return this.client.managedIntegrationExchangeConfig.findFirst({
      where: { publicSelector, enabled: true, lifecycle: 'active' }, select: configSelect
    });
  }
  findByIntegrationId(integrationId: string): Promise<ManagedIntegrationExchangeConfigRecord[]> {
    return this.client.managedIntegrationExchangeConfig.findMany({ where: { integrationId }, orderBy: { version: 'asc' }, select: configSelect });
  }
  findEnabledActiveByIntegrationId(integrationId: string): Promise<ManagedIntegrationExchangeConfigRecord[]> {
    return this.client.managedIntegrationExchangeConfig.findMany({ where: { integrationId, enabled: true, lifecycle: 'active' }, select: configSelect });
  }
  transaction<T>(callback: (transaction: ManagedExchangeTransaction) => Promise<T>): Promise<T> {
    return this.client.$transaction((transaction) => callback(transaction));
  }
}

export class ManagedIntegrationAdmissionPolicyRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  findEnabledActiveByConfigId(integrationConfigId: string): Promise<ManagedIntegrationAdmissionPolicyRecord[]> {
    return this.client.managedIntegrationAdmissionPolicy.findMany({ where: { integrationConfigId, enabled: true, lifecycle: 'active' }, select: admissionSelect });
  }
  findByConfigId(integrationConfigId: string): Promise<ManagedIntegrationAdmissionPolicyRecord[]> {
    return this.client.managedIntegrationAdmissionPolicy.findMany({ where: { integrationConfigId }, orderBy: { version: 'asc' }, select: admissionSelect });
  }
}

export class ManagedPermissionSourceInstanceRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  findEnabledActiveById(id: string): Promise<ManagedPermissionSourceInstanceRecord | null> {
    return this.client.managedPermissionSourceInstance.findFirst({ where: { id, enabled: true, lifecycle: 'active' }, select: sourceSelect });
  }
}

export class ManagedPermissionPolicyRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  findEnabledActiveByConfigId(integrationConfigId: string): Promise<ManagedPermissionPolicyRecord[]> {
    return this.client.managedPermissionPolicy.findMany({ where: { integrationConfigId, enabled: true, lifecycle: 'active' }, select: permissionSelect });
  }
  findByConfigId(integrationConfigId: string): Promise<ManagedPermissionPolicyRecord[]> {
    return this.client.managedPermissionPolicy.findMany({ where: { integrationConfigId }, orderBy: { version: 'asc' }, select: permissionSelect });
  }
}

export class ManagedUpstreamIssuerRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  findEnabledActive(): Promise<ManagedUpstreamIssuerRecord[]> {
    return this.client.managedUpstreamIssuer.findMany({ where: { enabled: true, lifecycle: 'active' }, select: issuerSelect });
  }
}

export class ManagedUpstreamSigningKeyRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  findEnabledActiveByIssuerId(issuerId: string): Promise<ManagedUpstreamSigningKeyRecord[]> {
    return this.client.managedUpstreamSigningKey.findMany({ where: { issuerId, enabled: true, lifecycle: 'active', status: 'active' }, select: keySelect });
  }
}

/** Deliberately narrow audit persistence boundary; callers cannot attach payload bags. */
export class ManagedExchangeAuditRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  append(data: Prisma.ManagedExchangeAuditEventCreateInput): Promise<ManagedExchangeAuditRecord> {
    return this.client.managedExchangeAuditEvent.create({ data, select: auditSelect });
  }
}

/**
 * Narrow lifecycle repository used only by Feature 005 direct provisioning.
 * It deliberately maps a finite set of managed tables; callers cannot name a
 * model, supply raw SQL, or mutate Feature 004/Gateway signing records.
 */
export type ManagedExchangeLifecycleKind = 'provider' | 'config' | 'admission' | 'source' | 'permission' | 'issuer' | 'key';
export class ManagedExchangeLifecycleRepository {
  constructor(private readonly client: ManagedExchangeClient) {}
  transaction<T>(callback: (transaction: ManagedExchangeTransaction) => Promise<T>): Promise<T> { return this.client.$transaction((transaction) => callback(transaction)); }
  async findById(kind: ManagedExchangeLifecycleKind, id: string, transaction: ManagedExchangeTransaction): Promise<Record<string, unknown> | null> {
    const delegate = this.delegate(kind, transaction);
    return delegate.findUnique({ where: { id } }) as Promise<Record<string, unknown> | null>;
  }
  async create(kind: ManagedExchangeLifecycleKind, data: Record<string, unknown>, transaction: ManagedExchangeTransaction): Promise<Record<string, unknown>> {
    return this.delegate(kind, transaction).create({ data }) as Promise<Record<string, unknown>>;
  }
  async disable(kind: ManagedExchangeLifecycleKind, id: string, transaction: ManagedExchangeTransaction): Promise<Record<string, unknown>> {
    const result = await this.delegate(kind, transaction).updateMany({ where: { id, enabled: true, lifecycle: 'active' }, data: { enabled: false, lifecycle: 'disabled' } });
    if (result.count !== 1) throw new Error('conditional lifecycle state mismatch');
    return (await this.delegate(kind, transaction).findUnique({ where: { id } })) as Record<string, unknown>;
  }
  async replace(kind: ManagedExchangeLifecycleKind, predecessorId: string, successor: Record<string, unknown>, transaction: ManagedExchangeTransaction): Promise<Record<string, unknown>> {
    const predecessor = await this.findById(kind, predecessorId, transaction);
    if (!predecessor || predecessor.enabled !== true || predecessor.lifecycle !== 'active' || !sameAnchor(kind, predecessor, successor)) throw new Error('invalid replacement');
    const result = await this.delegate(kind, transaction).updateMany({ where: { id: predecessorId, enabled: true, lifecycle: 'active' }, data: { enabled: false, lifecycle: 'replaced' } });
    if (result.count !== 1) throw new Error('stale predecessor');
    // The partial active unique index permits this order. If insert fails, the
    // enclosing transaction rolls the predecessor back to active.
    return this.create(kind, { ...successor, enabled: true, lifecycle: 'active', version: Number(predecessor.version) + 1, [replacementField(kind)]: predecessor.id }, transaction);
  }
  /** Key-only consistency operation; other managed lifecycle kinds retain generic behavior. */
  async transitionSigningKey(id: string, from: ManagedSigningKeyStatus, to: ManagedSigningKeyStatus, transaction: ManagedExchangeTransaction): Promise<Record<string, unknown>> {
    const target = signingTransition(to);
    const result = await transaction.managedUpstreamSigningKey.updateMany({
      where: { id, status: from, enabled: target.fromEnabled, lifecycle: target.fromLifecycle },
      data: target.data
    });
    if (result.count !== 1) throw new Error('illegal signing key transition');
    return transaction.managedUpstreamSigningKey.findUnique({ where: { id } }) as Promise<Record<string, unknown>>;
  }
  async replaceSigningKey(predecessorId: string, successor: Record<string, unknown>, transaction: ManagedExchangeTransaction): Promise<Record<string, unknown>> {
    const predecessor = await this.findById('key', predecessorId, transaction);
    if (!predecessor || predecessor.enabled !== true || predecessor.lifecycle !== 'active' || predecessor.status !== 'active' || !sameAnchor('key', predecessor, successor)) throw new Error('invalid signing key replacement');
    const replaced = await transaction.managedUpstreamSigningKey.updateMany({
      where: { id: predecessorId, enabled: true, lifecycle: 'active', status: 'active' },
      data: { enabled: false, lifecycle: 'replaced', status: 'retired', retiredAt: new Date() }
    });
    if (replaced.count !== 1) throw new Error('stale signing key predecessor');
    return this.create('key', { ...successor, enabled: true, lifecycle: 'active', status: 'active', version: Number(predecessor.version) + 1, replacesKeyId: predecessor.id }, transaction);
  }
  private delegate(kind: ManagedExchangeLifecycleKind, client: ManagedExchangeTransaction): { findUnique(input: unknown): Promise<unknown>; create(input: unknown): Promise<unknown>; updateMany(input: unknown): Promise<{ count: number }> } {
    const names = { provider: 'managedIdentityProviderInstance', config: 'managedIntegrationExchangeConfig', admission: 'managedIntegrationAdmissionPolicy', source: 'managedPermissionSourceInstance', permission: 'managedPermissionPolicy', issuer: 'managedUpstreamIssuer', key: 'managedUpstreamSigningKey' } as const;
    return client[names[kind]] as never;
  }
}

function signingTransition(to: ManagedSigningKeyStatus): Readonly<{ fromEnabled: boolean; fromLifecycle: ManagedExchangeLifecycle; data: Record<string, unknown> }> {
  if (to === 'published') return { fromEnabled: false, fromLifecycle: 'draft', data: { status: 'published' } };
  if (to === 'active') return { fromEnabled: false, fromLifecycle: 'draft', data: { status: 'active', enabled: true, lifecycle: 'active', activatedAt: new Date() } };
  if (to === 'retiring') return { fromEnabled: true, fromLifecycle: 'active', data: { status: 'retiring', enabled: false, lifecycle: 'disabled', retireAfter: new Date() } };
  if (to === 'retired') return { fromEnabled: false, fromLifecycle: 'disabled', data: { status: 'retired', retiredAt: new Date() } };
  throw new Error('unknown signing key transition');
}

function replacementField(kind: ManagedExchangeLifecycleKind): string {
  return ({ provider: 'replacesProviderId', config: 'replacesConfigId', admission: 'replacesPolicyId', source: 'replacesSourceId', permission: 'replacesPolicyId', issuer: 'replacesIssuerId', key: 'replacesKeyId' } as const)[kind];
}
function sameAnchor(kind: ManagedExchangeLifecycleKind, predecessor: Record<string, unknown>, successor: Record<string, unknown>): boolean {
  if (kind === 'config') return predecessor.integrationId === successor.integrationId;
  if (kind === 'admission' || kind === 'permission') return predecessor.integrationConfigId === successor.integrationConfigId;
  if (kind === 'key') return predecessor.issuerId === successor.issuerId;
  return true;
}

function select<T extends object>(...keys: readonly (keyof T)[]): { readonly [K in keyof T]: boolean } {
  return Object.fromEntries(keys.map((key) => [key, true])) as { readonly [K in keyof T]: boolean };
}
