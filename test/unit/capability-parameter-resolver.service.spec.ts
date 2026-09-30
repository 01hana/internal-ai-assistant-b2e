import {
  CapabilityParameterResolverService,
  freezeCapabilityResolutionResultV1
} from '../../src/capabilities/capability-parameter-resolver.service';
import type { CapabilityDefinitionV1, CapabilityResolutionResultV1 } from '../../src/capabilities/capability-pack.types';

describe('CapabilityParameterResolverService', () => {
  it('maps enum aliases only to declared values and deduplicates repeated same-value mentions', () => {
    const result = resolveParameters({ capability: enumCapability(), text: '本月和這個月新增工單' });
    expect(result).toEqual({ status: 'VALID', parameters: { timeRange: 'this_month' }, validatedParameterNames: ['timeRange'] });
  });

  it('classifies distinct enum values as conflict without exposing raw values', () => {
    const result = resolveParameters({ capability: enumCapability(), text: '本月和今天新增工單' });
    expect(result).toMatchObject({
      status: 'ISSUES', result: {
        outcome: 'NEEDS_CLARIFICATION', reasonCode: 'PARAMETER_ISSUES', missingParameters: [], invalidParameters: [],
        conflictingParameters: [{ parameterName: 'timeRange', candidateCount: 2 }]
      }
    });
    expect(JSON.stringify(result)).not.toContain('this_month');
    expect(JSON.stringify(result)).not.toContain('today');
  });

  it('classifies a recognized but undeclared enum capture as invalid before missing', () => {
    const result = resolveParameters({ capability: enumCapability(), text: '期間 下季' });
    expect(result).toMatchObject({
      status: 'ISSUES', result: {
        invalidParameters: [{ parameterName: 'timeRange', reasonCode: 'VALUE_NOT_DECLARED' }],
        missingParameters: [], conflictingParameters: []
      }
    });
    expect(JSON.stringify(result)).not.toContain('下季');
  });

  it('reports sorted missing canonical names when required parameters are absent', () => {
    const capability = enumCapability();
    capability.parameters = [
      ...capability.parameters,
      { version: '1', parameterName: 'area', type: 'bounded_string', required: true, semanticTerms: ['區域'], maxLength: 16, tokenSyntax: 'SAFE_IDENTIFIER', prefixes: [] }
    ];
    const result = resolveParameters({ capability: capability as CapabilityDefinitionV1, text: '請查詢' });
    expect(result).toMatchObject({ status: 'ISSUES', result: { missingParameters: ['area', 'timeRange'] } });
  });

  it('admits bounded strings through SAFE_IDENTIFIER, maximum length, and exact literal prefixes', () => {
    const capability = boundedCapability();
    expect(resolveParameters({ capability, text: '料號 SKU-1001' })).toEqual({
      status: 'VALID', parameters: { itemRef: 'SKU-1001' }, validatedParameterNames: ['itemRef']
    });
    expect(resolveParameters({ capability, text: '料號 BAD-1001' })).toMatchObject({
      status: 'ISSUES', result: { invalidParameters: [{ parameterName: 'itemRef', reasonCode: 'VALUE_INVALID' }] }
    });
    expect(resolveParameters({ capability, text: '料號 SKU/1001' })).toMatchObject({ status: 'ISSUES' });
  });

  it('admits an empty-prefix bounded string captured from current text', () => {
    expect(resolveParameters({ capability: genericBoundedCapability(), text: 'item ABC-1' })).toEqual({
      status: 'VALID', parameters: { itemRef: 'ABC-1' }, validatedParameterNames: ['itemRef']
    });
  });

  it('applies SAFE_IDENTIFIER and maximum length to empty-prefix current-text captures', () => {
    expect(resolveParameters({ capability: genericBoundedCapability(), text: 'item BAD/1' })).toMatchObject({
      status: 'ISSUES', result: { invalidParameters: [{ parameterName: 'itemRef', reasonCode: 'VALUE_INVALID' }] }
    });
    expect(resolveParameters({ capability: genericBoundedCapability(5), text: 'item ABCDEF' })).toMatchObject({
      status: 'ISSUES', result: { invalidParameters: [{ parameterName: 'itemRef', reasonCode: 'VALUE_INVALID' }] }
    });
  });

  it('retains literal-prefix admission when bounded-string prefixes are declared', () => {
    expect(resolveParameters({ capability: genericBoundedCapability(16, ['REF-']), text: 'item ABC-1' })).toMatchObject({
      status: 'ISSUES', result: { invalidParameters: [{ parameterName: 'itemRef', reasonCode: 'VALUE_INVALID' }] }
    });
    expect(resolveParameters({ capability: genericBoundedCapability(16, ['REF-']), text: 'item REF-1' }).status).toBe('VALID');
  });

  it('classifies distinct empty-prefix current-text values as conflict', () => {
    expect(resolveParameters({ capability: genericBoundedCapability(), text: 'item ABC-1 item XYZ-2' })).toMatchObject({
      status: 'ISSUES', result: {
        conflictingParameters: [{ parameterName: 'itemRef', candidateCount: 2 }],
        invalidParameters: [], missingParameters: []
      }
    });
  });

  it('uses normalized Latin case folding when locating a semantic term capture', () => {
    expect(resolveParameters({ capability: genericBoundedCapability(), text: 'ITEM ABC-1' })).toEqual({
      status: 'VALID', parameters: { itemRef: 'ABC-1' }, validatedParameterNames: ['itemRef']
    });
  });

  it('revalidates current, page-context, and inherited candidates through the same rules', () => {
    const capability = boundedCapability();
    expect(resolveParameters({ capability, text: '', currentValues: { itemRef: 'SKU-1' } }).status).toBe('VALID');
    expect(resolveParameters({ capability, text: '', pageContextValues: { itemRef: 'BAD-1' } })).toMatchObject({ status: 'ISSUES' });
    expect(resolveParameters({ capability, text: '', inheritedValues: { itemRef: 'SKU-2' } }).status).toBe('VALID');
  });

  it('revalidates all structured sources without adding source precedence for empty-prefix values', () => {
    const capability = genericBoundedCapability();
    expect(resolveParameters({ capability, text: '', currentValues: { itemRef: 'ABC-1' } }).status).toBe('VALID');
    expect(resolveParameters({ capability, text: '', pageContextValues: { itemRef: 'BAD/1' } })).toMatchObject({ status: 'ISSUES' });
    expect(resolveParameters({ capability, text: '', inheritedValues: { itemRef: 'XYZ-2' } }).status).toBe('VALID');
    expect(resolveParameters({
      capability,
      text: '',
      currentValues: { itemRef: 'ABC-1' },
      inheritedValues: { itemRef: 'XYZ-2' }
    })).toMatchObject({
      status: 'ISSUES', result: { conflictingParameters: [{ parameterName: 'itemRef', candidateCount: 2 }] }
    });
  });

  it('uses conflict before invalid before missing across parameter issues', () => {
    const capability = boundedCapability();
    const result = resolveParameters({
      capability,
      text: '',
      currentValues: { itemRef: 'SKU-1' },
      inheritedValues: { itemRef: 'SKU-2' },
      pageContextValues: { itemRef: 'BAD-1' }
    });
    expect(result).toMatchObject({
      status: 'ISSUES', result: { conflictingParameters: [{ parameterName: 'itemRef', candidateCount: 2 }], invalidParameters: [], missingParameters: [] }
    });
  });

  it.each([
    resolvedResult(),
    notRecognized(),
    unavailableResult(),
    ambiguousResult()
  ])('freeze-validates a closed safe result without selecting bindings', (input) => {
    const result = freezeCapabilityResolutionResultV1(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/credential|connectorContext|permission|authorization|prose/i);
  });

  it('rejects extra authority, connector, and raw-value fields from result shapes', () => {
    expect(() => freezeCapabilityResolutionResultV1({ ...notRecognized(), permissionScopes: ['admin'] } as unknown as CapabilityResolutionResultV1)).toThrow('CAPABILITY_RESOLUTION_RESULT_INVALID');
    expect(() => freezeCapabilityResolutionResultV1({ ...ambiguousResult(), rawValue: 'secret' } as unknown as CapabilityResolutionResultV1)).toThrow('CAPABILITY_RESOLUTION_RESULT_INVALID');
  });
});

