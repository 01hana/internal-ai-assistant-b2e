import {
  MAX_AMBIGUOUS_CANDIDATE_REFS,
  MAX_BINDINGS_PER_PACK,
  MAX_BOUNDED_STRING_LENGTH,
  MAX_CANDIDATES_MATERIALIZED,
  MAX_CAPABILITIES_PER_PACK,
  MAX_ENUM_VALUES_PER_PARAMETER,
  MAX_EXAMPLE_LENGTH,
  MAX_EXAMPLES_PER_PROFILE,
  MAX_HOST_APPS_PER_PACK,
  MAX_IDENTIFIER_LENGTH,
  MAX_MAPPINGS_PER_BINDING,
  MAX_PACK_BYTES,
  MAX_PARAMETERS_PER_CAPABILITY,
  MAX_SEMANTIC_PROFILES_PER_CAPABILITY,
  MAX_TERMS_PER_LIST,
  MAX_TEXT_LENGTH,
  parseCustomerCapabilityPackJsonV1,
  parseCustomerCapabilityPackV1
} from '../../src/capabilities/capability-pack.parser';

describe('capability-pack parser bounds', () => {
  it('exports the approved V1 bounds', () => {
    expect({
      MAX_PACK_BYTES,
      MAX_CAPABILITIES_PER_PACK,
      MAX_BINDINGS_PER_PACK,
      MAX_SEMANTIC_PROFILES_PER_CAPABILITY,
      MAX_PARAMETERS_PER_CAPABILITY,
      MAX_ENUM_VALUES_PER_PARAMETER,
      MAX_MAPPINGS_PER_BINDING,
      MAX_TERMS_PER_LIST,
      MAX_EXAMPLES_PER_PROFILE,
      MAX_HOST_APPS_PER_PACK,
      MAX_CANDIDATES_MATERIALIZED,
      MAX_AMBIGUOUS_CANDIDATE_REFS,
      MAX_TEXT_LENGTH,
      MAX_EXAMPLE_LENGTH,
      MAX_IDENTIFIER_LENGTH,
      MAX_BOUNDED_STRING_LENGTH
    }).toEqual({
      MAX_PACK_BYTES: 262144,
      MAX_CAPABILITIES_PER_PACK: 128,
      MAX_BINDINGS_PER_PACK: 256,
      MAX_SEMANTIC_PROFILES_PER_CAPABILITY: 4,
      MAX_PARAMETERS_PER_CAPABILITY: 16,
      MAX_ENUM_VALUES_PER_PARAMETER: 64,
      MAX_MAPPINGS_PER_BINDING: 32,
      MAX_TERMS_PER_LIST: 32,
      MAX_EXAMPLES_PER_PROFILE: 16,
      MAX_HOST_APPS_PER_PACK: 16,
      MAX_CANDIDATES_MATERIALIZED: 32,
      MAX_AMBIGUOUS_CANDIDATE_REFS: 5,
      MAX_TEXT_LENGTH: 256,
      MAX_EXAMPLE_LENGTH: 256,
      MAX_IDENTIFIER_LENGTH: 128,
      MAX_BOUNDED_STRING_LENGTH: 256
    });
  });

  it.each([
    ['capabilities', (pack: Record<string, any>, count: number) => {
      pack.capabilities = sequence(count, (index) => capability(`capability-${index}`));
    }, 128],
    ['bindings', (pack: Record<string, any>, count: number) => {
      pack.bindings = sequence(count, (index) => binding(`binding-${index}`));
    }, 256],
    ['semantic profiles', (pack: Record<string, any>, count: number) => {
      pack.capabilities[0].semanticProfiles = sequence(count, (index) => profile(`x-${index}`));
    }, 4],
    ['parameters', (pack: Record<string, any>, count: number) => {
      pack.capabilities[0].parameters = sequence(count, (index) => enumParameter(`parameter-${index}`));
    }, 16],
    ['enum values', (pack: Record<string, any>, count: number) => {
      pack.capabilities[0].parameters[0].values = sequence(count, (index) => ({
        value: `value-${index}`,
        aliases: [`別名-${index}`]
      }));
    }, 64],
    ['mappings', (pack: Record<string, any>, count: number) => {
      pack.bindings[0].mappings = sequence(count, (index) => ({
        version: '1',
        targetArgument: `target-${index}`,
        source: 'BOUND_CONSTANT',
        value: index
      }));
    }, 32],
    ['aliases', (pack: Record<string, any>, count: number) => {
      pack.capabilities[0].semanticProfiles[0].aliases = sequence(count, (index) => `別名-${index}`);
    }, 32],
    ['examples', (pack: Record<string, any>, count: number) => {
      pack.capabilities[0].semanticProfiles[0].examples = sequence(count, (index) => `範例-${index}`);
    }, 16],
    ['host apps', (pack: Record<string, any>, count: number) => {
      pack.hostApps = sequence(count, (index) => `host-${index}`);
    }, 16]
  ])('accepts %s at its maximum and rejects maximum plus one', (_name, mutate, maximum) => {
    const accepted = validPack();
    mutate(accepted, maximum);
    expect(() => parseCustomerCapabilityPackV1(accepted)).not.toThrow();

    const rejected = validPack();
    mutate(rejected, maximum + 1);
    expect(() => parseCustomerCapabilityPackV1(rejected)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it('enforces the text, example, identifier, and bounded-string limits', () => {
    const accepted = validPack();
    accepted.packId = `p${'a'.repeat(127)}`;
    accepted.capabilities[0].safeLabel = 'a'.repeat(256);
    accepted.capabilities[0].semanticProfiles[0].examples = ['範'.repeat(256)];
    accepted.capabilities[0].parameters = [{
      version: '1', parameterName: 'itemRef', type: 'bounded_string', required: true,
      semanticTerms: ['料號'], maxLength: 256, tokenSyntax: 'SAFE_IDENTIFIER', prefixes: []
    }];
    expect(() => parseCustomerCapabilityPackV1(accepted)).not.toThrow();

    for (const mutate of [
      (pack: Record<string, any>) => { pack.packId = `p${'a'.repeat(128)}`; },
      (pack: Record<string, any>) => { pack.capabilities[0].safeLabel = 'a'.repeat(257); },
      (pack: Record<string, any>) => { pack.capabilities[0].semanticProfiles[0].examples = ['範'.repeat(257)]; },
      (pack: Record<string, any>) => {
        pack.capabilities[0].parameters = [{
          version: '1', parameterName: 'itemRef', type: 'bounded_string', required: true,
          semanticTerms: ['料號'], maxLength: 257, tokenSyntax: 'SAFE_IDENTIFIER', prefixes: []
        }];
      }
    ]) {
      const rejected = validPack();
      mutate(rejected);
      expect(() => parseCustomerCapabilityPackV1(rejected)).toThrow('CAPABILITY_PACK_INVALID');
    }
  });

  it('accepts exactly MAX_PACK_BYTES and rejects one byte more', () => {
    const json = JSON.stringify(validPack());
    const exact = new TextEncoder().encode(`${json}${' '.repeat(MAX_PACK_BYTES - Buffer.byteLength(json))}`);
    const oversized = new Uint8Array([...exact, 0x20]);

    expect(exact.byteLength).toBe(MAX_PACK_BYTES);
    expect(() => parseCustomerCapabilityPackJsonV1(exact)).not.toThrow();
    expect(() => parseCustomerCapabilityPackJsonV1(oversized)).toThrow('CAPABILITY_PACK_INVALID');
  });
});

describe('capability-pack identifier and version validation', () => {
  it.each([
    ['', 'empty'],
    ['*', 'wildcard'],
    ['customer/*', 'embedded wildcard'],
    [' customer', 'leading whitespace'],
    ['customer/app', 'slash'],
    ['客戶', 'non-contract characters']
  ])('rejects %s as an identifier (%s)', (value) => {
    const pack = validPack();
    pack.customerId = value;
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it.each([
    '1.0.0',
    '1.0.0-beta',
    '1.0.0-beta.1',
    '1.0.0-rc.1',
    '1.0.0+build.5',
    '1.0.0-rc.1+build.5'
  ])('accepts semantic version %s consistently across all exact-version fields', (version) => {
    for (const field of ['packVersion', 'bindingVersion', 'toolVersion'] as const) {
      const pack = validPack();
      setVersionField(pack, field, version);
      expect(() => parseCustomerCapabilityPackV1(pack)).not.toThrow();
    }
  });

  it.each([
    '1',
    '1.0',
    'v1.0.0',
    '01.0.0',
    '1.00.0',
    '1.0.00',
    '1.0.0-01',
    '1.0.0-alpha..1',
    '1.0.0+',
    '^1.0.0',
    '~1.0.0',
    '>=1.0.0',
    '-'
  ])('rejects invalid or ranged semantic version %s across all exact-version fields', (version) => {
    for (const field of ['packVersion', 'bindingVersion', 'toolVersion'] as const) {
      const pack = validPack();
      setVersionField(pack, field, version);
      expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
    }
  });

  it.each(['z', 'zh_', '-TW', 'zh--TW', 'zh-Taiwan-oversized', 'zh-*'])('rejects invalid locale %s', (locale) => {
    const pack = validPack();
    pack.capabilities[0].semanticProfiles[0].locale = locale;
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it.each(['zh-TW', 'en', 'en-US', 'x-0'])('accepts bounded BCP-47-shaped locale %s', (locale) => {
    const pack = validPack();
    pack.capabilities[0].semanticProfiles[0].locale = locale;
    expect(() => parseCustomerCapabilityPackV1(pack)).not.toThrow();
  });
});

describe('capability-pack parameter structures', () => {
  it('accepts closed enum and bounded-string parameter definitions', () => {
    const pack = validPack();
    pack.capabilities[0].parameters = [
      enumParameter('timeRange'),
      {
        version: '1', parameterName: 'itemRef', type: 'bounded_string', required: false,
        semanticTerms: ['料號'], maxLength: 64, tokenSyntax: 'SAFE_IDENTIFIER', prefixes: ['SKU-', 'ITEM:']
      }
    ];

    expect(() => parseCustomerCapabilityPackV1(pack)).not.toThrow();
  });

  it.each([
    ['enum required flag', (parameter: Record<string, any>) => { parameter.required = 'yes'; }],
    ['enum value', (parameter: Record<string, any>) => { parameter.values[0].value = 1; }],
    ['enum alias', (parameter: Record<string, any>) => { parameter.values[0].aliases = [1]; }],
    ['bounded-string required flag', (parameter: Record<string, any>) => { parameter.required = 1; }],
    ['bounded-string token syntax', (parameter: Record<string, any>) => { parameter.tokenSyntax = 'REGEX'; }],
    ['bounded-string zero maximum', (parameter: Record<string, any>) => { parameter.maxLength = 0; }],
    ['bounded-string fractional maximum', (parameter: Record<string, any>) => { parameter.maxLength = 1.5; }],
    ['bounded-string invalid prefix', (parameter: Record<string, any>) => { parameter.prefixes = ['SKU/']; }]
  ])('rejects an invalid %s', (_name, mutate) => {
    const pack = validPack();
    const parameter = _name.startsWith('enum')
      ? enumParameter('timeRange')
      : {
          version: '1', parameterName: 'itemRef', type: 'bounded_string', required: true,
          semanticTerms: ['料號'], maxLength: 64, tokenSyntax: 'SAFE_IDENTIFIER', prefixes: []
        };
    mutate(parameter);
    pack.capabilities[0].parameters = [parameter];
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });
});

describe('capability-pack semantic profile structure', () => {
  it.each(['resource', 'intent', 'metric'])('accepts the closed %s signal group', (group) => {
    const pack = validPack();
    pack.capabilities[0].semanticProfiles[0].requiredSignalGroups = [group];
    expect(() => parseCustomerCapabilityPackV1(pack)).not.toThrow();
  });

  it('rejects unknown required signal groups', () => {
    const pack = validPack();
    pack.capabilities[0].semanticProfiles[0].requiredSignalGroups = ['operation'];
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it.each([
    ['resource', 'resourceTerms'],
    ['intent', 'intentTerms'],
    ['metric', 'metricTerms']
  ])('rejects required %s without declared terms', (group, termsKey) => {
    const pack = validPack();
    pack.capabilities[0].semanticProfiles[0].requiredSignalGroups = [group];
    pack.capabilities[0].semanticProfiles[0][termsKey] = [];
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });
});

describe('capability-pack binding structures', () => {
  it('accepts canonical-parameter and scalar-constant mappings', () => {
    const pack = validPack();
    pack.bindings[0].semanticConstraints = [];
    pack.bindings[0].mappings = [
      { version: '1', targetArgument: 'sku', source: 'CANONICAL_PARAMETER', parameterName: 'itemRef' },
      { version: '1', targetArgument: 'limit', source: 'BOUND_CONSTANT', value: 10 },
      { version: '1', targetArgument: 'active', source: 'BOUND_CONSTANT', value: true },
      { version: '1', targetArgument: 'mode', source: 'BOUND_CONSTANT', value: 'summary' }
    ];
    expect(() => parseCustomerCapabilityPackV1(pack)).not.toThrow();
  });

  it('accepts empty mappings and empty semantic constraints', () => {
    const pack = validPack();
    pack.bindings[0].semanticConstraints = [];
    pack.bindings[0].mappings = [];
    expect(() => parseCustomerCapabilityPackV1(pack)).not.toThrow();
  });

  it.each([
    ['target kind', (value: Record<string, any>) => { value.target.kind = 'API'; }],
    ['constraint operator', (value: Record<string, any>) => {
      value.semanticConstraints = [{ version: '1', parameterName: 'timeRange', operator: 'EQUALS', allowedValues: ['this_month'] }];
    }],
    ['parameter mapping source', (value: Record<string, any>) => {
      value.mappings = [{ version: '1', targetArgument: 'sku', source: 'PARAMETER', parameterName: 'itemRef' }];
    }],
    ['constant mapping source', (value: Record<string, any>) => {
      value.mappings = [{ version: '1', targetArgument: 'limit', source: 'CONSTANT', value: 10 }];
    }],
    ['object constant', (value: Record<string, any>) => {
      value.mappings = [{ version: '1', targetArgument: 'value', source: 'BOUND_CONSTANT', value: { nested: true } }];
    }],
    ['null constant', (value: Record<string, any>) => {
      value.mappings = [{ version: '1', targetArgument: 'value', source: 'BOUND_CONSTANT', value: null }];
    }],
    ['non-finite constant', (value: Record<string, any>) => {
      value.mappings = [{ version: '1', targetArgument: 'value', source: 'BOUND_CONSTANT', value: Number.POSITIVE_INFINITY }];
    }]
  ])('rejects invalid %s', (_name, mutate) => {
    const pack = validPack();
    mutate(pack.bindings[0]);
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });
});

describe('capability-pack duplicate rejection', () => {
  it('allows repeated normalized enum aliases for the same canonical value', () => {
    const pack = validPack();
    pack.capabilities[0].parameters[0].values[0].aliases = ['This Month', 'this\u3000month'];
    expect(() => parseCustomerCapabilityPackV1(pack)).not.toThrow();
  });

  it.each([
    ['HostApps', (pack: Record<string, any>) => { pack.hostApps = ['host-a', 'host-a']; }],
    ['capability keys', (pack: Record<string, any>) => { pack.capabilities.push(capability('capability-a')); }],
    ['binding identity/version pairs', (pack: Record<string, any>) => { pack.bindings.push(binding('binding-a')); }],
    ['parameter names', (pack: Record<string, any>) => { pack.capabilities[0].parameters.push(enumParameter('timeRange')); }],
    ['case-insensitive locales', (pack: Record<string, any>) => {
      pack.capabilities[0].semanticProfiles.push(profile('ZH-tw'));
    }],
    ['normalized aliases', (pack: Record<string, any>) => {
      pack.capabilities[0].semanticProfiles[0].aliases = ['New\u3000Orders', 'new orders'];
    }],
    ['normalized semantic terms', (pack: Record<string, any>) => {
      const semantic = pack.capabilities[0].semanticProfiles[0];
      semantic.resourceTerms = ['Ｏｒｄｅｒ'];
      semantic.metricTerms = ['order'];
    }],
    ['conflicting enum aliases', (pack: Record<string, any>) => {
      pack.capabilities[0].parameters[0].values = [
        { value: 'this_month', aliases: ['This Month'] },
        { value: 'today', aliases: ['this\u3000month'] }
      ];
    }],
    ['mapping sources', (pack: Record<string, any>) => {
      pack.bindings[0].mappings = [
        { version: '1', targetArgument: 'a', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange' },
        { version: '1', targetArgument: 'b', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange' }
      ];
    }],
    ['constraint sources', (pack: Record<string, any>) => {
      pack.bindings[0].semanticConstraints = [
        { version: '1', parameterName: 'timeRange', operator: 'ENUM_VALUE_IN', allowedValues: ['this_month'] },
        { version: '1', parameterName: 'timeRange', operator: 'ENUM_VALUE_IN', allowedValues: ['today'] }
      ];
    }],
    ['target assignments', (pack: Record<string, any>) => {
      pack.bindings[0].mappings = [
        { version: '1', targetArgument: 'value', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange' },
        { version: '1', targetArgument: 'value', source: 'BOUND_CONSTANT', value: true }
      ];
    }]
  ])('rejects duplicate %s deterministically when declarations are reordered', (_name, mutate) => {
    const forward = validPack();
    mutate(forward);
    const reversed = JSON.parse(JSON.stringify(forward));
    reverseNestedLists(reversed);

    for (const candidate of [forward, reversed]) {
      try {
        parseCustomerCapabilityPackV1(candidate);
        throw new Error('EXPECTED_REJECTION');
      } catch (error) {
        expect(error).toEqual(new Error('CAPABILITY_PACK_INVALID'));
      }
    }
  });

  it('preserves declaration order for successful packs', () => {
    const pack = validPack();
    pack.hostApps = ['host-z', 'host-a'];
    pack.capabilities = [capability('capability-z'), capability('capability-a')];
    pack.bindings = [binding('binding-z'), binding('binding-a')];

    const parsed = parseCustomerCapabilityPackV1(pack);
    expect(parsed.hostApps).toEqual(['host-z', 'host-a']);
    expect(parsed.capabilities.map((entry) => entry.capabilityKey)).toEqual(['capability-z', 'capability-a']);
    expect(parsed.bindings.map((entry) => entry.bindingId)).toEqual(['binding-z', 'binding-a']);
  });
});

function validPack(): Record<string, any> {
  return {
    version: '1', packId: 'pack-a', packVersion: '1.0.0', customerId: 'customer-a',
    integrationId: 'integration-a', hostApps: ['host-a'], active: true,
    capabilities: [capability('capability-a')],
    bindings: [binding('binding-a')]
  };
}

function capability(capabilityKey: string): Record<string, any> {
  return {
    version: '1', capabilityKey, active: true, kind: 'READ_ONLY_TOOL', safeLabel: capabilityKey,
    semanticProfiles: [profile('zh-TW')], parameters: [enumParameter('timeRange')]
  };
}

function profile(locale: string): Record<string, any> {
  return {
    version: '1', locale, aliases: [`alias-${locale}`], examples: [`example-${locale}`],
    resourceTerms: [`resource-${locale}`], intentTerms: [`intent-${locale}`],
    metricTerms: [`metric-${locale}`], requiredSignalGroups: ['resource', 'metric']
  };
}

function enumParameter(parameterName: string): Record<string, any> {
  return {
    version: '1', parameterName, type: 'enum', required: true, semanticTerms: [`term-${parameterName}`],
    values: [{ value: 'this_month', aliases: [`alias-${parameterName}`] }]
  };
}

function binding(bindingId: string): Record<string, any> {
  return {
    version: '1', bindingId, bindingVersion: '1.0.0', active: true, capabilityKey: 'capability-a',
    semanticConstraints: [], target: { kind: 'TOOL', toolKey: 'tool-a', toolVersion: '1.0.0' }, mappings: []
  };
}

function sequence<T>(count: number, factory: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => factory(index));
}

function setVersionField(
  pack: Record<string, any>,
  field: 'packVersion' | 'bindingVersion' | 'toolVersion',
  version: string
): void {
  if (field === 'packVersion') pack.packVersion = version;
  if (field === 'bindingVersion') pack.bindings[0].bindingVersion = version;
  if (field === 'toolVersion') pack.bindings[0].target.toolVersion = version;
}

function reverseNestedLists(pack: Record<string, any>): void {
  pack.hostApps.reverse();
  pack.capabilities.reverse();
  pack.bindings.reverse();
  for (const capabilityValue of pack.capabilities) {
    capabilityValue.semanticProfiles.reverse();
    capabilityValue.parameters.reverse();
    for (const semantic of capabilityValue.semanticProfiles) {
      semantic.aliases.reverse();
      semantic.resourceTerms.reverse();
      semantic.intentTerms.reverse();
      semantic.metricTerms.reverse();
    }
    for (const parameter of capabilityValue.parameters) {
      if (parameter.type === 'enum') {
        parameter.values.reverse();
        for (const value of parameter.values) value.aliases.reverse();
      }
    }
  }
  for (const bindingValue of pack.bindings) {
    bindingValue.semanticConstraints.reverse();
    bindingValue.mappings.reverse();
  }
}
