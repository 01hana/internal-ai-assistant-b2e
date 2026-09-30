import { CapabilityBindingResolverService } from '../../src/capabilities/capability-binding-resolver.service';
import type { CapabilityBindingV1, CapabilityDefinitionV1, ScopedCapabilityCatalogV1 } from '../../src/capabilities/capability-pack.types';
import type { RegisteredToolDefinition } from '../../src/tools/tool-registry.types';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import { ToolRegistryService } from '../../src/tools/tool-registry.service';

const parameter = { version: '1' as const, parameterName: 'timeRange', type: 'enum' as const, required: true, semanticTerms: ['time'], values: [{ value: 'this_month', aliases: ['month'] }, { value: 'today', aliases: ['today'] }] };
const capability: CapabilityDefinitionV1 = {
  version: '1', capabilityKey: 'cap.count', active: true, kind: 'READ_ONLY_TOOL', safeLabel: 'Count',
  semanticProfiles: [{ version: '1', locale: 'zh-TW', aliases: ['count'], examples: ['count current'], resourceTerms: ['resource'], intentTerms: ['count'], metricTerms: ['new'], requiredSignalGroups: ['resource', 'intent'] }],
  parameters: [parameter]
};
const binding: CapabilityBindingV1 = {
  version: '1', bindingId: 'monthly', bindingVersion: '1.0.0', active: true, capabilityKey: 'cap.count',
  semanticConstraints: [{ version: '1', parameterName: 'timeRange', operator: 'ENUM_VALUE_IN', allowedValues: ['this_month'] }],
  target: { kind: 'TOOL', toolKey: 'tool.count', toolVersion: '1.0.0' }, mappings: []
};
const tool: RegisteredToolDefinition = {
  id: 'tool-v1', key: 'tool.count', name: 'tool.count', version: '1.0.0', description: '',
  operation: ToolOperation.read, riskLevel: RiskLevel.low, active: true, connectorKey: 'mock', timeoutMs: 1000,
  requiredPermissionScopes: [], inputSchema: { type: 'object', properties: {}, required: [] }, outputSchema: { required: [] },
  hasSideEffect: false, requiresConfirmation: false, requiresApproval: false
};

function catalog(overrides: Partial<ScopedCapabilityCatalogV1> = {}): ScopedCapabilityCatalogV1 {
  return { version: '1', packId: 'pack', packVersion: '1.0.0', customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'app', capabilities: [capability], bindings: [binding], ...overrides };
}
function harness(toolOverride: Partial<RegisteredToolDefinition> = {}) {
  const selected = { ...tool, ...toolOverride };
  const validator = new ToolRegistryService({} as never, {} as never);
  const tools = {
    resolveExactToolForCustomer: jest.fn(async (key: string, version: string, customerId: string) =>
      key === selected.key && version === selected.version && customerId === 'customer-a'
        ? { resolved: { tool: selected, requiredRoles: [], requiredPermissionScopes: [] } }
        : { deniedReason: 'tool_not_registered' }
    ),
    validateNamedOperation: jest.fn((resolvedTool: RegisteredToolDefinition, candidate: { arguments: Record<string, unknown> }) =>
      validator.validateNamedOperation(resolvedTool, candidate)
    )
  };
  return { resolver: new CapabilityBindingResolverService(tools as never), tools };
}
function withBinding(change: Partial<CapabilityBindingV1>): ScopedCapabilityCatalogV1 {
  return catalog({ bindings: [{ ...binding, ...change }] });
}

