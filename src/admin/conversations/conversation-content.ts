import { Injectable } from '@nestjs/common';
import { AssistantMessageRole, type AnswerDecisionStatus, type AssistantSessionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserAuditService } from '../audit/user-audit.service';
import { actorOf } from '../auth/admin-auth.service';
import type { AdminPrincipal } from '../common/admin-request';
import type { RequestMeta } from '../common/request-meta';
import { AdminSettings } from '../config/admin-settings';

export type MessageView = { id: string; content: string; answerDecision: AnswerDecisionStatus | null; createdAt: string };
/** One question and its answer (either may be missing), with the conversation they belong to. */
export type ConversationExchange = { sessionId: string; sessionStatus: AssistantSessionStatus; question: MessageView | null; answer: MessageView | null };
export type ContentAccess = { via: 'conversation' | 'feedback' | 'reviewItem'; messageId?: string };

/**
 * Feature 015: the one way conversation text leaves the admin API. Text requires `Conversation:read`
 * and every read is audited (`admin_conversation_viewed`) before the text is returned, so a failed
 * audit write means no text (spec FR-003).
 */
@Injectable()
export class ConversationContentService {
  constructor(private readonly prisma: PrismaService, private readonly settings: AdminSettings, private readonly audit: UserAuditService) {}

  canRead(principal: AdminPrincipal): boolean {
    return principal.ability.can('read', 'Conversation');
  }

  async recordView(principal: AdminPrincipal, meta: RequestMeta, sessionId: string, access: ContentAccess): Promise<void> {
    await this.audit.record({
      eventType: 'admin_conversation_viewed', meta, actor: actorOf(principal.user),
      target: { type: 'AssistantSession', id: sessionId }, metadata: { ...access }
    });
  }

  /**
   * The exchange a message belongs to, audited — or null without `Conversation:read`, or when the
   * message is gone. Used by feedback and review-item details.
   */
  async readExchange(principal: AdminPrincipal, meta: RequestMeta, messageId: string | null, via: ContentAccess['via']): Promise<ConversationExchange | null> {
    if (!messageId || !this.canRead(principal)) return null;
    const exchange = await this.exchangeAround(messageId);
    if (exchange) await this.recordView(principal, meta, exchange.sessionId, { via, messageId });
    return exchange;
  }

  /** For an answer, the question before it; for a question, the answer after it. */
  private async exchangeAround(messageId: string): Promise<ConversationExchange | null> {
    const customerId = this.settings.customerId;
    const message = await this.prisma.db.assistantMessage.findFirst({
      where: { customerId, id: messageId, role: { in: [AssistantMessageRole.user, AssistantMessageRole.assistant] } },
      include: { session: { select: { status: true } } }
    });
    if (!message) return null;
    const isAnswer = message.role === AssistantMessageRole.assistant;
    const order = isAnswer ? 'desc' : 'asc';
    const other = await this.prisma.db.assistantMessage.findFirst({
      where: {
        customerId, sessionId: message.sessionId, id: { not: message.id },
        role: isAnswer ? AssistantMessageRole.user : AssistantMessageRole.assistant,
        createdAt: isAnswer ? { lte: message.createdAt } : { gte: message.createdAt }
      },
      orderBy: [{ createdAt: order }, { id: order }]
    });
    return {
      sessionId: message.sessionId,
      sessionStatus: message.session.status,
      question: toMessageView(isAnswer ? other : message),
      answer: toMessageView(isAnswer ? message : other)
    };
  }
}

export function toMessageView(message: { id: string; content: string; answerDecision: AnswerDecisionStatus | null; createdAt: Date } | null): MessageView | null {
  if (!message) return null;
  return { id: message.id, content: message.content, answerDecision: message.answerDecision, createdAt: message.createdAt.toISOString() };
}
