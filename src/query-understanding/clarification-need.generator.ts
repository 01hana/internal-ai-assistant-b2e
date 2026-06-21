import { DEIXIS_PATTERN } from './deixis-resolver';
import { hasEntity } from './entity-extractor';
import {
  QueryUnderstandingClarificationNeed,
  QueryUnderstandingEntityCandidate,
  QueryUnderstandingResolvedReference,
  QueryUnderstandingToolCandidate
} from './query-understanding.types';
import { isPunctuationOnly } from './query-task-decomposer';

export function generateClarificationNeeds(input: {
  text: string;
  timeClarifications: QueryUnderstandingClarificationNeed[];
  entityCandidates: QueryUnderstandingEntityCandidate[];
  resolvedReferences: QueryUnderstandingResolvedReference[];
  candidateTools: QueryUnderstandingToolCandidate[];
}): QueryUnderstandingClarificationNeed[] {
  const needs: QueryUnderstandingClarificationNeed[] = [...input.timeClarifications];

  if (input.text.length === 0 || isPunctuationOnly(input.text)) {
    needs.push({
      type: 'empty_query',
      reason: 'empty_query',
      question: '請提供要查詢的內容或對象。',
      blocking: true
    });
  }

  const unresolvedReferences = input.resolvedReferences.filter((reference) => reference.needsClarification);
  if (unresolvedReferences.some((reference) => reference.reason === 'multiple_candidates')) {
    needs.push({
      type: 'reference',
      reason: 'multiple_candidates',
      question: '你選取了多筆資料，請指定要查詢哪一筆。',
      candidateRefs: unresolvedReferences.map((reference) => ({
        entityType: reference.entityType,
        entityId: reference.entityId
      })),
      blocking: true
    });
  } else if (unresolvedReferences.length > 0) {
    needs.push({
      type: 'reference',
      reason: 'missing_page_context',
      question: '請指定要查詢的資料，或在頁面上選取單一資料。',
      candidateRefs: unresolvedReferences,
      blocking: true
    });
  }

  if (input.text.includes('訂單') && !hasEntity(input.entityCandidates, 'orderId') && !DEIXIS_PATTERN.test(input.text)) {
    needs.push({
      type: 'entity',
      reason: 'missing_order_identifier',
      question: '請提供訂單號，像是 SO-10001。',
      blocking: true
    });
  }

  if (input.candidateTools.length === 0 && input.text.length > 0 && !isPunctuationOnly(input.text)) {
    needs.push({
      type: 'intent',
      reason: 'low_confidence_intent',
      question: '請補充要查詢或操作的業務對象。',
      blocking: true
    });
  }

  return dedupeClarificationNeeds(needs);
}

function dedupeClarificationNeeds(
  needs: QueryUnderstandingClarificationNeed[]
): QueryUnderstandingClarificationNeed[] {
  const map = new Map<string, QueryUnderstandingClarificationNeed>();
  for (const need of needs) {
    map.set(need.reason, need);
  }
  return [...map.values()];
}
