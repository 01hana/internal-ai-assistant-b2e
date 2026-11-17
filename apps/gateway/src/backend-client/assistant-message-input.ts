/** Feature 013: the same choice ID format the Core accepts (`EXPERIENCE_CHOICE_ID_PATTERN`). */
export const ASSISTANT_CHOICE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Exactly one of a non-blank `message` or a well-formed `choiceId`. The Gateway only checks the format;
 * whether the choice exists and may be run is decided by the Core.
 */
export function hasMessageOrChoiceId(value: Readonly<Record<string, unknown>>): boolean {
  const hasMessage = value.message !== undefined;
  const hasChoice = value.choiceId !== undefined;
  if (hasMessage === hasChoice) return false;
  return hasMessage
    ? typeof value.message === 'string' && value.message.trim().length > 0
    : typeof value.choiceId === 'string' && ASSISTANT_CHOICE_ID_PATTERN.test(value.choiceId);
}
