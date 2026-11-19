import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { redactSecrets } from '../../common/logger/redaction.util';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestMeta } from '../common/request-meta';

type Db = Prisma.TransactionClient | PrismaService['db'];

export type AdminAuditEventType =
  | 'admin_bootstrap'
  | 'admin_login_succeeded'
  | 'admin_login_failed'
  | 'admin_logout'
  | 'admin_password_set'
  | 'admin_password_reset_requested'
  | 'admin_password_reset'
  | 'admin_user_created'
  | 'admin_user_updated'
  | 'admin_user_email_changed'
  | 'admin_user_groups_changed'
  | 'admin_user_disabled'
  | 'admin_user_enabled'
  | 'admin_user_invite_resent'
  | 'admin_user_deleted'
  | 'admin_user_group_created'
  | 'admin_user_group_updated'
  | 'admin_user_group_deleted'
  | 'admin_conversation_viewed'
  | 'admin_review_item_updated';

export type AuditActor = { id: string; account: string; isDeveloper: boolean };
export type AuditTarget = { type: 'User' | 'UserGroup' | 'AssistantSession' | 'ReviewItem'; id: string; isDeveloper?: boolean };

export type AdminAuditRecord = {
  eventType: AdminAuditEventType;
  meta: RequestMeta;
  actor?: AuditActor | null;
  target?: AuditTarget | null;
  /** IDs, accounts, group codes/names and permission strings only — never passwords, hashes or tokens. */
  metadata?: Record<string, unknown>;
};

/** Feature 014: append-only audit of back-office actions (`UserAuditEvent`). */
@Injectable()
export class UserAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AdminAuditRecord, db: Db = this.prisma.db): Promise<void> {
    await db.userAuditEvent.create({
      data: {
        requestId: entry.meta.requestId,
        actorUserId: entry.actor?.id ?? null,
        actorAccount: entry.actor?.account ?? null,
        actorIsDeveloper: entry.actor?.isDeveloper ?? false,
        eventType: entry.eventType,
        targetType: entry.target?.type ?? null,
        targetId: entry.target?.id ?? null,
        targetIsDeveloper: entry.target?.isDeveloper ?? false,
        ipSummary: entry.meta.ipSummary,
        userAgentSummary: entry.meta.userAgentSummary,
        ...(entry.metadata ? { metadata: redactSecrets(entry.metadata) as Prisma.InputJsonValue } : {})
      }
    });
  }
}
