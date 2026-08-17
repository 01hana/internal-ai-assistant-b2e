import { CandidateTrustProfileResolver, type CandidateTrustProfile } from '../integration-registry/candidate-trust-profile.resolver';
import { parseBearerToken } from './bearer-token.parser';
import { ProfileScopedVerifier, ProfileScopedVerificationError } from './profile-scoped-verifier';
import { RoutingMetadataParser } from './routing-metadata.parser';
import { UpstreamAuthenticationError, UpstreamIdentityServiceUnavailableError } from './upstream-auth.error';
import { UpstreamAuthTelemetry, type UpstreamAuthTelemetryEvent } from './upstream-auth-telemetry';
import type { UpstreamTokenVerifier } from './upstream-token-verifier.service';
import type { VerifiedUpstreamIdentity } from './verified-upstream-identity';

type Dependencies = Readonly<{
  parser: Pick<RoutingMetadataParser, 'parse'>;
  candidateResolver: Pick<CandidateTrustProfileResolver, 'resolve'>;
  profileVerifier: Pick<ProfileScopedVerifier, 'verify'>;
  telemetry?: Pick<UpstreamAuthTelemetry, 'record'>;
  clockToleranceSeconds: number;
}>;
type VerifiedProfileDecision = Readonly<{ profile: CandidateTrustProfile; identity: VerifiedUpstreamIdentity }>;

export class MultiProfileUpstreamTokenVerifier implements UpstreamTokenVerifier {
  constructor(private readonly dependencies: Dependencies) {
    if (!Number.isInteger(dependencies.clockToleranceSeconds) || dependencies.clockToleranceSeconds < 0 || dependencies.clockToleranceSeconds > 300) {
      throw new UpstreamAuthenticationError('invalid_claim_shape');
    }
  }

  async verify(input: Readonly<{ authorization?: string; requestId?: string }>): Promise<VerifiedUpstreamIdentity> {
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
      await this.record(input.requestId, { outcome: 'denied', reasonCode: 'verification_infrastructure_unavailable' });
      throw new MultiProfileInfrastructureError();
    }
    if (candidates.length === 0) {
      await this.record(input.requestId, { outcome: 'denied', reasonCode: 'no_candidate' });
      throw new UpstreamAuthenticationError('invalid_signature');
    }
    const decisions: VerifiedProfileDecision[] = [];
    for (const profile of candidates) {
      if (!eligible(profile)) {
        await this.record(input.requestId, { outcome: 'denied', reasonCode: 'profile_disabled', profileId: profile.id, integrationId: profile.integrationId });
        continue;
      }
      try {
        const identity = await this.dependencies.profileVerifier.verify({ profile, token, clockToleranceSeconds: this.dependencies.clockToleranceSeconds });
        if (identity.integrationId === profile.integrationId) decisions.push(Object.freeze({ profile, identity }));
        else await this.record(input.requestId, { outcome: 'denied', reasonCode: 'profile_integration_mismatch', profileId: profile.id, integrationId: profile.integrationId });
      } catch (error) {
        if (error instanceof ProfileScopedVerificationError && error.category === 'credential') {
          await this.record(input.requestId, { outcome: 'denied', reasonCode: error.reason, profileId: profile.id, integrationId: profile.integrationId });
          continue;
        }
        if (error instanceof ProfileScopedVerificationError) {
          await this.record(input.requestId, { outcome: 'denied', reasonCode: 'verification_infrastructure_unavailable', profileId: profile.id, integrationId: profile.integrationId });
          throw new MultiProfileInfrastructureError();
        }
        await this.record(input.requestId, { outcome: 'denied', reasonCode: 'verification_infrastructure_unavailable', profileId: profile.id, integrationId: profile.integrationId });
        throw new MultiProfileInfrastructureError();
      }
    }
    if (decisions.length !== 1) {
      if (decisions.length > 1) {
        await Promise.all(decisions.map((decision) => this.record(input.requestId, {
          outcome: 'denied', reasonCode: 'ambiguous_profile_decision', profileId: decision.profile.id, integrationId: decision.profile.integrationId
        })));
      }
      throw new UpstreamAuthenticationError('invalid_signature');
    }
    const decision = decisions[0];
    await this.record(input.requestId, {
      outcome: 'success', reasonCode: 'verified', profileId: decision.profile.id, integrationId: decision.identity.integrationId,
      actorId: decision.identity.subject, hostApp: decision.identity.hostApp
    });
    return decision.identity;
  }

  private async record(requestId: string | undefined, event: Omit<UpstreamAuthTelemetryEvent, 'requestId'>): Promise<void> {
    if (!requestId || !this.dependencies.telemetry) return;
    try { await this.dependencies.telemetry.record({ requestId, ...event }); } catch { /* Telemetry cannot alter verification. */ }
  }
}

/** Compatibility name for verifier tests; controllers depend on the common upstream boundary. */
export class MultiProfileInfrastructureError extends UpstreamIdentityServiceUnavailableError {
  constructor() {
    super();
    this.name = 'MultiProfileInfrastructureError';
    this.message = 'Multi-profile verification cannot be completed.';
  }
}

function eligible(profile: CandidateTrustProfile): boolean {
  return profile.enabled === true && profile.lifecycle === 'active';
}
