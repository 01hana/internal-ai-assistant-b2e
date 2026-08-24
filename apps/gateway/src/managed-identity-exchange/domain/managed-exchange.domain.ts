/** Provider-neutral, immutable values and ports for the managed exchange boundary. */
import type { KeyLike } from 'jose';

export const EXCHANGE_REQUEST_FIELDS = Object.freeze(['integrationSelector'] as const);
export const EXCHANGE_PUBLIC_ERROR_CODES = Object.freeze([
  'EXCHANGE_REQUEST_INVALID', 'EXCHANGE_IDENTITY_INVALID', 'EXCHANGE_IDENTITY_DENIED', 'EXCHANGE_SERVICE_UNAVAILABLE'
] as const);

export type ExchangePublicErrorCode = typeof EXCHANGE_PUBLIC_ERROR_CODES[number];
/** Immutable, server-provisioned and validated adapter configuration. It is never browser input or an expression mapper. */
export type ServerProvisionedContract = Readonly<Record<string, unknown>>;
export type VerifiedAnchor = Readonly<{ kind: string; value: string }>;
export type TrustedPermissionMaterial = Readonly<{ kind: string; reference?: string; values?: readonly string[] }>;
export type NormalizedPermission = Readonly<{ subject: string; action: string }>;

export type VerifiedExternalIdentity = Readonly<{
  subject: string;
  organization?: string;
  anchors: readonly VerifiedAnchor[];
  trustedPermissionReference?: string;
  trustedPermissionMaterial?: TrustedPermissionMaterial;
  providerSubjectReference?: string;
}>;

export type CanonicalManagedIdentity = Readonly<{
  integrationId: string;
  subject: string;
  organizationId: string;
  hostApp: string;
  roles: readonly [];
  permissionScopes: readonly string[];
}>;

export type ProviderInstancePolicy = Readonly<{
  id: string;
  providerType: string;
  endpointUri: string;
  httpMethod: string;
  credentialPlacement: string;
  timeoutMilliseconds: number;
  responseContractVersion: string;
  declaredAnchorKinds: readonly string[];
  providerContract: ServerProvisionedContract;
}>;

export type VerifyNativeCredentialInput = Readonly<{
  nativeCredential: string;
  providerInstancePolicy: ProviderInstancePolicy;
  requestId: string;
}>;

export interface IdentityProviderAdapter {
  readonly providerType: string;
  verify(input: VerifyNativeCredentialInput): Promise<VerifiedExternalIdentity>;
}

export interface IdentityProviderAdapterRegistry {
  resolve(providerType: string): IdentityProviderAdapter | undefined;
}

/** Narrow runtime source selector; provisioning-only details never reach an adapter. */
export type PermissionSourcePolicy = Readonly<{
  id: string;
  sourceType: string;
  adapterContractReference: string;
}>;

export type ResolvePermissionInput = Readonly<{
  admittedIdentity: VerifiedExternalIdentity;
  trustedPermissionReference?: string;
  trustedPermissionMaterial?: TrustedPermissionMaterial;
  serverOwnedIntegrationContext: Readonly<{ integrationId: string; hostApp: string }>;
  serviceCredentialReference?: string;
  permissionSourcePolicy: PermissionSourcePolicy;
  requestId: string;
}>;

export interface PermissionSourceAdapter {
  readonly sourceType: string;
  resolve(input: ResolvePermissionInput): Promise<TrustedPermissionMaterial>;
}

export interface PermissionSourceAdapterRegistry {
  resolve(sourceType: string): PermissionSourceAdapter | undefined;
}

export interface PermissionNormalizer {
  readonly normalizerType: string;
  normalize(material: TrustedPermissionMaterial): readonly NormalizedPermission[];
}

/** Lookup only; implementations are fixed deployment registries, never browser-selected plugins. */
export interface PermissionNormalizerRegistry {
  resolve(normalizerType: string): PermissionNormalizer | undefined;
}

export interface IntegrationAdmissionPort {
  admit(input: Readonly<{ identity: VerifiedExternalIdentity; integrationConfigId: string }>): Promise<void>;
}

