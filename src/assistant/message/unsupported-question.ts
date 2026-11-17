import type { CapabilityResolutionResultV1 } from '../../capabilities/capability-pack.types';

export type UnsupportedQuestionReasonCode = 'CAPABILITY_NOT_RECOGNIZED' | 'LLM_NO_MATCH';

/**
 * Feature 013 US5: the reason a typed question counts as unsupported, or undefined when it does not.
 * Clarifiable supported questions (PARAMETER_ISSUES, MULTIPLE_CAPABILITIES), model failures
 * (LLM_NO_ALLOWED_TOOL, LLM_SELECTION_FAILED), capability discovery and clicked choices are not collected.
 */
export function unsupportedQuestionReason(resolution: CapabilityResolutionResultV1 | undefined,
  fromDeclaredChoice: boolean): UnsupportedQuestionReasonCode | undefined {
  if (fromDeclaredChoice || resolution?.outcome !== 'NEEDS_CLARIFICATION') return undefined;
  return resolution.reasonCode === 'CAPABILITY_NOT_RECOGNIZED' || resolution.reasonCode === 'LLM_NO_MATCH'
    ? resolution.reasonCode : undefined;
}
