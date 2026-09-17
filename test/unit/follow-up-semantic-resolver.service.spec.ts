import { loadFeature010Export } from '../support/feature010-red-contract.helper';

type Resolver = { resolve(input: Record<string, unknown>): Record<string, unknown> };
type ResolverConstructor = new () => Resolver;
const prior = Object.freeze({ resource: dim('inventory'), intent: dim('read'), metricOrAspect: dim('availability'), entity: { ...dim('SKU-001'), entityType: 'itemSku' }, topicKey: 'inventory:SKU-001' });

describe('Feature 010 semantic follow-up RED (T005)', () => {
  it.each([
    ['INHERIT', {}, [prior]],
    ['REPLACE', { entity: { ...dim('SKU-002', 'current_explicit'), entityType: 'itemSku' } }, [prior]],
    ['NEW_TOPIC', { resource: dim('workOrder', 'current_explicit'), entity: { ...dim('WO-10001', 'current_explicit'), entityType: 'workOrder' } }, [prior]],
    ['CLARIFY', {}, []]
  ])('resolves %s deterministically [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (kind, currentFrame, priorFrames) => {
    expect(resolver().resolve({ currentFrame, priorFrames })).toMatchObject({ kind, reasonCode: expect.any(String) });
  });

  it('lets explicit current values win and inherits omissions only [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', () => {
    const result = resolver().resolve({ currentFrame: { entity: { ...dim('SKU-002', 'current_explicit'), entityType: 'itemSku' } }, priorFrames: [prior] });
    expect(result).toMatchObject({
      kind: 'REPLACE', resolvedFrame: { resource: { value: 'inventory' }, intent: { value: 'read' }, entity: { value: 'SKU-002', source: 'current_explicit' } },
      inheritedDimensions: expect.arrayContaining(['resource', 'intent', 'metricOrAspect']), replacedDimensions: ['entity']
    });
  });

  it.each([
    ['contradictory current frame', { currentFrame: { resource: dim('inventory'), topicKey: 'work-orders' }, priorFrames: [prior] }],
    ['multiple compatible frames', { currentFrame: {}, priorFrames: [prior, { ...prior, entity: { ...dim('SKU-002'), entityType: 'itemSku' } }] }]
  ])('clarifies %s instead of choosing authority [FAIL_REASON=MISSING_FEATURE010_BEHAVIOR]', (_case, input) => {
    expect(resolver().resolve(input)).toMatchObject({ kind: 'CLARIFY', resolvedFrame: undefined });
  });
});

function resolver(): Resolver {
  const Target = loadFeature010Export<ResolverConstructor>({
    taskId: 'T005', fromTestDirectory: __dirname,
    modulePath: '../../src/assistant/conversation/follow-up-semantic-resolver.service',
    exportName: 'FollowUpSemanticResolverService', capability: 'deterministic semantic follow-up resolution'
  });
  return new Target();
}
function dim(value: string, source = 'inherited') { return { value, source, sourceMessageId: 'message-1', confidence: 1 }; }
