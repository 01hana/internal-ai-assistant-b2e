import type {
  ManagedExchangeAuditEvent, ManagedIdentityProviderInstance, ManagedIntegrationAdmissionPolicy,
  ManagedIntegrationExchangeConfig, ManagedPermissionPolicy, ManagedPermissionSourceInstance,
  ManagedUpstreamIssuer, ManagedUpstreamSigningKey, Prisma, PrismaClient
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

function select<T extends object>(...keys: readonly (keyof T)[]): { readonly [K in keyof T]: boolean } {
  return Object.fromEntries(keys.map((key) => [key, true])) as { readonly [K in keyof T]: boolean };
}
