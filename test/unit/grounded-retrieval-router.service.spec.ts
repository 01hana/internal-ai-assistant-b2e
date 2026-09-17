import { loadFeature010Export } from '../support/feature010-red-contract.helper';

type Router = { route(input: Record<string, unknown>): Record<string, any> };
type RouterConstructor = new () => Router;

describe('Feature 010 grounded retrieval router RED (T004)', () => {
  it.each([
    ['CONTEXT_ONLY', [{ kind: 'DOCUMENT', coveredByPriorEvidence: true }]],
    ['RAG', [{ kind: 'DOCUMENT' }]],
    ['TOOL', [{ kind: 'TOOL' }]],
    ['HYBRID', [{ kind: 'DOCUMENT' }, { kind: 'TOOL' }]],
    ['CLARIFY', [{ kind: 'AMBIGUOUS' }]],
    ['INSUFFICIENT', [{ kind: 'UNSUPPORTED' }]]
  ])('selects %s deterministically without execution authority [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (mode, needs) => {
    const plan = router().route({ requestId: 'req-router', decomposedNeeds: needs });
    expect(plan).toMatchObject({ mode, reasonCode: expect.any(String), needs: expect.any(Array) });
    expect(JSON.stringify(plan)).not.toMatch(/operationKey|toolDefinitionId|adapter|connector|credential|permissionResult|execute|retry/i);
  });

  it('caps needs at four with stable IDs and represents overflow as unsupported [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    const input = Array.from({ length: 6 }, (_, index) => ({ kind: 'DOCUMENT', query: `need-${index + 1}` }));
    const first = router().route({ requestId: 'req-bound', decomposedNeeds: input });
    const second = router().route({ requestId: 'req-bound', decomposedNeeds: input });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ needs: expect.any(Array), reasonCode: 'RETRIEVAL_NEED_LIMIT_EXCEEDED' });
    expect(first.needs).toHaveLength(4);
  });

  it('permits at most one Tool need and never emits a recursive plan [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    const plan = router().route({ decomposedNeeds: [{ kind: 'TOOL' }, { kind: 'TOOL' }] });
    expect(plan).toMatchObject({ mode: expect.stringMatching(/CLARIFY|INSUFFICIENT/), reasonCode: 'MULTIPLE_TOOL_NEEDS_UNSUPPORTED' });
    expect(plan).not.toHaveProperty('children');
    expect(plan).not.toHaveProperty('nextPlan');
  });
});

function router(): Router {
  const Target = loadFeature010Export<RouterConstructor>({
    taskId: 'T004', fromTestDirectory: __dirname,
    modulePath: '../../src/retrieval/grounded-retrieval-router.service',
    exportName: 'GroundedRetrievalRouterService', capability: 'bounded non-authoritative grounded retrieval routing'
  });
  return new Target();
}
