import { type Ability, AbilityBuilder } from '@casl/ability';
import { createPrismaAbility, type Model, type PrismaQueryFactory } from '@casl/prisma/runtime';
import type { Prisma, User, UserGroup } from '../../generated/prisma/client';
import { ADMIN_GROUP_CODE, ADMIN_SUBJECT_NAMES, type AdminAbilityAction, type AdminAbilitySubject, DEVELOPER_GROUP_CODE, effectivePermissions } from '../permissions';

type GroupLike = { code: string | null; permissions: readonly string[] };
/** Subjects may be checked by type name or, for User and UserGroup, against a loaded record. */
type AdminSubjectValue = AdminAbilitySubject | Model<User, 'User'> | Model<UserGroup, 'UserGroup'>;
export type AdminAbility = Ability<[AdminAbilityAction, AdminSubjectValue], PrismaQueryFactory<Prisma.TypeMap>>;
export type AdminRule = { action: AdminAbilityAction; subject: AdminAbilitySubject };

/** Non-developers never see developer accounts or the developer group (design D2). */
const HIDE_DEVELOPER_USERS = { groups: { none: { code: DEVELOPER_GROUP_CODE } } };
const HIDE_DEVELOPER_GROUP = { OR: [{ code: null }, { code: ADMIN_GROUP_CODE }] };

export function isDeveloper(groups: readonly GroupLike[]): boolean {
  return groups.some((group) => group.code === DEVELOPER_GROUP_CODE);
}

/**
 * The rules a user holds: the union of their groups. Developers get `manage all`. Everyone else gets
 * per-subject rules (an `all:manage` from the admin group becomes `manage` on each subject), with
 * conditions that hide developer accounts and the developer group.
 */
export function adminRules(groups: readonly GroupLike[]): AdminRule[] {
  if (isDeveloper(groups)) return [{ action: 'manage', subject: 'all' }];
  const permissions = effectivePermissions(groups);
  if (permissions.some((permission) => permission.subject === 'all')) {
    return ADMIN_SUBJECT_NAMES.map((subject) => ({ action: 'manage' as const, subject }));
  }
  return permissions.map(({ action, subject }) => ({ action, subject }));
}

export function buildAdminAbility(groups: readonly GroupLike[]): AdminAbility {
  const { can, build } = new AbilityBuilder<AdminAbility>(createPrismaAbility);
  const developer = isDeveloper(groups);
  for (const rule of adminRules(groups)) {
    if (!developer && rule.subject === 'User') can(rule.action, rule.subject, HIDE_DEVELOPER_USERS);
    else if (!developer && rule.subject === 'UserGroup') can(rule.action, rule.subject, HIDE_DEVELOPER_GROUP);
    else can(rule.action, rule.subject);
  }
  return build();
}
