import type { Prisma } from '../../generated/prisma/client';

/**
 * Feature 015: which message a review item is about. Items created from an Assistant outcome or from
 * feedback carry it in `suggestedImprovement.messageId`; unsupported questions use the question's
 * message ID as `sourceId`. Keep this the one place that knows the rule.
 */
export function messageIdOf(item: { sourceId: string; suggestedImprovement: Prisma.JsonValue }): string {
  const json = item.suggestedImprovement;
  const fromJson = json && typeof json === 'object' && !Array.isArray(json) ? json.messageId : undefined;
  return typeof fromJson === 'string' ? fromJson : item.sourceId;
}
