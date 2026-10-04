import type {
  GenerationAttemptV1,
  GenerationEligibilityDecision,
  GenerationFailureReason,
  GenerationResultV1,
  GenerationStreamChunkV1,
  GenerationTerminalMetadataV1,
  GroundedGenerationContextV1
} from '../../src/assistant/generation/grounded-generation.types';

type AssertFalse<T extends false> = T;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
type _NoToolSelection = AssertFalse<HasKey<GroundedGenerationContextV1, 'toolKey'>>;
type _NoToolArguments = AssertFalse<HasKey<GroundedGenerationContextV1, 'toolArguments'>>;
type _NoPermissionSnapshot = AssertFalse<HasKey<GroundedGenerationContextV1, 'permissionSnapshot'>>;
type _NoCustomerPolicy = AssertFalse<HasKey<GroundedGenerationContextV1, 'customerToolPolicy'>>;
type _NoRawConnector = AssertFalse<HasKey<GroundedGenerationContextV1, 'rawConnectorPayload'>>;
type _NoRawTool = AssertFalse<HasKey<GroundedGenerationContextV1, 'rawToolResponse'>>;
type _NoCredentials = AssertFalse<HasKey<GroundedGenerationContextV1, 'credentials'>>;

describe('Feature 012 internal generation contracts (T003)', () => {
  it('keeps eligibility closed and server-owned', () => {
    const eligible: GenerationEligibilityDecision = {
      kind: 'ELIGIBLE', coverage: 'PARTIAL', evidenceRefIds: ['evidence-1'], citationIds: ['citation-1']
    };
    const blocked: GenerationEligibilityDecision = { kind: 'BLOCKED', reasonCode: 'SAFE_GATE_BLOCKED' };
    expect(Object.keys(eligible)).toEqual(['kind', 'coverage', 'evidenceRefIds', 'citationIds']);
    expect(Object.keys(blocked)).toEqual(['kind', 'reasonCode']);
  });

  it('separates all generation trust classes without execution or permission authority', () => {
    const context: GroundedGenerationContextV1 = {
      version: '1', coverage: 'COMPLETE',
      currentQuestion: { trustClass: 'UNTRUSTED_USER_TEXT', text: 'What is the status?' },
      priorExchanges: [{ userText: 'Earlier?', assistantText: 'Earlier answer.', trustClass: 'COMPLETED_ASSISTANT_TEXT' }],
      documentEvidence: [{ evidenceRefId: 'evidence-1', citationId: 'citation-1', trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE', text: 'Approved excerpt.' }],
      toolEvidence: [{ evidenceRefId: 'evidence-2', citationId: 'citation-2', trustClass: 'SERVER_PROJECTED_TOOL_EVIDENCE', facts: { count: 1 } }],
      unsupportedNeeds: [],
      allowedCitationIds: ['citation-1', 'citation-2'], allowedEvidenceRefIds: ['evidence-1', 'evidence-2']
    };
    expect(Object.keys(context)).toEqual([
      'version', 'coverage', 'currentQuestion', 'priorExchanges', 'documentEvidence', 'toolEvidence',
      'unsupportedNeeds', 'allowedCitationIds', 'allowedEvidenceRefIds'
    ]);
  });

  it('types attempt, terminal result, provisional chunk, and safe failure separately', () => {
    const attempt: GenerationAttemptV1 = { requestId: 'request-1', status: 'STARTED' };
    const terminal: GenerationTerminalMetadataV1 = { finishReason: 'STOP', outputBytes: 12 };
    const chunk: GenerationStreamChunkV1 = { kind: 'TEXT_DELTA', text: 'hello' };
    const success: GenerationResultV1 = { kind: 'COMPLETED', text: 'hello world', terminal };
    const failure: GenerationFailureReason = 'PROVIDER_TIMEOUT';
    const failed: GenerationResultV1 = { kind: 'FAILED', reasonCode: failure };
    expect({ attempt, chunk, success, failed }).toMatchObject({
      attempt: { status: 'STARTED' }, chunk: { kind: 'TEXT_DELTA' }, success: { kind: 'COMPLETED' }, failed: { kind: 'FAILED' }
    });
  });

  it('rejects extra authority fields and mutable contract properties at compile time', () => {
    const eligible: GenerationEligibilityDecision = { kind: 'ELIGIBLE', coverage: 'COMPLETE', evidenceRefIds: [], citationIds: [] };
    const compileOnly = (decision: GenerationEligibilityDecision) => {
      if (decision.kind !== 'ELIGIBLE') return;
      // @ts-expect-error Eligibility coverage is immutable.
      decision.coverage = 'PARTIAL';
      // @ts-expect-error Tool selection is never part of the eligibility result.
      const invented: GenerationEligibilityDecision = { kind: 'ELIGIBLE', coverage: 'COMPLETE', evidenceRefIds: [], citationIds: [], toolKey: 'invented' };
      void invented;
    };
    expect(typeof compileOnly).toBe('function');
    expect(eligible.kind).toBe('ELIGIBLE');
  });
});
