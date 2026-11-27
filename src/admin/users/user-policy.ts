import { BadRequestException } from '@nestjs/common';

/**
 * Feature 014 US4-6: protection rules for user changes, as pure checks so single and batch
 * operations share them. Each throws a 400 naming the offending users.
 */

/** Nobody may disable or delete their own account (US4-6). */
export function assertNotSelf(actorId: string, targetIds: readonly string[], action: 'disable' | 'delete'): void {
  if (!targetIds.includes(actorId)) return;
  throw new BadRequestException({
    error: action === 'disable' ? 'cannot_disable_self' : 'cannot_delete_self',
    message: action === 'disable' ? '不可停用自己的帳號。' : '不可刪除自己的帳號。',
    details: { ids: [actorId] }
  });
}
