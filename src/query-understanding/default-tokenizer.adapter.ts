import { Injectable } from '@nestjs/common';
import {
  ExtractedPhrase,
  PhraseExtractionInput,
  PhraseExtractionResult,
  Token,
  TokenizeInput,
  TokenizeResult,
  TokenizerAdapter
} from './tokenizer-adapter.interface';
import { BUSINESS_TERMS, getNormalizedDomainTerm, getPhraseCategoryForNormalizedTerm } from './domain-lexicon';

const ID_PATTERN = /\b(?:SO|WO)-\d{4,}\b|\bSKU-[A-Z0-9-]+\b/gi;

@Injectable()
export class DefaultTokenizerAdapter implements TokenizerAdapter {
  readonly key = 'rule-based-zh-tw-tokenizer';

  async tokenize(input: TokenizeInput): Promise<TokenizeResult> {
    return {
      tokenizer: this.key,
      tokens: tokenizeText(input.text)
    };
  }

  async extractPhrases(input: PhraseExtractionInput): Promise<PhraseExtractionResult> {
    const phrases = extractBusinessPhrases(input.text).slice(0, input.maxPhrases ?? 20);
    return {
      tokenizer: this.key,
      phrases
    };
  }
}

export function tokenizeText(text: string): Token[] {
  const tokens: Token[] = [];
  const takenRanges: Array<[number, number]> = [];

  for (const match of text.matchAll(ID_PATTERN)) {
    const value = match[0];
    const startOffset = match.index ?? 0;
    const endOffset = startOffset + value.length;
    takenRanges.push([startOffset, endOffset]);
    tokens.push({
      value,
      normalizedValue: value.toUpperCase(),
      startOffset,
      endOffset,
      confidence: 0.98
    });
  }

  for (const term of BUSINESS_TERMS) {
    let index = text.indexOf(term);
    while (index >= 0) {
      const end = index + term.length;
      if (!takenRanges.some(([start, rangeEnd]) => index < rangeEnd && end > start)) {
        tokens.push({
          value: term,
          normalizedValue: getNormalizedDomainTerm(term),
          startOffset: index,
          endOffset: end,
          confidence: 0.88
        });
      }
      index = text.indexOf(term, end);
    }
  }

  return tokens.sort((a, b) => a.startOffset - b.startOffset);
}

export function extractBusinessPhrases(text: string): ExtractedPhrase[] {
  const phraseMap = new Map<string, ExtractedPhrase>();
  for (const token of tokenizeText(text)) {
    const normalizedValue = token.normalizedValue ?? token.value;
    phraseMap.set(token.value, {
      value: token.value,
      normalizedValue,
      confidence: token.confidence ?? 0.8,
      category: inferPhraseCategory(normalizedValue)
    });
  }

  return [...phraseMap.values()];
}

function inferPhraseCategory(normalizedValue: string): string {
  return getPhraseCategoryForNormalizedTerm(normalizedValue);
}
