import { ManagedExchangeIdentityDeniedError, type NormalizedPermission, type PermissionNormalizer, type TrustedPermissionMaterial } from '../domain/managed-exchange.domain';

const MATERIAL_KEYS = ['kind', 'reference', 'values'] as const;
const MATERIAL_KIND = 'managed-permission-material/v1';

/** Provider-neutral V1 normalizer for server-trusted synthetic material. */
export class SyntheticV1PermissionNormalizer implements PermissionNormalizer {
  readonly normalizerType = 'synthetic-normalizer/v1';

  normalize(material: TrustedPermissionMaterial): readonly NormalizedPermission[] {
    try {
      if (!record(material) || !only(material, MATERIAL_KEYS) || material.kind !== MATERIAL_KIND) throw new ManagedExchangeIdentityDeniedError();
      text(material.kind);
      if (material.reference !== undefined) text(material.reference);
      if (material.values !== undefined && !Array.isArray(material.values)) throw new ManagedExchangeIdentityDeniedError();

      const seen = new Set<string>();
      const result: NormalizedPermission[] = [];
      for (const value of material.values ?? []) {
        const parts = text(value).split(':');
        if (parts.length !== 2) throw new ManagedExchangeIdentityDeniedError();
        const subject = segment(parts[0]);
        const action = segment(parts[1]);
        const key = `${subject}:${action}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(Object.freeze({ subject, action }));
        }
      }
      return Object.freeze(result);
    } catch {
      throw new ManagedExchangeIdentityDeniedError();
    }
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new ManagedExchangeIdentityDeniedError();
  const normalized = value.trim();
  if (!normalized || control(normalized)) throw new ManagedExchangeIdentityDeniedError();
  return normalized;
}

function segment(value: unknown): string {
  const normalized = text(value);
  if (normalized.includes(':')) throw new ManagedExchangeIdentityDeniedError();
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
