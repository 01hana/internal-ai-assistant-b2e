import type { TrustProfileRecord } from './trust-profile.repository';
import type { UnverifiedRoutingMetadata } from '../upstream-auth/routing-metadata.parser';

export type CandidateTrustProfile = TrustProfileRecord;
type CandidateLookup = Readonly<{ findEnabledByIssuer(expectedIssuer: string): Promise<readonly TrustProfileRecord[]> }>;

/** Resolves registered verification-policy candidates from untrusted routing hints only. */
export class CandidateTrustProfileResolver {
  constructor(private readonly repository: CandidateLookup) {}

  async resolve(metadata: UnverifiedRoutingMetadata): Promise<readonly CandidateTrustProfile[]> {
    const profiles = await this.repository.findEnabledByIssuer(metadata.issuerHint);
    return Object.freeze([...profiles]);
  }
}
