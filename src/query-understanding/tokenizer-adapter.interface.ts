export interface TokenizerAdapter {
  readonly key: string;
  tokenize(input: TokenizeInput): Promise<TokenizeResult>;
  extractPhrases(input: PhraseExtractionInput): Promise<PhraseExtractionResult>;
}

export interface TokenizeInput {
  requestId: string;
  text: string;
  locale?: string;
}

export interface Token {
  value: string;
  normalizedValue?: string;
  startOffset: number;
  endOffset: number;
  partOfSpeech?: string;
  confidence?: number;
}

export interface TokenizeResult {
  tokenizer: string;
  tokens: Token[];
  metadata?: Record<string, unknown>;
}

export interface PhraseExtractionInput {
  requestId: string;
  text: string;
  locale?: string;
  maxPhrases?: number;
}

export interface ExtractedPhrase {
  value: string;
  normalizedValue?: string;
  confidence: number;
  category?: string;
}

export interface PhraseExtractionResult {
  tokenizer: string;
  phrases: ExtractedPhrase[];
  metadata?: Record<string, unknown>;
}
