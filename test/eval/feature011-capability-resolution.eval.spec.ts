import { CapabilitySemanticResolverService } from '../../src/capabilities/capability-semantic-resolver.service';
import { CapabilityParameterResolverService } from '../../src/capabilities/capability-parameter-resolver.service';
import { FollowUpSemanticResolverService } from '../../src/assistant/conversation/follow-up-semantic-resolver.service';
import type { CapabilityDefinitionV1, ScopedCapabilityCatalogV1 } from '../../src/capabilities/capability-pack.types';
import type { CapabilityFollowUpFrameV1 } from '../../src/assistant/conversation/conversation.types';

describe('Feature 011 direct capability resolution eval', () => {
  const toolCalls = jest.fn();
  const customerRequests = jest.fn();
  const modelCalls = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  it.each([
    '請查本月工單新增數量',
    '想知道這個月新開立的維修工單數量',
    '本月份維修工單新增數量是多少'
  ])('recognizes a deterministic paraphrase without an exact-question rule: %s', (text) => {
    const result = evaluate(catalog([monthlyCapability()]), text);
    expect(result).toMatchObject({ outcome: 'MATCHED_PARAMETERS', capabilityKey: 'work-orders.count', parameters: { timeRange: 'this_month' } });
  });

  it('classifies unknown, ambiguous, missing, invalid, and conflicting meanings without execution', () => {
    expect(evaluate(catalog([monthlyCapability()]), '請說明差旅政策')).toMatchObject({ outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED' });
    expect(evaluate(catalog([monthlyCapability('work-orders.count'), monthlyCapability('maintenance.count')]), '本月工單新增數量')).toMatchObject({ outcome: 'AMBIGUOUS' });
    expect(evaluate(catalog([monthlyCapability()]), '工單新增數量')).toMatchObject({ outcome: 'NEEDS_CLARIFICATION', missingParameters: ['timeRange'] });
    expect(evaluate(catalog([monthlyCapability()]), '工單新增數量 期間 下季')).toMatchObject({ outcome: 'NEEDS_CLARIFICATION', invalidParameters: [{ parameterName: 'timeRange' }] });
    expect(evaluate(catalog([monthlyCapability()]), '本月和今天工單新增數量')).toMatchObject({ outcome: 'NEEDS_CLARIFICATION', conflictingParameters: [{ parameterName: 'timeRange', candidateCount: 2 }] });
    expect(toolCalls).not.toHaveBeenCalled();
    expect(customerRequests).not.toHaveBeenCalled();
    expect(modelCalls).not.toHaveBeenCalled();
  });

  it('inherits, replaces, and invalidates canonical values only under the current scoped catalog', () => {
    const followUp = new FollowUpSemanticResolverService();
    const currentCatalog = catalog([monthlyCapability()]);
    const inherited = followUp.resolveCapability({ currentFrame: frame([]), priorFrames: [frame([{ parameterName: 'timeRange', value: 'this_month', source: 'current_explicit', sourceMessageId: 'm1' }])], catalog: currentCatalog });
    const replaced = followUp.resolveCapability({ currentFrame: frame([{ parameterName: 'timeRange', value: 'today', source: 'current_explicit', sourceMessageId: 'm2' }]), priorFrames: [frame([{ parameterName: 'timeRange', value: 'this_month', source: 'current_explicit', sourceMessageId: 'm1' }])], catalog: currentCatalog });
    const invalidated = followUp.resolveCapability({ currentFrame: frame([]), priorFrames: [frame([{ parameterName: 'timeRange', value: 'last_month', source: 'current_explicit', sourceMessageId: 'm1' }])], catalog: currentCatalog });
    expect(inherited).toMatchObject({ kind: 'INHERIT', inheritedParameters: ['timeRange'] });
    expect(replaced).toMatchObject({ kind: 'REPLACE', replacedParameters: ['timeRange'] });
    expect(invalidated).toMatchObject({ kind: 'CLARIFY', invalidatedParameters: ['timeRange'] });
  });
});

function evaluate(scopedCatalog: ScopedCapabilityCatalogV1, text: string): any {
  const parameters = new CapabilityParameterResolverService();
  const signals = Object.fromEntries(scopedCatalog.capabilities.map((capability) => {
    const resolution = parameters.resolve({ capability, capabilityRef: ref(scopedCatalog, capability), text });
    return [capability.capabilityKey, resolution.validatedParameterNames];
  }));
  const semantic = new CapabilitySemanticResolverService().resolve({
    catalog: scopedCatalog, text, validatedParameterSignalsByCapability: signals
  });
  if (semantic.outcome !== 'MATCHED') return semantic;
  const capability = scopedCatalog.capabilities.find((entry) => entry.capabilityKey === semantic.capability.capabilityKey)!;
  const parameterResult = parameters.resolve({ capability, capabilityRef: semantic.capability, text });
  if (parameterResult.status === 'ISSUES') return parameterResult.result;
  return { outcome: 'MATCHED_PARAMETERS', capabilityKey: capability.capabilityKey, parameters: parameterResult.parameters };
}

function monthlyCapability(capabilityKey = 'work-orders.count'): CapabilityDefinitionV1 {
  return {
    version: '1', capabilityKey, active: true, kind: 'READ_ONLY_TOOL', safeLabel: capabilityKey,
    semanticProfiles: [{
      version: '1', locale: 'zh-TW', aliases: ['工單新增數量', '新開立'], examples: ['查詢本月新開立的維修工單總數'],
      resourceTerms: ['工單', '維修工單'], intentTerms: ['查詢'], metricTerms: ['新增數量', '新增', '新開立'], requiredSignalGroups: ['resource', 'metric']
    }],
    parameters: [{ version: '1', parameterName: 'timeRange', type: 'enum', required: true, semanticTerms: ['期間'], values: [
      { value: 'this_month', aliases: ['本月', '這個月', '本月份'] }, { value: 'today', aliases: ['今天'] }
    ] }]
  };
}

function catalog(capabilities: readonly CapabilityDefinitionV1[]): ScopedCapabilityCatalogV1 {
  return { version: '1', packId: 'customer-a.pack', packVersion: '1.0.0', customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a', capabilities, bindings: [] };
}

function ref(scopedCatalog: ScopedCapabilityCatalogV1, capability: CapabilityDefinitionV1) {
  return { packId: scopedCatalog.packId, packVersion: scopedCatalog.packVersion, capabilityKey: capability.capabilityKey, safeLabel: capability.safeLabel };
}

function frame(parameters: CapabilityFollowUpFrameV1['parameters']): CapabilityFollowUpFrameV1 {
  return { version: '1', scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a' }, packId: 'customer-a.pack', packVersion: '1.0.0', capabilityKey: 'work-orders.count', sourceMessageId: 'm2', parameters };
}
