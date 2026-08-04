import { CanonicalIdentityContext } from './identity-context.types';
import { IdentityContextException } from './identity.errors';

export function validateVerifiedInternalIdentityClaims(input: {
  claims: Record<string, unknown>;
  issuer: string;
}): CanonicalIdentityContext {
  const customerId = requireString(input.claims.customer_id, 'customer_id');
  const integrationId = requireString(input.claims.integration_id, 'integration_id');
  const actorId = requireString(input.claims.sub, 'sub');
  const organizationId = requireString(input.claims.org_id, 'org_id');
  const hostApp = requireString(input.claims.host_app, 'host_app');
  const tokenId = requireString(input.claims.jti, 'jti');
  const roles = requireStringArray(input.claims.roles, 'roles');
  const permissionScopes = requireStringArray(input.claims.permission_scopes, 'permission_scopes');

  return {
    customer: { customerId, integrationId },
    organization: { organizationId },
    hostApp: { hostApp },
    actor: { actorId, roles, permissionScopes },
    auth: { tokenId, gatewayIssuer: requireString(input.issuer, 'issuer') }
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IdentityContextException([field]);
  }
  return value.trim();
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new IdentityContextException([field]);
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new IdentityContextException([field]);
    }
    return entry.trim();
  });
  return normalized;
}
