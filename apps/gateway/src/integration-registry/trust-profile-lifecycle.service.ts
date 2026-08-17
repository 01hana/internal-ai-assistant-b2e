import type { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import type { TrustProfileInvalidationHook } from '../commands/provision-trust-profile';
import type { TrustProfileActivationInput } from './trust-profile-activation.validator';
import { TrustProfileActivationError, TrustProfileActivationValidator } from './trust-profile-activation.validator';
import type { TrustProfileRecord, TrustProfileTransaction } from './trust-profile.repository';
import { TrustProfileRepository } from './trust-profile.repository';

type LifecycleValidationRepository = Readonly<{
  findBindingByIntegrationId(integrationId: string): Promise<unknown>;
  findEnabledExactPolicy(input: Pick<TrustProfileActivationInput, 'id' | 'integrationId' | 'expectedIssuer' | 'expectedAudience' | 'jwksUri'> & Readonly<{ algorithm: 'RS256' }>): Promise<readonly unknown[]>;
  findById(id: string): Promise<{ integrationId: string; version: number } | null>;
}>;

export type DisableTrustProfileInput = Readonly<{ profileId: string; requestId: string }>;
export type ReplaceTrustProfileInput = Readonly<{ predecessorId: string; successorId: string; requestId: string }>;
export type TrustProfileLifecycleResult = Readonly<{
  changed: true;
  integrationId: string;
  predecessorId?: string;
  successorId?: string;
  id?: string;
}>;

/** Direct-only control-plane lifecycle; it never owns IntegrationBinding admission or identity authority. */
export class TrustProfileLifecycleService {
  constructor(private readonly dependencies: Readonly<{
    repository: TrustProfileRepository;
    validator: TrustProfileActivationValidator;
    auditWriter: Pick<GatewayIdentityAuditWriter, 'append'>;
    invalidation: TrustProfileInvalidationHook;
  }>) {}

  async disable(input: DisableTrustProfileInput): Promise<TrustProfileLifecycleResult> {
    const normalized = normalizeDisable(input);
    let result: TrustProfileLifecycleResult;
    try {
      result = await this.dependencies.repository.transaction(async (transaction) => {
        const profile = await this.dependencies.repository.findById(normalized.profileId, transaction);
        if (!profile || !(await this.dependencies.repository.disableActive(profile.id, transaction))) {
          throw new TrustProfileLifecycleError();
        }
        return Object.freeze({ changed: true, id: profile.id, integrationId: profile.integrationId });
      });
    } catch (error) {
      throw lifecycleError(error);
    }
    await this.afterCommit(result, normalized.requestId, 'disable');
    return result;
  }

  async replace(input: ReplaceTrustProfileInput): Promise<TrustProfileLifecycleResult> {
    const normalized = normalizeReplace(input);
    let result: TrustProfileLifecycleResult;
    try {
      result = await this.dependencies.repository.transaction(async (transaction) => {
        const predecessor = await this.dependencies.repository.findById(normalized.predecessorId, transaction);
        const successor = await this.dependencies.repository.findById(normalized.successorId, transaction);
        if (!predecessor || !successor || !isActive(predecessor) || !isDraft(successor)) throw new TrustProfileLifecycleError();
        if (successor.integrationId !== predecessor.integrationId || successor.replacesProfileId !== predecessor.id || successor.version <= predecessor.version) {
          throw new TrustProfileLifecycleError();
        }

        const activeProfiles = await this.dependencies.repository.findEnabledActiveByIntegrationId(predecessor.integrationId, transaction);
        if (activeProfiles.length !== 1 || activeProfiles[0].id !== predecessor.id) throw new TrustProfileLifecycleError();

        await this.dependencies.validator.validate(toActiveInput(successor), this.validationRepository(transaction));
        if (!(await this.dependencies.repository.activateDraftSuccessor(successor.id, transaction))) throw new TrustProfileLifecycleError();
        if (!(await this.dependencies.repository.replaceActivePredecessor(predecessor.id, transaction))) throw new TrustProfileLifecycleError();

        return Object.freeze({ changed: true, integrationId: predecessor.integrationId, predecessorId: predecessor.id, successorId: successor.id });
      });
    } catch (error) {
      throw lifecycleError(error);
    }
    await this.afterCommit(result, normalized.requestId, 'replace');
    return result;
  }

  private validationRepository(transaction: TrustProfileTransaction): LifecycleValidationRepository {
    return {
      findBindingByIntegrationId: (integrationId) => this.dependencies.repository.findBindingByIntegrationId(integrationId, transaction),
      findEnabledExactPolicy: (input) => this.dependencies.repository.findEnabledExactPolicy(input, transaction),
      findById: (id) => this.dependencies.repository.findById(id, transaction)
    };
  }

  private async afterCommit(result: TrustProfileLifecycleResult, requestId: string, action: 'disable' | 'replace'): Promise<void> {
    const profileIds = result.id ? [result.id] : [result.predecessorId!, result.successorId!];
    const outcomes = await Promise.allSettled([
      this.dependencies.auditWriter.append({
        requestId,
        eventType: `trust_profile_${action}`,
        outcome: 'success',
        reasonCode: 'changed',
        integrationId: result.integrationId
      }),
      ...profileIds.map((profileId) => this.dependencies.invalidation.invalidate(profileId))
    ]);
    if (outcomes.some((outcome) => outcome.status === 'rejected')) {
      throw new TrustProfileLifecyclePostCommitError();
    }
  }
}

function toActiveInput(profile: TrustProfileRecord): TrustProfileActivationInput {
  return {
    ...profile,
    enabled: true,
    lifecycle: 'active',
    replacesProfileId: profile.replacesProfileId ?? undefined
  };
}

function isActive(profile: TrustProfileRecord): boolean {
  return profile.enabled === true && profile.lifecycle === 'active';
}

function isDraft(profile: TrustProfileRecord): boolean {
  return profile.enabled === false && profile.lifecycle === 'draft';
}

function normalizeDisable(input: DisableTrustProfileInput): DisableTrustProfileInput {
  if (!input || !nonBlank(input.profileId) || !nonBlank(input.requestId)) throw new TrustProfileLifecycleError();
  return Object.freeze({ profileId: input.profileId.trim(), requestId: input.requestId.trim() });
}

function normalizeReplace(input: ReplaceTrustProfileInput): ReplaceTrustProfileInput {
  if (!input || !nonBlank(input.predecessorId) || !nonBlank(input.successorId) || !nonBlank(input.requestId)) throw new TrustProfileLifecycleError();
  return Object.freeze({ predecessorId: input.predecessorId.trim(), successorId: input.successorId.trim(), requestId: input.requestId.trim() });
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function lifecycleError(error: unknown): TrustProfileLifecycleError {
  if (error instanceof TrustProfileLifecycleError) return error;
  if (error instanceof TrustProfileActivationError) return new TrustProfileLifecycleError();
  return new TrustProfileLifecycleError();
}

export class TrustProfileLifecycleError extends Error {
  readonly committed: boolean = false;

  constructor() {
    super('Trust profile lifecycle cannot be completed.');
    this.name = 'TrustProfileLifecycleError';
  }
}

export class TrustProfileLifecyclePostCommitError extends TrustProfileLifecycleError {
  override readonly committed = true;

  constructor() {
    super();
    this.name = 'TrustProfileLifecyclePostCommitError';
  }
}
