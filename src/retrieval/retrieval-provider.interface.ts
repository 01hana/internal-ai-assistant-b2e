export interface RetrievalProvider {
  readonly key: string;
  retrieve(input: RetrievalInput): Promise<RetrievalResult>;
  rerank(input: RerankInput): Promise<RerankResult>;
}

export interface RetrievalInput {
  requestId: string;
  organizationId: string;
  query: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface RetrievalCandidate {
  id: string;
  sourceType: 'knowledge_chunk' | 'tool_result' | 'history' | 'page_context';
  sourceId: string;
  title?: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface RetrievalResult {
  provider: string;
  candidates: RetrievalCandidate[];
  metadata?: Record<string, unknown>;
}

export interface RerankInput {
  requestId: string;
  query: string;
  candidates: RetrievalCandidate[];
  limit?: number;
}

export interface RerankResult {
  provider: string;
  candidates: RetrievalCandidate[];
  metadata?: Record<string, unknown>;
}