export interface ManagedCanonicalizationPort {
  canonicalize(input: Readonly<{ identity: VerifiedExternalIdentity; integrationConfigId: string; permissionScopes: readonly string[] }>): Promise<CanonicalManagedIdentity>;
}

export interface ManagedTokenIssuer {
  issue(identity: CanonicalManagedIdentity): Promise<Readonly<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number; jti: string; kid: string }>>;
}

export interface ManagedSigningKeyProvider {
  findActive(): Promise<Readonly<{ issuer: string; audience: string; kid: string; privateKey: KeyLike }>>;
}

export interface ManagedExchangeAuditPort {
  append(input: Readonly<{ requestId: string; outcome: 'success' | 'denied' | 'unavailable'; reasonCode: string; integrationId?: string; integrationConfigId?: string; providerType?: string; providerInstanceId?: string; jti?: string; kid?: string }>): Promise<void>;
}

export class ManagedExchangeRequestError extends Error {
  readonly category = 'request' as const;
  constructor() { super('Managed identity exchange request is invalid.'); }
}

export class ManagedExchangeCredentialError extends Error {
  readonly category = 'credential' as const;
  constructor() { super('Managed identity exchange identity is invalid.'); }
}

export class ManagedExchangeIdentityDeniedError extends Error {
  readonly category = 'denial' as const;
  constructor() { super('Managed identity exchange identity is denied.'); }
}

export class ManagedExchangeInfrastructureError extends Error {
  readonly category = 'infrastructure' as const;
  constructor() { super('Managed identity exchange is unavailable.'); }
}

export class ManagedExchangeIssuanceError extends Error {
  readonly category = 'issuance' as const;
  constructor() { super('Managed identity exchange cannot issue a credential.'); }
}

export function createPublicSelector(value: string): string {
  return required(value, ManagedExchangeRequestError);
}

export function createVerifiedExternalIdentity(input: Readonly<{
  subject: string;
  organization?: string;
  anchors: readonly VerifiedAnchor[];
  trustedPermissionReference?: string;
  trustedPermissionMaterial?: TrustedPermissionMaterial;
  providerSubjectReference?: string;
}>): VerifiedExternalIdentity {
  if (!input || typeof input !== 'object' || Object.prototype.hasOwnProperty.call(input, 'nativeCredential')) throw new ManagedExchangeCredentialError();
  const anchors = input.anchors.map((anchor) => Object.freeze({ kind: required(anchor?.kind, ManagedExchangeCredentialError), value: required(anchor?.value, ManagedExchangeCredentialError) }));
  if (anchors.length === 0) throw new ManagedExchangeCredentialError();
  return Object.freeze({
    subject: required(input.subject, ManagedExchangeCredentialError),
    ...optional('organization', input.organization, ManagedExchangeCredentialError),
    anchors: Object.freeze(anchors),
    ...optional('trustedPermissionReference', input.trustedPermissionReference, ManagedExchangeCredentialError),
    ...optionalMaterial(input.trustedPermissionMaterial),
    ...optional('providerSubjectReference', input.providerSubjectReference, ManagedExchangeCredentialError)
  });
}

function optional(key: string, value: string | undefined, ErrorType: new () => Error): Record<string, string> {
  return value === undefined ? {} : { [key]: required(value, ErrorType) };
}

function optionalMaterial(value: TrustedPermissionMaterial | undefined): Record<string, TrustedPermissionMaterial> {
  if (!value) return {};
  const kind = required(value.kind, ManagedExchangeCredentialError);
  const reference = value.reference === undefined ? undefined : required(value.reference, ManagedExchangeCredentialError);
  const values = value.values === undefined ? undefined : Object.freeze(value.values.map((item) => required(item, ManagedExchangeCredentialError)));
  return { trustedPermissionMaterial: Object.freeze({ kind, ...(reference === undefined ? {} : { reference }), ...(values === undefined ? {} : { values }) }) };
}

function required(value: string | undefined, ErrorType: new () => Error): string {
  if (typeof value !== 'string') throw new ErrorType();
  const normalized = value.trim();
  if (!normalized || containsControlCharacter(normalized)) throw new ErrorType();
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
