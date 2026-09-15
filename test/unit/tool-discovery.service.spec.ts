import { ToolDiscoveryService, parseToolDiscoveryMetadataV1 } from '../../src/tools/tool-discovery.service';
import { RiskLevel, ToolOperation } from '../../src/generated/prisma/enums';
import type { ToolDiscoveryInput } from '../../src/tools/tool-discovery.service';

describe('ToolDiscoveryService', () => {
  it('parses and deeply freezes the closed discovery metadata contract', () => {
    const parsed = parseToolDiscoveryMetadataV1(schema().inputSchema);
    expect(parsed).toEqual(metadata());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.argumentBindings)).toBe(true);
  });

  it.each([
    ['unknown field', { ...metadata(), endpoint: 'https://attacker.test' }],
    ['authority field', { ...metadata(), customerId: 'customer-b' }],
    ['unsafe concept', { ...metadata(), resourceConcepts: ['https://attacker.test'] }],
    ['unknown group', { ...metadata(), requiredConceptGroups: ['adapter'] }],
    ['unknown binding source', { ...metadata(), argumentBindings: [{ argumentName: 'entityId', source: 'browser', concepts: ['orderId'] }] }],
    ['missing schema target', { ...metadata(), argumentBindings: [{ argumentName: 'missing', source: 'entity_value', concepts: ['orderId'] }] }]
  ])('rejects malformed or authority-expanding metadata: %s', (_label, value) => {
    expect(parseToolDiscoveryMetadataV1({ ...schema().inputSchema, 'x-assistant-discovery-v1': value })).toBeUndefined();
  });

  it.each([
    'customerId', 'Integration_ID', 'HOSTAPP', 'connectorKey', 'connectorInstanceId',
    'adapterKey', 'destination', 'endpoint', 'url', 'URI', 'path', 'method', 'httpMethod',
    'header', 'headers', 'authorization', 'credential', 'password', 'secret', 'token',
    'connectorContextRef', 'sql', 'command', 'callback', 'script'
  ])('rejects authority-like argument binding target %s', (argumentName) => {
    expect(parseToolDiscoveryMetadataV1({
      ...schema().inputSchema,
      properties: { [argumentName]: { type: 'string' } },
      required: [argumentName],
      'x-assistant-discovery-v1': {
        ...metadata(),
        argumentBindings: [{ argumentName, source: 'entity_value', concepts: ['orderId'] }]
      }
    })).toBeUndefined();
  });

  it('returns one bounded candidate only when every required concept group matches', async () => {
    const service = serviceWith([schema()]);
    const result = await service.discover(discoveryInput());
    expect(result).toEqual({
      candidates: [{ key: 'mock.orders.status.lookup', arguments: { entityId: 'SO-10001' }, reason: 'metadata_discovery' }],
      taskType: 'order_status_lookup',
      requiredEvidence: ['identity_context', 'structured_record'],
      matchConfidence: 0.95,
      clarificationNeeds: [],
      discoveredTaskTypes: ['order_status_lookup']
    });
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.candidates[0])).toBe(true);
    expect(Object.isFrozen(result.candidates[0].arguments)).toBe(true);
  });

  it('fails closed for missing concepts, schema-invalid bindings, and malformed metadata', async () => {
    const service = serviceWith([
      schema(),
      schema({ key: 'bad.binding', inputSchema: { ...schema().inputSchema, required: ['other'] } }),
      schema({ key: 'bad.metadata', inputSchema: { ...schema().inputSchema, 'x-assistant-discovery-v1': { ...metadata(), token: 'secret' } } })
    ]);
    const result = await service.discover(discoveryInput({ normalizedTerms: [] }));
    expect(result.candidates).toEqual([]);
    expect(result.clarificationNeeds).toEqual([]);
  });

  it('returns blocking ambiguity and no candidate for near-tied tools on one anchor', async () => {
    const service = serviceWith([
      schema(),
      schema({ key: 'orders.status.alternate', version: '2.0.0' })
    ]);
    const result = await service.discover(discoveryInput());
    expect(result.candidates).toEqual([]);
    expect(result.clarificationNeeds).toEqual([
      expect.objectContaining({ reason: 'tool_ambiguity', blocking: true })
    ]);
  });

  it('ranks required-group matches before optional concept coverage', async () => {
    const lessSpecific = schema({
      key: 'orders.generic.lookup',
      inputSchema: {
        ...schema().inputSchema,
        'x-assistant-discovery-v1': { ...metadata(), requiredConceptGroups: ['resource'] }
      }
    });
    const result = await serviceWith([lessSpecific, schema()]).discover(discoveryInput());
    expect(result.candidates).toEqual([
      { key: 'mock.orders.status.lookup', arguments: { entityId: 'SO-10001' }, reason: 'metadata_discovery' }
    ]);
  });

  it('ignores semantic signals below the accepted confidence threshold', async () => {
    const result = await serviceWith([schema()]).discover(discoveryInput({
      normalizedTerms: [
        { originalTerm: '訂單', normalizedTerm: 'order', category: 'resource', confidence: 0.79, reason: 'weak' },
        { originalTerm: '狀態', normalizedTerm: 'status', category: 'metric', confidence: 0.79, reason: 'weak' }
      ],
      phrases: [],
      entityCandidates: []
    }));
    expect(result).toMatchObject({ candidates: [], matchConfidence: 0 });
  });

  it('binds only declared normalized-term and time-range-label signals', async () => {
    const inputSchema = {
      type: 'object', required: ['metric', 'period'],
      properties: { metric: { type: 'string' }, period: { type: 'string' } },
      'x-assistant-discovery-v1': {
        ...metadata(), timeRangeConcepts: ['this_month'], requiredConceptGroups: ['resource', 'metric', 'timeRange'],
        argumentBindings: [
          { argumentName: 'metric', source: 'normalized_term', concepts: ['status'] },
          { argumentName: 'period', source: 'time_range_label', concepts: ['this_month'] }
        ]
      }
    };
    const result = await serviceWith([schema({ key: 'generic.monthly-status.lookup', inputSchema })]).discover(discoveryInput({
      entityCandidates: [],
      timeRanges: [{ label: 'this_month', start: '2026-09-01', end: '2026-09-30', timezone: 'Asia/Taipei', source: '這個月', confidence: 1 }]
    }));
    expect(result.candidates).toEqual([
      { key: 'generic.monthly-status.lookup', arguments: { metric: 'status', period: 'this_month' }, reason: 'metadata_discovery' }
    ]);
  });

  it('keeps the same query Customer-isolated through the already filtered catalog', async () => {
    const customerA = serviceWith([schema()]);
    const customerB = serviceWith([]);
    await expect(customerA.discover(discoveryInput())).resolves.toMatchObject({ candidates: [{ key: 'mock.orders.status.lookup' }] });
    await expect(customerB.discover(discoveryInput({ customerScope: scope('customer-b') }))).resolves.toMatchObject({ candidates: [] });
  });

  it('discovers the monthly new-work-order count from generic concepts without phrase routing or arguments', async () => {
    const reference = schema({
      id: 'tool-monthly-new-work-orders',
      key: 'work-orders.monthly-new-count',
      name: 'work-orders.monthly-new-count',
      connectorKey: 'business',
      timeoutMs: 5000,
      inputSchema: {
        type: 'object', required: [], properties: {}, additionalProperties: false,
        'x-assistant-discovery-v1': {
          version: '1', locale: 'zh-TW', resourceConcepts: ['workOrder'], intentConcepts: ['read'],
          metricConcepts: ['newCount', 'count'], timeRangeConcepts: ['this_month'],
          requiredConceptGroups: ['resource', 'metric', 'timeRange'], argumentBindings: [],
          taskType: 'work_order_monthly_new_count', requiredEvidence: ['identity_context', 'structured_record']
        }
      }
    });
    const result = await serviceWith([reference]).discover(discoveryInput({
      normalizedTerms: [
        { originalTerm: '工單', normalizedTerm: 'workOrder', category: 'resource', confidence: 0.9, reason: 'domain_lexicon' },
        { originalTerm: '新增', normalizedTerm: 'newCount', category: 'metric', confidence: 0.9, reason: 'domain_lexicon' },
        { originalTerm: '幾張', normalizedTerm: 'count', category: 'metric', confidence: 0.9, reason: 'domain_lexicon' },
        { originalTerm: '這個月', normalizedTerm: 'this_month', category: 'time', confidence: 0.9, reason: 'domain_lexicon' }
      ],
      phrases: [],
      entityCandidates: [],
      timeRanges: [{ label: 'this_month', start: '2026-09-01', end: '2026-09-30', timezone: 'Asia/Taipei', source: '這個月', confidence: 1 }]
    }));
    expect(result).toMatchObject({
      candidates: [{ key: 'work-orders.monthly-new-count', arguments: {}, reason: 'metadata_discovery' }],
      taskType: 'work_order_monthly_new_count',
      matchConfidence: 0.95
    });
  });
});

