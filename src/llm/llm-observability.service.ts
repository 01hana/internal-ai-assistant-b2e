import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { StructuredLoggerService } from '../common/logger/structured-logger.service';
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

export interface RecordGenerationTerminalInput extends RecordLlmProviderDecisionInput {
  outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  durationMs: number;
  reasonCode?: 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'CANCELLED' | 'INVALID_OUTPUT' | 'CORE_PERSISTENCE_FAILED';
}

const GENERATION_AUDIT_DEADLINE_MS = 2000;

@Injectable()
export class LlmObservabilityService {
  private readonly logger = new StructuredLoggerService();
  constructor(private readonly auditWriter: AuditWriterService) {}

  async recordGenerationTerminal(input: RecordGenerationTerminalInput): Promise<{ auditPersisted: boolean }> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const append = Promise.resolve().then(() => this.auditWriter.append({
      customerScope: createCustomerScopeFromIdentityContext(input.identityContext),
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: input.outcome === 'COMPLETED' ? 'llm_generation_completed' : 'llm_generation_terminated',
      durationMs: Math.max(0, Math.min(60_000, Math.trunc(input.durationMs))),
      metadata: toJsonInput({ provider: bounded(input.metadata.provider), model: bounded(input.metadata.model),
        fallbackUsed: input.metadata.fallbackUsed, outcome: input.outcome,
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}) })
    }));
    // Promise.race installs a rejection handler on the append attempt, including after a timeout.
    try {
      await Promise.race([
        append,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('AUDIT_DEADLINE_EXCEEDED')), GENERATION_AUDIT_DEADLINE_MS);
        })
      ]);
      return { auditPersisted: true };
    } catch {
      this.logger.warn('FEATURE012_AUDIT_PERSISTENCE_FAILED', 'LlmObservabilityService', {
        AUDIT_PERSISTED: 'NO', eventType: 'llm_generation_terminal',
        requestId: bounded(input.requestId), sessionId: bounded(input.sessionId), messageId: bounded(input.messageId)
      });
      return { auditPersisted: false };
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

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

function bounded(value: string | undefined): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined;
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
