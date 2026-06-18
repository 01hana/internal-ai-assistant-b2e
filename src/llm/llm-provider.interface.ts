export interface LlmProviderMetadata {
  provider: string;
  model: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  requestId?: string;
}

export interface LlmProvider {
  readonly key: string;
  getMetadata(input?: LlmMetadataInput): LlmProviderMetadata;
  generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerResult>;
  classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult>;
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
}

export interface LlmMetadataInput {
  requestId?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface LlmEvidenceSummary {
  id: string;
  sourceType: 'tool_result' | 'document_chunk' | 'page_context' | 'history' | 'manual';
  title?: string;
  summary: string;
}

export interface GenerateAnswerInput {
  requestId: string;
  sessionId?: string;
  messageId?: string;
  messages: LlmMessage[];
  evidence: LlmEvidenceSummary[];
  instructions?: string;
  responseFormat?: 'text' | 'json';
}

export interface GenerateAnswerResult {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_required' | 'not_executed' | 'error';
  metadata: LlmProviderMetadata;
}

export interface ClassifyIntentInput {
  requestId: string;
  text: string;
  candidateIntents?: string[];
  locale?: string;
}

export interface ClassifyIntentResult {
  intent: string;
  confidence: number;
  reasons: string[];
  metadata: LlmProviderMetadata;
}

export interface SummarizeInput {
  requestId: string;
  text: string;
  maxLength?: number;
  locale?: string;
}

export interface SummarizeResult {
  summary: string;
  metadata: LlmProviderMetadata;
}
