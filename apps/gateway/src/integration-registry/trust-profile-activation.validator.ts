import { ProductionJwksSourceRegistrationPolicy, type JwksSourceRegistrationPolicy } from '../upstream-auth/jwks-source-policy';
export { ProductionJwksSourceRegistrationPolicy } from '../upstream-auth/jwks-source-policy';

export type TrustProfileActivationInput = Readonly<{
  id: string;
  integrationId: string;
  expectedIssuer: string;
  expectedAudience: string;
  jwksUri: string;
  algorithm: string;
  enabled: boolean;
  lifecycle: string;
  version: number;
  replacesProfileId?: string | null;
}>;

type ActivationRepository = Readonly<{
  findBindingByIntegrationId(integrationId: string): Promise<unknown>;
  findEnabledExactPolicy(input: ActivePolicyInput): Promise<readonly unknown[]>;
  findById?(id: string): Promise<{ integrationId: string; version: number } | null>;
}>;

type ActivePolicyInput = Pick<TrustProfileActivationInput, 'id' | 'integrationId' | 'expectedIssuer' | 'expectedAudience' | 'jwksUri'> & Readonly<{ algorithm: 'RS256' }>;

export type { JwksSourceRegistrationPolicy } from '../upstream-auth/jwks-source-policy';

export class TrustProfileActivationValidator {
  constructor(private readonly dependencies: Readonly<{ repository: ActivationRepository; jwksSourcePolicy: JwksSourceRegistrationPolicy }>) {}

  async validate(input: TrustProfileActivationInput, repository: ActivationRepository = this.dependencies.repository): Promise<TrustProfileActivationInput> {
    const profile = normalize(input);
    try { this.dependencies.jwksSourcePolicy.validate(profile.jwksUri); } catch { throw new TrustProfileActivationError(); }
    const binding = await repository.findBindingByIntegrationId(profile.integrationId);
    if (!binding) throw new TrustProfileActivationError();
    if (profile.replacesProfileId) await this.validateReplacement(profile, repository);
    if (profile.enabled && profile.lifecycle === 'active') {
      const duplicates = await repository.findEnabledExactPolicy(profile as ActivePolicyInput);
      if (duplicates.length > 0) throw new TrustProfileActivationError();
    }
    return Object.freeze(profile);
  }

  private async validateReplacement(profile: TrustProfileActivationInput, repository: ActivationRepository) {
    if (profile.replacesProfileId === profile.id) throw new TrustProfileActivationError();
    if (!repository.findById) throw new TrustProfileActivationError();
    const predecessor = await repository.findById(profile.replacesProfileId!);
    if (!predecessor || predecessor.integrationId !== profile.integrationId || predecessor.version >= profile.version) throw new TrustProfileActivationError();
  }
}

function normalize(input: TrustProfileActivationInput): TrustProfileActivationInput {
  const allowed = ['id', 'integrationId', 'expectedIssuer', 'expectedAudience', 'jwksUri', 'algorithm', 'enabled', 'lifecycle', 'version', 'replacesProfileId'];
  if (!input || typeof input !== 'object' || Object.keys(input as object).some((key) => !allowed.includes(key))) throw new TrustProfileActivationError();
  const profile = {
    id: required(input.id), integrationId: required(input.integrationId), expectedIssuer: required(input.expectedIssuer), expectedAudience: required(input.expectedAudience), jwksUri: required(input.jwksUri),
    algorithm: required(input.algorithm), enabled: input.enabled, lifecycle: required(input.lifecycle), version: input.version,
    replacesProfileId: input.replacesProfileId === undefined || input.replacesProfileId === null ? undefined : required(input.replacesProfileId)
  };
  if (profile.algorithm !== 'RS256' || typeof profile.enabled !== 'boolean' || !Number.isSafeInteger(profile.version) || profile.version < 1) throw new TrustProfileActivationError();
  if (!['draft', 'active', 'disabled', 'replaced'].includes(profile.lifecycle)) throw new TrustProfileActivationError();
  if ((profile.lifecycle === 'active') !== profile.enabled) throw new TrustProfileActivationError();
  if (profile.replacesProfileId && profile.version < 2) throw new TrustProfileActivationError();
  if (profile.lifecycle === 'replaced' && profile.enabled) throw new TrustProfileActivationError();
  return profile;
}

function required(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].some((character) => (character.codePointAt(0) ?? 0) <= 31 || character.codePointAt(0) === 127)) throw new TrustProfileActivationError();
  return value.trim();
}

export class TrustProfileActivationError extends Error {
  constructor() { super('Trust profile activation cannot be completed.'); }
}
