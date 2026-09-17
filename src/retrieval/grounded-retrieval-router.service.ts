import { Injectable } from '@nestjs/common';
import type { ConversationSemanticFrame, SemanticDimension } from '../assistant/conversation/conversation.types';
import {
  GroundedRetrievalPlan,
  GroundedRetrievalRoutingInput,
  MAX_RETRIEVAL_NEEDS,
  MAX_TOOL_NEEDS,
  RetrievalNeed,
  RetrievalNeedCandidate,
  RetrievalMode
} from './grounded-retrieval.types';

@Injectable()
export class GroundedRetrievalRouterService {
  route(input: GroundedRetrievalRoutingInput): GroundedRetrievalPlan {
    const overflow = input.decomposedNeeds.length > MAX_RETRIEVAL_NEEDS;
    const admittedCount = overflow ? MAX_RETRIEVAL_NEEDS - 1 : Math.min(input.decomposedNeeds.length, MAX_RETRIEVAL_NEEDS);
    const needs: RetrievalNeed[] = [];
    let toolCount = 0;
    let hasAmbiguity = false;
    let hasUnsupported = false;
    let multipleToolNeeds = false;
    const coveredNeedIds = new Set<string>();

    input.decomposedNeeds.slice(0, admittedCount).forEach((candidate, index) => {
      const id = stableNeedId(candidate, index, needs);
      if (candidate.kind === 'AMBIGUOUS') {
        hasAmbiguity = true;
        needs.push(freezeNeed({ id, kind: 'UNSUPPORTED', reasonCode: safeReasonCode(candidate.reasonCode, 'AMBIGUOUS_RETRIEVAL_NEED') }));
        return;
      }
      if (candidate.kind === 'UNSUPPORTED') {
        hasUnsupported = true;
        needs.push(freezeNeed({ id, kind: 'UNSUPPORTED', reasonCode: safeReasonCode(candidate.reasonCode, 'UNSUPPORTED_RETRIEVAL_NEED') }));
        return;
      }
      if (candidate.kind === 'TOOL') {
        toolCount += 1;
        if (toolCount > MAX_TOOL_NEEDS) {
          multipleToolNeeds = true;
          needs.push(freezeNeed({ id, kind: 'UNSUPPORTED', reasonCode: 'MULTIPLE_TOOL_NEEDS_UNSUPPORTED' }));
          return;
        }
        needs.push(freezeNeed({ id, kind: 'TOOL', frame: sanitizeFrame(candidate.frame ?? input.resolvedFrame ?? {}) }));
        if (candidate.coveredByPriorEvidence === true) coveredNeedIds.add(id);
        return;
      }
      const query = candidate.query?.trim() ?? '';
      needs.push(query.length > 0 || candidate.query === undefined
        ? freezeNeed({ id, kind: 'DOCUMENT', query, ...(candidate.topicKey ? { topicKey: candidate.topicKey } : {}) })
        : freezeNeed({ id, kind: 'UNSUPPORTED', reasonCode: 'EMPTY_DOCUMENT_QUERY' }));
      if (candidate.query !== undefined && query.length === 0) hasUnsupported = true;
      if (candidate.coveredByPriorEvidence === true && (query.length > 0 || candidate.query === undefined)) coveredNeedIds.add(id);
    });

    if (overflow) {
      needs.push(freezeNeed({
        id: `need-${MAX_RETRIEVAL_NEEDS}`,
        kind: 'UNSUPPORTED',
        reasonCode: 'RETRIEVAL_NEED_LIMIT_EXCEEDED'
      }));
    }

    const reasonCode = overflow
      ? 'RETRIEVAL_NEED_LIMIT_EXCEEDED'
      : multipleToolNeeds
        ? 'MULTIPLE_TOOL_NEEDS_UNSUPPORTED'
        : hasAmbiguity
          ? 'RETRIEVAL_NEED_AMBIGUOUS'
          : hasUnsupported || needs.length === 0
            ? 'RETRIEVAL_NEEDS_INSUFFICIENT'
            : allCoveredByPriorEvidence(input)
              ? 'PRIOR_EVIDENCE_COMPLETE'
              : 'RETRIEVAL_ROUTE_SELECTED';

    const mode = selectMode({ input, needs, coveredNeedIds, overflow, multipleToolNeeds, hasAmbiguity, hasUnsupported });
    return deepFreeze({
      mode,
      needs,
      ...(input.resolvedFrame ? { resolvedFrame: sanitizeFrame(input.resolvedFrame) } : {}),
      reasonCode
    });
  }
}

