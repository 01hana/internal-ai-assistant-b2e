import { Injectable } from '@nestjs/common';
import type { SafeCompletedConversationExchange } from '../conversation/conversation.types';
import type { GroundedCitation, GroundedContextBundleV1, GroundedDocumentEvidence, GroundedToolEvidence } from './grounded-context-bundle.types';
import type { GroundedRetrievalNeedResult, RetrievalMode, RetrievalNeed } from '../../retrieval/grounded-retrieval.types';
import { RetrievalCoverageService } from './retrieval-coverage.service';

export interface GroundedContextBundleAssemblyInput {
  readonly currentRequest: GroundedContextBundleV1['currentRequest'];
  readonly boundedRecentTurns?: readonly SafeCompletedConversationExchange[];
  readonly locale: string;
  readonly mode: RetrievalMode;
  readonly requestedNeeds: readonly RetrievalNeed[];
  readonly needResults: readonly GroundedRetrievalNeedResult[];
  readonly evidence: readonly (GroundedDocumentEvidence | GroundedToolEvidence)[];
  readonly citations: readonly GroundedCitation[];
}

@Injectable()
export class GroundedContextBundleService {
  constructor(private readonly coverageService: RetrievalCoverageService = new RetrievalCoverageService()) {}

  assemble(input: GroundedContextBundleAssemblyInput | Record<string, any>): GroundedContextBundleV1 {
    assertSafeTree(input, []);
    const requestedNeeds = [...input.requestedNeeds] as RetrievalNeed[];
    const needResults = [...input.needResults] as GroundedRetrievalNeedResult[];
    const requestedIds = requestedNeeds.map((need) => need.id);
    if (new Set(requestedIds).size !== requestedIds.length || needResults.length !== requestedNeeds.length ||
      needResults.some((result, index) => result.needId !== requestedIds[index])) {
      throw new Error('Invalid requested need/result mapping.');
    }
    const inputEvidence = input.evidence as readonly (GroundedDocumentEvidence | GroundedToolEvidence)[];
    const inputCitations = input.citations as readonly GroundedCitation[];
    const evidence = dedupe(inputEvidence, (item) => item.evidenceRefId)
      .sort((left, right) => requestedIds.indexOf(left.needId) - requestedIds.indexOf(right.needId) || left.evidenceRefId.localeCompare(right.evidenceRefId));
    const evidenceIds = new Set(evidence.map((item) => item.evidenceRefId));
    const citations = dedupe(inputCitations, (item) => item.citationId)
      .filter((item) => evidenceIds.has(item.evidenceRefId))
      .sort((left, right) => requestedIds.indexOf(left.needId) - requestedIds.indexOf(right.needId) || left.citationId.localeCompare(right.citationId));
    const coverage = this.coverageService.evaluate({ mode: input.mode, requestedNeeds, needResults });
    const unsupportedNeeds = needResults.flatMap((result) => result.status === 'COVERED' ? [] : [{
      needId: result.needId, reasonCode: result.reasonCode ?? (result.status === 'CLARIFY' ? 'CLARIFICATION_REQUIRED' : 'EVIDENCE_UNAVAILABLE')
    }]);
    return deepFreeze({
      version: '1', currentRequest: input.currentRequest,
      conversationContext: { boundedRecentTurns: Object.freeze([...(input.boundedRecentTurns ?? [])]) },
      retrieval: { mode: input.mode, requestedNeeds: Object.freeze(requestedNeeds), needResults: Object.freeze(needResults), coverage },
      evidence: Object.freeze(evidence), citations: Object.freeze(citations),
      unsupportedNeeds: Object.freeze(unsupportedNeeds), locale: input.locale
    });
  }
}

const PROHIBITED_KEY = /(operationkey|connector|adapter|credential|password|secret|token|authorization|permissionresult|permissionsnapshot|rawresponse|preprojection|deployment|endpoint|opaquehandle)/i;
function assertSafeTree(value: unknown, path: readonly string[], seen = new WeakSet<object>()): void {
  if (value === undefined) return;
  if (value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) return;
  if (!value || typeof value !== 'object') throw new Error('Invalid unsafe bundle value.');
  if (seen.has(value)) throw new Error('Invalid cyclic bundle value.');
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertSafeTree(value[index], [...path, String(index)], seen);
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Invalid non-plain bundle value.');
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const canonicalAllowed = key === 'canonicalToolKey' && path.includes('evidence');
    if (!canonicalAllowed && (PROHIBITED_KEY.test(key) || key.toLowerCase() === 'canonicaltoolkey')) throw new Error(`Prohibited authority field: ${key}`);
    assertSafeTree(nested, [...path, key], seen);
  }
  seen.delete(value);
}
function dedupe<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => !seen.has(key(value)) && Boolean(seen.add(key(value))));
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
