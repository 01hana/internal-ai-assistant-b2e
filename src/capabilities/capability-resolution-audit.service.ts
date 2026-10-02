import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import type { CapabilityResolutionAuditMetadataV1, CapabilityResolutionAuditPort } from './capability-resolution.service';

@Injectable()
export class CapabilityResolutionAuditService implements CapabilityResolutionAuditPort {
  constructor(private readonly writer: AuditWriterService) {}

  async record(input: CapabilityResolutionAuditMetadataV1): Promise<void> {
    const context = input.auditContext;
    if (!context || context.customerScope.customerId !== input.scope.customerId ||
      context.customerScope.integrationId !== input.scope.integrationId ||
      context.customerScope.hostApp !== input.scope.hostApp ||
      ![input.scope.customerId, input.scope.integrationId, input.scope.hostApp,
        input.packId, input.capabilityKey, input.bindingId,
        context.requestId, context.sessionId, context.messageId].every((value) => value === undefined || safeRef(value)) ||
      (input.packVersion !== undefined && !safeVersion(input.packVersion)) ||
      !context.requestId || !context.sessionId || !context.messageId ||
      !['RESOLVED', 'NEEDS_CLARIFICATION', 'CAPABILITY_UNAVAILABLE', 'AMBIGUOUS'].includes(input.outcome) ||
      !Array.isArray(input.parameterNames) || input.parameterNames.length > 16 ||
      new Set(input.parameterNames).size !== input.parameterNames.length ||
      !input.parameterNames.every(safeRef) ||
      !Number.isInteger(input.candidateCount) || input.candidateCount < 0 || input.candidateCount > 5 ||
      !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 60_000 ||
      (input.reasonCode !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(input.reasonCode))) {
      throw new Error('CAPABILITY_RESOLUTION_AUDIT_INVALID');
    }
    await this.writer.append({
      customerScope: context.customerScope,
      requestId: context.requestId,
      sessionId: context.sessionId,
      messageId: context.messageId,
      eventType: 'capability_resolution_completed',
      durationMs: input.durationMs,
      metadata: {
        customerId: input.scope.customerId,
        integrationId: input.scope.integrationId,
        hostApp: input.scope.hostApp,
        ...(input.packId ? { packId: input.packId } : {}),
        ...(input.packVersion ? { packVersion: input.packVersion } : {}),
        outcome: input.outcome,
        ...(input.capabilityKey ? { capabilityKey: input.capabilityKey } : {}),
        ...(input.bindingId ? { bindingId: input.bindingId } : {}),
        parameterNames: [...input.parameterNames],
        candidateCount: input.candidateCount,
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {})
      }
    });
  }
}

function safeRef(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function safeVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/.test(value);
}
