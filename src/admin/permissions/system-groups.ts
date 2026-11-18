import { ALL_MANAGE } from './permission-string';

/**
 * Feature 014: the two built-in groups. Their permissions come only from this file (not from the
 * database), so a release can change them without a data migration. Both hold every permission; the
 * developer group is hidden from everyone else and only developers can assign it.
 */
export const SYSTEM_GROUP_CODES = ['developer', 'admin'] as const;
export type SystemGroupCode = (typeof SYSTEM_GROUP_CODES)[number];

export type SystemGroupDefinition = {
  readonly code: SystemGroupCode;
  readonly name: string;
  readonly permissions: readonly string[];
};

export const SYSTEM_GROUPS: Readonly<Record<SystemGroupCode, SystemGroupDefinition>> = Object.freeze({
  developer: Object.freeze({ code: 'developer', name: '開發工程師', permissions: Object.freeze([ALL_MANAGE]) }),
  admin: Object.freeze({ code: 'admin', name: '最高管理者', permissions: Object.freeze([ALL_MANAGE]) })
});

/** The group only developers can see and assign. */
export const DEVELOPER_GROUP_CODE: SystemGroupCode = 'developer';
/** The group that must keep at least one active member who is not a developer. */
export const ADMIN_GROUP_CODE: SystemGroupCode = 'admin';

export function isSystemGroupCode(value: string | null | undefined): value is SystemGroupCode {
  return value !== null && value !== undefined && (SYSTEM_GROUP_CODES as readonly string[]).includes(value);
}