function selectMode(state: {
  input: GroundedRetrievalRoutingInput;
  needs: readonly RetrievalNeed[];
  coveredNeedIds: ReadonlySet<string>;
  overflow: boolean;
  multipleToolNeeds: boolean;
  hasAmbiguity: boolean;
  hasUnsupported: boolean;
}): RetrievalMode {
  if (state.hasAmbiguity) return 'CLARIFY';
  if (state.overflow || state.multipleToolNeeds || state.hasUnsupported || state.needs.length === 0) return 'INSUFFICIENT';
  if (allCoveredByPriorEvidence(state.input)) return 'CONTEXT_ONLY';
  const uncoveredNeeds = state.needs.filter((need) => !state.coveredNeedIds.has(need.id));
  const documentCount = uncoveredNeeds.filter((need) => need.kind === 'DOCUMENT').length;
  const toolCount = uncoveredNeeds.filter((need) => need.kind === 'TOOL').length;
  if (documentCount > 0 && toolCount === 0) return 'RAG';
  if (documentCount === 0 && toolCount === 1) return 'TOOL';
  if (documentCount > 0 && toolCount === 1) return 'HYBRID';
  return 'INSUFFICIENT';
}

function allCoveredByPriorEvidence(input: GroundedRetrievalRoutingInput): boolean {
  if (input.coveredByPriorEvidence === true) return input.decomposedNeeds.length > 0;
  return input.decomposedNeeds.length > 0 && input.decomposedNeeds.every((need) =>
    (need.kind === 'DOCUMENT' || need.kind === 'TOOL') && need.coveredByPriorEvidence === true
  );
}

function stableNeedId(candidate: RetrievalNeedCandidate, index: number, existing: readonly RetrievalNeed[]): string {
  const candidateId = candidate.id?.trim();
  if (candidateId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidateId) && !existing.some((need) => need.id === candidateId)) {
    return candidateId;
  }
  let ordinal = index + 1;
  while (existing.some((need) => need.id === `need-${ordinal}`)) ordinal += 1;
  return `need-${ordinal}`;
}

function sanitizeFrame(frame: ConversationSemanticFrame): ConversationSemanticFrame {
  return deepFreeze({
    ...(frame.resource ? { resource: sanitizeDimension(frame.resource) } : {}),
    ...(frame.intent ? { intent: sanitizeDimension(frame.intent) } : {}),
    ...(frame.metricOrAspect ? { metricOrAspect: sanitizeDimension(frame.metricOrAspect) } : {}),
    ...(frame.timeRange ? { timeRange: sanitizeDimension(frame.timeRange) } : {}),
    ...(frame.entity ? { entity: { ...sanitizeDimension(frame.entity), entityType: frame.entity.entityType } } : {}),
    ...(frame.topicKey ? { topicKey: frame.topicKey } : {})
  });
}

function sanitizeDimension(dimension: SemanticDimension): SemanticDimension {
  return Object.freeze({
    value: dimension.value,
    sourceMessageId: dimension.sourceMessageId,
    source: dimension.source,
    confidence: dimension.confidence
  });
}

function safeReasonCode(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z0-9_]{1,64}$/.test(normalized) ? normalized : fallback;
}

function freezeNeed<T extends RetrievalNeed>(need: T): T {
  return deepFreeze(need);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
