import type {
  ConversationSemanticFrame,
  SafeCompletedConversationExchange as SafeConversationTurn
} from '../conversation/conversation.types';
import type {
  GroundedRetrievalNeedResult,
  RetrievalCoverage,
  RetrievalMode,
  RetrievalNeed
} from '../../retrieval/grounded-retrieval.types';

export interface GroundedDocumentEvidence {
  readonly kind: 'DOCUMENT';
  readonly evidenceRefId: string;
  readonly needId: string;
  readonly content: string;
  readonly title: string;
  readonly documentId: string;
  readonly chunkId: string;
  readonly documentVersion: string;
  readonly sourceKey: string;
  readonly observedAt: string;
  readonly trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE';
}

export interface GroundedToolEvidence {
  readonly kind: 'TOOL';
  readonly evidenceRefId: string;
  readonly needId: string;
  readonly toolCallId: string;
  readonly canonicalToolKey: string;
  readonly projectedFacts: Readonly<Record<string, unknown>>;
  readonly fieldPaths: readonly string[];
  readonly observedAt: string;
}

export interface GroundedCitation {
  readonly citationId: string;
  readonly evidenceRefId: string;
  readonly needId: string;
  readonly sourceKind: 'DOCUMENT' | 'TOOL';
  readonly safeLabel: string;
}

export interface GroundedContextBundleV1 {
  readonly version: '1';
  readonly currentRequest: {
    readonly messageId: string;
    readonly normalizedQuestion: string;
    readonly resolvedFrame?: ConversationSemanticFrame;
  };
  readonly conversationContext: {
    readonly boundedRecentTurns: readonly SafeConversationTurn[];
  };
  readonly retrieval: {
    readonly mode: RetrievalMode;
    readonly requestedNeeds: readonly RetrievalNeed[];
    readonly needResults: readonly GroundedRetrievalNeedResult[];
    readonly coverage: RetrievalCoverage;
  };
  readonly evidence: readonly (GroundedDocumentEvidence | GroundedToolEvidence)[];
  readonly citations: readonly GroundedCitation[];
  readonly unsupportedNeeds: readonly {
    readonly needId: string;
    readonly reasonCode: string;
  }[];
  readonly locale: string;
}
