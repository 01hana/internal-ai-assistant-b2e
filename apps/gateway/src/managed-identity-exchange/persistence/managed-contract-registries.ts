import { ManagedExchangeActivationError } from './managed-exchange-activation.validator';

type Contract = Readonly<Record<string, unknown>>;
export const DELEGATED_HTTP_V1_ANCHOR_SCHEMA = 'managed-verified-anchors/v1';
export const DELEGATED_HTTP_V1_RESPONSE_SCHEMA = 'managed-verified-identity/v1';
export const IDX_MENU_DETAIL_V1_RESPONSE_SCHEMA = 'idx-menu-detail/v1';
export const IDX_MENU_DETAIL_V1_CONTENT_TYPE = 'application/json';
export const SYNTHETIC_PERMISSION_V1_MATERIAL_SCHEMA = 'managed-permission-material/v1';
export const MANAGED_PERMISSION_V1_SCOPE_SCHEMA = 'managed-normalized-scopes/v1';

/** Fixed server-owned V1 contract allowlists; they are not a plugin mechanism. */
export class ProviderContractValidatorRegistry {
  validate(providerType: string, version: string, contract: Contract): void {
    if (providerType === 'delegated_http' && version === 'delegated-http/v1') {
      assertKnownObject(contract, ['anchorSchema', 'responseSchema']);
      if (contract.anchorSchema !== DELEGATED_HTTP_V1_ANCHOR_SCHEMA || contract.responseSchema !== DELEGATED_HTTP_V1_RESPONSE_SCHEMA) throw new ManagedExchangeActivationError();
      return;
    }
    if (providerType === 'idx_delegated' && version === 'idx-menu-detail/v1') {
      assertKnownObject(contract, ['responseSchema', 'contentType']);
      if (contract.responseSchema !== IDX_MENU_DETAIL_V1_RESPONSE_SCHEMA || contract.contentType !== IDX_MENU_DETAIL_V1_CONTENT_TYPE) throw new ManagedExchangeActivationError();
      return;
    }
    throw new ManagedExchangeActivationError();
  }
  isActiveEligible(providerType: string, version: string): boolean {
    return (providerType === 'delegated_http' && version === 'delegated-http/v1') ||
      (providerType === 'idx_delegated' && version === 'idx-menu-detail/v1');
  }
}

export class PermissionSourceContractValidatorRegistry {
  validate(sourceType: string, reference: string, contract: Contract): void {
    if (sourceType !== 'synthetic' || reference !== 'synthetic/v1') throw new ManagedExchangeActivationError();
    assertKnownObject(contract, ['materialSchema']);
    if (contract.materialSchema !== SYNTHETIC_PERMISSION_V1_MATERIAL_SCHEMA) throw new ManagedExchangeActivationError();
  }
}

export class ProjectionContractValidator {
  validate(version: string, contract: Contract): void {
    if (version !== 'managed-permissions/v1') throw new ManagedExchangeActivationError();
    assertKnownObject(contract, ['scopeSchema']);
    if (contract.scopeSchema !== MANAGED_PERMISSION_V1_SCOPE_SCHEMA) throw new ManagedExchangeActivationError();
  }
}

function assertKnownObject(value: Contract, keys: readonly string[]): void {
  if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new ManagedExchangeActivationError();
  const text = JSON.stringify(value).toLowerCase();
  if (/jsonpath|\$\.|expression|\beval\b|browser|native.?credential|authorization|raw.?jwt|callback/.test(text)) throw new ManagedExchangeActivationError();
}
function plain(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
