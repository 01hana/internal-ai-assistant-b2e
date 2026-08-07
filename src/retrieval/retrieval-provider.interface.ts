import { CustomerScope } from '../identity/customer-scope.types';

export interface RetrievalProvider {
  readonly key: string;
  retrieve(input: RetrievalInput): Promise<RetrievalResult>;
  rerank(input: RerankInput): Promise<RerankResult>;
}

export interface RetrievalInput {
  requestId: string;
  customerScope: Pick<CustomerScope, 'customerId' | 'organizationId' | 'permissionScopes'>;
  query: string;
  filters?: Record<string, unknown>;
  limit?: number;
}

export interface RetrievalCandidate {
  id: string;
  sourceType: 'document_chunk' | 'tool_result' | 'history' | 'page_context';
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
