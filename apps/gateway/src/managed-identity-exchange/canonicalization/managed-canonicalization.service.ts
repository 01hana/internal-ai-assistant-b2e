import {
  type CanonicalManagedIdentity,
  type ManagedCanonicalizationPort,
  type VerifiedExternalIdentity,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError
} from '../domain/managed-exchange.domain';
import type { ManagedIntegrationExchangeConfigRepository } from '../persistence/managed-exchange.repository';

type ConfigReader = Pick<ManagedIntegrationExchangeConfigRepository, 'findById'>;

/** Projects only immutable verified identity and active registered configuration. */
export class ManagedCanonicalizationService implements ManagedCanonicalizationPort {
  constructor(private readonly configs: ConfigReader) {}

  async canonicalize(input: Readonly<{
    identity: VerifiedExternalIdentity;
    integrationConfigId: string;
    permissionScopes: readonly string[];
  }>): Promise<CanonicalManagedIdentity> {
    try {
      const config = await this.configs.findById(input.integrationConfigId);
      if (!config || config.id !== input.integrationConfigId || config.enabled !== true || config.lifecycle !== 'active') {
        throw new ManagedExchangeIdentityDeniedError();
      }

      const identity = identityRecord(input.identity);
      const integrationId = requiredText(config.integrationId);
      const subject = requiredText(identity.subject);
      const hostApp = requiredText(config.canonicalHostApp);
      const organizationId = organization(config.organizationMode, config.fixedOrganizationId, identity.organization);
      const permissionScopes = scopes(input.permissionScopes);
      const roles = Object.freeze([]) as readonly [];

      return Object.freeze({ integrationId, subject, organizationId, hostApp, roles, permissionScopes });
    } catch (error) {
      if (error instanceof ManagedExchangeIdentityDeniedError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function organization(mode: unknown, fixedOrganizationId: unknown, verifiedOrganization: unknown): string {
  if (mode === 'verified') {
    if (fixedOrganizationId !== null && fixedOrganizationId !== undefined) throw new ManagedExchangeIdentityDeniedError();
    return requiredText(verifiedOrganization);
  }
  if (mode === 'fixed_single_organization') return requiredText(fixedOrganizationId);
  throw new ManagedExchangeIdentityDeniedError();
}

function scopes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new ManagedExchangeIdentityDeniedError();
  return Object.freeze(value.map(requiredText));
}

function identityRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ManagedExchangeIdentityDeniedError();
  return value as Readonly<Record<string, unknown>>;
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  })) {
    throw new ManagedExchangeIdentityDeniedError();
  }
  return value;
}
