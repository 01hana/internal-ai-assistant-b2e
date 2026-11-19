import { Injectable, NotFoundException } from '@nestjs/common';
import type { FeedbackEvent, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminPrincipal } from '../common/admin-request';
import { FEEDBACK_RATING_LABELS, optionsOf } from '../common/labels';
import { periodWhere } from '../common/period.dto';
import type { RequestMeta } from '../common/request-meta';
import { keywordWhere, orderByOf, pageArgs, type TablePage } from '../common/table-query.dto';
import { AdminSettings } from '../config/admin-settings';
import { ConversationContentService, type ConversationExchange } from '../conversations/conversation-content';
import type { FeedbackFiltersDto, FeedbackTableQueryDto } from './feedback.dto';

const SORTABLE = ['createdAt'] as const;
const WITH_SESSION = { message: { select: { sessionId: true } } } as const;

type FeedbackWithSession = FeedbackEvent & { message: { sessionId: string } };
export type FeedbackRow = ReturnType<typeof feedbackView>;

/**
 * Feature 015 US3: what users thought of the answers. Rows never carry conversation text; the detail
 * adds the rated exchange only for `Conversation:read`, audited (ConversationContentService).
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService, private readonly settings: AdminSettings, private readonly content: ConversationContentService) {}

  async table(query: FeedbackTableQueryDto): Promise<TablePage<FeedbackRow>> {
    const where: Prisma.FeedbackEventWhereInput = {
      AND: [{ customerId: this.settings.customerId }, filtersWhere(query.filters), keywordWhere(query.keyword, ['reason', 'comment'])]
    };
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.feedbackEvent.findMany({ where, include: WITH_SESSION, orderBy: [orderByOf(query.sort, SORTABLE, { createdAt: 'desc' }), { id: 'desc' }], ...pageArgs(query) }),
      this.prisma.db.feedbackEvent.count({ where })
    ]);
    return { items: rows.map(feedbackView), total };
  }

  filters() {
    return { rating: optionsOf(FEEDBACK_RATING_LABELS) };
  }

  async get(principal: AdminPrincipal, id: string, meta: RequestMeta): Promise<FeedbackRow & { conversation: ConversationExchange | null }> {
    const feedback = await this.prisma.db.feedbackEvent.findFirst({ where: { customerId: this.settings.customerId, id }, include: WITH_SESSION });
    if (!feedback) throw new NotFoundException({ error: 'feedback_not_found', message: '找不到回饋。' });
    return { ...feedbackView(feedback), conversation: await this.content.readExchange(principal, meta, feedback.messageId, 'feedback') };
  }
}

function filtersWhere(filters: FeedbackFiltersDto | undefined): Prisma.FeedbackEventWhereInput {
  return {
    ...(filters?.rating?.length ? { rating: { in: filters.rating } } : {}),
    ...(periodWhere(filters) ? { createdAt: periodWhere(filters) } : {}),
    ...(filters?.hasComment === undefined ? {} : { comment: filters.hasComment ? { not: null } : null })
  };
}

function feedbackView(feedback: FeedbackWithSession) {
  return {
    id: feedback.id, rating: feedback.rating, reason: feedback.reason, comment: feedback.comment, answerDecision: feedback.answerDecision,
    createdAt: feedback.createdAt.toISOString(), sessionId: feedback.message.sessionId, messageId: feedback.messageId
  };
}
