import { ManagedExchangeIdentityDeniedError, type NormalizedPermission } from '../domain/managed-exchange.domain';
import { ProjectionContractValidator } from '../persistence/managed-contract-registries';

const PERMISSION_KEYS = ['subject', 'action'] as const;

/** Constrained V1 normalized-permission to canonical-scope projection. */
export class ManagedPermissionScopeProjector {
  constructor(private readonly contracts = new ProjectionContractValidator()) {}

  project(permissions: readonly NormalizedPermission[], projectionContractVersion: string, projectionContract: Readonly<Record<string, unknown>>): readonly string[] {
    try {
      this.contracts.validate(projectionContractVersion, projectionContract);
      if (!Array.isArray(permissions)) throw new ManagedExchangeIdentityDeniedError();
      const seen = new Set<string>();
      const scopes: string[] = [];
      for (const permission of permissions) {
        if (!record(permission) || !exact(permission, PERMISSION_KEYS)) throw new ManagedExchangeIdentityDeniedError();
        const scope = `${segment(permission.subject)}:${segment(permission.action)}`;
        if (!seen.has(scope)) {
          seen.add(scope);
          scopes.push(scope);
        }
      }
      return Object.freeze(scopes);
    } catch {
      throw new ManagedExchangeIdentityDeniedError();
    }
  }
}

function segment(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeIdentityDeniedError();
  const normalized = value.trim();
  if (!normalized || normalized.includes(':') || [...normalized].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  })) throw new ManagedExchangeIdentityDeniedError();
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
