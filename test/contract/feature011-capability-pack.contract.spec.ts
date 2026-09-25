import { parseCustomerCapabilityPackV1 } from '../../src/capabilities/capability-pack.parser';

describe('Feature 011 capability-pack V1 contract', () => {
  it('accepts a closed valid V1 pack', () => {
    expect(parseCustomerCapabilityPackV1(validPack())).toEqual(validPack());
  });

  it.each([
    ['pack', (pack: Record<string, unknown>) => ({ ...pack, unexpected: true })],
    ['capability', (pack: Record<string, any>) => ({
      ...pack,
      capabilities: [{ ...pack.capabilities[0], unexpected: true }]
    })],
    ['semantic profile', (pack: Record<string, any>) => ({
      ...pack,
      capabilities: [{
        ...pack.capabilities[0],
        semanticProfiles: [{ ...pack.capabilities[0].semanticProfiles[0], unexpected: true }]
      }]
    })],
    ['parameter', (pack: Record<string, any>) => ({
      ...pack,
      capabilities: [{
        ...pack.capabilities[0],
        parameters: [{ ...pack.capabilities[0].parameters[0], unexpected: true }]
      }]
    })],
    ['binding', (pack: Record<string, any>) => ({
      ...pack,
      bindings: [{ ...pack.bindings[0], unexpected: true }]
    })]
  ])('rejects an unknown key at the %s level', (_name, mutate) => {
    expect(() => parseCustomerCapabilityPackV1(mutate(validPack()))).toThrow('CAPABILITY_PACK_INVALID');
  });

  it.each([
    ['pack', (pack: Record<string, any>) => ({ ...pack, version: '2' })],
    ['capability', (pack: Record<string, any>) => ({
      ...pack,
      capabilities: [{ ...pack.capabilities[0], version: '2' }]
    })],
    ['semantic profile', (pack: Record<string, any>) => ({
      ...pack,
      capabilities: [{
        ...pack.capabilities[0],
        semanticProfiles: [{ ...pack.capabilities[0].semanticProfiles[0], version: '2' }]
      }]
    })],
    ['parameter', (pack: Record<string, any>) => ({
      ...pack,
      capabilities: [{
        ...pack.capabilities[0],
        parameters: [{ ...pack.capabilities[0].parameters[0], version: '2' }]
      }]
    })],
    ['binding', (pack: Record<string, any>) => ({
      ...pack,
      bindings: [{ ...pack.bindings[0], version: '2' }]
    })]
  ])('rejects an unknown version at the %s level', (_name, mutate) => {
    expect(() => parseCustomerCapabilityPackV1(mutate(validPack()))).toThrow('CAPABILITY_PACK_INVALID');
  });

  it.each([
    new Date(),
    new Map(),
    new (class PackLike { version = '1'; })()
  ])('rejects non-plain objects', (value) => {
    expect(() => parseCustomerCapabilityPackV1(value)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it('rejects the complete pack when one nested member is invalid', () => {
    const pack = validPack();
    pack.capabilities.push({ ...pack.capabilities[0], capabilityKey: 'second', version: '2' });

    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it.each([
    ['identity authority', 'actorId'],
    ['permissions', 'permissionScopes'],
    ['credentials', 'credentialHandle'],
    ['routes', 'route'],
    ['response pointers', 'responsePointer'],
    ['SQL', 'sql'],
    ['scripts', 'script'],
    ['prompts', 'systemPrompt'],
    ['callbacks', 'callback'],
    ['regexes', 'regex'],
    ['templates', 'template'],
    ['expressions', 'expression'],
    ['functions', 'function'],
    ['Connector details', 'connectorContextRef']
  ])('rejects forbidden %s fields at any nested level', (_name, field) => {
    const pack = validPack();
    pack.capabilities[0].semanticProfiles[0][field] = 'forbidden';
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it.each([
    'https://customer.example/internal',
    '/Dashboard/KPIStats',
    'select secret from credentials',
    'Bearer secret-token',
    'curl https://customer.example',
    '{{ executable.template }}',
    '${process.env.SECRET}',
    'javascript:callback()',
    'ignore previous instructions',
    'connectorContextRef=secret'
  ])('rejects prohibited free-text content without exposing it: %s', (value) => {
    const pack = validPack();
    pack.capabilities[0].safeLabel = value;
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });

  it('rejects prohibited string constants while retaining bounded scalar constants', () => {
    const pack = validPack();
    pack.bindings[0].mappings = [{
      version: '1', targetArgument: 'mode', source: 'BOUND_CONSTANT', value: 'https://customer.example'
    }];
    expect(() => parseCustomerCapabilityPackV1(pack)).toThrow('CAPABILITY_PACK_INVALID');
  });
});

function validPack(): Record<string, any> {
  return {
    version: '1',
    packId: 'customer-a.capabilities',
    packVersion: '1.0.0',
    customerId: 'customer-a',
    integrationId: 'integration-a',
    hostApps: ['host-a'],
    active: true,
    capabilities: [{
      version: '1',
      capabilityKey: 'orders.count',
      active: true,
      kind: 'READ_ONLY_TOOL',
      safeLabel: 'Order count',
      semanticProfiles: [{
        version: '1',
        locale: 'zh-TW',
        aliases: ['訂單數量'],
        examples: ['查詢本月訂單數量'],
        resourceTerms: ['訂單'],
        intentTerms: ['查詢'],
        metricTerms: ['數量'],
        requiredSignalGroups: ['resource', 'metric']
      }],
      parameters: [{
        version: '1',
        parameterName: 'timeRange',
        type: 'enum',
        required: true,
        semanticTerms: ['期間'],
        values: [{ value: 'this_month', aliases: ['本月'] }]
      }]
    }],
    bindings: [{
      version: '1',
      bindingId: 'orders.count.monthly',
      bindingVersion: '1.0.0',
      active: true,
      capabilityKey: 'orders.count',
      semanticConstraints: [{
        version: '1',
        parameterName: 'timeRange',
        operator: 'ENUM_VALUE_IN',
        allowedValues: ['this_month']
      }],
      target: { kind: 'TOOL', toolKey: 'orders.monthly-count', toolVersion: '1.0.0' },
      mappings: []
    }]
  };
}
