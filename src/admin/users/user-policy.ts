import { BadRequestException } from '@nestjs/common';
import type { UserGroup } from '../../generated/prisma/client';
import { ADMIN_GROUP_CODE, DEVELOPER_GROUP_CODE, isSystemGroupCode } from '../permissions';
import type { SessionUser } from '../auth/user-session.service';

/**
 * Feature 014 US4-6 and US4-7: protection rules for user changes, as pure checks over loaded users so
 * single and batch operations share them. Each throws a 400 naming the offending users.
 */

/** Counts towards "at least one active admin": active, in the admin group, not a developer. */
export function isActiveAdmin(user: Pick<SessionUser, 'status' | 'groups'>): boolean {
  return user.status && hasCode(user.groups, ADMIN_GROUP_CODE) && !hasCode(user.groups, DEVELOPER_GROUP_CODE);
}

/** Nobody may disable or delete their own account (US4-6). */
export function assertNotSelf(actorId: string, targetIds: readonly string[], action: 'disable' | 'delete'): void {
  if (!targetIds.includes(actorId)) return;
  throw new BadRequestException({
    error: action === 'disable' ? 'cannot_disable_self' : 'cannot_delete_self',
    message: action === 'disable' ? '不可停用自己的帳號。' : '不可刪除自己的帳號。',
    details: { ids: [actorId] }
  });
}

/** Nobody may leave a built-in group they belong to (US4-6). */
export function assertKeepsOwnSystemGroups(current: readonly UserGroup[], next: readonly UserGroup[]): void {
  const left = current.filter((group) => isSystemGroupCode(group.code) && !next.some((kept) => kept.id === group.id));
  if (left.length === 0) return;
  throw new BadRequestException({ error: 'cannot_leave_system_group', message: '不可把自己移出所屬的內建群組。', details: { groups: left.map((group) => group.code) } });
}

/**
 * US4-7: `remaining` is the number of active admins left after the change. Rejects when the change
 * removes the last one (developers do not count, so customers are never locked out).
 */
export function assertAdminRemains(losing: readonly SessionUser[], remaining: number): void {
  if (losing.length === 0 || remaining > 0) return;
  throw new BadRequestException({ error: 'last_admin', message: '至少需保留一位啟用中的最高管理者。', details: { ids: losing.map((user) => user.id) } });
}

function hasCode(groups: readonly Pick<UserGroup, 'code'>[], code: string): boolean {
  return groups.some((group) => group.code === code);
}
