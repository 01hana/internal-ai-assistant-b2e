import { Injectable } from '@nestjs/common';
import { ExecutionDecision, RiskLevel } from '../../generated/prisma/enums';
import type {
  GenerationEligibilityBlockReason,
  GenerationEligibilityDecision,
  GenerationEligibilityInput
} from './grounded-generation.types';

@Injectable()
export class GenerationEligibilityService {
  evaluate(input: GenerationEligibilityInput): GenerationEligibilityDecision {
    if (!input.groundingValid || !hasValidEvidenceLinks(input)) return blocked('INVALID_GROUNDING');
    if (input.safeGate) return blocked('SAFE_GATE_BLOCKED');
    if (input.riskLevel !== RiskLevel.low) return blocked('RISK_BLOCKED');
    if (input.executionDecision !== ExecutionDecision.continue) {
      return blocked(decisionBlockReason(input.executionDecision));
    }

    const { mode, coverage, needResults } = input.bundle.retrieval;
    if (mode === 'CLARIFY' || coverage === 'CLARIFY') return blocked('CLARIFY');
    if (mode === 'INSUFFICIENT' || coverage === 'INSUFFICIENT') return blocked('INSUFFICIENT');
    if (mode === 'CONTEXT_ONLY' && !input.priorEvidenceRevalidated) return blocked('CONTEXT_NOT_REVALIDATED');

    const covered = needResults.filter((need) => need.status === 'COVERED');
    const evidenceRefIds = covered.flatMap((need) => need.evidenceRefIds);
    if (covered.length === 0 || evidenceRefIds.length === 0) return blocked('NO_COVERED_EVIDENCE');
    const allowedEvidence = new Set(evidenceRefIds);
    const citationIds = input.bundle.citations
      .filter((citation) => allowedEvidence.has(citation.evidenceRefId))
      .map((citation) => citation.citationId);
    return Object.freeze({
      kind: 'ELIGIBLE', coverage,
      evidenceRefIds: Object.freeze([...new Set(evidenceRefIds)]),
      citationIds: Object.freeze([...new Set(citationIds)])
    });
  }
}

function blocked(reasonCode: GenerationEligibilityBlockReason): GenerationEligibilityDecision {
  return Object.freeze({ kind: 'BLOCKED', reasonCode });
}

function decisionBlockReason(decision: ExecutionDecision): GenerationEligibilityBlockReason {
  if (decision === ExecutionDecision.confirmation_required) return 'CONFIRMATION_REQUIRED';
  if (decision === ExecutionDecision.approval_required) return 'APPROVAL_REQUIRED';
  if (decision === ExecutionDecision.escalation_required) return 'ESCALATION_REQUIRED';
  return 'SAFE_GATE_BLOCKED';
}

function hasValidEvidenceLinks(input: GenerationEligibilityInput): boolean {
  const { requestedNeeds, needResults } = input.bundle.retrieval;
  if (input.bundle.version !== '1' || requestedNeeds.length !== needResults.length) return false;
  const evidenceById = new Map(input.bundle.evidence.map((evidence) => [evidence.evidenceRefId, evidence]));
  if (evidenceById.size !== input.bundle.evidence.length) return false;
  const linkedEvidenceIds = new Set<string>();
  for (let index = 0; index < requestedNeeds.length; index += 1) {
    const result = needResults[index];
    if (requestedNeeds[index].id !== result.needId) return false;
    if (result.status !== 'COVERED' && result.evidenceRefIds.length > 0) return false;
    for (const evidenceRefId of result.evidenceRefIds) {
      if (evidenceById.get(evidenceRefId)?.needId !== result.needId) return false;
      linkedEvidenceIds.add(evidenceRefId);
    }
  }
  if (linkedEvidenceIds.size !== evidenceById.size) return false;
  for (const citation of input.bundle.citations) {
    const evidence = evidenceById.get(citation.evidenceRefId);
    if (!evidence || evidence.needId !== citation.needId || evidence.kind !== citation.sourceKind) return false;
  }
  return true;
}
