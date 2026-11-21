/**
 * The feedback a Host may send for an Assistant answer, checked against the same limits as Core's
 * SubmitFeedbackDto. Unknown keys are rejected, so a caller cannot add scope or identity fields.
 */
export type GatewayFeedbackInput = Readonly<{
  rating: 'positive' | 'negative' | 'neutral';
  intent?: 'correction' | 'unsafe' | 'not_helpful' | 'missing_evidence' | 'other';
  reason?: string;
  comment?: string;
}>;

const RATINGS: readonly string[] = ['positive', 'negative', 'neutral'];
const INTENTS: readonly string[] = ['correction', 'unsafe', 'not_helpful', 'missing_evidence', 'other'];
const KEYS: readonly string[] = ['rating', 'intent', 'reason', 'comment'];

export function isGatewayFeedbackInput(value: unknown): value is GatewayFeedbackInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEYS.includes(key))) return false;
  return typeof record.rating === 'string' && RATINGS.includes(record.rating)
    && (record.intent === undefined || (typeof record.intent === 'string' && INTENTS.includes(record.intent)))
    && isOptionalText(record.reason, 160)
    && isOptionalText(record.comment, 1000);
}

/** Only the allowed keys, in a fixed shape. */
export function toGatewayFeedbackInput(value: GatewayFeedbackInput): GatewayFeedbackInput {
  return Object.freeze({
    rating: value.rating,
    ...(value.intent === undefined ? {} : { intent: value.intent }),
    ...(value.reason === undefined ? {} : { reason: value.reason }),
    ...(value.comment === undefined ? {} : { comment: value.comment })
  });
}

function isOptionalText(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}
