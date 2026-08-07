import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { redactSecrets } from '../common/logger/redaction.util';
import { Prisma } from '../generated/prisma/client';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { createCustomerScopeFromIdentityContext } from '../identity/customer-scope.factory';
import { LlmProviderMetadata } from './llm-provider.interface';

export interface RecordLlmProviderDecisionInput {
  requestId: string;
  identityContext: RequestIdentityContext;
  metadata: LlmProviderMetadata;
  sessionId?: string;
  messageId?: string;
}

@Injectable()
export class LlmObservabilityService {
  constructor(private readonly auditWriter: AuditWriterService) {}

  async recordProviderDecision(input: RecordLlmProviderDecisionInput) {
    const eventType = input.metadata.fallbackUsed ? 'llm_provider_fallback' : 'llm_provider_selected';
    const metadata = redactSecrets({
      provider: input.metadata.provider,
      model: input.metadata.model,
      fallbackUsed: input.metadata.fallbackUsed,
      fallbackReason: input.metadata.fallbackReason,
      requestId: input.metadata.requestId ?? input.requestId
    });

    return this.auditWriter.append({
      customerScope: createCustomerScopeFromIdentityContext(input.identityContext),
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType,
      metadata: toJsonInput(metadata)
    });
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
