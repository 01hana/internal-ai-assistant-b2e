import { ManagedExchangeActivationValidator } from './managed-exchange-activation.validator';

type Config = Readonly<{ id: string; integrationId: string; providerInstanceId: string; canonicalHostApp: string; organizationMode: string; fixedOrganizationId: string | null }>;
type Provider = Readonly<Record<string, unknown>>;
type Policy = Readonly<{ mode?: string; permissionSourceInstanceId?: string | null; normalizerType?: string | null; projectionContractVersion?: string | null; projectionContract?: unknown; anchorRequirements?: unknown }>;
type Issuer = Readonly<{ id: string; issuer: string; expectedAudience: string; publicJwksUri: string }>;
type Key = Readonly<Record<string, unknown>>;
type TrustProfile = Readonly<{ integrationId: string; expectedIssuer: string; expectedAudience: string; jwksUri: string; enabled: boolean; lifecycle: string }>;

export class ManagedExchangeReadinessError extends Error { constructor() { super('Managed identity exchange is not ready.'); } }

/** Read-only deployment readiness gate. It accepts no browser data and issues nothing. */
export class ManagedExchangeReadinessValidator {
  constructor(private readonly dependencies: Readonly<{
    findBinding(integrationId: string): Promise<Readonly<{ enabled: boolean }> | null>;
    findEnabledActiveConfigsByIntegrationId(integrationId: string): Promise<readonly Config[]>;
    findEnabledActiveProviderById(id: string): Promise<Provider | null>;
    findEnabledActiveAdmissionPoliciesByConfigId(configId: string): Promise<readonly Policy[]>;
    findEnabledActivePermissionPoliciesByConfigId(configId: string): Promise<readonly Policy[]>;
    findEnabledActivePermissionSourceById(id: string): Promise<Readonly<Record<string, unknown>> | null>;
    hasPermissionAdapter(type: string): boolean;
    hasPermissionNormalizer(type: string): boolean;
    findEnabledActiveIssuers(): Promise<readonly Issuer[]>;
    findEnabledActiveSigningKeysByIssuerId(issuerId: string): Promise<readonly Key[]>;
    findTrustProfiles(integrationId: string): Promise<readonly TrustProfile[]>;
  }>, private readonly validator = new ManagedExchangeActivationValidator()) {}

  async assertReady(integrationId: string): Promise<void> {
    try {
      await this.assertReadyInternal(integrationId);
    } catch (error) {
      if (error instanceof ManagedExchangeReadinessError) throw error;
      throw new ManagedExchangeReadinessError();
    }
  }

  private async assertReadyInternal(integrationId: string): Promise<void> {
    const binding = await this.dependencies.findBinding(integrationId);
    if (!binding?.enabled) throw new ManagedExchangeReadinessError();
    const configs = await this.dependencies.findEnabledActiveConfigsByIntegrationId(integrationId);
    if (configs.length !== 1) throw new ManagedExchangeReadinessError();
    const config = configs[0];
    if (!nonBlank(config.canonicalHostApp) || !validOrganization(config.organizationMode, config.fixedOrganizationId)) throw new ManagedExchangeReadinessError();
    const provider = await this.dependencies.findEnabledActiveProviderById(config.providerInstanceId);
    if (!provider) throw new ManagedExchangeReadinessError();
    let validatedProvider: ReturnType<ManagedExchangeActivationValidator['validateProvider']>;
    try { validatedProvider = this.validator.validateProvider(provider); } catch { throw new ManagedExchangeReadinessError(); }
    const idx = validatedProvider.providerType === 'idx_delegated';
    if (idx) assertIdxConfig(config);
    const admission = await this.dependencies.findEnabledActiveAdmissionPoliciesByConfigId(config.id);
    if (admission.length !== 1) throw new ManagedExchangeReadinessError();
    try { this.validator.validateAdmission(admission[0].anchorRequirements); } catch { throw new ManagedExchangeReadinessError(); }
    if (idx) assertIdxAdmission(admission[0].anchorRequirements);
    await this.assertPermissions(config.id, idx);
    const issuers = await this.dependencies.findEnabledActiveIssuers();
    if (issuers.length !== 1) throw new ManagedExchangeReadinessError();
    const issuer = issuers[0];
    try { this.validator.validateIssuer(issuer); } catch { throw new ManagedExchangeReadinessError(); }
    const keys = await this.dependencies.findEnabledActiveSigningKeysByIssuerId(issuer.id);
    if (keys.length !== 1) throw new ManagedExchangeReadinessError();
    try { this.validator.validateSigningKey(keys[0]); } catch { throw new ManagedExchangeReadinessError(); }
    const profiles = await this.dependencies.findTrustProfiles(config.integrationId);
    const compatible = profiles.filter((profile) => profile.enabled && profile.lifecycle === 'active' && profile.integrationId === config.integrationId && profile.expectedIssuer === issuer.issuer && profile.expectedAudience === issuer.expectedAudience && profile.jwksUri === issuer.publicJwksUri);
    if (compatible.length !== 1) throw new ManagedExchangeReadinessError();
  }

