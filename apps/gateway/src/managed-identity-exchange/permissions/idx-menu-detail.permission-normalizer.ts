import {
  IDX_TRUSTED_MENU_ACTIONS,
  ManagedExchangeIdentityDeniedError,
  type IdxTrustedMenuAction,
  type NormalizedPermission,
  type PermissionNormalizer,
  type TrustedPermissionMaterial
} from '../domain/managed-exchange.domain';

const MATERIAL_KEYS = ['kind', 'menus'] as const;
const MENU_KEYS = ['menuId', 'actions'] as const;
const MATERIAL_KIND = 'idx-menu-detail/v1';

/** Reduces closed semantic menu material into deterministic provider-neutral permission records. */
export class IdxMenuDetailPermissionNormalizer implements PermissionNormalizer {
  readonly normalizerType = MATERIAL_KIND;

  normalize(material: TrustedPermissionMaterial): readonly NormalizedPermission[] {
    try {
      if (!record(material) || !exact(material, MATERIAL_KEYS) || material.kind !== MATERIAL_KIND || !array(material.menus)) {
        throw new ManagedExchangeIdentityDeniedError();
      }

      const actionsByMenu = new Map<string, Set<IdxTrustedMenuAction>>();
      for (const menu of material.menus) {
        if (!record(menu) || !exact(menu, MENU_KEYS) || !array(menu.actions)) throw new ManagedExchangeIdentityDeniedError();
        const menuId = canonicalMenuId(menu.menuId);
        const actions = validatedActions(menu.actions);
        const aggregated = actionsByMenu.get(menuId) ?? new Set<IdxTrustedMenuAction>();
        for (const action of actions) aggregated.add(action);
        actionsByMenu.set(menuId, aggregated);
      }

      const result: NormalizedPermission[] = [];
      const menuIds = [...actionsByMenu.keys()].sort(ordinal);
      for (const menuId of menuIds) {
        const actions = actionsByMenu.get(menuId);
        if (!actions) throw new ManagedExchangeIdentityDeniedError();
        for (const action of IDX_TRUSTED_MENU_ACTIONS) {
          if (actions.has(action)) result.push(Object.freeze({ subject: `menu:${menuId}`, action }));
        }
      }
      return Object.freeze(result);
    } catch {
      throw new ManagedExchangeIdentityDeniedError();
    }
  }
}

function validatedActions(value: readonly unknown[]): readonly IdxTrustedMenuAction[] {
  const result: IdxTrustedMenuAction[] = [];
  let previous = -1;
  for (const action of value) {
    const index = typeof action === 'string' ? IDX_TRUSTED_MENU_ACTIONS.indexOf(action as IdxTrustedMenuAction) : -1;
    if (index < 0 || index <= previous) throw new ManagedExchangeIdentityDeniedError();
    previous = index;
    result.push(action as IdxTrustedMenuAction);
  }
  if (result[0] !== 'read') throw new ManagedExchangeIdentityDeniedError();
  return result;
}

function canonicalMenuId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.includes(':') || control(value)) {
    throw new ManagedExchangeIdentityDeniedError();
  }
  return value;
}

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function array(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === 'string' && keys.includes(key));
}

function control(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}
