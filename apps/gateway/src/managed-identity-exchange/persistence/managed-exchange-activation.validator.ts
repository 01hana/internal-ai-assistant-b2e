import type { ProviderInstancePolicy, ServerProvisionedContract } from '../domain/managed-exchange.domain';
import { DelegatedEndpointPolicy } from '../providers/delegated-endpoint.policy';
import { PermissionSourceContractValidatorRegistry, ProjectionContractValidator, ProviderContractValidatorRegistry } from './managed-contract-registries';

export class ManagedExchangeActivationError extends Error {
  constructor() { super('Managed exchange configuration cannot be activated.'); }
}

/** Validates provisioned policy only. It never calls an adapter or a remote endpoint. */
export class ManagedExchangeActivationValidator {
  constructor(private readonly providers = new ProviderContractValidatorRegistry(), private readonly sources = new PermissionSourceContractValidatorRegistry(), private readonly projections = new ProjectionContractValidator(), private readonly endpoints = new DelegatedEndpointPolicy()) {}
  validateProvider(input: Readonly<Record<string, unknown>>, requirePersistedId = true): ProviderInstancePolicy {
    const endpointUri = https(input.endpointUri);
    const type = required(input.providerType);
    if (input.httpMethod !== 'POST' || input.credentialPlacement !== 'authorization_bearer') throw new ManagedExchangeActivationError();
    const timeoutMilliseconds = input.timeoutMilliseconds;
    if (!Number.isInteger(timeoutMilliseconds) || typeof timeoutMilliseconds !== 'number' || timeoutMilliseconds < 1 || timeoutMilliseconds > 5_000) throw new ManagedExchangeActivationError();
    const responseContractVersion = required(input.responseContractVersion);
    const declaredAnchorKinds = strings(input.declaredAnchorKinds, true);
    if (new Set(declaredAnchorKinds).size !== declaredAnchorKinds.length) throw new ManagedExchangeActivationError();
    const providerContract = contract(input.contractConfig);
    this.providers.validate(type, responseContractVersion, providerContract);
    try { this.endpoints.validate({ providerType: type, endpointUri, httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds, responseContractVersion }); } catch { throw new ManagedExchangeActivationError(); }
    return Object.freeze({ id: requirePersistedId ? required(input.id) : optionalId(input.id), providerType: type, endpointUri, httpMethod: 'POST', credentialPlacement: 'authorization_bearer', timeoutMilliseconds, responseContractVersion, declaredAnchorKinds: Object.freeze(declaredAnchorKinds), providerContract });
  }

  validateAdmission(requirements: unknown): void {
    if (!Array.isArray(requirements) || requirements.length === 0) throw new ManagedExchangeActivationError();
    const seen = new Set<string>();
    for (const requirement of requirements) {
      if (!plain(requirement)) throw new ManagedExchangeActivationError();
      const kind = required(requirement.kind);
      const allowedValues = strings(requirement.allowedValues, true);
      if (new Set(allowedValues).size !== allowedValues.length || seen.has(kind)) throw new ManagedExchangeActivationError();
      seen.add(kind);
    }
  }

  validatePermissionSource(input: Readonly<Record<string, unknown>>): void {
    const sourceType = required(input.sourceType); const reference = required(input.adapterContractReference); const sourceContract = contract(input.contractConfig);
    this.sources.validate(sourceType, reference, sourceContract);
    if (input.endpointUri !== null && input.endpointUri !== undefined) https(input.endpointUri);
    optional(input.serviceCredentialReference);
    const serialized = JSON.stringify(input.contractConfig).toLowerCase();
    if (/native.?credential|browser.?authorization|raw.?jwt|callback.?data|jsonpath|\$\.|eval\(/.test(serialized)) throw new ManagedExchangeActivationError();
  }

  validatePermissionPolicy(input: Readonly<Record<string, unknown>>, hasActiveSource: boolean): void {
    if (input.mode !== 'allow_empty' && input.mode !== 'required') throw new ManagedExchangeActivationError();
    if (!hasActiveSource) {
      if (input.mode === 'required') throw new ManagedExchangeActivationError();
      if (input.normalizerType !== null && input.normalizerType !== undefined) throw new ManagedExchangeActivationError();
      if (input.projectionContractVersion !== null && input.projectionContractVersion !== undefined) throw new ManagedExchangeActivationError();
      if (input.projectionContract !== null && input.projectionContract !== undefined) throw new ManagedExchangeActivationError();
      return;
    }
    if (!nonBlank(input.normalizerType) || !nonBlank(input.projectionContractVersion) || input.projectionContract === null || input.projectionContract === undefined) throw new ManagedExchangeActivationError();
    this.projections.validate(required(input.projectionContractVersion), contract(input.projectionContract));
  }

  validateIssuer(input: Readonly<Record<string, unknown>>): void { https(input.issuer); required(input.expectedAudience); https(input.publicJwksUri); }
  validateSigningKey(input: Readonly<Record<string, unknown>>): void {
    required(input.kid); required(input.keyReference);
    const publicJwk = input.publicJwk;
    if (!plain(publicJwk) || publicJwk.kty !== 'RSA' || !nonBlank(publicJwk.n) || !nonBlank(publicJwk.e) ||
      ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((field) => field in publicJwk) ||
      (publicJwk.alg !== undefined && publicJwk.alg !== 'RS256') ||
      (publicJwk.use !== undefined && publicJwk.use !== 'sig')) throw new ManagedExchangeActivationError();
  }
}

function contract(value: unknown): ServerProvisionedContract {
  if (!plain(value)) throw new ManagedExchangeActivationError();
  const serialized = JSON.stringify(value).toLowerCase();
  if (/jsonpath|\$\.|expression|\beval\b|browser/.test(serialized)) throw new ManagedExchangeActivationError();
  return Object.freeze({ ...value });
}
function https(value: unknown): string { const text = required(value); try { const url = new URL(text); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(); return url.toString(); } catch { throw new ManagedExchangeActivationError(); } }
function strings(value: unknown, nonEmpty: boolean): string[] { if (!Array.isArray(value) || (nonEmpty && value.length === 0)) throw new ManagedExchangeActivationError(); return value.map(required); }
function required(value: unknown): string { if (!nonBlank(value)) throw new ManagedExchangeActivationError(); return value.trim(); }
function optionalId(value: unknown): string { return value === null || value === undefined ? '' : required(value); }
function optional(value: unknown): void { if (value !== null && value !== undefined) required(value); }
function nonBlank(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && [...value].every((character) => { const point = character.codePointAt(0) ?? 0; return point > 31 && point !== 127; }); }
function plain(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
