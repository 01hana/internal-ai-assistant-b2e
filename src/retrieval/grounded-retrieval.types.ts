import type { ConversationSemanticFrame, FollowUpResolutionDecision } from '../assistant/conversation/conversation.types';

export const RETRIEVAL_MODES = [
  'CONTEXT_ONLY',
  'RAG',
  'TOOL',
  'HYBRID',
  'CLARIFY',
  'INSUFFICIENT'
] as const;

export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export const RETRIEVAL_COVERAGES = ['COMPLETE', 'PARTIAL', 'INSUFFICIENT', 'CLARIFY'] as const;

export type RetrievalCoverage = (typeof RETRIEVAL_COVERAGES)[number];

export const MAX_RETRIEVAL_NEEDS = 4;
export const MAX_TOOL_NEEDS = 1;
export const MAX_TOOL_NEEDS_PER_TURN = MAX_TOOL_NEEDS;
export const MAX_DOCUMENT_CHUNKS_PER_NEED = 2;

export interface DocumentRetrievalNeed {
  readonly id: string;
  readonly kind: 'DOCUMENT';
  readonly query: string;
  readonly topicKey?: string;
}

export interface ToolRetrievalNeed {
  readonly id: string;
  readonly kind: 'TOOL';
  readonly frame: ConversationSemanticFrame;
}

export interface UnsupportedRetrievalNeed {
  readonly id: string;
  readonly kind: 'UNSUPPORTED';
  readonly reasonCode: string;
}

export type RetrievalNeed = DocumentRetrievalNeed | ToolRetrievalNeed | UnsupportedRetrievalNeed;

export type GroundedRetrievalNeedStatus = 'COVERED' | 'UNSUPPORTED' | 'FAILED' | 'CLARIFY';

export interface GroundedRetrievalNeedResult {
  readonly needId: string;
  readonly status: GroundedRetrievalNeedStatus;
  readonly evidenceRefIds: readonly string[];
  readonly reasonCode?: string;
}

export interface GroundedRetrievalPlan {
  readonly mode: RetrievalMode;
  readonly needs: readonly RetrievalNeed[];
  readonly resolvedFrame?: ConversationSemanticFrame;
  readonly reasonCode: string;
}

export type RetrievalNeedCandidate =
  | {
      readonly id?: string;
      readonly kind: 'DOCUMENT';
      readonly query?: string;
      readonly topicKey?: string;
      readonly coveredByPriorEvidence?: boolean;
    }
  | {
      readonly id?: string;
      readonly kind: 'TOOL';
      readonly frame?: ConversationSemanticFrame;
      readonly coveredByPriorEvidence?: boolean;
    }
  | {
      readonly id?: string;
      readonly kind: 'UNSUPPORTED';
      readonly reasonCode?: string;
    }
  | {
      readonly id?: string;
      readonly kind: 'AMBIGUOUS';
      readonly reasonCode?: string;
    };

export interface GroundedRetrievalRoutingInput {
  readonly requestId?: string;
  readonly decomposedNeeds: readonly RetrievalNeedCandidate[];
  readonly resolvedFrame?: ConversationSemanticFrame;
  readonly coveredByPriorEvidence?: boolean;
  readonly followUpResolution?: FollowUpResolutionDecision;
}
