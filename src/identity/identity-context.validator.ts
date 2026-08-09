import { CANONICAL_INTERNAL_IDENTITY_CLAIM_NAMES } from '@internal-ai-assistant/internal-identity-contract';
import { CanonicalIdentityContext } from './identity-context.types';
import { IdentityContextException } from './identity.errors';

export function validateVerifiedInternalIdentityClaims(input: {
  claims: Record<string, unknown>;
  issuer: string;
}): CanonicalIdentityContext {
  const [customerClaim, integrationClaim, actorClaim, organizationClaim, hostAppClaim, rolesClaim, permissionScopesClaim, tokenIdClaim] =
    CANONICAL_INTERNAL_IDENTITY_CLAIM_NAMES;
  const customerId = requireString(input.claims[customerClaim], customerClaim);
  const integrationId = requireString(input.claims[integrationClaim], integrationClaim);
  const actorId = requireString(input.claims[actorClaim], actorClaim);
  const organizationId = requireString(input.claims[organizationClaim], organizationClaim);
  const hostApp = requireString(input.claims[hostAppClaim], hostAppClaim);
  const tokenId = requireString(input.claims[tokenIdClaim], tokenIdClaim);
  const roles = requireStringArray(input.claims[rolesClaim], rolesClaim);
  const permissionScopes = requireStringArray(input.claims[permissionScopesClaim], permissionScopesClaim);

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
