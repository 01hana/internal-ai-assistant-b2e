import type { GatewayIdentityAuditWriter } from '../audit/gateway-identity-audit.writer';
import {
  CanonicalIdentityCompositionError,
  composeCanonicalGatewayIdentity,
  type CanonicalGatewayIdentity,
  type IntegrationBindingAuthority
} from '../identity/canonical-gateway-identity';
import type { VerifiedUpstreamIdentity } from '../upstream-auth/verified-upstream-identity';
import type { IntegrationBindingRepository } from './integration-binding.repository';

type ResolutionDiagnosticReason =
  | 'unknown_binding'
  | 'disabled_binding'
  | 'binding_mismatch'
  | 'host_app_mismatch'
  | 'invalid_binding'
  | 'invalid_composed_identity';

export type ResolveCanonicalIdentityInput = Readonly<{
  identity: VerifiedUpstreamIdentity;
  requestId: string;
}>;

type BindingLookup = Pick<IntegrationBindingRepository, 'findByIntegrationId'>;
type ResolutionDenialTelemetry = Pick<GatewayIdentityAuditWriter, 'append'>;

export class IdentityResolutionError extends Error {
  readonly status = 403;
  readonly code = 'IDENTITY_ISSUANCE_DENIED';
  readonly #diagnosticReason: ResolutionDiagnosticReason;

  constructor(diagnosticReason: ResolutionDiagnosticReason) {
    super('Identity issuance cannot be completed.');
    this.#diagnosticReason = diagnosticReason;
  }

  /** Internal-only classification; it is intentionally not enumerable. */
  get diagnosticReason(): ResolutionDiagnosticReason {
    return this.#diagnosticReason;
  }
}

/** Resolves Customer authority only through the explicit IntegrationBinding key. */
export class CanonicalIdentityResolver {
  constructor(
    private readonly repository: BindingLookup,
    private readonly denialTelemetry: ResolutionDenialTelemetry
  ) {}

  async resolve(input: ResolveCanonicalIdentityInput): Promise<CanonicalGatewayIdentity> {
    try {
      const identity = input.identity;
      const integrationId = strictIdentityIntegrationId(identity);
      const binding = await this.repository.findByIntegrationId(integrationId);
      const bindingFailure = bindingDiagnostic(identity, binding);
      if (bindingFailure) throw new ResolutionDenied(bindingFailure);
      return composeCanonicalGatewayIdentity(identity, binding as IntegrationBindingAuthority);
    } catch (error) {
      const diagnosticReason = classifyResolutionFailure(error);
      await this.recordDenial(input, diagnosticReason);
      throw new IdentityResolutionError(diagnosticReason);
    }
  }

  private async recordDenial(input: ResolveCanonicalIdentityInput, _diagnosticReason: ResolutionDiagnosticReason): Promise<void> {
    try {
      const identity = input.identity;
      await this.denialTelemetry.append({
        requestId: input.requestId,
        eventType: 'identity_resolution_denied',
        outcome: 'denied',
        reasonCode: 'identity_issuance_denied',
        integrationId: safeIdentityScalar(identity?.integrationId),
        actorId: safeIdentityScalar(identity?.subject),
        hostApp: safeIdentityScalar(identity?.hostApp)
      });
    } catch {
      // There is no resolution mutation to roll back; retain the generic denial.
    }
  }
}

function bindingDiagnostic(identity: VerifiedUpstreamIdentity, binding: unknown): ResolutionDiagnosticReason | undefined {
  if (!binding || typeof binding !== 'object') return 'unknown_binding';
  const candidate = binding as Partial<IntegrationBindingAuthority>;
  if (candidate.enabled !== true) return 'disabled_binding';
  if (!isExactNonBlankString(candidate.integrationId) || !isExactNonBlankString(candidate.customerId) || !isExactNonBlankString(candidate.allowedHostApp)) {
    return 'invalid_binding';
  }
  if (candidate.integrationId !== identity.integrationId) return 'binding_mismatch';
  if (candidate.allowedHostApp !== identity.hostApp) return 'host_app_mismatch';
  return undefined;
}

function strictIdentityIntegrationId(identity: VerifiedUpstreamIdentity): string {
  if (!identity || !isExactNonBlankString(identity.integrationId)) throw new ResolutionDenied('invalid_composed_identity');
  return identity.integrationId;
}

function safeIdentityScalar(value: unknown): string | undefined {
  return isExactNonBlankString(value) ? value : undefined;
}

function isExactNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && !containsControlCharacter(value);
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

function classifyResolutionFailure(error: unknown): ResolutionDiagnosticReason {
  if (error instanceof ResolutionDenied) return error.reason;
  if (error instanceof CanonicalIdentityCompositionError) return 'invalid_composed_identity';
  return 'invalid_composed_identity';
}

class ResolutionDenied extends Error {
  constructor(readonly reason: ResolutionDiagnosticReason) {
    super(reason);
  }
}
