import { Injectable } from '@nestjs/common';
import type { GroundedRetrievalNeedResult, RetrievalCoverage, RetrievalMode, RetrievalNeed } from '../../retrieval/grounded-retrieval.types';

@Injectable()
export class RetrievalCoverageService {
  evaluate(input: { readonly mode: RetrievalMode; readonly requestedNeeds: readonly RetrievalNeed[]; readonly needResults: readonly GroundedRetrievalNeedResult[] }): RetrievalCoverage {
    if (input.mode === 'CLARIFY' || input.needResults.some((result) => result.status === 'CLARIFY')) return 'CLARIFY';
    if (input.requestedNeeds.length === 0) return 'INSUFFICIENT';
    const covered = input.needResults.filter((result) => result.status === 'COVERED').length;
    if (covered === input.requestedNeeds.length && input.needResults.length === input.requestedNeeds.length) return 'COMPLETE';
    return covered > 0 ? 'PARTIAL' : 'INSUFFICIENT';
  }
}
