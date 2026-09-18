import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import type { CustomerScope } from '../../identity/customer-scope.types';
import type { GroundedContextBundleV1 } from './grounded-context-bundle.types';
import type { GroundedRetrievalNeedResult, GroundedRetrievalPlan, RetrievalCoverage } from '../../retrieval/grounded-retrieval.types';

interface AuditContext {
  readonly customerScope: CustomerScope;
  readonly requestId: string;
  readonly sessionId: string;
  readonly messageId: string;
}

@Injectable()
export class GroundedRetrievalAuditService {
  constructor(private readonly writer: AuditWriterService) {}

  recordPlan(input: AuditContext & { readonly plan: GroundedRetrievalPlan; readonly durationMs: number }) {
    return this.writer.append({ ...input, eventType: 'grounded_retrieval_plan_selected', durationMs: input.durationMs, metadata: {
      mode: input.plan.mode, reasonCode: input.plan.reasonCode, requestedNeedCount: input.plan.needs.length,
      documentNeedCount: input.plan.needs.filter((need) => need.kind === 'DOCUMENT').length,
      toolNeedCount: input.plan.needs.filter((need) => need.kind === 'TOOL').length,
      unsupportedNeedCount: input.plan.needs.filter((need) => need.kind === 'UNSUPPORTED').length,
      durationMs: input.durationMs
    } });
  }

  recordReuse(input: AuditContext & { readonly candidateCount: number; readonly eligibleCount: number; readonly complete: boolean }) {
    return this.writer.append({ ...input, eventType: 'grounded_prior_context_evaluated', metadata: {
      candidateCount: input.candidateCount, eligibleCount: input.eligibleCount,
      rejectedCount: Math.max(0, input.candidateCount - input.eligibleCount), complete: input.complete
    } });
  }

  recordLane(input: AuditContext & { readonly result: GroundedRetrievalNeedResult; readonly kind: 'DOCUMENT' | 'TOOL' | 'UNSUPPORTED' }) {
    return this.writer.append({ ...input,
      eventType: input.result.status === 'COVERED' ? 'grounded_retrieval_lane_completed' : 'grounded_retrieval_lane_rejected',
      metadata: { needId: input.result.needId, needKind: input.kind, status: input.result.status,
        ...(input.result.reasonCode ? { reasonCode: input.result.reasonCode } : {}),
        evidenceRefIds: [...input.result.evidenceRefIds], evidenceCount: input.result.evidenceRefIds.length } });
  }

  recordCoverage(input: AuditContext & { readonly coverage: RetrievalCoverage; readonly results: readonly GroundedRetrievalNeedResult[] }) {
    return this.writer.append({ ...input, eventType: 'grounded_retrieval_coverage_evaluated', metadata: {
      coverage: input.coverage, requestedNeedCount: input.results.length,
      coveredNeedCount: input.results.filter((result) => result.status === 'COVERED').length,
      rejectedNeedCount: input.results.filter((result) => result.status !== 'COVERED').length
    } });
  }

  recordBundle(input: AuditContext & { readonly bundle: GroundedContextBundleV1; readonly durationMs: number }) {
    return this.writer.append({ ...input, eventType: 'grounded_context_bundle_assembled', durationMs: input.durationMs,
      metadata: {
        bundleVersion: input.bundle.version, mode: input.bundle.retrieval.mode, coverage: input.bundle.retrieval.coverage,
        requestedNeedCount: input.bundle.retrieval.requestedNeeds.length, coveredNeedCount: input.bundle.retrieval.needResults.filter((item) => item.status === 'COVERED').length,
        unsupportedNeedCount: input.bundle.unsupportedNeeds.length, evidenceCount: input.bundle.evidence.length,
        citationCount: input.bundle.citations.length, evidenceRefIds: input.bundle.evidence.map((item) => item.evidenceRefId), durationMs: input.durationMs
      } });
  }
}
