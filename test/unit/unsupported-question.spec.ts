import type { CapabilityResolutionResultV1 } from '../../src/capabilities/capability-pack.types';
import { unsupportedQuestionReason } from '../../src/assistant/message/unsupported-question';

const empty = { missingParameters: [], invalidParameters: [], conflictingParameters: [] } as const;
const capability = { capabilityKey: 'orders.status', capabilityVersion: '1' } as never;
const clarification = (reasonCode: string) => ({ version: '1', outcome: 'NEEDS_CLARIFICATION', reasonCode, ...empty }) as CapabilityResolutionResultV1;

/** Feature 013 US5 (T045): which resolution outcomes count as unsupported questions. */
describe('unsupportedQuestionReason', () => {
  it.each(['CAPABILITY_NOT_RECOGNIZED', 'LLM_NO_MATCH'])('collects %s', (reasonCode) => {
    expect(unsupportedQuestionReason(clarification(reasonCode), false)).toBe(reasonCode);
  });

  it.each(['LLM_NO_ALLOWED_TOOL', 'LLM_SELECTION_FAILED', 'LLM_CAPABILITY_DISCOVERY'])('does not collect %s', (reasonCode) => {
    expect(unsupportedQuestionReason(clarification(reasonCode), false)).toBeUndefined();
  });

  it('does not collect clarifiable supported questions or other outcomes', () => {
    const parameterIssues = { version: '1', outcome: 'NEEDS_CLARIFICATION', reasonCode: 'PARAMETER_ISSUES', capability,
      missingParameters: ['orderId'], invalidParameters: [], conflictingParameters: [] } as CapabilityResolutionResultV1;
    const ambiguous = { version: '1', outcome: 'AMBIGUOUS', reasonCode: 'MULTIPLE_CAPABILITIES', candidates: [capability, capability] } as CapabilityResolutionResultV1;
    const unavailable = { version: '1', outcome: 'CAPABILITY_UNAVAILABLE', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING', capability, parameters: {} } as CapabilityResolutionResultV1;
    for (const resolution of [parameterIssues, ambiguous, unavailable, undefined]) {
      expect(unsupportedQuestionReason(resolution, false)).toBeUndefined();
    }
  });

  it('never collects a clicked Quick Reply or follow-up', () => {
    expect(unsupportedQuestionReason(clarification('CAPABILITY_NOT_RECOGNIZED'), true)).toBeUndefined();
  });
});
