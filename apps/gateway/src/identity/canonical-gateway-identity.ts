import type { VerifiedUpstreamIdentity } from '../upstream-auth/verified-upstream-identity';

export type CanonicalGatewayIdentity = Readonly<{
  customerId: string;
  integrationId: string;
  subject: string;
  organizationId: string;
  hostApp: string;
  roles: readonly string[];
  permissionScopes: readonly string[];
}>;

export type IntegrationBindingAuthority = Readonly<{
  integrationId: string;
  customerId: string;
  allowedHostApp: string;
  enabled: boolean;
}>;

export class CanonicalIdentityCompositionError extends Error {}

/**
 * Explicitly composes durable authority only. JWT metadata and signing values
 * are intentionally absent until Phase 5.
 */
export function composeCanonicalGatewayIdentity(
  verifiedIdentity: VerifiedUpstreamIdentity,
  binding: IntegrationBindingAuthority
): CanonicalGatewayIdentity {
  const integrationId = requiredExactString(verifiedIdentity.integrationId);
  const subject = requiredExactString(verifiedIdentity.subject);
  const organizationId = requiredExactString(verifiedIdentity.organizationId);
  const hostApp = requiredExactString(verifiedIdentity.hostApp);
  const roles = frozenStringArray(verifiedIdentity.roles);
  const permissionScopes = frozenStringArray(verifiedIdentity.permissionScopes);
  const bindingIntegrationId = requiredExactString(binding.integrationId);
  const customerId = requiredExactString(binding.customerId);
  const allowedHostApp = requiredExactString(binding.allowedHostApp);

  if (binding.enabled !== true || bindingIntegrationId !== integrationId || allowedHostApp !== hostApp) {
    throw new CanonicalIdentityCompositionError();
  }

  return Object.freeze({ customerId, integrationId, subject, organizationId, hostApp, roles, permissionScopes });
}

function frozenStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new CanonicalIdentityCompositionError();
  return Object.freeze(value.map(requiredExactString));
}

function requiredExactString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || containsControlCharacter(value)) {
    throw new CanonicalIdentityCompositionError();
  }
  return value;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