function serviceWith(tools: ReturnType<typeof schema>[]) {
  return new ToolDiscoveryService({
    listDiscoverableToolsForCustomer: jest.fn().mockResolvedValue(tools),
    validateNamedOperation: jest.fn((tool, candidate) => {
      const required = tool.inputSchema.required as string[];
      return required.every((key) => Object.prototype.hasOwnProperty.call(candidate.arguments, key))
        ? { valid: true, operation: { canonicalToolKey: tool.key, schemaVersion: tool.version, arguments: candidate.arguments }, safeInputSummary: {} }
        : { valid: false, deniedReason: 'schema_invalid', schemaErrorReason: 'invalid_operation_arguments' };
    })
  } as never);
}

function discoveryInput(overrides: Partial<ToolDiscoveryInput> = {}): ToolDiscoveryInput {
  return {
    customerScope: scope('customer-a'),
    normalizedTerms: [
      { originalTerm: '訂單', normalizedTerm: 'order', category: 'resource', confidence: 0.9, reason: 'domain_lexicon' },
      { originalTerm: '狀態', normalizedTerm: 'status', category: 'metric', confidence: 0.9, reason: 'domain_lexicon' }
    ],
    phrases: [{ value: '查詢', normalizedValue: 'read', category: 'intent' }],
    timeRanges: [],
    entityCandidates: [{ type: 'orderId', value: 'SO-10001', confidence: 0.98 }],
    ...overrides
  };
}

