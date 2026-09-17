import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CustomerScope } from '../identity/customer-scope.types';
import { GroundedRetrievalPlan } from './grounded-retrieval.types';

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
}

interface GroundedRetrievalAuditInput {
  readonly customerScope: CustomerScope;
  readonly requestId: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly durationMs: number;
}
