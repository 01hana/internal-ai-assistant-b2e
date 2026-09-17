import { loadFeature010Export } from '../support/feature010-red-contract.helper';

type BundleService = { assemble(input: Record<string, unknown>): Record<string, any> };
type BundleServiceConstructor = new () => BundleService;

describe('Feature 010 Grounded Context Bundle RED (T008)', () => {
  it.each([
    ['COMPLETE', [result('need-document', 'COVERED'), result('need-tool', 'COVERED')]],
    ['PARTIAL', [result('need-document', 'COVERED'), result('need-tool', 'UNSUPPORTED')]],
    ['INSUFFICIENT', [result('need-document', 'UNSUPPORTED'), result('need-tool', 'UNSUPPORTED')]]
  ])('computes %s from per-need outcomes [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (coverage, needResults) => {
    expect(service().assemble(bundleInput(needResults))).toMatchObject({
      version: '1', retrieval: { coverage, requestedNeeds: expect.any(Array), needResults }
    });
  });

  it('keeps requested needs distinct from results with exact stable mapping and unsupported needs [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    const bundle = service().assemble(bundleInput([result('need-document', 'COVERED'), result('need-tool', 'UNSUPPORTED')]));
    const requestedIds = bundle.retrieval.requestedNeeds.map((need: { id: string }) => need.id);
    const resultNeedIds = bundle.retrieval.needResults.map((need: { needId: string }) => need.needId);
    expect(requestedIds).toEqual(['need-document', 'need-tool']);
    expect(resultNeedIds).toEqual(requestedIds);
    expect(bundle.retrieval.requestedNeeds.every((need: Record<string, unknown>) => !Object.hasOwn(need, 'needId'))).toBe(true);
    expect(bundle.unsupportedNeeds).toEqual([expect.objectContaining({ needId: 'need-tool' })]);
    expect(bundle.retrieval.requestedNeeds).not.toBe(bundle.retrieval.needResults);
  });

  it('orders sources stably, links evidence and citations, deduplicates, and deeply freezes the bundle [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    const input = bundleInput([result('need-document', 'COVERED'), result('need-tool', 'COVERED')]);
    input.evidence = [documentEvidence(), toolEvidence(), documentEvidence()];
    input.citations = [citation('citation-tool', 'evidence-tool', 'need-tool'), citation('citation-document', 'evidence-document', 'need-document')];
    const bundle = service().assemble(input);
    expect(bundle.evidence.map((item: { evidenceRefId: string }) => item.evidenceRefId)).toEqual(['evidence-document', 'evidence-tool']);
    expect(bundle.citations).toEqual([
      expect.objectContaining({ citationId: 'citation-document', evidenceRefId: 'evidence-document' }),
      expect.objectContaining({ citationId: 'citation-tool', evidenceRefId: 'evidence-tool' })
    ]);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.retrieval.requestedNeeds)).toBe(true);
    expect(Object.isFrozen(bundle.evidence[0])).toBe(true);
  });

  it.each([
    ['operation selection', { operationKey: 'inventory.stock-on-hand' }],
    ['connector selection', { connectorId: 'connector-1' }],
    ['permission authority', { permissionResult: 'allowed' }],
    ['credential', { token: 'secret' }]
  ])('rejects authority-bearing %s recursively [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (_case, prohibited) => {
    const input = bundleInput([result('need-document', 'COVERED')]);
    input.currentRequest = { messageId: 'message-1', normalizedQuestion: 'policy?', nested: prohibited };
    const target = service();
    expect(() => target.assemble(input)).toThrow(/prohibited|authority|unsafe|invalid/i);
  });
});

function service(): BundleService {
  const Target = loadFeature010Export<BundleServiceConstructor>({
    taskId: 'T008', fromTestDirectory: __dirname,
    modulePath: '../../src/assistant/grounding/grounded-context-bundle.service',
    exportName: 'GroundedContextBundleService', capability: 'safe immutable GroundedContextBundleV1 assembly'
  });
  return new Target();
}

function bundleInput(needResults: readonly Record<string, unknown>[]): Record<string, any> {
  return {
    currentRequest: { messageId: 'message-1', normalizedQuestion: 'policy and inventory?' }, locale: 'zh-TW',
    mode: 'HYBRID', requestedNeeds: [
      { id: 'need-document', kind: 'DOCUMENT', query: 'policy' },
      { id: 'need-tool', kind: 'TOOL', frame: { resource: 'inventory', intent: 'read', entity: 'SKU-001' } }
    ], needResults, evidence: [documentEvidence(), toolEvidence()],
    citations: [citation('citation-document', 'evidence-document', 'need-document'), citation('citation-tool', 'evidence-tool', 'need-tool')]
  };
}
function result(needId: string, status: string) { return { needId, status, evidenceRefIds: status === 'COVERED' ? [`evidence-${needId.replace('need-', '')}`] : [] }; }
function documentEvidence() { return { kind: 'DOCUMENT', needId: 'need-document', evidenceRefId: 'evidence-document', sourceOrder: 1, content: 'policy' }; }
function toolEvidence() { return { kind: 'TOOL', needId: 'need-tool', evidenceRefId: 'evidence-tool', sourceOrder: 2, projectedFacts: { quantity: 17 } }; }
function citation(citationId: string, evidenceRefId: string, needId: string) { return { citationId, evidenceRefId, needId, sourceKind: needId === 'need-tool' ? 'TOOL' : 'DOCUMENT', safeLabel: citationId }; }
