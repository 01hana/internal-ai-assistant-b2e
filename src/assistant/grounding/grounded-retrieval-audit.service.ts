import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import type { CustomerScope } from '../../identity/customer-scope.types';
import type { GroundedContextBundleV1 } from './grounded-context-bundle.types';

interface AuditContext {
  readonly customerScope: CustomerScope;
  readonly requestId: string;
  readonly sessionId: string;
  readonly messageId: string;
}

@Injectable()
export class GroundedRetrievalAuditService {
  constructor(private readonly writer: AuditWriterService) {}

  recordReuse(input: AuditContext & { readonly eligibleCount: number; readonly complete: boolean }) {
    return this.writer.append({ ...input, eventType: 'grounded_prior_context_evaluated', metadata: {
      eligibleCount: input.eligibleCount, complete: input.complete
    } });
  }

  recordBundle(input: AuditContext & { readonly bundle: GroundedContextBundleV1; readonly durationMs: number }) {
    return this.writer.append({ ...input, eventType: 'grounded_context_bundle_assembled', durationMs: input.durationMs,
      evidenceRefIds: input.bundle.evidence.map((item) => item.evidenceRefId), metadata: {
        bundleVersion: input.bundle.version, mode: input.bundle.retrieval.mode, coverage: input.bundle.retrieval.coverage,
        requestedNeedCount: input.bundle.retrieval.requestedNeeds.length, coveredNeedCount: input.bundle.retrieval.needResults.filter((item) => item.status === 'COVERED').length,
        unsupportedNeedCount: input.bundle.unsupportedNeeds.length, evidenceCount: input.bundle.evidence.length,
        citationCount: input.bundle.citations.length, durationMs: input.durationMs
      } });
  }
}
