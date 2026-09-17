import { loadFeature010Export } from '../support/feature010-red-contract.helper';
import { GroundedRetrievalAuditService } from '../../src/retrieval/grounded-retrieval-audit.service';

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
    expect(plan.needs.filter((need: { kind: string }) => need.kind === 'TOOL')).toHaveLength(1);
  });

  it('routes compound document and Tool needs once in stable source order', () => {
    const plan = router().route({
      requestId: 'req-compound',
      decomposedNeeds: [
        { kind: 'DOCUMENT', query: 'work order SOP' },
        { kind: 'TOOL', frame: {} }
      ]
    });
    expect(plan).toMatchObject({ mode: 'HYBRID', reasonCode: 'RETRIEVAL_ROUTE_SELECTED' });
    expect(plan.needs.map((need: { id: string }) => need.id)).toEqual(['need-1', 'need-2']);
  });

  it('selects the lane from uncovered needs without authorizing prior evidence itself', () => {
    const plan = router().route({
      decomposedNeeds: [
        { kind: 'DOCUMENT', query: 'policy', coveredByPriorEvidence: true },
        { kind: 'TOOL', frame: {} }
      ]
    });
    expect(plan).toMatchObject({ mode: 'TOOL' });
    expect(plan.needs).toHaveLength(2);
  });

  it('sanitizes authority-bearing input instead of copying it into the plan', () => {
    const plan = router().route({
      decomposedNeeds: [{
        kind: 'TOOL', operationKey: 'unsafe', connector: 'unsafe', credential: 'unsafe',
        frame: { topicKey: 'inventory', canonicalToolKey: 'unsafe', permissionResult: 'allowed' }
      }]
    });
    expect(plan).toMatchObject({ mode: 'TOOL' });
    expect(JSON.stringify(plan)).not.toMatch(/operationKey|canonicalToolKey|toolDefinitionId|adapter|connector|credential|permissionResult|rawResponse|preProjectionData|execute|retry/i);
  });

  it('is deeply immutable and does not expose retry or autonomous-plan surfaces', () => {
    const plan = router().route({ decomposedNeeds: [{ kind: 'DOCUMENT', query: 'policy' }] });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.needs)).toBe(true);
    expect(Object.isFrozen(plan.needs[0])).toBe(true);
    expect(plan).not.toHaveProperty('children');
    expect(plan).not.toHaveProperty('nextPlan');
    expect(plan).not.toHaveProperty('retry');
  });

  it('records only bounded plan metadata in audit output', async () => {
    const append = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const audit = new GroundedRetrievalAuditService({ append } as never);
    const plan = router().route({ decomposedNeeds: [{ kind: 'DOCUMENT', query: 'sensitive policy question' }] });
    await audit.recordPlan({
      customerScope: { customerId: 'customer-1', organizationId: 'org-1', hostApp: 'app-1', actorId: 'actor-1' } as never,
      requestId: 'request-1', sessionId: 'session-1', messageId: 'message-1', durationMs: 3, plan: plan as never
    });
    const payload = append.mock.calls[0][0];
    expect(payload).toMatchObject({ eventType: 'grounded_retrieval_planned', metadata: { mode: 'RAG', needCount: 1, needKinds: ['DOCUMENT'], unsupportedCount: 0 } });
    expect(JSON.stringify(payload.metadata)).not.toContain('sensitive policy question');
    expect(JSON.stringify(payload.metadata)).not.toMatch(/projectedFacts|toolArguments|canonicalToolKey|permission|connector|evidence/i);
  });

  it('normalizes untrusted reason text before it can enter a plan or audit event', () => {
    const plan = router().route({
      decomposedNeeds: [{ kind: 'UNSUPPORTED', reasonCode: 'query text and token=secret' }]
    });
    expect(plan.needs).toEqual([{ id: 'need-1', kind: 'UNSUPPORTED', reasonCode: 'UNSUPPORTED_RETRIEVAL_NEED' }]);
    expect(JSON.stringify(plan)).not.toContain('token=secret');
  });

  it('lets a CLARIFY follow-up decision override generic decomposition', () => {
    const plan = router().route({
      decomposedNeeds: [{ kind: 'TOOL', frame: {} }],
      followUpResolution: {
        kind: 'CLARIFY', reasonCode: 'VAGUE_DEIXIS', inheritedDimensions: [], replacedDimensions: []
      }
    });
    expect(plan).toMatchObject({ mode: 'CLARIFY', reasonCode: 'RETRIEVAL_NEED_AMBIGUOUS' });
    expect(plan.needs).toEqual([{ id: 'need-1', kind: 'UNSUPPORTED', reasonCode: 'VAGUE_DEIXIS' }]);
  });

  it('routes only the whitelisted resolved follow-up frame without execution authority', () => {
    const dimension = { value: 'inventory', sourceMessageId: 'message-1', source: 'inherited', confidence: 1 };
    const plan = router().route({
      decomposedNeeds: [{ kind: 'TOOL' }],
      followUpResolution: {
        kind: 'INHERIT', reasonCode: 'OMITTED_DIMENSIONS_INHERITED', inheritedDimensions: ['resource'], replacedDimensions: [],
        resolvedFrame: { resource: dimension, topicKey: 'inventory', canonicalToolKey: 'forbidden', permissionResult: 'allowed' }
      }
    });
    expect(plan).toMatchObject({ mode: 'TOOL', resolvedFrame: { resource: { value: 'inventory' } } });
    expect(JSON.stringify(plan)).not.toMatch(/canonicalToolKey|permissionResult/);
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
