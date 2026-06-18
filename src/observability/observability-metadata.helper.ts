import { redactSecrets } from '../common/logger/redaction.util';
import { LlmProviderMetadata } from '../llm/llm-provider.interface';
import {
  ApprovalDecisionStatus,
  ConfirmationDecisionStatus,
  DependencyStatus,
  DependencyStatusMetadata,
  NoAnswerReason,
  PermissionDeniedReason,
  RuntimeDecisionMetadata,
  ToolFailureReason
} from './observability-metadata.types';

export function createDurationMetadata(startedAt: Date, endedAt: Date = new Date()): Pick<RuntimeDecisionMetadata, 'durationMs'> {
  return {
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime())
  };
}

export function createDependencyStatusMetadata(
  dependency: string,
  status: DependencyStatus,
  reason?: string,
  checkedAt: Date = new Date()
): DependencyStatusMetadata {
  return redactSecrets({
    dependency,
    status,
    checkedAt: checkedAt.toISOString(),
    reason
  });
}

export function createRuntimeDecisionMetadata(input: RuntimeDecisionMetadata): RuntimeDecisionMetadata {
  return redactSecrets(input);
}

export function withNoAnswerReason(reason: NoAnswerReason): Pick<RuntimeDecisionMetadata, 'noAnswerReason'> {
  return { noAnswerReason: reason };
}

export function withPermissionDeniedReason(
  reason: PermissionDeniedReason
): Pick<RuntimeDecisionMetadata, 'permissionDeniedReason'> {
  return { permissionDeniedReason: reason };
}

export function withToolFailureReason(reason: ToolFailureReason): Pick<RuntimeDecisionMetadata, 'toolFailureReason'> {
  return { toolFailureReason: reason };
}

export function withApprovalDecisionStatus(
  status: ApprovalDecisionStatus
): Pick<RuntimeDecisionMetadata, 'approvalDecisionStatus'> {
  return { approvalDecisionStatus: status };
}

export function withConfirmationDecisionStatus(
  status: ConfirmationDecisionStatus
): Pick<RuntimeDecisionMetadata, 'confirmationDecisionStatus'> {
  return { confirmationDecisionStatus: status };
}

export function createLlmProviderMetadata(
  metadata: LlmProviderMetadata
): Pick<RuntimeDecisionMetadata, 'llmProvider'> {
  return {
    llmProvider: redactSecrets({
      provider: metadata.provider,
      model: metadata.model,
      fallbackUsed: metadata.fallbackUsed,
      fallbackReason: metadata.fallbackReason,
      requestId: metadata.requestId
    })
  };
}