describe('CapabilityBindingResolverService static declarations', () => {
  it.each([
    ['unknown mapping source', { semanticConstraints: [], mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'unknown', targetArgument: 'count' }] }],
    ['unknown constraint source', { semanticConstraints: [{ version: '1', parameterName: 'unknown', operator: 'ENUM_VALUE_IN', allowedValues: ['this_month'] }] }],
    ['unknown enum value', { semanticConstraints: [{ version: '1', parameterName: 'timeRange', operator: 'ENUM_VALUE_IN', allowedValues: ['yesterday'] }] }],
    ['required unconsumed', { semanticConstraints: [], mappings: [] }],
    ['duplicate mapping source', { semanticConstraints: [], mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'count' }, { version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'extra' }] }],
    ['duplicate constraint source', { semanticConstraints: [binding.semanticConstraints[0], binding.semanticConstraints[0]] }],
    ['dual mapping and constraint', { mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'count' }] }],
    ['duplicate target', { semanticConstraints: [], mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'count' }, { version: '1', source: 'BOUND_CONSTANT', value: 1, targetArgument: 'count' }] }]
  ])('rejects %s', async (_label, change) => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: [], properties: { count: { type: 'string' }, extra: { type: 'string' } } } });
    await expect(resolver.validateCatalog(withBinding(change as Partial<CapabilityBindingV1>))).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('allows an optional unconsumed parameter only when not supplied', async () => {
    const optional = { ...parameter, parameterName: 'optional', required: false };
    const { resolver } = harness();
    const scoped = catalog({ capabilities: [{ ...capability, parameters: [parameter, optional] }] });
    await expect(resolver.validateCatalog(scoped)).resolves.toBeUndefined();
    await expect(resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month', optional: 'today' })).resolves.toEqual(expect.objectContaining({ outcome: 'CAPABILITY_UNAVAILABLE' }));
  });

  it('does not treat a Tool constant as an implicit declaration consuming a required parameter', async () => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: ['count'], properties: { count: { type: 'string' } } } });
    await expect(resolver.validateCatalog(withBinding({
      semanticConstraints: [], mappings: [{ version: '1', source: 'BOUND_CONSTANT', targetArgument: 'count', value: 'this_month' }]
    }))).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('rejects duplicate Tool targets even when the required parameter is independently consumed', async () => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: [], properties: { count: { type: 'string' } } } });
    await expect(resolver.validateCatalog(withBinding({ mappings: [
      { version: '1', source: 'BOUND_CONSTANT', targetArgument: 'count', value: 'first' },
      { version: '1', source: 'BOUND_CONSTANT', targetArgument: 'count', value: 'second' }
    ] }))).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });
});

describe('CapabilityBindingResolverService Tool contract', () => {
  it.each([
    ['unknown target', 'missing', 'value'], ['non-top-level target', 'nested.value', 'value'],
    ['constant type mismatch', 'count', 2], ['constant enum mismatch', 'count', 'other']
  ])('rejects %s', async (_label, targetArgument, value) => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: [], properties: { count: { type: 'string', enum: ['allowed'] } } } });
    await expect(resolver.validateCatalog(withBinding({ mappings: [{ version: '1', source: 'BOUND_CONSTANT', targetArgument, value }] }))).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('rejects unsatisfied required Tool input', async () => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: ['count'], properties: { count: { type: 'string' } } } });
    await expect(resolver.validateCatalog(catalog())).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('rejects a bounded canonical string that can exceed the declared Tool field limit', async () => {
    const itemRef = { version: '1' as const, parameterName: 'itemRef', type: 'bounded_string' as const, required: true, semanticTerms: ['item'], maxLength: 32, tokenSyntax: 'SAFE_IDENTIFIER' as const, prefixes: [] };
    const scoped = catalog({
      capabilities: [{ ...capability, parameters: [itemRef] }],
      bindings: [{ ...binding, semanticConstraints: [], mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'itemRef', targetArgument: 'sku' }] }]
    });
    const { resolver } = harness({ inputSchema: { type: 'object', required: ['sku'], properties: { sku: { type: 'string', maxLength: 16 } } } });
    await expect(resolver.validateCatalog(scoped)).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('accepts a bounded scalar constant and rejects an over-bound one', async () => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: ['count'], properties: { count: { type: 'string' } } } });
    await expect(resolver.validateCatalog(withBinding({ mappings: [
      { version: '1', source: 'BOUND_CONSTANT', targetArgument: 'count', value: 'safe' }
    ] }))).resolves.toBeUndefined();
    await expect(resolver.validateCatalog(withBinding({ mappings: [
      { version: '1', source: 'BOUND_CONSTANT', targetArgument: 'count', value: 'x'.repeat(257) }
    ] }))).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('rejects mapped canonical values incompatible with the Tool input type or enum', async () => {
    const scoped = withBinding({ semanticConstraints: [], mappings: [
      { version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'count' }
    ] });
    for (const field of [{ type: 'number' }, { type: 'string', enum: ['this_month'] }]) {
      const { resolver } = harness({ inputSchema: { type: 'object', required: ['count'], properties: { count: field } } });
      await expect(resolver.validateCatalog(scoped)).rejects.toThrow('CAPABILITY_BINDING_INVALID');
    }
  });

  it('rejects denied exact Tool or policy', async () => {
    const { resolver, tools } = harness();
    tools.resolveExactToolForCustomer.mockResolvedValueOnce({ deniedReason: 'customer_policy_denied' } as never);
    await expect(resolver.validateCatalog(catalog())).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it.each([
    ['inactive', { active: false }],
    ['write', { operation: ToolOperation.update }],
    ['side-effecting', { hasSideEffect: true }],
    ['wrong exact version', { version: '2.0.0' }]
  ])('rejects %s target despite a successful lookup response', async (_label, override) => {
    const { resolver, tools } = harness();
    tools.resolveExactToolForCustomer.mockResolvedValueOnce({ resolved: { tool: { ...tool, ...override }, requiredRoles: [], requiredPermissionScopes: [] } } as never);
    await expect(resolver.validateCatalog(catalog())).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });
});

