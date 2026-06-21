import { QueryUnderstandingSentence } from './query-understanding.types';

const SENTENCE_SPLIT_PATTERN = /[。！？!?]+/;

export function normalizeQueryText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function splitQuerySentences(text: string): QueryUnderstandingSentence[] {
  const segments = text
    .split(SENTENCE_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 && text.length > 0) {
    return [{ index: 0, text }];
  }

  return segments.map((segment, index) => ({
    index,
    text: segment
  }));
}
