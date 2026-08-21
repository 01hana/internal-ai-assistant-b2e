import { type IntegrationAdmissionPort, type VerifiedExternalIdentity, ManagedExchangeIdentityDeniedError, ManagedExchangeInfrastructureError } from '../domain/managed-exchange.domain';
import type { ManagedIntegrationAdmissionPolicyRepository } from '../persistence/managed-exchange.repository';

type Requirement = Readonly<{ kind: string; allowedValues: readonly string[] }>;
type PolicyReader = Pick<ManagedIntegrationAdmissionPolicyRepository, 'findEnabledActiveByConfigId'>;

/** Exact server-policy admission over immutable, provider-verified anchors only. */
export class IntegrationAdmissionService implements IntegrationAdmissionPort {
  constructor(private readonly policies: PolicyReader) {}

  async admit(input: Readonly<{ identity: VerifiedExternalIdentity; integrationConfigId: string }>): Promise<void> {
    try {
      const policies = await this.policies.findEnabledActiveByConfigId(input.integrationConfigId);
      if (policies.length !== 1) throw new ManagedExchangeIdentityDeniedError();
      const policy = policies[0];
      if (policy.integrationConfigId !== input.integrationConfigId || policy.enabled !== true || policy.lifecycle !== 'active') throw new ManagedExchangeIdentityDeniedError();
      const requirements = parseRequirements(policy.anchorRequirements);
      const anchors = verifiedAnchors(input.identity);
      for (const requirement of requirements) {
        const values = anchors.get(requirement.kind);
        if (!values || values.size !== 1 || !requirement.allowedValues.includes([...values][0])) throw new ManagedExchangeIdentityDeniedError();
      }
    } catch (error) {
      if (error instanceof ManagedExchangeIdentityDeniedError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function parseRequirements(value: unknown): readonly Requirement[] {
  if (!Array.isArray(value) || value.length === 0) throw new ManagedExchangeIdentityDeniedError();
  const kinds = new Set<string>();
  return value.map((item) => {
    if (!plain(item) || !Array.isArray(item.allowedValues) || item.allowedValues.length === 0) throw new ManagedExchangeIdentityDeniedError();
    const kind = text(item.kind);
    if (kinds.has(kind)) throw new ManagedExchangeIdentityDeniedError();
    const allowedValues = item.allowedValues.map(text);
    if (new Set(allowedValues).size !== allowedValues.length) throw new ManagedExchangeIdentityDeniedError();
    kinds.add(kind);
    return Object.freeze({ kind, allowedValues: Object.freeze(allowedValues) });
  });
}

function verifiedAnchors(identity: VerifiedExternalIdentity): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const anchor of identity.anchors) { const values = result.get(anchor.kind) ?? new Set<string>(); values.add(anchor.value); result.set(anchor.kind, values); }
  return result;
}
function plain(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].some((character) => (character.codePointAt(0) ?? 0) <= 31 || character.codePointAt(0) === 127)) {
    throw new ManagedExchangeIdentityDeniedError();
  }
  return value;
}
