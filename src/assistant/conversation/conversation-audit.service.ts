import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { CustomerScope } from '../../identity/customer-scope.types';
import { ConversationSourceRejectionReason } from './conversation.types';

@Injectable()
export class ConversationAuditService {
  constructor(private readonly auditWriter: AuditWriterService) {}

  recordLoaded(input: ConversationAuditInput & {
    readonly exchangeCount: number;
    readonly evidenceRefCount: number;
    readonly rejectedReasonCodes: readonly ConversationSourceRejectionReason[];
  }) {
    return this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'conversation_context_loaded',
      durationMs: input.durationMs,
      metadata: {
        exchangeCount: input.exchangeCount,
        evidenceRefCount: input.evidenceRefCount,
        rejectionCount: input.rejectedReasonCodes.length,
        rejectedReasonCodes: [...new Set(input.rejectedReasonCodes)].sort()
      }
    });
  }

  recordRejected(input: ConversationAuditInput & {
    readonly reasonCodes: readonly ConversationSourceRejectionReason[];
    readonly category: string;
  }) {
    return this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'conversation_context_rejected',
      durationMs: input.durationMs,
      metadata: {
        category: input.category.slice(0, 64),
        reasonCodes: [...new Set(input.reasonCodes)].sort()
      }
    });
  }
}

interface ConversationAuditInput {
  readonly customerScope: CustomerScope;
  readonly requestId: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly durationMs: number;
}

