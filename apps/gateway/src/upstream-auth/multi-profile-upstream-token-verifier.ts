import { CandidateTrustProfileResolver, type CandidateTrustProfile } from '../integration-registry/candidate-trust-profile.resolver';
import { parseBearerToken } from './bearer-token.parser';
import { ProfileScopedVerifier, ProfileScopedVerificationError } from './profile-scoped-verifier';
import { RoutingMetadataParser } from './routing-metadata.parser';
import { UpstreamAuthenticationError } from './upstream-auth.error';
import type { UpstreamTokenVerifier } from './upstream-token-verifier.service';
import type { VerifiedUpstreamIdentity } from './verified-upstream-identity';

type Dependencies = Readonly<{
  parser: Pick<RoutingMetadataParser, 'parse'>;
  candidateResolver: Pick<CandidateTrustProfileResolver, 'resolve'>;
  profileVerifier: Pick<ProfileScopedVerifier, 'verify'>;
  clockToleranceSeconds: number;
}>;
type VerifiedProfileDecision = Readonly<{ profile: CandidateTrustProfile; identity: VerifiedUpstreamIdentity }>;

export class MultiProfileUpstreamTokenVerifier implements UpstreamTokenVerifier {
  constructor(private readonly dependencies: Dependencies) {
    if (!Number.isInteger(dependencies.clockToleranceSeconds) || dependencies.clockToleranceSeconds < 0 || dependencies.clockToleranceSeconds > 300) {
      throw new UpstreamAuthenticationError('invalid_claim_shape');
    }
  }

  async verify(input: Readonly<{ authorization?: string }>): Promise<VerifiedUpstreamIdentity> {
    const token = parseBearerToken(input.authorization);
    let metadata: ReturnType<RoutingMetadataParser['parse']>;
    try {
      metadata = this.dependencies.parser.parse(token);
    } catch {
      throw new UpstreamAuthenticationError('invalid_signature');
    }
    let candidates: readonly CandidateTrustProfile[];
    try {
      candidates = await this.dependencies.candidateResolver.resolve(metadata);
    } catch {
      throw new MultiProfileInfrastructureError();
    }
    const decisions: VerifiedProfileDecision[] = [];
    for (const profile of candidates) {
      if (!eligible(profile)) continue;
      try {
        const identity = await this.dependencies.profileVerifier.verify({ profile, token, clockToleranceSeconds: this.dependencies.clockToleranceSeconds });
        if (identity.integrationId === profile.integrationId) decisions.push(Object.freeze({ profile, identity }));
      } catch (error) {
        if (error instanceof ProfileScopedVerificationError && error.category === 'credential') continue;
        if (error instanceof ProfileScopedVerificationError) throw error;
        throw new ProfileScopedVerificationError('infrastructure');
      }
    }
    if (decisions.length !== 1) throw new UpstreamAuthenticationError('invalid_signature');
    return decisions[0].identity;
  }
}

export class MultiProfileInfrastructureError extends Error {
  readonly category = 'infrastructure';
  constructor() {
    super('Multi-profile verification cannot be completed.');
    this.name = 'MultiProfileInfrastructureError';
  }
}

function eligible(profile: CandidateTrustProfile): boolean {
  return profile.enabled === true && profile.lifecycle === 'active';
}
