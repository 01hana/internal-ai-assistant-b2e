import { type AdminPermission, expandPermission, formatPermission, parsePermission } from './permission-string';
import { isSystemGroupCode, SYSTEM_GROUPS } from './system-groups';

/** A group as stored: built-in groups carry a code, custom groups carry their own permissions. */
export type GroupPermissionSource = { code: string | null; permissions: readonly string[] };

/**
 * The effective permissions of a user: the union of their groups. Built-in groups take their
 * permissions from `system-groups.ts`, never from the database row; unknown stored strings are ignored.
 */
export function effectivePermissions(groups: readonly GroupPermissionSource[]): AdminPermission[] {
  const seen = new Map<string, AdminPermission>();
  for (const group of groups) {
    const source = isSystemGroupCode(group.code) ? SYSTEM_GROUPS[group.code].permissions : group.permissions;
    for (const value of source) {
      const parsed = parsePermission(value);
      if (parsed) seen.set(value, parsed);
    }
  }
  return [...seen.values()];
}

/** Raw CASL rules (`{ action, subject }`) without conditions; the admin API adds its own conditions. */
export function toCaslRules(permissions: readonly AdminPermission[]): Array<{ action: string; subject: string }> {
  return permissions.map(({ action, subject }) => ({ action, subject }));
}

/**
 * Whether someone holding `held` may grant `wanted`: no one gives more than they have. `all:manage` covers
 * everything (and only it covers `all:manage`); otherwise every concrete permission wanted must be held,
 * with `subject:manage` expanded to the subject's actions.
 */
export function coversPermissions(held: readonly AdminPermission[], wanted: readonly AdminPermission[]): boolean {
  if (held.some((permission) => permission.subject === 'all')) return true;
  const have = new Set(held.flatMap((permission) => expandPermission(permission) ?? []).map(formatPermission));
  return wanted.every((permission) => {
    const expanded = expandPermission(permission);
    return expanded !== null && expanded.every((concrete) => have.has(formatPermission(concrete)));
  });
}
