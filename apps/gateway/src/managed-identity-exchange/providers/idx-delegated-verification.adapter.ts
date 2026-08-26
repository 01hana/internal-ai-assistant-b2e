import {
  createVerifiedExternalIdentity,
  type IdentityProviderAdapter,
  type VerifyNativeCredentialInput,
  type VerifiedExternalIdentity,
  ManagedExchangeCredentialError,
  ManagedExchangeIdentityDeniedError,
  ManagedExchangeInfrastructureError,
} from '../domain/managed-exchange.domain';
import { ProviderContractValidatorRegistry } from '../persistence/managed-contract-registries';
import { DelegatedEndpointPolicy } from './delegated-endpoint.policy';
import type { DelegatedHttpTransport } from './delegated-http.transport';
import { IdxMenuDetailValidator } from './idx-menu-detail.validator';

type Transport = Pick<DelegatedHttpTransport, 'execute'>;
type MenuDetailValidator = Pick<IdxMenuDetailValidator, 'validate'>;
export type IdxNativeClaimParser = (credential: string) => Record<string, unknown>;

/** Provider-local IDX mapping after protected-endpoint and MenuDetail acceptance. */
export class IdxDelegatedVerificationAdapter implements IdentityProviderAdapter {
  readonly providerType = 'idx_delegated';

  constructor(
    private readonly transport?: Transport,
    private readonly menuDetailValidator: MenuDetailValidator = new IdxMenuDetailValidator(),
    private readonly parseAcceptedClaims: IdxNativeClaimParser = parseAcceptedNativeClaims,
    private readonly contracts = new ProviderContractValidatorRegistry(),
    private readonly endpoints = new DelegatedEndpointPolicy(),
  ) {}

  async verify(input: VerifyNativeCredentialInput): Promise<VerifiedExternalIdentity> {
    try {
      this.contracts.validate(input.providerInstancePolicy.providerType, input.providerInstancePolicy.responseContractVersion, input.providerInstancePolicy.providerContract);
      this.endpoints.validate(input.providerInstancePolicy);
      assertIdxAnchorContract(input.providerInstancePolicy.declaredAnchorKinds);
      if (!this.transport) throw new ManagedExchangeInfrastructureError();
      const response = await this.transport.execute(input);
      const menus = this.menuDetailValidator.validate(response.body);
      const claims = this.parseAcceptedClaims(input.nativeCredential);
      const subject = identifier(claims.sub);
      const user = identifier(claims.UUID_User);
      const organization = identifier(claims.UUID_Company);
      const entry = identifier(claims.UUID_Entry);
      if (subject !== user) throw new ManagedExchangeCredentialError();
      return createVerifiedExternalIdentity({ subject, organization, anchors: [{ kind: 'idx_entry', value: entry }], trustedPermissionMaterial: { kind: 'idx-menu-detail/v1', menus } });
    } catch (error) {
      if (error instanceof ManagedExchangeCredentialError || error instanceof ManagedExchangeIdentityDeniedError || error instanceof ManagedExchangeInfrastructureError) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }
}

function assertIdxAnchorContract(value: readonly string[]): void {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'idx_entry') throw new ManagedExchangeInfrastructureError();
}

function parseAcceptedNativeClaims(credential: string): Record<string, unknown> {
  if (typeof credential !== 'string') throw new ManagedExchangeCredentialError();
  const segments = credential.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) throw new ManagedExchangeCredentialError();
  try {
    const payload = decodeBase64Url(segments[1]);
    const value: unknown = JSON.parse(payload);
    if (!plainRecord(value)) throw new ManagedExchangeCredentialError();
    return value;
  } catch (error) {
    if (error instanceof ManagedExchangeCredentialError) throw error;
    throw new ManagedExchangeCredentialError();
  }
}

function decodeBase64Url(segment: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) throw new ManagedExchangeCredentialError();
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(segment, 'base64url'));
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001F\u007F]/.test(value)) throw new ManagedExchangeCredentialError();
  return value;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