function enumCapability(): any {
  return {
    version: '1', capabilityKey: 'work-orders.count', active: true, kind: 'READ_ONLY_TOOL', safeLabel: 'Work orders', semanticProfiles: [],
    parameters: [{ version: '1', parameterName: 'timeRange', type: 'enum', required: true, semanticTerms: ['期間'], values: [
      { value: 'this_month', aliases: ['本月', '這個月'] }, { value: 'today', aliases: ['今天'] }
    ] }]
  };
}

function boundedCapability(): CapabilityDefinitionV1 {
  return {
    version: '1', capabilityKey: 'inventory.stock', active: true, kind: 'READ_ONLY_TOOL', safeLabel: 'Inventory', semanticProfiles: [],
    parameters: [{ version: '1', parameterName: 'itemRef', type: 'bounded_string', required: true, semanticTerms: ['料號'], maxLength: 16, tokenSyntax: 'SAFE_IDENTIFIER', prefixes: ['SKU-'] }]
  };
}

function genericBoundedCapability(maxLength = 16, prefixes: string[] = []): CapabilityDefinitionV1 {
  return {
    version: '1', capabilityKey: 'inventory.lookup', active: true, kind: 'READ_ONLY_TOOL', safeLabel: 'Inventory lookup', semanticProfiles: [],
    parameters: [{ version: '1', parameterName: 'itemRef', type: 'bounded_string', required: true, semanticTerms: ['item'], maxLength, tokenSyntax: 'SAFE_IDENTIFIER', prefixes }]
  };
}

function ref() { return { packId: 'pack-a', packVersion: '1.0.0', capabilityKey: 'orders.count', safeLabel: 'Orders' }; }
function resolveParameters(input: Omit<Parameters<CapabilityParameterResolverService['resolve']>[0], 'capabilityRef'>) {
  return new CapabilityParameterResolverService().resolve({
    ...input,
    capabilityRef: { ...ref(), capabilityKey: input.capability.capabilityKey, safeLabel: input.capability.safeLabel }
  });
}
function resolvedResult(): CapabilityResolutionResultV1 { return { version: '1', outcome: 'RESOLVED', capability: ref(), parameters: { timeRange: 'this_month' }, bindingRef: { bindingId: 'b1', bindingVersion: '1.0.0' }, toolCandidate: { key: 'orders.count', version: '1.0.0', arguments: {}, reason: 'customer_capability_binding' } }; }
function notRecognized(): CapabilityResolutionResultV1 { return { version: '1', outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED', missingParameters: [], invalidParameters: [], conflictingParameters: [] }; }
function unavailableResult(): CapabilityResolutionResultV1 { return { version: '1', outcome: 'CAPABILITY_UNAVAILABLE', capability: ref(), parameters: { timeRange: 'today' }, reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' }; }
function ambiguousResult(): CapabilityResolutionResultV1 { return { version: '1', outcome: 'AMBIGUOUS', reasonCode: 'MULTIPLE_CAPABILITIES', candidates: [ref()] }; }
