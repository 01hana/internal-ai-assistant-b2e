import { DOMAIN_LEXICON } from './domain-lexicon';
import {
  QueryUnderstandingNormalizedTerm,
  QueryUnderstandingPhrase,
  QueryUnderstandingSentence,
  QueryUnderstandingToken
} from './query-understanding.types';
import { ExtractedPhrase, TokenizerAdapter } from './tokenizer-adapter.interface';

export function toQueryTokens(
  tokens: Awaited<ReturnType<TokenizerAdapter['tokenize']>>['tokens'],
  sentences: QueryUnderstandingSentence[]
): QueryUnderstandingToken[] {
  return tokens.map((token) => ({
    value: token.value,
    normalizedValue: token.normalizedValue ?? token.value.toLowerCase(),
    sentenceIndex: findSentenceIndex(token.startOffset, sentences)
  }));
}

export function normalizeDomainTerms(
  text: string,
  tokens: QueryUnderstandingToken[]
): QueryUnderstandingNormalizedTerm[] {
  const terms = new Map<string, QueryUnderstandingNormalizedTerm>();

  for (const definition of DOMAIN_LEXICON) {
    for (const originalTerm of definition.terms) {
      if (text.includes(originalTerm)) {
        terms.set(`${originalTerm}:${definition.normalizedTerm}`, {
          originalTerm,
          normalizedTerm: definition.normalizedTerm,
          category: definition.category,
          confidence: 0.9,
          reason: 'domain_lexicon'
        });
      }
    }
  }

  for (const token of tokens) {
    if (/^(SO|WO)-\d{4,}$/i.test(token.value) || /^SKU-[A-Z0-9-]+$/i.test(token.value)) {
      terms.set(token.value, {
        originalTerm: token.value,
        normalizedTerm: token.value.toUpperCase(),
        category: 'entity',
        confidence: 0.98,
        reason: 'identifier_pattern'
      });
    }
  }

  return [...terms.values()];
}

export function mapExtractedPhrases(
  phrases: ExtractedPhrase[],
  tokens: QueryUnderstandingToken[],
  text: string
): QueryUnderstandingPhrase[] {
  const fromAdapter = phrases.map((phrase) => ({
    value: phrase.value,
    normalizedValue: phrase.normalizedValue ?? phrase.value.toLowerCase(),
    category: toPhraseCategory(phrase.category)
  }));

  if (fromAdapter.some((phrase) => phrase.normalizedValue === 'read')) {
    return fromAdapter;
  }

  if (tokens.length > 0 && /(查|看|確認)/.test(text)) {
    return [
      ...fromAdapter,
      {
        value: '查詢',
        normalizedValue: 'read',
        category: 'intent' as const
      }
    ];
  }

  return fromAdapter;
}

function findSentenceIndex(offset: number, sentences: QueryUnderstandingSentence[]): number {
  let cursor = 0;
  for (const sentence of sentences) {
    const start = cursor;
    const end = start + sentence.text.length;
    if (offset >= start && offset <= end) {
      return sentence.index;
    }
    cursor = end + 1;
  }
  return 0;
}

function toPhraseCategory(category: string | undefined): QueryUnderstandingPhrase['category'] {
  if (category === 'resource' || category === 'intent' || category === 'time' || category === 'metric') {
    return category;
  }
  return 'unknown';
}
