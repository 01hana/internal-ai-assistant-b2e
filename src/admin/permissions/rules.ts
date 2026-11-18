import { type AdminPermission, parsePermission } from './permission-string';
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