function scope(customerId: string) {
  return Object.freeze({ customerId, integrationId: 'integration-erp', organizationId: 'org-1', hostApp: 'erp', actorId: 'actor-1', roles: [], permissionScopes: [] }) as never;
}

function schema(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-order', key: 'mock.orders.status.lookup', name: 'mock.orders.status.lookup', version: '1.0.0',
    description: 'Lookup order status.', operation: ToolOperation.read, riskLevel: RiskLevel.low,
    active: true, connectorKey: 'mock', timeoutMs: 3000, requiredPermissionScopes: [],
    inputSchema: {
      type: 'object', required: ['entityId'], properties: { entityId: { type: 'string' } },
      'x-assistant-discovery-v1': metadata()
    },
    outputSchema: { type: 'object', required: [], properties: {} }, hasSideEffect: false,
    requiresConfirmation: false, requiresApproval: false, ...overrides
  };
}

function metadata() {
  return {
    version: '1', locale: 'zh-TW', resourceConcepts: ['order'], intentConcepts: ['read'],
    metricConcepts: ['status'], timeRangeConcepts: [], requiredConceptGroups: ['resource', 'metric'],
    argumentBindings: [{ argumentName: 'entityId', source: 'entity_value', concepts: ['orderId'] }],
    taskType: 'order_status_lookup', requiredEvidence: ['identity_context', 'structured_record']
  };
}
