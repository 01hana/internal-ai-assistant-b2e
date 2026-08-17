import type { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import type { UpstreamProfileVerificationReason } from './profile-scoped-verifier';

export type UpstreamAuthTelemetryReason = UpstreamProfileVerificationReason
  | 'no_candidate'
  | 'profile_disabled'
  | 'profile_integration_mismatch'
  | 'ambiguous_profile_decision'
  | 'verified'
  | 'verification_infrastructure_unavailable';

export type UpstreamAuthTelemetryEvent = Readonly<{
  requestId: string;
  outcome: 'denied' | 'success';
  reasonCode: UpstreamAuthTelemetryReason;
  profileId?: string;
  integrationId?: string;
  actorId?: string;
  hostApp?: string;
}>;

export class UpstreamAuthTelemetry {
  constructor(private readonly writer: Pick<GatewayIdentityAuditWriter, 'append'>) {}

  /** Compatibility projection for existing redaction coverage; active profile telemetry uses record(). */
  recordDenied(input: Readonly<{ requestId: string }>) {
    return this.writer.append({ requestId: input.requestId, eventType: 'upstream_auth_denied', outcome: 'denied', reasonCode: 'upstream_auth_invalid' });
  }

  record(event: UpstreamAuthTelemetryEvent) {
    return this.writer.append({
      requestId: event.requestId,
      eventType: 'upstream_profile_verification',
      outcome: event.outcome,
      reasonCode: event.reasonCode,
      profileId: event.profileId,
      integrationId: event.integrationId,
      actorId: event.actorId,
      hostApp: event.hostApp
    });
  }
}
