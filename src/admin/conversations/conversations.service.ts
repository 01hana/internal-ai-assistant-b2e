import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AnswerDecisionStatus, AssistantMessageRole, AssistantSessionStatus, FeedbackRating, type AssistantSession, type Prisma
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminPrincipal } from '../common/admin-request';
import { optionsOf, SESSION_STATUS_LABELS } from '../common/labels';
import { periodWhere } from '../common/period.dto';
import type { RequestMeta } from '../common/request-meta';
import { keywordWhere, orderByOf, pageArgs, type TablePage } from '../common/table-query.dto';
import { AdminSettings } from '../config/admin-settings';
import { ConversationContentService } from './conversation-content';
import type { ConversationFiltersDto, ConversationTableQueryDto } from './conversations.dto';

export const UNANSWERED_DECISIONS = [AnswerDecisionStatus.no_answer, AnswerDecisionStatus.permission_denied, AnswerDecisionStatus.tool_failed];
const SORTABLE = ['lastMessageAt', 'createdAt'] as const;
const MESSAGE_LIMIT = 500;
const VISIBLE_ROLES = [AssistantMessageRole.user, AssistantMessageRole.assistant];

export type ConversationRow = {
  id: string; title: string | null; actorId: string; organizationId: string; hostApp: string; status: AssistantSessionStatus;
  messageCount: number; createdAt: string; lastMessageAt: string | null; hasNegativeFeedback: boolean; hasUnanswered: boolean;
};

/** Feature 015 US1: conversations of the deployment's Customer. Reading messages is audited. */
@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService, private readonly settings: AdminSettings, private readonly content: ConversationContentService) {}

  async table(query: ConversationTableQueryDto): Promise<TablePage<ConversationRow>> {
    const where: Prisma.AssistantSessionWhereInput = {
      AND: [{ customerId: this.settings.customerId }, filtersWhere(query.filters), keywordWhere(query.keyword, ['title'])]
    };
    const [sessions, total] = await this.prisma.db.$transaction([
      this.prisma.db.assistantSession.findMany({
        where, orderBy: sortOf(query), ...pageArgs(query),
        include: { _count: { select: { messages: { where: { role: AssistantMessageRole.user } } } } }
      }),
      this.prisma.db.assistantSession.count({ where })
    ]);
    const flags = await this.flagsOf(sessions.map((session) => session.id));
    return {
      items: sessions.map((session) => ({
        ...sessionView(session), messageCount: session._count.messages,
        hasNegativeFeedback: flags.negative.has(session.id), hasUnanswered: flags.unanswered.has(session.id)
      })),
      total
    };
  }

  async filters() {
    const hostApps = await this.prisma.db.assistantSession.findMany({
      where: { customerId: this.settings.customerId }, distinct: ['hostApp'], select: { hostApp: true }, orderBy: { hostApp: 'asc' }
    });
    return { status: optionsOf(SESSION_STATUS_LABELS), hostApps: hostApps.map(({ hostApp }) => ({ value: hostApp, label: hostApp })) };
  }

  /**
   * The conversation with its newest messages (at most 500). Each answer carries only its rating (one feedback per
   * answer); the reason and review items live on their own pages. Audited.
   */
  async get(principal: AdminPrincipal, id: string, meta: RequestMeta) {
    const customerId = this.settings.customerId;
    const session = await this.prisma.db.assistantSession.findFirst({ where: { customerId, id } });
    if (!session) throw new NotFoundException({ error: 'conversation_not_found', message: '找不到對話。' });
    const newest = await this.prisma.db.assistantMessage.findMany({
      where: { customerId, sessionId: id, role: { in: VISIBLE_ROLES } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MESSAGE_LIMIT + 1,
      // Older data may hold several feedback rows for one answer: the latest one counts.
      include: { feedbackEvents: { select: { rating: true }, orderBy: { updatedAt: 'desc' }, take: 1 } }
    });
    const messages = newest.slice(0, MESSAGE_LIMIT).reverse();

    await this.content.recordView(principal, meta, id, { via: 'conversation' });
    return {
      ...sessionView(session),
      truncated: newest.length > MESSAGE_LIMIT,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        answerDecision: message.answerDecision,
        createdAt: message.createdAt.toISOString(),
        feedback: message.feedbackEvents[0]?.rating ?? null
      }))
    };
  }

  /** The two row flags for one page of conversations, in two queries. */
  private async flagsOf(sessionIds: string[]): Promise<{ negative: Set<string>; unanswered: Set<string> }> {
    const customerId = this.settings.customerId;
    const sessionsWhere = (where: Prisma.AssistantMessageWhereInput) => this.prisma.db.assistantMessage.findMany({
      where: { customerId, sessionId: { in: sessionIds }, ...where }, distinct: ['sessionId'], select: { sessionId: true }
    });
    const [negative, unanswered] = await Promise.all([
      sessionsWhere({ feedbackEvents: { some: { rating: FeedbackRating.negative } } }),
      sessionsWhere({ role: AssistantMessageRole.assistant, answerDecision: { in: UNANSWERED_DECISIONS } })
    ]);
    return { negative: new Set(negative.map((row) => row.sessionId)), unanswered: new Set(unanswered.map((row) => row.sessionId)) };
  }
}

function filtersWhere(filters: ConversationFiltersDto | undefined): Prisma.AssistantSessionWhereInput {
  return {
    status: filters?.status?.length ? { in: filters.status } : { not: AssistantSessionStatus.deleted },
    ...(filters?.hostApp ? { hostApp: filters.hostApp } : {}),
    ...(filters?.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters?.actorId ? { actorId: filters.actorId } : {}),
    ...(periodWhere(filters) ? { lastMessageAt: periodWhere(filters) } : {}),
    AND: [
      filters?.hasNegativeFeedback === undefined ? {} : relation(filters.hasNegativeFeedback, { feedbackEvents: { some: { rating: FeedbackRating.negative } } }),
      filters?.hasUnanswered === undefined ? {} : relation(filters.hasUnanswered, { role: AssistantMessageRole.assistant, answerDecision: { in: UNANSWERED_DECISIONS } })
    ]
  };
}

/** Sessions that have (or, with false, have no) message matching `where`. */
function relation(present: boolean, where: Prisma.AssistantMessageWhereInput): Prisma.AssistantSessionWhereInput {
  return { messages: present ? { some: where } : { none: where } };
}

/** Newest activity first by default; conversations without messages last in either direction. */
function sortOf(query: ConversationTableQueryDto): Prisma.AssistantSessionOrderByWithRelationInput[] {
  const [field, order] = Object.entries(orderByOf(query.sort, SORTABLE, { lastMessageAt: 'desc' }))[0] as [(typeof SORTABLE)[number], 'asc' | 'desc'];
  return [field === 'lastMessageAt' ? { lastMessageAt: { sort: order, nulls: 'last' } } : { createdAt: order }, { id: order }];
}

function sessionView(session: AssistantSession) {
  return {
    id: session.id, title: session.title, actorId: session.actorId, organizationId: session.organizationId, hostApp: session.hostApp,
    status: session.status, createdAt: session.createdAt.toISOString(), lastMessageAt: session.lastMessageAt?.toISOString() ?? null
  };
}
