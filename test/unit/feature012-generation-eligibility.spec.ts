import { ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import type { GroundedContextBundleV1 } from '../../src/assistant/grounding/grounded-context-bundle.types';
import { GenerationEligibilityService } from '../../src/assistant/generation/generation-eligibility.service';

describe('Feature 012 generation eligibility (T001/T007)', () => {
  const service = new GenerationEligibilityService();

  it.each([
    ['COMPLETE', 'RAG'],
    ['PARTIAL', 'HYBRID'],
    ['COMPLETE', 'CONTEXT_ONLY']
  ] as const)('admits covered %s in %s without changing coverage', (coverage, mode) => {
    const bundle = makeBundle(coverage, mode);
    const result = service.evaluate(input(bundle));
    expect(result).toEqual({
      kind: 'ELIGIBLE', coverage, evidenceRefIds: ['evidence-document'], citationIds: ['citation-document']
    });
    expect(bundle.retrieval.coverage).toBe(coverage);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ['CLARIFY', makeBundle('CLARIFY', 'CLARIFY'), {}],
    ['INSUFFICIENT', makeBundle('INSUFFICIENT', 'RAG'), {}],
    ['NO_COVERED_EVIDENCE', makeBundle('COMPLETE', 'RAG', false), {}],
    ['INVALID_GROUNDING', makeBundle('COMPLETE', 'RAG'), { groundingValid: false }],
    ['CONTEXT_NOT_REVALIDATED', makeBundle('COMPLETE', 'CONTEXT_ONLY'), { priorEvidenceRevalidated: false }],
    ['RISK_BLOCKED', makeBundle('COMPLETE', 'RAG'), { riskLevel: RiskLevel.high }],
    ['CONFIRMATION_REQUIRED', makeBundle('COMPLETE', 'RAG'), { executionDecision: ExecutionDecision.confirmation_required }],
    ['APPROVAL_REQUIRED', makeBundle('COMPLETE', 'RAG'), { executionDecision: ExecutionDecision.approval_required }],
    ['ESCALATION_REQUIRED', makeBundle('COMPLETE', 'RAG'), { executionDecision: ExecutionDecision.escalation_required }]
  ] as const)('blocks %s without an LLM decision', (reasonCode, bundle, override) => {
    expect(service.evaluate({ ...input(bundle), ...override })).toEqual({ kind: 'BLOCKED', reasonCode });
  });

  it.each([
    ['evidence conflict', 'evidence_conflict'],
    ['permission-only denial', 'permission_denied'],
    ['tool failure', 'tool_failure']
  ])('preserves a deterministic %s safe gate', (_label, reason) => {
    const safeGate = {
      kind: 'no_answer' as const,
      status: reason === 'permission_denied' ? 'permission_denied' : 'no_answer',
      noAnswerReason: reason,
      answer: 'safe', delta: 'safe'
    };
    expect(service.evaluate({ ...input(makeBundle('COMPLETE', 'RAG')), safeGate: safeGate as never }))
      .toEqual({ kind: 'BLOCKED', reasonCode: 'SAFE_GATE_BLOCKED' });
  });

  it('rejects an unlinked citation instead of allowing a model-created reference', () => {
    const bundle = makeBundle('COMPLETE', 'RAG');
    const invalid = { ...bundle, citations: [{ ...bundle.citations[0], evidenceRefId: 'foreign-evidence' }] };
    expect(service.evaluate(input(invalid))).toEqual({ kind: 'BLOCKED', reasonCode: 'INVALID_GROUNDING' });
  });

  it('rejects evidence that no covered need authorized', () => {
    const bundle = makeBundle('COMPLETE', 'RAG');
    const unlinked: GroundedContextBundleV1 = {
      ...bundle,
      evidence: [...bundle.evidence, { ...bundle.evidence[0], evidenceRefId: 'unlinked-evidence' }]
    };
    expect(service.evaluate(input(unlinked))).toEqual({ kind: 'BLOCKED', reasonCode: 'INVALID_GROUNDING' });
  });

  it.each(['PERMISSION_DENIED', 'NO_COMPATIBLE_ACTIVE_BINDING'])('keeps covered Document plus %s Tool lane eligible only as PARTIAL', (reasonCode) => {
    const bundle = makeBundle('PARTIAL', 'HYBRID');
    const partial: GroundedContextBundleV1 = {
      ...bundle,
      retrieval: { ...bundle.retrieval, needResults: [bundle.retrieval.needResults[0], {
        needId: 'need-tool', status: 'UNSUPPORTED', evidenceRefIds: [], reasonCode
      }] },
      unsupportedNeeds: [{ needId: 'need-tool', reasonCode }]
    };
    expect(service.evaluate(input(partial))).toEqual({
      kind: 'ELIGIBLE', coverage: 'PARTIAL', evidenceRefIds: ['evidence-document'], citationIds: ['citation-document']
    });
    expect(partial.retrieval.coverage).toBe('PARTIAL');
    expect(partial.unsupportedNeeds).toEqual([{ needId: 'need-tool', reasonCode }]);
  });

  it('does not generate for a permission-only Tool denial with no covered lane', () => {
    const partial = makeBundle('PARTIAL', 'HYBRID');
    const denied: GroundedContextBundleV1 = {
      ...partial,
      retrieval: {
        mode: 'TOOL', coverage: 'INSUFFICIENT', requestedNeeds: [partial.retrieval.requestedNeeds[1]],
        needResults: [{ needId: 'need-tool', status: 'UNSUPPORTED', evidenceRefIds: [], reasonCode: 'PERMISSION_DENIED' }]
      },
      evidence: [], citations: [], unsupportedNeeds: [{ needId: 'need-tool', reasonCode: 'PERMISSION_DENIED' }]
    };
    expect(service.evaluate(input(denied))).toEqual({ kind: 'BLOCKED', reasonCode: 'INSUFFICIENT' });
  });
});

function input(bundle: GroundedContextBundleV1) {
  return {
    bundle, executionDecision: ExecutionDecision.continue, riskLevel: RiskLevel.low,
    groundingValid: true, priorEvidenceRevalidated: true
  };
}

function makeBundle(coverage: GroundedContextBundleV1['retrieval']['coverage'], mode: GroundedContextBundleV1['retrieval']['mode'], covered = true): GroundedContextBundleV1 {
  const document = { kind: 'DOCUMENT' as const, id: 'need-document', query: 'policy' };
  const tool = { kind: 'TOOL' as const, id: 'need-tool', frame: {
    resource: { value: 'work-orders', source: 'current_explicit' as const, sourceMessageId: 'message-1', confidence: 1 },
    intent: { value: 'count', source: 'current_explicit' as const, sourceMessageId: 'message-1', confidence: 1 }
  } };
  const requestedNeeds = coverage === 'PARTIAL' ? [document, tool] : [document];
  const needResults = requestedNeeds.map((need) => ({
    needId: need.id, status: need.id === 'need-document' && covered ? 'COVERED' as const : 'UNSUPPORTED' as const,
    evidenceRefIds: need.id === 'need-document' && covered ? ['evidence-document'] : []
  }));
  return {
    version: '1', currentRequest: { messageId: 'message-1', normalizedQuestion: 'policy?' },
    conversationContext: { boundedRecentTurns: [] }, locale: 'zh-TW',
    retrieval: { mode, coverage, requestedNeeds, needResults },
    evidence: covered ? [{
      kind: 'DOCUMENT', evidenceRefId: 'evidence-document', needId: 'need-document', content: 'policy', title: 'SOP',
      documentId: 'doc-1', chunkId: 'chunk-1', documentVersion: '1', sourceKey: 'source-1',
      observedAt: '2026-10-02T00:00:00.000Z', trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE'
    }] : [],
    citations: covered ? [{ citationId: 'citation-document', evidenceRefId: 'evidence-document', needId: 'need-document', sourceKind: 'DOCUMENT', safeLabel: 'SOP' }] : [],
    unsupportedNeeds: coverage === 'PARTIAL' ? [{ needId: 'need-tool', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' }] : []
  };
}
