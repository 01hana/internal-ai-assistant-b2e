/**
 * Feature 014: the single source of admin back-office permissions. The admin frontend receives the
 * catalogue from `groups/getPermissions` and a user's permissions from `auth/profile`; it keeps only the
 * subject names as a type. A permission is `{ action, subject }` (CASL `can(action, subject)`),
 * written as `subject:action`. Only four actions exist; `manage` means all of them.
 */
export const ADMIN_ACTIONS = ['read', 'create', 'update', 'delete'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** CASL's catch-all action; `subject:manage` is every action the subject allows. */
export const MANAGE_ACTION = 'manage' as const;
export type AdminAbilityAction = AdminAction | typeof MANAGE_ACTION;

/** CASL's catch-all subject; `all:manage` belongs to the built-in groups only. */
export const ALL_SUBJECT = 'all' as const;

type SubjectDefinition = { readonly label: string; readonly actions: readonly AdminAction[] };

export const ADMIN_SUBJECTS = {
  User: { label: '使用者', actions: ['read', 'create', 'update', 'delete'] },
  UserGroup: { label: '使用者群組', actions: ['read', 'create', 'update', 'delete'] },
  AuditEvent: { label: '稽核紀錄', actions: ['read'] },
  Stats: { label: '統計', actions: ['read'] },
  Conversation: { label: '對話紀錄', actions: ['read'] },
  ReviewItem: { label: '待處理項目', actions: ['read', 'update'] },
  Feedback: { label: '使用者回饋', actions: ['read'] },
  ExperienceConfig: { label: '體驗設定', actions: ['read', 'update'] }
} as const satisfies Record<string, SubjectDefinition>;

export type AdminSubject = keyof typeof ADMIN_SUBJECTS;
export type AdminAbilitySubject = AdminSubject | typeof ALL_SUBJECT;

export const ADMIN_SUBJECT_NAMES = Object.freeze(Object.keys(ADMIN_SUBJECTS) as AdminSubject[]);

export function isAdminSubject(value: string): value is AdminSubject {
  return Object.prototype.hasOwnProperty.call(ADMIN_SUBJECTS, value);
}

export function isAdminAction(value: string): value is AdminAction {
  return (ADMIN_ACTIONS as readonly string[]).includes(value);
}

export function subjectActions(subject: AdminSubject): readonly AdminAction[] {
  return ADMIN_SUBJECTS[subject].actions;
}

/** Catalogue for the group permission matrix (rows = subjects, columns = actions). */
export type PermissionCatalogEntry = { subject: AdminSubject; label: string; actions: AdminAction[] };

export function permissionCatalog(): PermissionCatalogEntry[] {
  return ADMIN_SUBJECT_NAMES.map((subject) => ({
    subject,
    label: ADMIN_SUBJECTS[subject].label,
    actions: [...ADMIN_SUBJECTS[subject].actions]
  }));
}
