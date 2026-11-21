import type { AnswerDecisionStatus, AssistantSessionStatus, FeedbackRating, PrismaClient, ReviewSourceType } from '../../src/generated/prisma/client';
import { ADMIN_TEST_CUSTOMER } from './admin-test-app.helper';

/** Feature 015: Assistant data for admin operations tests — two customers, so isolation is always exercised. */
export const OTHER_TEST_CUSTOMER = 'customer-admin-f015-other';

export type ExchangeSeed = {
  question: string;
  answer?: string;
  decision?: AnswerDecisionStatus;
  /** When the question was asked; the answer follows one second later. */
  at: Date;
  feedback?: { rating: FeedbackRating; reason?: string; comment?: string };
  review?: { sourceType: ReviewSourceType; on: 'question' | 'answer' };
};

export type ConversationSeed = {
  customerId?: string;
  actorId?: string;
  organizationId?: string;
  hostApp?: string;
  status?: AssistantSessionStatus;
  exchanges: ExchangeSeed[];
};

export type SeededExchange = { questionId: string; answerId?: string; feedbackId?: string; reviewItemId?: string };
export type SeededConversation = { sessionId: string; exchanges: SeededExchange[] };

/** Removes the Assistant data of both test customers (children before parents) and makes sure both exist. */
export async function resetOperationsData(db: PrismaClient): Promise<void> {
  const customerId = { in: [ADMIN_TEST_CUSTOMER, OTHER_TEST_CUSTOMER] };
  await db.auditEvent.deleteMany({ where: { customerId } });
  await db.reviewItem.deleteMany({ where: { customerId } });
  await db.feedbackEvent.deleteMany({ where: { customerId } });
  await db.assistantSession.deleteMany({ where: { customerId } });
  await db.customer.upsert({ where: { id: OTHER_TEST_CUSTOMER }, create: { id: OTHER_TEST_CUSTOMER }, update: {} });
}

/**
 * A conversation with its messages, answer decisions, feedback, review items and Assistant audit
 * events, shaped like the Assistant writes them (review items reference the message through
 * `suggestedImprovement.messageId`, unsupported questions through `sourceId`).
 */
export async function seedConversation(db: PrismaClient, seed: ConversationSeed): Promise<SeededConversation> {
  const customerId = seed.customerId ?? ADMIN_TEST_CUSTOMER;
  const scope = { organizationId: seed.organizationId ?? 'org-1', hostApp: seed.hostApp ?? 'scm', actorId: seed.actorId ?? 'actor-1' };
  const first = seed.exchanges[0]?.at;
  const last = seed.exchanges[seed.exchanges.length - 1]?.at;
  const session = await db.assistantSession.create({
    data: {
      customerId, ...scope, status: seed.status ?? 'active', title: seed.exchanges[0]?.question.slice(0, 40) ?? null,
      createdAt: first, lastMessageAt: last ? new Date(last.getTime() + 1000) : null
    }
  });
  const exchanges: SeededExchange[] = [];
  for (const [index, exchange] of seed.exchanges.entries()) {
    const requestId = `req-${session.id}-${index}`;
    const question = await db.assistantMessage.create({
      data: { customerId, sessionId: session.id, requestId, role: 'user', content: exchange.question, createdAt: exchange.at }
    });
    await db.auditEvent.create({ data: { customerId, requestId, ...scope, sessionId: session.id, messageId: question.id, eventType: 'message_received', timestamp: exchange.at } });
    const result: SeededExchange = { questionId: question.id };
    if (exchange.answer !== undefined) {
      const answer = await db.assistantMessage.create({
        data: {
          customerId, sessionId: session.id, requestId, role: 'assistant', content: exchange.answer,
          answerDecision: exchange.decision ?? 'answered', createdAt: new Date(exchange.at.getTime() + 1000)
        }
      });
      result.answerId = answer.id;
      await db.auditEvent.create({
        data: { customerId, requestId, ...scope, sessionId: session.id, messageId: answer.id, eventType: 'final', decision: answer.answerDecision, durationMs: 1200, timestamp: answer.createdAt, metadata: { secret: 'not for the admin API' } }
      });
      if (exchange.feedback) {
        const feedback = await db.feedbackEvent.create({
          data: { customerId, requestId, messageId: answer.id, rating: exchange.feedback.rating, reason: exchange.feedback.reason ?? null,
            comment: exchange.feedback.comment ?? null, answerDecision: answer.answerDecision, createdAt: new Date(exchange.at.getTime() + 2000),
            updatedAt: new Date(exchange.at.getTime() + 2000) }
        });
        result.feedbackId = feedback.id;
      }
    }
    if (exchange.review) {
      const messageId = exchange.review.on === 'question' ? question.id : result.answerId!;
      const item = await db.reviewItem.create({
        data: {
          customerId, sourceType: exchange.review.sourceType, status: 'open', priority: 'medium',
          sourceId: exchange.review.on === 'question' ? question.id : `decision-${messageId}`,
          summary: `${exchange.review.sourceType}: assistant answer requires review`,
          suggestedImprovement: exchange.review.on === 'question' ? { reasonCode: 'unsupported' } : { requestId, messageId, toolName: 'kpi.query' },
          createdAt: new Date(exchange.at.getTime() + 3000)
        }
      });
      result.reviewItemId = item.id;
    }
    exchanges.push(result);
  }
  return { sessionId: session.id, exchanges };
}
