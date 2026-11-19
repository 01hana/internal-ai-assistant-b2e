import { Prisma, type ReviewItemStatus, type ReviewSourceType } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Feature 015: which message a review item is about. Items created from an Assistant outcome or from
 * feedback carry it in `suggestedImprovement.messageId`; unsupported questions use the question's
 * message ID as `sourceId`. Keep this the one place that knows the rule (SQL twin: MESSAGE_ID_SQL).
 */
export function messageIdOf(item: { sourceId: string; suggestedImprovement: Prisma.JsonValue }): string {
  const json = item.suggestedImprovement;
  const fromJson = json && typeof json === 'object' && !Array.isArray(json) ? json.messageId : undefined;
  return typeof fromJson === 'string' ? fromJson : item.sourceId;
}

const MESSAGE_ID_SQL = Prisma.sql`COALESCE("suggestedImprovement"->>'messageId', "sourceId")`;

export type MessageReviewItem = { id: string; sourceType: ReviewSourceType; status: ReviewItemStatus; messageId: string };

/** Review items about any of the given messages, in one query. */
export function reviewItemsForMessages(prisma: PrismaService, customerId: string, messageIds: string[]): Promise<MessageReviewItem[]> {
  if (messageIds.length === 0) return Promise.resolve([]);
  return prisma.db.$queryRaw<MessageReviewItem[]>`
    SELECT id, "sourceType", status, ${MESSAGE_ID_SQL} AS "messageId"
    FROM "ReviewItem"
    WHERE "customerId" = ${customerId} AND ${MESSAGE_ID_SQL} = ANY(${messageIds}::text[])
    ORDER BY "createdAt"`;
}
