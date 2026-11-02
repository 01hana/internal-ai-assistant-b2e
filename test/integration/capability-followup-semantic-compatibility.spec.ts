import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const metricsPack = 'test/fixtures/capability-packs/customer-a-followup-metrics.v1.json';
const packB = 'test/fixtures/capability-packs/customer-b-inventory.v1.json';
const hostA = Object.freeze({ requestId: 'req-followup-metric', customerId: 'customer-a',
  integrationId: 'integration-erp', hostApp: 'erp', organizationId: 'org-shared',
  actorId: 'actor-shared', roles: Object.freeze([]), permissionScopes: Object.freeze(['inventory:read']) });

interface BaselineScenario {
  name: string;
  text: string;
  currentMetric?: string;
  metric?: string;
  kind: string;
  tool?: string;
  entityRef?: string;
  expectedTool?: string;
  expectedCapability?: string;
}

describe('Capability follow-up semantic compatibility baseline', () => {
  it('requires a unique current scoped semantic and exact binding for deny-only applicability', async () => {
    const harness = await createFeature011DirectHarness([metricsPack, packB]);
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic,
      harness.parameters, harness.binding, harness.audit);
    const probe = (text: string, customerId = 'customer-a') => resolver.resolvePreCandidateScopeApplicability({
      scope: { customerId, integrationId: 'integration-erp', hostApp: 'erp' },
      text, sourceMessageId: 'current-message'
    });
    expect(probe('查詢庫存現量 料號 SKU-DEMO-RED')).toMatchObject({
      scope: { customerId: 'customer-a' }, sourceMessageId: 'current-message',
      capabilityKey: 'inventory.stock', toolKey: 'mock.inventory.stock.lookup',
      evidenceSource: 'CURRENT_SCOPED_SEMANTIC'
    });
    expect(probe('那數量呢？')).toBeUndefined();
    expect(probe('查詢庫存現量與可用量 料號 SKU-DEMO-RED')).toBeUndefined();
    expect(probe('查詢庫存現量 料號 SKU-DEMO-RED', 'customer-none')).toBeUndefined();
  });

  it.each([
    ['查詢庫存可用量 料號 SKU-DEMO-RED', 'inventory.availability', 'mock.inventory.availability.lookup'],
    ['查詢庫存可供量 料號 SKU-DEMO-RED', 'inventory.availability', 'mock.inventory.availability.lookup'],
    ['查詢庫存現量 料號 SKU-DEMO-RED', 'inventory.stock', 'mock.inventory.stock.lookup']
  ])('resolves complete current question %s by the scoped Pack', async (text, capabilityKey, toolKey) => {
    const harness = await createFeature011DirectHarness([metricsPack]);
    const pipeline = createPipeline(harness);
    const output = await pipeline.understand({ requestId: hostA.requestId, sessionId: 'session-metric',
      messageId: 'complete-question', text, hostIntegrationContext: hostA });
    expect(output.capabilityResolution).toMatchObject({ outcome: 'RESOLVED', capability: { capabilityKey } });
    expect(output.candidateTools).toEqual([expect.objectContaining({ key: toolKey })]);
  });

  // The current-turn target must be verified before any prior Capability can be reused.
  it.each<BaselineScenario>([
    { name: 'same metric', text: '那可用量呢？', currentMetric: 'availability', metric: 'availability', kind: 'INHERIT', tool: 'mock.inventory.availability.lookup' },
    { name: 'pack-declared alternative term', text: '那可供量呢？', metric: 'availability', kind: 'INHERIT', tool: 'mock.inventory.availability.lookup' },
    { name: 'different supported metric', text: '那現量呢？', metric: 'availability', kind: 'INHERIT', expectedTool: 'mock.inventory.stock.lookup', expectedCapability: 'inventory.stock' },
    { name: 'unsupported metric', text: '那周轉率呢？', metric: 'availability', kind: 'INHERIT' },
    { name: 'ambiguous metric', text: '那數量呢？', metric: 'availability', kind: 'INHERIT' },
    { name: 'entity replacement', text: '那料號 SKU-DEMO-BLUE 呢？', metric: 'availability', kind: 'REPLACE', tool: 'mock.inventory.availability.lookup', entityRef: 'SKU-DEMO-BLUE' },
    { name: 'omitted metric', text: '那庫存呢？', metric: 'availability', kind: 'INHERIT', tool: 'mock.inventory.availability.lookup' },
    { name: 'vague deixis', text: '那個呢？', kind: 'CLARIFY' }
  ])('records %s', async (scenario) => {
    const harness = await createFeature011DirectHarness([metricsPack]);
    const pipeline = createPipeline(harness);
    const seed = await pipeline.understand({ requestId: hostA.requestId, sessionId: 'session-metric',
      messageId: 'seed-metric', text: '查詢庫存可用量 料號 SKU-DEMO-RED', hostIntegrationContext: hostA });
    expect(seed.capabilityResolution).toMatchObject({ outcome: 'RESOLVED', capability: { capabilityKey: 'inventory.availability' } });
    const output = await pipeline.understand({ requestId: hostA.requestId, sessionId: 'session-metric',
      messageId: `followup-${scenario.name}`, text: scenario.text, hostIntegrationContext: hostA,
      priorConversationContext: { semanticFrames: [seed.currentSemanticFrame],
        capabilityFrames: [seed.currentCapabilityFrame] } as never });
    expect(output.currentSemanticFrame?.metricOrAspect?.value).toBe(scenario.currentMetric);
    expect(output.followUpResolution?.resolvedFrame?.metricOrAspect?.value).toBe(scenario.metric);
    expect(output.followUpResolution?.kind).toBe(scenario.kind);
    const expectedTool = scenario.expectedTool ?? scenario.tool;
    expect(output.candidateTools.map((candidate) => candidate.key)).toEqual(expectedTool ? [expectedTool] : []);
    if (expectedTool) {
      if (scenario.tool) expect(output.capabilityFollowUpResolution?.kind).toBe(scenario.kind);
      expect(output.capabilityResolution).toMatchObject({ outcome: 'RESOLVED',
        capability: { capabilityKey: scenario.expectedCapability ?? 'inventory.availability' },
        parameters: { entityRef: scenario.entityRef ?? 'SKU-DEMO-RED' } });
    } else {
      expect(output.clarificationNeeds.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['other Customer', { ...hostA, customerId: 'customer-b' }, undefined, undefined],
    ['wrong Pack version', hostA, '0.9.0', undefined],
    ['inactive capability', hostA, undefined, 'inventory.retired'],
    ['no Pack', { ...hostA, customerId: 'customer-none' }, undefined, undefined]
  ])('records %s isolation', async (name, host, packVersion, capabilityKey) => {
    const harness = await createFeature011DirectHarness([metricsPack, packB]);
    const pipeline = createPipeline(harness);
    const seed = await pipeline.understand({ requestId: hostA.requestId, sessionId: 'session-metric',
      messageId: 'seed-metric', text: '查詢庫存可用量 料號 SKU-DEMO-RED', hostIntegrationContext: hostA });
    expect(seed.capabilityResolution).toMatchObject({ outcome: 'RESOLVED' });
    const prior = { ...seed.currentCapabilityFrame!,
      ...(packVersion ? { packVersion } : {}), ...(capabilityKey ? { capabilityKey } : {}) };
    const output = await pipeline.understand({ requestId: hostA.requestId, sessionId: 'session-metric',
      messageId: `followup-${name}`, text: '那現量呢？', hostIntegrationContext: host,
      priorConversationContext: { semanticFrames: [seed.currentSemanticFrame], capabilityFrames: [prior] } as never });
    expect(output.followUpResolution?.kind).toBe('INHERIT');
    expect(output.capabilityFollowUpResolution).toBeUndefined();
    expect(output.capabilityResolution).toMatchObject({ outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED' });
    expect(output.candidateTools).toEqual([]);
  });

  // An unsupported explicit time must not silently reuse this_month.
  it.each([
    ['上個月呢？', 'last_month', 'REPLACE', 'CAPABILITY_UNAVAILABLE', 'last_month', undefined],
    ['那上週呢？', 'last_week', 'CLARIFY', 'NEEDS_CLARIFICATION', undefined, undefined]
  ])('records non-metric time follow-up %s', async (text, frameTime, kind, outcome, parameterTime, toolKey) => {
    const harness = await createFeature011DirectHarness(['test/fixtures/capability-packs/customer-a-monthly-followup.v1.json']);
    const pipeline = createPipeline(harness);
    const seed = await pipeline.understand({ requestId: hostA.requestId, sessionId: 'session-time',
      messageId: 'seed-time', text: '請查這個月新增工單數', hostIntegrationContext: hostA });
    expect(seed.capabilityResolution).toMatchObject({ outcome: 'RESOLVED' });
    const output = await pipeline.understand({ requestId: hostA.requestId, sessionId: 'session-time',
      messageId: 'followup-time', text, hostIntegrationContext: hostA,
      priorConversationContext: { semanticFrames: [seed.currentSemanticFrame],
        capabilityFrames: [seed.currentCapabilityFrame] } as never });
    expect(output.currentSemanticFrame?.timeRange?.value).toBe(frameTime);
    expect(output.capabilityFollowUpResolution?.kind ?? 'CLARIFY').toBe(kind);
    expect(output.capabilityResolution?.outcome ?? 'NEEDS_CLARIFICATION').toBe(outcome);
    expect(output.capabilityResolution && 'parameters' in output.capabilityResolution
      ? output.capabilityResolution.parameters.timeRange : undefined).toBe(parameterTime);
    expect(output.candidateTools.map((candidate) => candidate.key)).toEqual(toolKey ? [toolKey] : []);
  });
});

function createPipeline(harness: Awaited<ReturnType<typeof createFeature011DirectHarness>>) {
  return new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
    new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit),
    undefined, undefined, harness.registry, harness.parameters);
}