  private async assertPermissions(configId: string, idx: boolean): Promise<void> {
    const policies = await this.dependencies.findEnabledActivePermissionPoliciesByConfigId(configId);
    if (policies.length !== 1) throw new ManagedExchangeReadinessError();
    const policy = policies[0];
    if (idx) {
      if (policy.mode !== 'provider_trusted' || policy.permissionSourceInstanceId !== null || policy.normalizerType !== 'idx-menu-detail/v1') throw new ManagedExchangeReadinessError();
      try { this.validator.validatePermissionPolicy(policy, false); } catch { throw new ManagedExchangeReadinessError(); }
      if (!this.dependencies.hasPermissionNormalizer('idx-menu-detail/v1')) throw new ManagedExchangeReadinessError();
      return;
    }
    const sourceId = policy.permissionSourceInstanceId;
    const source = sourceId ? await this.dependencies.findEnabledActivePermissionSourceById(sourceId) : null;
    if (sourceId && !source) throw new ManagedExchangeReadinessError();
    if (source) {
      try { this.validator.validatePermissionSource(source); } catch { throw new ManagedExchangeReadinessError(); }
      if (!this.dependencies.hasPermissionAdapter(String(source.sourceType))) throw new ManagedExchangeReadinessError();
    }
    try { this.validator.validatePermissionPolicy(policy, Boolean(source)); } catch { throw new ManagedExchangeReadinessError(); }
    if (policy.mode === 'required' && (!source || !nonBlank(policy.normalizerType) || !this.dependencies.hasPermissionNormalizer(policy.normalizerType))) throw new ManagedExchangeReadinessError();
    if (source && nonBlank(policy.normalizerType) && !this.dependencies.hasPermissionNormalizer(policy.normalizerType)) throw new ManagedExchangeReadinessError();
  }
}
function nonBlank(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function validOrganization(mode: string, fixedOrganizationId: string | null): boolean { return (mode === 'verified' && (fixedOrganizationId === null || fixedOrganizationId === undefined)) || (mode === 'fixed_single_organization' && nonBlank(fixedOrganizationId)); }
function assertIdxConfig(config: Config): void {
  if (config.organizationMode !== 'verified' || (config.fixedOrganizationId !== null && config.fixedOrganizationId !== undefined)) throw new ManagedExchangeReadinessError();
}
function assertIdxAdmission(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 1 || !plain(value[0]) || !exactKeys(value[0], ['kind', 'allowedValues'])) throw new ManagedExchangeReadinessError();
  const requirement = value[0];
  if (requirement.kind !== 'idx_entry' || !Array.isArray(requirement.allowedValues) || requirement.allowedValues.length !== 1 || !safeText(requirement.allowedValues[0])) throw new ManagedExchangeReadinessError();
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every((key) => typeof key === 'string' && expected.includes(key));
}
function safeText(value: unknown): value is string {
  return nonBlank(value) && [...value].every((character) => { const point = character.codePointAt(0) ?? 0; return point > 31 && point !== 127; });
}
function plain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
