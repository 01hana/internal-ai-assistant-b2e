import {
  createVerifiedExternalIdentity,
  type IdentityProviderAdapter,
  type VerifyNativeCredentialInput,
  type VerifiedAnchor,
  type VerifiedExternalIdentity,
  ManagedExchangeCredentialError,
  ManagedExchangeInfrastructureError
} from '../domain/managed-exchange.domain';
import { ProviderContractValidatorRegistry } from '../persistence/managed-contract-registries';
import type { DelegatedHttpTransport } from './delegated-http.transport';

type Transport = Pick<DelegatedHttpTransport, 'execute'>;
type V1Response = Readonly<{ subject: string; organization?: string; anchors: readonly VerifiedAnchor[]; trustedPermissionReference?: string }>;

/** Fixed delegated HTTP V1 response validator. */
export class DelegatedHttpV1Adapter implements IdentityProviderAdapter {
  readonly providerType = 'delegated_http';

  constructor(private readonly transport: Transport, private readonly contracts = new ProviderContractValidatorRegistry()) {}

  async verify(input: VerifyNativeCredentialInput): Promise<VerifiedExternalIdentity> {
    try {
      this.contracts.validate(input.providerInstancePolicy.providerType, input.providerInstancePolicy.responseContractVersion, input.providerInstancePolicy.providerContract);
      const response = await this.transport.execute(input);
      const parsed = parseResponse(response.body, input.providerInstancePolicy.declaredAnchorKinds);
      return createVerifiedExternalIdentity(parsed);
    } catch (error) {
      if (error instanceof ManagedExchangeCredentialError || error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function parseResponse(value: unknown, declaredAnchorKinds: readonly string[]): V1Response {
  if (!plain(value) || !only(value, ['subject', 'organization', 'anchors', 'trustedPermissionReference'])) throw new ManagedExchangeInfrastructureError();
  const subject = text(value.subject);
  const organization = value.organization === undefined ? undefined : text(value.organization);
  const trustedPermissionReference = value.trustedPermissionReference === undefined ? undefined : text(value.trustedPermissionReference);
  if (!Array.isArray(value.anchors) || value.anchors.length === 0) throw new ManagedExchangeInfrastructureError();
  const anchors = anchorsOf(value.anchors, declaredAnchorKinds);
  return Object.freeze({ subject, ...(organization === undefined ? {} : { organization }), anchors, ...(trustedPermissionReference === undefined ? {} : { trustedPermissionReference }) });
}

function anchorsOf(value: readonly unknown[], declared: readonly string[]): readonly VerifiedAnchor[] {
  const byKind = new Map<string, string>();
  for (const item of value) {
    if (!plain(item) || !only(item, ['kind', 'value'])) throw new ManagedExchangeInfrastructureError();
    const kind = text(item.kind);
    const anchorValue = text(item.value);
    if (!declared.includes(kind)) throw new ManagedExchangeInfrastructureError();
    const existing = byKind.get(kind);
    if (existing !== undefined && existing !== anchorValue) throw new ManagedExchangeInfrastructureError();
    byKind.set(kind, anchorValue);
  }
  return Object.freeze([...byKind].map(([kind, value]) => Object.freeze({ kind, value })));
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeInfrastructureError();
  const normalized = value.trim();
  if (!normalized || [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  })) throw new ManagedExchangeInfrastructureError();
  return normalized;
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function only(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
