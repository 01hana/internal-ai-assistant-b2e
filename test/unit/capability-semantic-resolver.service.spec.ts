import {
  CapabilitySemanticResolverService,
  normalizeCapabilitySemanticText
} from '../../src/capabilities/capability-semantic-resolver.service';
import type { CapabilityDefinitionV1, ScopedCapabilityCatalogV1 } from '../../src/capabilities/capability-pack.types';

describe('CapabilitySemanticResolverService', () => {
  const resolver = new CapabilitySemanticResolverService();

  it('normalizes NFKC, Latin case, punctuation, and bounded whitespace deterministically', () => {
    expect(normalizeCapabilitySemanticText('  ＡＢＣ，新增\n\t工單！ ')).toBe('abc 新增 工單');
  });

  it('uses only the exact zh-TW profile from the already-scoped catalog', () => {
    const catalog = scopedCatalog([
      capability('orders.count', { locale: 'en-US', alias: 'orders', resource: 'orders', metric: 'count' }),
      capability('work-orders.count', { alias: '工單', resource: '工單', metric: '新增' })
    ]);

    expect(resolver.resolve({ catalog, text: '請查工單新增數量' })).toMatchObject({
      outcome: 'MATCHED', capability: { capabilityKey: 'work-orders.count' }
    });
    expect(resolver.resolve({ catalog: scopedCatalog([capability('orders.count', { locale: 'zh', alias: '工單', resource: '工單', metric: '新增' })]), text: '工單新增' })).toEqual(notRecognized());
  });

  it('requires every declared signal group and does not infer from Tool metadata', () => {
    expect(resolver.resolve({ catalog: scopedCatalog([capability('orders.count')]), text: '這個月工單' })).toEqual(notRecognized());
  });

  it('applies normalized weights, threshold 0.70, parameter signals, and deterministic ordering', () => {
    const catalog = scopedCatalog([
      capability('zeta.count'),
      capability('alpha.count')
    ]);
    const result = resolver.resolve({
      catalog,
      text: '請查工單新增數量',
      validatedParameterSignalsByCapability: { 'alpha.count': ['timeRange'], 'zeta.count': ['timeRange'] }
    });

    expect(result.outcome).toBe('AMBIGUOUS');
    if (result.outcome !== 'AMBIGUOUS') return;
    expect(result.candidates.map((candidate) => candidate.capabilityKey)).toEqual(['alpha.count', 'zeta.count']);
    expect(result.candidates).toHaveLength(2);
  });

  it('returns ambiguity for candidates within 0.05 and caps safe references at five', () => {
    const catalog = scopedCatalog(Array.from({ length: 7 }, (_, index) => capability(`orders.count-${index}`)));
    const result = resolver.resolve({ catalog, text: '工單新增' });

    expect(result.outcome).toBe('AMBIGUOUS');
    if (result.outcome !== 'AMBIGUOUS') return;
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates.map((candidate) => candidate.capabilityKey)).toEqual([
      'orders.count-0', 'orders.count-1', 'orders.count-2', 'orders.count-3', 'orders.count-4'
    ]);
  });

  it('fails closed without widening the public union when eligible candidates exceed 32', () => {
    const catalog = scopedCatalog(Array.from({ length: 33 }, (_, index) => capability(`orders.count-${index}`)));
    expect(resolver.resolve({ catalog, text: '工單新增' })).toEqual(notRecognized());
  });

  it('resolves unseen compositional wording through metadata token and bigram overlap without exact-question matching', () => {
    const catalog = scopedCatalog([
      capability('work-orders.count', {
        alias: '工單新增數量',
        resource: '維修工單',
        metric: '新增數量',
        examples: ['想知道本月份新開立的維修工單總數']
      })
    ]);

    const result = resolver.resolve({
      catalog,
      text: '請問維修工單新增數量',
      validatedParameterSignalsByCapability: { 'work-orders.count': ['timeRange'] }
    });
    expect(result).toMatchObject({ outcome: 'MATCHED', capability: { capabilityKey: 'work-orders.count' } });
  });
});

function notRecognized() {
  return {
    version: '1', outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED',
    missingParameters: [], invalidParameters: [], conflictingParameters: []
  };
}

function scopedCatalog(capabilities: readonly CapabilityDefinitionV1[]): ScopedCapabilityCatalogV1 {
  return {
    version: '1', packId: 'customer-a.pack', packVersion: '1.0.0', customerId: 'customer-a',
    integrationId: 'integration-a', hostApp: 'host-a', capabilities, bindings: []
  };
}

function capability(
  capabilityKey: string,
  options: { locale?: string; alias?: string; resource?: string; metric?: string; examples?: string[] } = {}
): CapabilityDefinitionV1 {
  return {
    version: '1', capabilityKey, active: true, kind: 'READ_ONLY_TOOL', safeLabel: capabilityKey,
    semanticProfiles: [{
      version: '1', locale: options.locale ?? 'zh-TW', aliases: [options.alias ?? '工單新增'],
      examples: options.examples ?? ['查詢本月新增工單'], resourceTerms: [options.resource ?? '工單'],
      intentTerms: ['查詢'], metricTerms: [options.metric ?? '新增'], requiredSignalGroups: ['resource', 'metric']
    }],
    parameters: [{
      version: '1', parameterName: 'timeRange', type: 'enum', required: true, semanticTerms: ['期間'],
      values: [{ value: 'this_month', aliases: ['本月'] }]
    }]
  };
}
