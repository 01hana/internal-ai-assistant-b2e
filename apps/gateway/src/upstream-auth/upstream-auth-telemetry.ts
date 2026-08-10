import type { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import type { VerifiedUpstreamIdentity } from './verified-upstream-identity';

export class UpstreamAuthTelemetry {
  constructor(private readonly writer: Pick<GatewayIdentityAuditWriter, 'append'>) {}

  recordDenied(input: Readonly<{ requestId: string }>) {
    return this.writer.append({ requestId: input.requestId, eventType: 'upstream_auth_denied', outcome: 'denied', reasonCode: 'upstream_auth_invalid' });
  }

  recordVerified(input: Readonly<{ requestId: string; identity: VerifiedUpstreamIdentity }>) {
    return this.writer.append({
      requestId: input.requestId, eventType: 'upstream_auth_verified', outcome: 'success', reasonCode: 'verified',
      integrationId: input.identity.integrationId, actorId: input.identity.subject, hostApp: input.identity.hostApp
    });
  }
}
