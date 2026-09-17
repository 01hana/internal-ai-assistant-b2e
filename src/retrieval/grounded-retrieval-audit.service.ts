import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CustomerScope } from '../identity/customer-scope.types';
import { GroundedRetrievalNeedResult, GroundedRetrievalPlan } from './grounded-retrieval.types';

@Injectable()
export class GroundedRetrievalAuditService {
  constructor(private readonly auditWriter: AuditWriterService) {}

  recordPlan(input: GroundedRetrievalAuditInput & { readonly plan: GroundedRetrievalPlan }) {
    const reasonCodes = [input.plan.reasonCode, ...input.plan.needs
      .filter((need) => need.kind === 'UNSUPPORTED')
      .map((need) => need.reasonCode)];
    return this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'grounded_retrieval_planned',
      durationMs: input.durationMs,
      metadata: {
        mode: input.plan.mode,
        needCount: input.plan.needs.length,
        needKinds: input.plan.needs.map((need) => need.kind),
        unsupportedCount: input.plan.needs.filter((need) => need.kind === 'UNSUPPORTED').length,
        reasonCodes: [...new Set(reasonCodes)].sort()
      }
    });
  }

  recordDocumentLane(input: GroundedRetrievalAuditInput & {
    readonly result: GroundedRetrievalNeedResult;
    readonly candidateCount: number;
    readonly selectedCount: number;
    readonly citationCount: number;
  }) {
    return this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: input.result.status === 'FAILED' ? 'grounded_document_retrieval_rejected' : 'grounded_document_retrieval_completed',
      evidenceRefIds: [...input.result.evidenceRefIds],
      durationMs: input.durationMs,
      metadata: {
        needId: input.result.needId,
        status: input.result.status,
        ...(input.result.reasonCode ? { reasonCode: input.result.reasonCode } : {}),
        candidateCount: input.candidateCount,
        selectedCount: input.selectedCount,
        evidenceRefIds: [...input.result.evidenceRefIds],
        citationCount: input.citationCount,
        durationMs: input.durationMs
      }
    });
  }
}

interface GroundedRetrievalAuditInput {
  readonly customerScope: CustomerScope;
  readonly requestId: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly durationMs: number;
}