describe('CapabilityBindingResolverService runtime accounting', () => {
  it('resolves an all-constrained monthly binding with empty Tool arguments', async () => {
    const { resolver, tools } = harness();
    const scoped = catalog();
    await resolver.validateCatalog(scoped);
    await expect(resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month' })).resolves.toEqual(expect.objectContaining({ outcome: 'RESOLVED', toolCandidate: expect.objectContaining({ key: 'tool.count', version: '1.0.0', arguments: {} }) }));
    expect(tools.validateNamedOperation).toHaveBeenCalledWith(expect.objectContaining({ version: '1.0.0' }), expect.objectContaining({ arguments: {} }));
  });

  it('returns unavailable when the valid canonical value has no compatible binding', async () => {
    const { resolver } = harness();
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'today' })).resolves.toEqual(expect.objectContaining({ outcome: 'CAPABILITY_UNAVAILABLE', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' }));
  });

  it('maps the canonical parameter and a bounded constant to declared Tool fields', async () => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: ['period', 'source'], properties: { period: { type: 'string' }, source: { type: 'string' } } } });
    const scoped = withBinding({ semanticConstraints: [], mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'period' }, { version: '1', source: 'BOUND_CONSTANT', value: 'catalog', targetArgument: 'source' }] });
    await resolver.validateCatalog(scoped);
    await expect(resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month' })).resolves.toEqual(expect.objectContaining({ outcome: 'RESOLVED', toolCandidate: expect.objectContaining({ arguments: { period: 'this_month', source: 'catalog' } }) }));
  });

  it('fails closed on multiple compatible bindings', async () => {
    const { resolver } = harness();
    const second = { ...binding, bindingId: 'duplicate', target: { ...binding.target } };
    await expect(resolver.resolve(catalog({ bindings: [binding, second] }), 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('rejects an undeclared or non-canonical supplied parameter rather than dropping it', async () => {
    const { resolver } = harness();
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'this_month', extra: 'x' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('does not release a candidate when an optional supplied parameter is unaccounted for', async () => {
    const { resolver, tools } = harness();
    const scoped = catalog({ capabilities: [{ ...capability, parameters: [parameter, { ...parameter, parameterName: 'optional', required: false }] }] });
    const result = await resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month', optional: 'today' });
    expect(result.outcome).toBe('CAPABILITY_UNAVAILABLE');
    expect(tools.validateNamedOperation).not.toHaveBeenCalled();
  });

  it('accounts for an optional parameter only when supplied and mapped', async () => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: [], properties: { optionalValue: { type: 'string' } } } });
    const scoped = catalog({
      capabilities: [{ ...capability, parameters: [parameter, { ...parameter, parameterName: 'optional', required: false }] }],
      bindings: [{ ...binding, mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'optional', targetArgument: 'optionalValue' }] }]
    });
    await resolver.validateCatalog(scoped);
    await expect(resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month' })).resolves.toEqual(expect.objectContaining({ outcome: 'RESOLVED', toolCandidate: expect.objectContaining({ arguments: {} }) }));
    await expect(resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month', optional: 'today' })).resolves.toEqual(expect.objectContaining({ outcome: 'RESOLVED', toolCandidate: expect.objectContaining({ arguments: { optionalValue: 'today' } }) }));
  });

  it('rejects multiply consumed runtime parameters from typed malformed bindings', async () => {
    const { resolver } = harness({ inputSchema: { type: 'object', required: [], properties: { period: { type: 'string' } } } });
    const scoped = withBinding({ mappings: [{ version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'period' }] });
    await expect(resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('returns unavailable with zero active compatible bindings', async () => {
    const { resolver } = harness();
    await expect(resolver.resolve(catalog({ bindings: [] }), 'cap.count', { timeRange: 'this_month' })).resolves.toEqual(expect.objectContaining({ outcome: 'CAPABILITY_UNAVAILABLE' }));
  });

  it('does not release a candidate when complete Tool validation rejects mapped arguments', async () => {
    const { resolver, tools } = harness();
    tools.validateNamedOperation.mockReturnValueOnce({ valid: false } as never);
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('uses the real ToolRegistry schema validator for the complete mapped argument object', async () => {
    const { resolver, tools } = harness({ inputSchema: {
      type: 'object', required: ['period'], properties: { period: { type: 'string', pattern: '^M-' } }
    } });
    const scoped = withBinding({ semanticConstraints: [], mappings: [
      { version: '1', source: 'CANONICAL_PARAMETER', parameterName: 'timeRange', targetArgument: 'period' }
    ] });
    await resolver.validateCatalog(scoped);
    await expect(resolver.resolve(scoped, 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
    expect(tools.validateNamedOperation).toHaveBeenCalledWith(expect.objectContaining({ version: '1.0.0' }), {
      arguments: { period: 'this_month' }
    });
  });

  it.each([
    ['missing Tool', 'tool_not_registered'],
    ['inactive Tool', 'tool_inactive'],
    ['side-effecting Tool', 'operation_denied'],
    ['newly denied Customer policy', 'customer_policy_denied']
  ])('does not release a candidate after %s runtime drift', async (_kind, denial) => {
    const { resolver, tools } = harness();
    await resolver.validateCatalog(catalog());
    tools.resolveExactToolForCustomer.mockResolvedValueOnce({ deniedReason: denial } as never);
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
  });

  it('rejects a changed Tool version after validation, without latest-version fallback', async () => {
    const { resolver, tools } = harness();
    await resolver.validateCatalog(catalog());
    tools.resolveExactToolForCustomer.mockResolvedValueOnce({ resolved: { tool: { ...tool, version: '2.0.0' }, requiredRoles: [], requiredPermissionScopes: [] } } as never);
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
    expect(tools.validateNamedOperation).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', { active: false }],
    ['non-read-only', { operation: ToolOperation.update }],
    ['side-effecting', { hasSideEffect: true }]
  ])('rejects a %s runtime Tool even if the lookup response is unexpectedly resolved', async (_label, override) => {
    const { resolver, tools } = harness();
    await resolver.validateCatalog(catalog());
    tools.resolveExactToolForCustomer.mockResolvedValueOnce({ resolved: { tool: { ...tool, ...override }, requiredRoles: [], requiredPermissionScopes: [] } } as never);
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
    expect(tools.validateNamedOperation).not.toHaveBeenCalled();
  });

  it('redacts a runtime policy lookup exception and releases no candidate', async () => {
    const { resolver, tools } = harness();
    await resolver.validateCatalog(catalog());
    tools.resolveExactToolForCustomer.mockRejectedValueOnce(new Error('secret policy store detail'));
    await expect(resolver.resolve(catalog(), 'cap.count', { timeRange: 'this_month' })).rejects.toThrow('CAPABILITY_BINDING_INVALID');
    expect(tools.validateNamedOperation).not.toHaveBeenCalled();
  });
});
