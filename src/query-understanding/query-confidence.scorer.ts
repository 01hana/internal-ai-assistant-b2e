import {
  QueryUnderstandingClarificationNeed,
  QueryUnderstandingEntityCandidate,
  QueryUnderstandingResolvedReference,
  QueryUnderstandingToolCandidate
} from './query-understanding.types';
import { isPunctuationOnly } from './query-task-decomposer';

export function scoreQueryUnderstandingConfidence(input: {
  text: string;
  entityCandidates: QueryUnderstandingEntityCandidate[];
  candidateTools: QueryUnderstandingToolCandidate[];
  resolvedReferences: QueryUnderstandingResolvedReference[];
  clarificationNeeds: QueryUnderstandingClarificationNeed[];
  hasDocumentEvidenceRequirement?: boolean;
}): number {
  if (input.text.length === 0 || isPunctuationOnly(input.text)) {
    return 0;
  }

  let confidence = 0.25;
  if (input.candidateTools.length > 0) confidence += 0.2;
  if (input.hasDocumentEvidenceRequirement) confidence += 0.35;
  if (input.entityCandidates.length > 0) confidence += 0.3;
  if (input.resolvedReferences.some((reference) => !reference.needsClarification)) confidence += 0.2;
  if (input.text.length > 12) confidence += 0.1;
  if (input.clarificationNeeds.some((need) => need.blocking)) confidence -= 0.35;

  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}
