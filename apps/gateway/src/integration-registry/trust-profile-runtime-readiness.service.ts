import type { TrustProfileRecord, TrustProfileRepository } from './trust-profile.repository';
import { ProductionJwksSourceRegistrationPolicy } from '../upstream-auth/jwks-source-policy';

type ProfileLookup = Pick<TrustProfileRepository, 'findEnabledActiveProfiles'>;

export class TrustProfileRuntimeReadiness {
  constructor(private readonly repository: ProfileLookup) {}

  async assertReady(): Promise<void> {
    try {
      const profiles = await this.repository.findEnabledActiveProfiles();
      if (!profiles.some(valid)) throw new TrustProfileRuntimeReadinessError();
    } catch (error) {
      if (error instanceof TrustProfileRuntimeReadinessError) throw error;
      throw new TrustProfileRuntimeReadinessError();
    }
  }
}

function valid(profile: TrustProfileRecord): boolean {
  if (
    profile.algorithm !== 'RS256' ||
    profile.enabled !== true ||
    profile.lifecycle !== 'active' ||
    !nonBlank(profile.expectedIssuer) ||
    !nonBlank(profile.expectedAudience)
  ) {
    return false;
  }

  try {
    new ProductionJwksSourceRegistrationPolicy().validate(profile.jwksUri);
    return true;
  } catch {
    return false;
  }
}

function nonBlank(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export class TrustProfileRuntimeReadinessError extends Error {
  constructor() {
    super('Profile runtime readiness cannot be completed.');
    this.name = 'TrustProfileRuntimeReadinessError';
  }
}
