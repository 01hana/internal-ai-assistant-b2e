import { loadFeature010Export } from '../support/feature010-red-contract.helper';

type Normalizer = { normalize(input: Record<string, unknown>): Record<string, unknown> };
type NormalizerConstructor = new () => Normalizer;

describe('Feature 010 grounded Tool evidence normalization RED (T007)', () => {
  it('normalizes only successful executed, projected, attached Tool evidence [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    const result = normalizer().normalize(validInput());
    expect(result).toEqual(expect.objectContaining({
      kind: 'TOOL', needId: 'need-tool-1', evidenceRefId: 'evidence-tool-1', toolCallId: 'tool-call-1',
      canonicalToolKey: 'inventory.stock-on-hand', projectedFacts: { sku: 'SKU-001', quantity: 17 },
      fieldPaths: ['sku', 'quantity'], observedAt: '2026-09-17T01:00:00.000Z'
    }));
    expect(JSON.stringify(result)).not.toMatch(/rawResponse|connectorContextRef|credential|permissionSnapshot|secret/i);
  });

  it.each([
    ['failed ToolCall', { status: 'failed', executionStatus: 'failed' }],
    ['blocked ToolCall', { status: 'blocked', executionStatus: 'not_started' }],
    ['pending ToolCall', { status: 'pending', executionStatus: 'not_started' }],
    ['successful but not executed ToolCall', { status: 'success', executionStatus: 'in_progress' }],
    ['permission-denied decision', { status: 'blocked', executionStatus: 'not_started', answerDecisionStatus: 'permission_denied' }],
    ['conflicted grounded result', { status: 'success', executionStatus: 'executed', groundingCovered: false, groundingReason: 'evidence_conflict' }],
    ['failed projection', { projectionStatus: 'failed' }],
    ['detached EvidenceRef', { evidenceAttached: false }]
  ])('rejects %s [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (_case, override) => {
    const target = normalizer();
    expect(() => target.normalize({ ...validInput(), ...override })).toThrow(/reject|invalid|successful|projected|attached/i);
  });

  it.each([
    ['raw connector output', { rawResponse: { quantity: 999 } }],
    ['pre-projection data', { preProjectionData: { internalQuantity: 999 } }],
    ['undeclared field', { projectedFacts: { sku: 'SKU-001', quantity: 17, internalMargin: 0.92 } }],
    ['credential', { credential: 'secret' }],
    ['permission snapshot', { permissionSnapshot: { allowed: true } }]
  ])('rejects prohibited %s [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (_case, prohibited) => {
    const target = normalizer();
    expect(() => target.normalize({ ...validInput(), ...prohibited })).toThrow(/prohibited|undeclared|invalid|reject/i);
  });
});

function normalizer(): Normalizer {
  const Target = loadFeature010Export<NormalizerConstructor>({
    taskId: 'T007', fromTestDirectory: __dirname,
    modulePath: '../../src/assistant/grounding/grounded-tool-evidence.normalizer',
    exportName: 'GroundedToolEvidenceNormalizer', capability: 'projected-only Tool evidence normalization'
  });
  return new Target();
}

function validInput() {
  return {
    needId: 'need-tool-1', evidenceRefId: 'evidence-tool-1', toolCallId: 'tool-call-1',
    canonicalToolKey: 'inventory.stock-on-hand', status: 'success', executionStatus: 'executed', projectionStatus: 'succeeded',
    answerDecisionStatus: 'answered', groundingCovered: true,
    evidenceAttached: true, projectedFacts: { sku: 'SKU-001', quantity: 17 }, declaredFieldPaths: ['sku', 'quantity'],
    observedAt: '2026-09-17T01:00:00.000Z'
  };
}
