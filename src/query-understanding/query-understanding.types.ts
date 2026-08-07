import { Prisma } from '../generated/prisma/client';
import { RiskLevel } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';

export interface QueryUnderstandingInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  text: string;
  identityContext: RequestIdentityContext;
  pageContext?: Prisma.InputJsonValue;
  assistantContextState?: QueryUnderstandingContextStateSnapshot;
  now?: Date;
  timezone?: string;
}

export interface QueryUnderstandingContextStateSnapshot {
  currentModule?: string | null;
  currentEntityType?: string | null;
  currentEntityId?: string | null;
  currentPage?: Prisma.JsonValue | null;
}

export interface QueryUnderstandingSentence {
  index: number;
  text: string;
}

export interface QueryUnderstandingToken {
  value: string;
  normalizedValue: string;
  sentenceIndex: number;
}

export interface QueryUnderstandingPhrase {
  value: string;
  normalizedValue: string;
  category: 'metric' | 'time' | 'resource' | 'intent' | 'unknown';
}

export interface QueryUnderstandingNormalizedTerm {
  originalTerm: string;
  normalizedTerm: string;
  category: 'resource' | 'entity' | 'operation' | 'time' | 'module' | 'unknown';
  confidence: number;
  reason: string;
}

export interface QueryUnderstandingTimeRange {
  label: string;
  start: string;
  end: string;
  timezone: string;
  source: string;
  confidence: number;
}

export interface QueryUnderstandingResolvedReference {
  source: 'page_context' | 'context_state' | 'user_text';
  entityType?: string;
  entityId?: string;
  confidence: number;
  needsClarification: boolean;
  reason: string;
}

export interface QueryUnderstandingEntityCandidate {
  type: 'orderId' | 'workOrderId' | 'itemSku' | 'customerId' | 'supplierId' | 'unknown';
  value: string;
  confidence: number;
}

export interface QueryUnderstandingSubTask {
  type: string;
  text: string;
}

export interface QueryUnderstandingClarificationNeed {
  reason: string;
  question: string;
  type?: string;
  candidateRefs?: unknown[];
  blocking?: boolean;
}

export interface QueryUnderstandingToolCandidate {
  key: string;
  reason: string;
}

export interface QueryUnderstandingOutput {
  taskType: string;
  sentences: QueryUnderstandingSentence[];
  tokens: QueryUnderstandingToken[];
  phrases: QueryUnderstandingPhrase[];
  normalizedTerms: QueryUnderstandingNormalizedTerm[];
  timeRanges: QueryUnderstandingTimeRange[];
  resolvedReferences: QueryUnderstandingResolvedReference[];
  entityCandidates: QueryUnderstandingEntityCandidate[];
  subTasks: QueryUnderstandingSubTask[];
  candidateTools: QueryUnderstandingToolCandidate[];
  riskLevel: RiskLevel;
  confidence: number;
  clarificationNeeds: QueryUnderstandingClarificationNeed[];
  requiredEvidence: string[];
}

export interface PersistedQueryUnderstandingResult {
  id: string;
  requestId: string;
  messageId: string;
  sentences: Prisma.JsonValue;
  tokens: Prisma.JsonValue;
  phrases: Prisma.JsonValue;
  normalizedTerms: Prisma.JsonValue;
  timeRanges: Prisma.JsonValue | null;
  resolvedReferences: Prisma.JsonValue | null;
  entityCandidates: Prisma.JsonValue;
  subTasks: Prisma.JsonValue | null;
  confidence: number;
  clarificationNeeds: Prisma.JsonValue | null;
  createdAt: Date;
}
