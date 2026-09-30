import { FollowUpSemanticResolverService } from '../../src/assistant/conversation/follow-up-semantic-resolver.service';
import { ConversationSemanticReconstructorService } from '../../src/assistant/conversation/conversation-semantic-reconstructor.service';
import type { CapabilityFollowUpFrameV1 } from '../../src/assistant/conversation/conversation.types';
import type { ScopedCapabilityCatalogV1 } from '../../src/capabilities/capability-pack.types';

describe('Feature 011 capability companion follow-up frame', () => {
  const resolver = new FollowUpSemanticResolverService();

  it('inherits canonical values by name and preserves a separate frame contract', () => {
    const result = resolver.resolveCapability({
      currentFrame: frame([]), priorFrames: [frame([parameter('timeRange', 'this_month')])], catalog: catalog()
    });
    expect(result).toMatchObject({ kind: 'INHERIT', inheritedParameters: ['timeRange'], replacedParameters: [] });
    expect(result.resolvedFrame?.parameters).toEqual([expect.objectContaining({ parameterName: 'timeRange', value: 'this_month', source: 'inherited' })]);
    expect(result.resolvedFrame).not.toHaveProperty('resource');
  });

  it('uses the existing REPLACE decision when a current canonical value replaces prior state', () => {
    const result = resolver.resolveCapability({
      currentFrame: frame([parameter('timeRange', 'today')]),
      priorFrames: [frame([parameter('timeRange', 'this_month')])], catalog: catalog()
    });
    expect(result).toMatchObject({ kind: 'REPLACE', replacedParameters: ['timeRange'], inheritedParameters: [] });
    expect(result.resolvedFrame?.parameters[0]).toMatchObject({ value: 'today', source: 'current_explicit' });
  });

  it.each([
    ['changed pack', frame([], { packVersion: '0.9.0' }), catalog()],
    ['changed customer scope', frame([], { scope: { customerId: 'customer-b', integrationId: 'integration-a', hostApp: 'host-a' } }), catalog()],
    ['changed integration scope', frame([], { scope: { customerId: 'customer-a', integrationId: 'integration-b', hostApp: 'host-a' } }), catalog()],
    ['changed HostApp scope', frame([], { scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-b' } }), catalog()],
    ['removed capability', frame([], { capabilityKey: 'removed.capability' }), catalog()]
  ])('rejects inheritance from %s', (_case, prior, currentCatalog) => {
    const result = resolver.resolveCapability({ currentFrame: frame([]), priorFrames: [prior], catalog: currentCatalog });
    expect(result.kind).toBe('CLARIFY');
    expect(result.resolvedFrame).toBeUndefined();
  });

  it('rejects removed parameters and inherited values invalidated by the current pack', () => {
    const removed = resolver.resolveCapability({
      currentFrame: frame([]), priorFrames: [frame([parameter('removedParam', 'x')])], catalog: catalog()
    });
    const invalidated = resolver.resolveCapability({
      currentFrame: frame([]), priorFrames: [frame([parameter('timeRange', 'last_month')])], catalog: catalog()
    });
    expect(removed).toMatchObject({ kind: 'CLARIFY', invalidatedParameters: ['removedParam'] });
    expect(invalidated).toMatchObject({ kind: 'CLARIFY', invalidatedParameters: ['timeRange'] });
  });

  it('reconstructs only a bounded frame that validates against the current catalog', () => {
    const reconstructor = new ConversationSemanticReconstructorService();
    const safe = reconstructor.reconstructCapabilityFrame(frame([parameter('timeRange', 'this_month')]), catalog());
    expect(safe).toEqual(frame([parameter('timeRange', 'this_month')]));
    expect(Object.isFrozen(safe)).toBe(true);
    expect(reconstructor.reconstructCapabilityFrame({ ...frame([]), token: 'secret' }, catalog())).toBeUndefined();
  });
});

function parameter(parameterName: string, value: string) {
  return { parameterName, value, source: 'current_explicit' as const, sourceMessageId: 'message-current' };
}

function frame(parameters: readonly ReturnType<typeof parameter>[], overrides: Partial<CapabilityFollowUpFrameV1> = {}): CapabilityFollowUpFrameV1 {
  return {
    version: '1', scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a' },
    packId: 'customer-a.pack', packVersion: '1.0.0', capabilityKey: 'work-orders.count',
    sourceMessageId: 'message-current', parameters, ...overrides
  };
}

function catalog(): ScopedCapabilityCatalogV1 {
  return {
    version: '1', packId: 'customer-a.pack', packVersion: '1.0.0', customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a',
    capabilities: [{
      version: '1', capabilityKey: 'work-orders.count', active: true, kind: 'READ_ONLY_TOOL', safeLabel: 'Work orders', semanticProfiles: [],
      parameters: [{ version: '1', parameterName: 'timeRange', type: 'enum', required: true, semanticTerms: ['期間'], values: [
        { value: 'this_month', aliases: ['本月'] }, { value: 'today', aliases: ['今天'] }
      ] }]
    }], bindings: []
  };
}
