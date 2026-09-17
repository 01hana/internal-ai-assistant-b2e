export type SemanticDimensionSource = 'current_explicit' | 'inherited';

export interface SemanticDimensionProvenance {
  readonly sourceMessageId: string;
  readonly source: SemanticDimensionSource;
  readonly confidence: number;
}

export interface SemanticDimension<T extends string = string> extends SemanticDimensionProvenance {
  readonly value: T;
}

export interface ConversationSemanticFrame {
  readonly resource?: SemanticDimension;
  readonly intent?: SemanticDimension;
  readonly metricOrAspect?: SemanticDimension;
  readonly timeRange?: SemanticDimension;
  readonly entity?: SemanticDimension & { readonly entityType: string };
  readonly topicKey?: string;
}

export type FollowUpResolutionKind = 'INHERIT' | 'REPLACE' | 'NEW_TOPIC' | 'CLARIFY';

export interface FollowUpResolutionDecision {
  readonly kind: FollowUpResolutionKind;
  readonly reasonCode: string;
  readonly resolvedFrame?: ConversationSemanticFrame;
  readonly inheritedDimensions: readonly string[];
  readonly replacedDimensions: readonly string[];
}

export interface ConversationScope {
  readonly customerId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly hostApp: string;
  readonly actorId: string;
}

export type ConversationSourceRejectionReason =
  | 'PROHIBITED_CONTEXT_SOURCE'
  | 'CONTEXT_DEPTH_EXCEEDED'
  | 'CONTEXT_ITEM_LIMIT_EXCEEDED'
  | 'CONTEXT_STRING_TOO_LONG'
  | 'CONTEXT_OBJECT_KEY_LIMIT_EXCEEDED'
  | 'CONTEXT_METADATA_TOO_LARGE'
  | 'CONTEXT_CYCLIC_VALUE'
  | 'CONTEXT_MALFORMED_VALUE'
  | 'CONTEXT_UNSUPPORTED_VALUE';

export type SafeConversationScalar = string | number | boolean | null;
export type SafeConversationValue =
  | SafeConversationScalar
  | readonly SafeConversationValue[]
  | { readonly [key: string]: SafeConversationValue };

export interface SafePriorEvidenceRefCandidate {
  readonly id: string;
  readonly messageId?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly observedAt?: string;
}

export interface SafeCompletedConversationExchange {
  readonly exchangeId: string;
  readonly requestId?: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly userText?: string;
  readonly createdAt: string;
  readonly semanticFrame?: ConversationSemanticFrame;
  readonly evidenceRefIds: readonly string[];
}

export interface BoundedConversationContext {
  readonly scope: ConversationScope;
  readonly selectedExchangeIdsNewestFirst: readonly string[];
  readonly chronologicalExchangeIds: readonly string[];
  readonly exchanges: readonly SafeCompletedConversationExchange[];
  readonly semanticFrames: readonly ConversationSemanticFrame[];
  readonly evidenceRefs: readonly SafePriorEvidenceRefCandidate[];
  readonly evidenceRefIds: readonly string[];
  readonly rejectedReasonCodes: readonly ConversationSourceRejectionReason[];
}

