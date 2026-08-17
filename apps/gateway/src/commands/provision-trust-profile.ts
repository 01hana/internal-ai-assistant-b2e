import { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import type { TrustProfileMutablePolicyUpdate, TrustProfileRecord } from '../integration-registry/trust-profile.repository';
import { TrustProfileActivationError, type TrustProfileActivationInput } from '../integration-registry/trust-profile-activation.validator';

type ProvisionAction = 'create' | 'update' | 'disable';
type ProfileRepository = Readonly<{
  transaction<T>(callback: (transaction: unknown) => Promise<T>): Promise<T>;
  findById(id: string, client?: unknown): Promise<TrustProfileRecord | null>;
  create(data: Record<string, unknown>, client: unknown): Promise<TrustProfileRecord>;
  update(id: string, data: TrustProfileMutablePolicyUpdate, client: unknown): Promise<TrustProfileRecord>;
  disable(id: string, client: unknown): Promise<TrustProfileRecord>;
}>;
type ProfileValidator = Readonly<{ validate(input: TrustProfileActivationInput): Promise<TrustProfileActivationInput> }>;
export interface TrustProfileInvalidationHook { invalidate(profileId: string): Promise<void>; }

export type ProvisionTrustProfileInput = TrustProfileActivationInput & Readonly<{ action: ProvisionAction; requestId: string }>;
export type ProvisionTrustProfileResult = Readonly<Pick<TrustProfileRecord, 'id' | 'integrationId' | 'enabled' | 'lifecycle' | 'version' | 'replacesProfileId'> & { changed: boolean }>;

/** Internal/direct-only control-plane command. It is intentionally not a Gateway controller or runtime provider. */
export class ProvisionTrustProfileCommand {
  constructor(private readonly dependencies: Readonly<{ repository: ProfileRepository; validator: ProfileValidator; auditWriter: Pick<GatewayIdentityAuditWriter, 'append'>; invalidation: TrustProfileInvalidationHook }>) {}

  async execute(input: ProvisionTrustProfileInput): Promise<ProvisionTrustProfileResult> {
    const normalized = normalize(input);
    try {
      const result = await this.dependencies.repository.transaction(async (transaction) => {
        const existing = await this.dependencies.repository.findById(normalized.id, transaction);
        if (normalized.action === 'disable') {
          if (!existing) throw new ProvisionTrustProfileError();
          const profile = await this.dependencies.repository.disable(normalized.id, transaction);
          return toResult(profile, true);
        }
        const validated = await this.dependencies.validator.validate(activationInput(normalized));
        if (existing && existing.integrationId !== validated.integrationId) throw new ProvisionTrustProfileError();
        if (!existing) {
          const profile = await this.dependencies.repository.create(toPersistenceData(validated), transaction);
          return toResult(profile, true);
        }
        if (normalized.action === 'create') {
          if (!sameProfile(existing, validated)) throw new ProvisionTrustProfileError();
          return toResult(existing, false);
        }
        const profile = await this.dependencies.repository.update(normalized.id, toMutablePolicyData(validated), transaction);
        return toResult(profile, true);
      });
      await this.dependencies.auditWriter.append({ requestId: normalized.requestId, eventType: `trust_profile_${normalized.action}`, outcome: 'success', reasonCode: result.changed ? 'changed' : 'replayed', integrationId: result.integrationId });
      await this.dependencies.invalidation.invalidate(result.id);
      return result;
    } catch (error) {
      if (error instanceof ProvisionTrustProfileError || error instanceof TrustProfileActivationError) throw new ProvisionTrustProfileError();
      throw error;
    }
  }
}

function normalize(input: ProvisionTrustProfileInput): ProvisionTrustProfileInput {
  if (!input || !['create', 'update', 'disable'].includes(input.action) || typeof input.requestId !== 'string' || !input.requestId.trim()) throw new ProvisionTrustProfileError();
  return { ...input, requestId: input.requestId.trim() };
}

function toPersistenceData(input: TrustProfileActivationInput): Record<string, unknown> {
  return { id: input.id, integrationId: input.integrationId, expectedIssuer: input.expectedIssuer, expectedAudience: input.expectedAudience, jwksUri: input.jwksUri, algorithm: input.algorithm, enabled: input.enabled, lifecycle: input.lifecycle, version: input.version, replacesProfileId: input.replacesProfileId ?? null };
}

function toMutablePolicyData(input: TrustProfileActivationInput): TrustProfileMutablePolicyUpdate {
  return { expectedIssuer: input.expectedIssuer, expectedAudience: input.expectedAudience, jwksUri: input.jwksUri, algorithm: input.algorithm as never, enabled: input.enabled, lifecycle: input.lifecycle as never, version: input.version, replacesProfileId: input.replacesProfileId ?? null };
}

function activationInput(input: ProvisionTrustProfileInput): TrustProfileActivationInput {
  const { action: _action, requestId: _requestId, ...profile } = input;
  return profile;
}

function sameProfile(record: TrustProfileRecord, input: TrustProfileActivationInput): boolean {
  return record.integrationId === input.integrationId && record.expectedIssuer === input.expectedIssuer && record.expectedAudience === input.expectedAudience && record.jwksUri === input.jwksUri && record.algorithm === input.algorithm && record.enabled === input.enabled && record.lifecycle === input.lifecycle && record.version === input.version && (record.replacesProfileId ?? undefined) === (input.replacesProfileId ?? undefined);
}

function toResult(profile: TrustProfileRecord, changed: boolean): ProvisionTrustProfileResult {
  return Object.freeze({ id: profile.id, integrationId: profile.integrationId, enabled: profile.enabled, lifecycle: profile.lifecycle, version: profile.version, replacesProfileId: profile.replacesProfileId, changed });
}

export class ProvisionTrustProfileError extends Error {
  constructor() { super('Trust profile provisioning cannot be completed.'); }
}
