import {
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
  type NormalizedPermission,
  type PermissionNormalizerRegistry,
  type ResolvePermissionInput,
  type TrustedPermissionMaterial,
  type VerifiedExternalIdentity
} from '../domain/managed-exchange.domain';
import { ProjectionContractValidator } from '../persistence/managed-contract-registries';
import type { ManagedPermissionPolicyRecord, ManagedPermissionSourceInstanceRecord } from '../persistence/managed-exchange.repository';

type PermissionPolicy = Pick<ManagedPermissionPolicyRecord,
  'integrationConfigId' | 'mode' | 'permissionSourceInstanceId' | 'normalizerType' |
  'projectionContractVersion' | 'projectionContract'>;
type PermissionSource = Pick<ManagedPermissionSourceInstanceRecord,
  'id' | 'sourceType' | 'serviceCredentialReference' | 'adapterContractReference'>;

type PermissionDependencies = Readonly<{
  permissionSources: Readonly<{ findEnabledActiveById(id: string): Promise<PermissionSource | null> }>;
  permissionAdapters: Readonly<{ execute(input: ResolvePermissionInput): Promise<TrustedPermissionMaterial> }>;
  permissionNormalizers: PermissionNormalizerRegistry;
  projector: Readonly<{ project(permissions: readonly NormalizedPermission[], version: string, contract: Readonly<Record<string, unknown>>): readonly string[] }>;
}>;

export type ResolveManagedPermissionInput = Readonly<{
  admittedIdentity: VerifiedExternalIdentity;
  integrationConfigId: string;
  serverOwnedIntegrationContext: Readonly<{ integrationId: string; hostApp: string }>;
  requestId: string;
  policy: PermissionPolicy;
}>;

const MATERIAL_KEYS = ['kind', 'reference', 'values'] as const;
const IDX_TRUSTED_NORMALIZER = 'idx-menu-detail/v1';

/** Resolves only server-configured permission material into canonical scopes. */
export class ManagedPermissionService {
  private readonly projectionContracts = new ProjectionContractValidator();

  constructor(private readonly dependencies: PermissionDependencies) {}

  async resolve(input: ResolveManagedPermissionInput): Promise<readonly string[]> {
    try {
      return await this.resolveTrusted(input);
    } catch (error) {
      if (error instanceof ManagedExchangeIdentityDeniedError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async resolveTrusted(input: ResolveManagedPermissionInput): Promise<readonly string[]> {
    const policy = policyInput(input);
    if (policy.mode === 'provider_trusted') return this.resolveProviderTrusted(input, policy);
    if (policy.permissionSourceInstanceId === null) {
      if (policy.mode !== 'allow_empty' || policy.normalizerType !== null || policy.projectionContractVersion !== null || policy.projectionContract !== null) {
        throw new ManagedExchangeInfrastructureError();
      }
      return Object.freeze([]);
    }
    if (policy.mode !== 'allow_empty' && policy.mode !== 'required') throw new ManagedExchangeInfrastructureError();

    const normalizerType = text(policy.normalizerType);
    const projectionContractVersion = text(policy.projectionContractVersion);
    const projectionContract = contract(policy.projectionContract);
    const source = await this.dependencies.permissionSources.findEnabledActiveById(text(policy.permissionSourceInstanceId));
    if (!source) throw new ManagedExchangeInfrastructureError();

    const material = materialShape(await this.dependencies.permissionAdapters.execute(sourceInput(input, source)));
    const normalizer = this.dependencies.permissionNormalizers.resolve(normalizerType);
    if (!normalizer) throw new ManagedExchangeInfrastructureError();
    const normalized = normalizer.normalize(material);
    const projected = this.dependencies.projector.project(normalized, projectionContractVersion, projectionContract);
    return scopes(projected);
  }

  private resolveProviderTrusted(input: ResolveManagedPermissionInput, policy: PermissionPolicy): readonly string[] {
    if (policy.permissionSourceInstanceId !== null || policy.normalizerType !== IDX_TRUSTED_NORMALIZER) throw new ManagedExchangeInfrastructureError();
    const projectionContractVersion = text(policy.projectionContractVersion);
    const projectionContract = contract(policy.projectionContract);
    this.projectionContracts.validate(projectionContractVersion, projectionContract);

    const material = input.admittedIdentity.trustedPermissionMaterial;
    if (!material || material.kind !== IDX_TRUSTED_NORMALIZER) throw new ManagedExchangeIdentityDeniedError();
    const normalizer = this.dependencies.permissionNormalizers.resolve(IDX_TRUSTED_NORMALIZER);
    if (!normalizer) throw new ManagedExchangeInfrastructureError();
    const normalized = normalizer.normalize(material);
    const projected = this.dependencies.projector.project(normalized, projectionContractVersion, projectionContract);
    return scopes(projected);
  }
}

function policyInput(input: ResolveManagedPermissionInput): PermissionPolicy {
  if (!record(input) || !record(input.policy)) throw new ManagedExchangeInfrastructureError();
  const policy = input.policy;
  if (text(policy.integrationConfigId) !== text(input.integrationConfigId)) throw new ManagedExchangeInfrastructureError();
  return policy;
}

function sourceInput(input: ResolveManagedPermissionInput, source: PermissionSource): ResolvePermissionInput {
  const result: {
    admittedIdentity: VerifiedExternalIdentity;
    serverOwnedIntegrationContext: Readonly<{ integrationId: string; hostApp: string }>;
    permissionSourcePolicy: Readonly<{ id: string; sourceType: string; adapterContractReference: string }>;
    requestId: string;
    trustedPermissionReference?: string;
    trustedPermissionMaterial?: TrustedPermissionMaterial;
    serviceCredentialReference?: string;
  } = {
    admittedIdentity: input.admittedIdentity,
    serverOwnedIntegrationContext: input.serverOwnedIntegrationContext,
    permissionSourcePolicy: Object.freeze({
      id: text(source.id),
      sourceType: text(source.sourceType),
      adapterContractReference: text(source.adapterContractReference)
    }),
    requestId: text(input.requestId)
  };
  if (input.admittedIdentity.trustedPermissionReference !== undefined) result.trustedPermissionReference = input.admittedIdentity.trustedPermissionReference;
  if (input.admittedIdentity.trustedPermissionMaterial !== undefined) result.trustedPermissionMaterial = input.admittedIdentity.trustedPermissionMaterial;
  if (source.serviceCredentialReference !== null) result.serviceCredentialReference = text(source.serviceCredentialReference);
  return result;
}

function materialShape(value: unknown): TrustedPermissionMaterial {
  if (!record(value) || !only(value, MATERIAL_KEYS) || !('kind' in value)) throw new ManagedExchangeInfrastructureError();
  const result: { kind: string; reference?: string; values?: readonly string[] } = { kind: text(value.kind) };
  if (value.reference !== undefined) result.reference = text(value.reference);
  if (value.values !== undefined) {
    if (!Array.isArray(value.values)) throw new ManagedExchangeInfrastructureError();
    result.values = Object.freeze(value.values.map(text));
  }
  return Object.freeze(result);
}

function contract(value: unknown): Readonly<Record<string, unknown>> {
  if (!record(value)) throw new ManagedExchangeInfrastructureError();
  return value;
}

function scopes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new ManagedExchangeInfrastructureError();
  return Object.freeze(value.map(text));
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeInfrastructureError();
  const normalized = value.trim();
  if (!normalized || control(normalized)) throw new ManagedExchangeInfrastructureError();
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
