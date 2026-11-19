import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma, type ReviewItem, ReviewItemStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { auditActorView } from '../audit/audit-actor';
import { UserAuditService } from '../audit/user-audit.service';
import { actorOf } from '../auth/admin-auth.service';
import type { AdminPrincipal } from '../common/admin-request';
import { ADMIN_CLOCK, type AdminClock } from '../common/clock';
import { uniqueIds } from '../common/ids.dto';
import { optionsOf, REVIEW_PRIORITY_LABELS, REVIEW_SOURCE_LABELS, REVIEW_STATUS_LABELS } from '../common/labels';
import { periodWhere } from '../common/period.dto';
import type { RequestMeta } from '../common/request-meta';
import { keywordWhere, orderByOf, pageArgs, type TablePage } from '../common/table-query.dto';
import { AdminSettings } from '../config/admin-settings';
import { ConversationContentService } from '../conversations/conversation-content';
import { messageIdOf } from './review-item-source';
import type { ReviewItemBatchDto, ReviewItemFiltersDto, ReviewItemTableQueryDto } from './review-items.dto';

const SORTABLE = ['createdAt', 'priority'] as const;
const OPEN_STATUSES = [ReviewItemStatus.open, ReviewItemStatus.in_review];
const CLOSED_STATUSES: ReviewItemStatus[] = [ReviewItemStatus.resolved, ReviewItemStatus.dismissed];
const NOT_FOUND = { error: 'review_item_not_found', message: '找不到待審項目。' };

type HistoryMetadata = { before?: ReviewItemStatus; after?: ReviewItemStatus; note?: string | null };

/**
 * Feature 015 US4: items the Assistant flagged for improvement (no answer, tool failure, negative
 * feedback…). Rows carry no conversation text or `suggestedImprovement`; the detail adds both, the
 * exchange only for `Conversation:read` (audited). Handling history lives in UserAuditEvent.
 */
@Injectable()
export class ReviewItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AdminSettings,
    private readonly content: ConversationContentService,
    private readonly audit: UserAuditService,
    @Inject(ADMIN_CLOCK) private readonly clock: AdminClock
  ) {}

  async table(query: ReviewItemTableQueryDto): Promise<TablePage<ReturnType<typeof itemView>>> {
    const where: Prisma.ReviewItemWhereInput = {
      AND: [{ customerId: this.settings.customerId }, filtersWhere(query.filters), keywordWhere(query.keyword, ['summary'])]
    };
    const [items, total] = await this.prisma.db.$transaction([
      this.prisma.db.reviewItem.findMany({ where, orderBy: [orderByOf(query.sort, SORTABLE, { createdAt: 'desc' }), { id: 'desc' }], ...pageArgs(query) }),
      this.prisma.db.reviewItem.count({ where })
    ]);
    const sessions = await this.sessionsOf(items.map(messageIdOf));
    return { items: items.map((item) => itemView(item, sessions.get(messageIdOf(item)) ?? null)), total };
  }

  filters() {
    return { sourceType: optionsOf(REVIEW_SOURCE_LABELS), status: optionsOf(REVIEW_STATUS_LABELS), priority: optionsOf(REVIEW_PRIORITY_LABELS) };
  }

  async get(principal: AdminPrincipal, id: string, meta: RequestMeta) {
    const item = await this.prisma.db.reviewItem.findFirst({ where: { customerId: this.settings.customerId, id } });
    if (!item) throw new NotFoundException(NOT_FOUND);
    const messageId = messageIdOf(item);
    const [sessions, history] = await Promise.all([this.sessionsOf([messageId]), this.history(principal, id)]);
    return {
      ...itemView(item, sessions.get(messageId) ?? null),
      suggestedImprovement: item.suggestedImprovement,
      history,
      conversation: await this.content.readExchange(principal, meta, messageId, 'reviewItem')
    };
  }

  /** All or nothing. Closing sets `resolvedAt`, reopening clears it; every item gets a history entry. */
  async updateStatus(principal: AdminPrincipal, input: ReviewItemBatchDto, meta: RequestMeta): Promise<{ updated: number }> {
    const ids = uniqueIds(input.ids);
    const items = await this.prisma.db.reviewItem.findMany({ where: { customerId: this.settings.customerId, id: { in: ids } } });
    const missing = ids.filter((id) => !items.some((item) => item.id === id));
    if (missing.length > 0) throw new NotFoundException({ ...NOT_FOUND, details: { ids: missing } });

    const now = this.clock();
    await this.prisma.db.$transaction(async (tx) => {
      for (const item of items) {
        await tx.reviewItem.update({
          where: { id: item.id },
          data: { status: input.status, resolvedAt: resolvedAtOf(item, input.status, now), ...(input.note !== undefined ? { note: input.note || null } : {}) }
        });
        await this.audit.record({
          eventType: 'admin_review_item_updated', meta, actor: actorOf(principal.user), target: { type: 'ReviewItem', id: item.id },
          metadata: { before: item.status, after: input.status, note: input.note || null } satisfies HistoryMetadata
        }, tx);
      }
    });
    return { updated: items.length };
  }

  private async history(principal: AdminPrincipal, id: string) {
    const events = await this.prisma.db.userAuditEvent.findMany({
      where: { eventType: 'admin_review_item_updated', targetType: 'ReviewItem', targetId: id }, orderBy: { timestamp: 'asc' }
    });
    return events.map((event) => {
      const change = (event.metadata ?? {}) as HistoryMetadata;
      return { at: event.timestamp.toISOString(), actor: auditActorView(event, principal.isDeveloper), before: change.before ?? null, after: change.after ?? null, note: change.note ?? null };
    });
  }

  /** messageId → sessionId for this customer's messages, in one query. */
  private async sessionsOf(messageIds: string[]): Promise<Map<string, string>> {
    const messages = await this.prisma.db.assistantMessage.findMany({
      where: { customerId: this.settings.customerId, id: { in: [...new Set(messageIds)] } }, select: { id: true, sessionId: true }
    });
    return new Map(messages.map((message) => [message.id, message.sessionId]));
  }
}

function filtersWhere(filters: ReviewItemFiltersDto | undefined): Prisma.ReviewItemWhereInput {
  return {
    status: { in: filters?.status?.length ? filters.status : OPEN_STATUSES },
    ...(filters?.sourceType?.length ? { sourceType: { in: filters.sourceType } } : {}),
    ...(filters?.priority?.length ? { priority: { in: filters.priority } } : {}),
    ...(periodWhere(filters) ? { createdAt: periodWhere(filters) } : {})
  };
}

function resolvedAtOf(item: ReviewItem, status: ReviewItemStatus, now: Date): Date | null {
  if (!CLOSED_STATUSES.includes(status)) return null;
  return CLOSED_STATUSES.includes(item.status) && item.resolvedAt ? item.resolvedAt : now;
}

/** Message and session are null when the source message no longer exists. */
function itemView(item: ReviewItem, sessionId: string | null) {
  return {
    id: item.id, sourceType: item.sourceType, status: item.status, priority: item.priority, summary: item.summary, note: item.note,
    createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), resolvedAt: item.resolvedAt?.toISOString() ?? null,
    sessionId, messageId: sessionId ? messageIdOf(item) : null
  };
}
