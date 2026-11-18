import {
  ADMIN_SUBJECT_NAMES,
  ALL_SUBJECT,
  type AdminAbilityAction,
  type AdminAbilitySubject,
  type AdminAction,
  type AdminSubject,
  isAdminAction,
  isAdminSubject,
  MANAGE_ACTION,
  subjectActions
} from './subjects';

export type AdminPermission = { subject: AdminAbilitySubject; action: AdminAbilityAction };

/** The only permission that grants everything; it belongs to the built-in groups. */
export const ALL_MANAGE = `${ALL_SUBJECT}:${MANAGE_ACTION}` as const;

export function formatPermission(permission: AdminPermission): string {
  return `${permission.subject}:${permission.action}`;
}

/**
 * `subject:action` → `{ subject, action }`. Accepts a known subject with one of its actions or `manage`,
 * and `all:manage`. Anything else is `null`.
 */
export function parsePermission(value: string): AdminPermission | null {
  const parts = value.split(':');
  if (parts.length !== 2) return null;
  const [subject, action] = parts;
  if (subject === ALL_SUBJECT) return action === MANAGE_ACTION ? { subject: ALL_SUBJECT, action: MANAGE_ACTION } : null;
  if (!isAdminSubject(subject)) return null;
  if (action === MANAGE_ACTION) return { subject, action: MANAGE_ACTION };
  return isAdminAction(action) && subjectActions(subject).includes(action) ? { subject, action } : null;
}

/** `subject:manage` → the subject's concrete actions; concrete permissions are returned as is. */
export function expandPermission(permission: AdminPermission): Array<{ subject: AdminSubject; action: AdminAction }> | null {
  if (permission.subject === ALL_SUBJECT) return null;
  const subject = permission.subject;
  if (permission.action === MANAGE_ACTION) return subjectActions(subject).map((action) => ({ subject, action }));
  return [{ subject, action: permission.action }];
}

export type CustomGroupPermissionResult =
  | { ok: true; permissions: string[] }
  | { ok: false; invalid: string[] };

/**
 * Validates and normalises the permissions of a custom group: every entry must be a known
 * `subject:action` (or `subject:manage`, expanded to its actions); `all:manage` is reserved for the
 * built-in groups. The result is de-duplicated and in catalogue order.
 */
export function normalizeCustomGroupPermissions(values: readonly string[]): CustomGroupPermissionResult {
  const invalid: string[] = [];
  const granted = new Set<string>();
  for (const value of values) {
    const parsed = parsePermission(value);
    const expanded = parsed ? expandPermission(parsed) : null;
    if (!expanded) {
      invalid.push(value);
      continue;
    }
    for (const permission of expanded) granted.add(formatPermission(permission));
  }
  if (invalid.length > 0) return { ok: false, invalid };
  return { ok: true, permissions: CATALOGUE_ORDER.filter((permission) => granted.has(permission)) };
}

const CATALOGUE_ORDER: readonly string[] = ADMIN_SUBJECT_NAMES.flatMap((subject) =>
  subjectActions(subject).map((action) => `${subject}:${action}`)
);
