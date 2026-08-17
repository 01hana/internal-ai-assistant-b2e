import type { TrustProfileInvalidationHook } from '../commands/provision-trust-profile';
import type { TrustProfileRecord, TrustProfileRepository } from './trust-profile.repository';

export const DEFAULT_TRUST_PROFILE_CACHE_TTL_MS = 30_000;
export const MAX_TRUST_PROFILE_CACHE_TTL_MS = 60_000;

type CandidateRepository = Pick<TrustProfileRepository, 'findEnabledByIssuer'>;
type CacheEntry = Readonly<{ loadedAt: number; profiles: readonly TrustProfileRecord[] }>;

/** Process-local cache for registered upstream verification policy candidates only. */
export class TrustProfileCache implements TrustProfileInvalidationHook {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly ttlMilliseconds: number;

  constructor(dependencies: Readonly<{ repository: CandidateRepository; now?: () => number; ttlMilliseconds?: number }>) {
    if (!dependencies || !dependencies.repository) throw new TrustProfileCacheConfigurationError();
    this.now = dependencies.now ?? Date.now;
    this.ttlMilliseconds = validateTtl(dependencies.ttlMilliseconds ?? DEFAULT_TRUST_PROFILE_CACHE_TTL_MS);
    this.repository = dependencies.repository;
  }

  private readonly repository: CandidateRepository;

  async findEnabledByIssuer(expectedIssuer: string): Promise<readonly TrustProfileRecord[]> {
    const current = this.entries.get(expectedIssuer);
    if (current && this.now() - current.loadedAt <= this.ttlMilliseconds) return current.profiles;

    const profiles = await this.repository.findEnabledByIssuer(expectedIssuer);
    const entry = Object.freeze({ loadedAt: this.now(), profiles: freezeProfiles(profiles) });
    this.entries.set(expectedIssuer, entry);
    return entry.profiles;
  }

  async invalidate(_profileId: string): Promise<void> {
    this.entries.clear();
  }
}

function freezeProfiles(profiles: readonly TrustProfileRecord[]): readonly TrustProfileRecord[] {
  return Object.freeze(profiles.map((profile) => Object.freeze({ ...profile })));
}

function validateTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TRUST_PROFILE_CACHE_TTL_MS) {
    throw new TrustProfileCacheConfigurationError();
  }
  return value;
}

export class TrustProfileCacheConfigurationError extends Error {
  constructor() {
    super('Trust profile cache configuration is invalid.');
  }
}
