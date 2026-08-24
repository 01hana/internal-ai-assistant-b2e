import { ManagedExchangeIdentityDeniedError, type NormalizedPermission, type PermissionNormalizer, type TrustedPermissionMaterial } from '../../../src/managed-identity-exchange/domain/managed-exchange.domain';

const MATERIAL_KIND = 'synthetic-idx-permission-material/v1';
const MATERIAL_KEYS = ['kind', 'reference', 'values'] as const;

/** Test-only fixed normalizer used to exercise provider-specific registration. */
export class SyntheticIdxPermissionNormalizerFixture implements PermissionNormalizer {
  readonly normalizerType = 'synthetic-idx-permission/v1';

  normalize(material: TrustedPermissionMaterial): readonly NormalizedPermission[] {
    try {
      if (!record(material) || !only(material, MATERIAL_KEYS) || material.kind !== MATERIAL_KIND) throw new ManagedExchangeIdentityDeniedError();
      if (material.reference !== undefined) text(material.reference);
      if (material.values !== undefined && !Array.isArray(material.values)) throw new ManagedExchangeIdentityDeniedError();

      const result: NormalizedPermission[] = [];
      const seen = new Set<string>();
      for (const value of material.values ?? []) {
        const permission = fixedPermission(text(value));
        const key = `${permission.subject}:${permission.action}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(Object.freeze(permission));
        }
      }
      return Object.freeze(result);
    } catch {
      throw new ManagedExchangeIdentityDeniedError();
    }
  }
}

function fixedPermission(value: string): NormalizedPermission {
  if (value === 'fixture-orders-read') return { subject: 'orders', action: 'read' };
  if (value === 'fixture-orders-update') return { subject: 'orders', action: 'update' };
  throw new ManagedExchangeIdentityDeniedError();
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeIdentityDeniedError();
  const normalized = value.trim();
  if (!normalized || control(normalized)) throw new ManagedExchangeIdentityDeniedError();
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
