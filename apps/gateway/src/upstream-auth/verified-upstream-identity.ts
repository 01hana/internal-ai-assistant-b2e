import { UpstreamAuthenticationError } from './upstream-auth.error';

export type VerifiedUpstreamIdentity = Readonly<{
  integrationId: string;
  subject: string;
  organizationId: string;
  hostApp: string;
  roles: readonly string[];
  permissionScopes: readonly string[];
}>;

export function createVerifiedUpstreamIdentity(claims: Record<string, unknown>): VerifiedUpstreamIdentity {
  return Object.freeze({
    integrationId: requiredString(claims.integration_id),
    subject: requiredString(claims.sub),
    organizationId: requiredString(claims.org_id),
    hostApp: requiredString(claims.host_app),
    roles: Object.freeze(requiredStringArray(claims.roles)),
    permissionScopes: Object.freeze(requiredStringArray(claims.permission_scopes))
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new UpstreamAuthenticationError('invalid_claim_shape');
  return value.trim();
}

function requiredStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new UpstreamAuthenticationError('invalid_claim_shape');
  return value.map((entry) => requiredString(entry));
}
