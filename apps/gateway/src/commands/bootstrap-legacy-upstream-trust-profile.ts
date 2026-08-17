import type { GatewayUpstreamVerificationConfig } from '../config/gateway-config.service';
import type { TrustProfileRecord } from '../integration-registry/trust-profile.repository';
import type { ProvisionTrustProfileInput, ProvisionTrustProfileResult } from './provision-trust-profile';

const PROFILE_ID_PREFIX = 'legacy-upstream-bootstrap:';

type LegacyConfig = Readonly<{ bootstrapUpstreamVerification: GatewayUpstreamVerificationConfig }>;
type ProfileLookup = Readonly<{ findByIntegrationId(integrationId: string): Promise<readonly TrustProfileRecord[]> }>;
type ProfileProvisioner = Readonly<{ execute(input: ProvisionTrustProfileInput): Promise<ProvisionTrustProfileResult> }>;

export type BootstrapLegacyUpstreamTrustProfileInput = Readonly<{ integrationId: string; requestId: string }>;
export type BootstrapLegacyUpstreamTrustProfileResult = Readonly<{ id: string; integrationId: string; changed: boolean }>;

/** Deployment-controlled migration input; it is not a runtime provider or HTTP surface. */
export class BootstrapLegacyUpstreamTrustProfileCommand {
  constructor(private readonly dependencies: Readonly<{ config: LegacyConfig; profiles: ProfileLookup; provision: ProfileProvisioner }>) {}

  async execute(input: BootstrapLegacyUpstreamTrustProfileInput): Promise<BootstrapLegacyUpstreamTrustProfileResult> {
    const normalized = normalize(input);
    try {
      const policy = this.dependencies.config.bootstrapUpstreamVerification;
      const existing = await this.dependencies.profiles.findByIntegrationId(normalized.integrationId);
      const active = existing.filter(isActive);
      const candidate = bootstrapProfile(normalized, policy);
      if (active.length > 0) {
        if (active.length === 1 && samePolicy(active[0], candidate)) return Object.freeze({ id: active[0].id, integrationId: active[0].integrationId, changed: false });
        throw new BootstrapLegacyUpstreamTrustProfileError();
      }
      const profile = await this.dependencies.provision.execute(candidate);
      return Object.freeze({ id: profile.id, integrationId: profile.integrationId, changed: profile.changed });
    } catch {
      throw new BootstrapLegacyUpstreamTrustProfileError();
    }
  }
}

function normalize(input: BootstrapLegacyUpstreamTrustProfileInput): Readonly<{ integrationId: string; requestId: string }> {
  if (!input || typeof input.integrationId !== 'string' || !input.integrationId.trim() || typeof input.requestId !== 'string' || !input.requestId.trim()) throw new BootstrapLegacyUpstreamTrustProfileError();
  return Object.freeze({ integrationId: input.integrationId.trim(), requestId: input.requestId.trim() });
}

function bootstrapProfile(input: Readonly<{ integrationId: string; requestId: string }>, policy: GatewayUpstreamVerificationConfig): ProvisionTrustProfileInput {
  return Object.freeze({
    action: 'create', requestId: input.requestId, id: `${PROFILE_ID_PREFIX}${input.integrationId}`, integrationId: input.integrationId,
    expectedIssuer: policy.issuer, expectedAudience: policy.audience, jwksUri: policy.jwksUri,
    algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: undefined
  });
}

function isActive(profile: TrustProfileRecord): boolean { return profile.enabled === true && profile.lifecycle === 'active'; }
function samePolicy(profile: TrustProfileRecord, candidate: ProvisionTrustProfileInput): boolean {
  return profile.integrationId === candidate.integrationId && profile.expectedIssuer === candidate.expectedIssuer && profile.expectedAudience === candidate.expectedAudience && profile.jwksUri === candidate.jwksUri && profile.algorithm === candidate.algorithm && profile.enabled === candidate.enabled && profile.lifecycle === candidate.lifecycle && profile.version === candidate.version && (profile.replacesProfileId ?? undefined) === (candidate.replacesProfileId ?? undefined);
}

export class BootstrapLegacyUpstreamTrustProfileError extends Error {
  constructor() { super('Legacy upstream trust-profile bootstrap cannot be completed.'); this.name = 'BootstrapLegacyUpstreamTrustProfileError'; }
}
