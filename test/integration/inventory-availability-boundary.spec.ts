import { AssistantPlanningService } from '../../src/assistant/planning/assistant-planning.service';
import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { createCustomerScopeFromHostIntegrationContext } from '../../src/host-integration/host-integration-request.factory';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { normalizeQueryText } from '../../src/query-understanding/query-sentence-splitter';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import type { QueryUnderstandingOutput } from '../../src/query-understanding/query-understanding.types';
import { GroundedRetrievalRouterService } from '../../src/retrieval/grounded-retrieval-router.service';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const packA = 'test/fixtures/capability-packs/customer-a-reference.v1.json';
const packB = 'test/fixtures/capability-packs/customer-b-inventory.v1.json';
const baseHost = Object.freeze({ requestId: 'req-inventory-boundary', integrationId: 'integration-erp',
  hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared', roles: Object.freeze([]),
  permissionScopes: Object.freeze(['inventory:read']) });

interface Scenario {
  name: string;
  packs: string[];
  customerId: string;
  text: string;
  seed?: string;
  metric?: string;
  effectiveMetric?: string;
  capability?: string;
  capabilityKey?: string;
  clarification: string[];
  route: string;
  needs: string[];
  tool: string[];
}

// Before removal, every inventory frame without an explicit metric received availability.
// These cases preserve the observed Tool/routing outcomes while asserting the new frame boundary.
const scenarios: Scenario[] = [
  { name: 'no-pack-bare', packs: [], customerId: 'customer-none', text: '查詢庫存',
    capability: 'NEEDS_CLARIFICATION', clarification: ['CAPABILITY_NOT_RECOGNIZED'], route: 'CLARIFY', needs: ['UNSUPPORTED'], tool: [] },
  { name: 'no-pack-explicit', packs: [], customerId: 'customer-none', text: '請查 SKU-DEMO-RED 庫存可用量',
    metric: 'availability', capability: 'NEEDS_CLARIFICATION', clarification: ['CAPABILITY_NOT_RECOGNIZED'],
    route: 'CLARIFY', needs: ['UNSUPPORTED'], tool: [] },
  { name: 'a-explicit', packs: [packA, packB], customerId: 'customer-a', text: '請查 SKU-DEMO-RED 庫存可用量',
    metric: 'availability', capability: 'RESOLVED', capabilityKey: 'inventory.availability',
    clarification: [], route: 'TOOL', needs: ['TOOL'], tool: ['mock.inventory.availability.lookup'] },
  { name: 'b-stock', packs: [packA, packB], customerId: 'customer-b', text: '查詢庫存現量 料號 ABC-1',
    capability: 'RESOLVED', capabilityKey: 'inventory.stock',
    clarification: [], route: 'TOOL', needs: ['TOOL'], tool: ['inventory.stock-on-hand'] },
  { name: 'b-availability', packs: [packA, packB], customerId: 'customer-b', text: '查詢庫存可用量 料號 ABC-1',
    metric: 'availability', capability: 'NEEDS_CLARIFICATION', clarification: ['CAPABILITY_NOT_RECOGNIZED'],
    route: 'CLARIFY', needs: ['UNSUPPORTED'], tool: [] },
  { name: 'a-bare', packs: [packA, packB], customerId: 'customer-a', text: '查詢庫存',
    capability: 'NEEDS_CLARIFICATION', clarification: ['CAPABILITY_NOT_RECOGNIZED'], route: 'CLARIFY', needs: ['UNSUPPORTED'], tool: [] },
  { name: 'b-bare', packs: [packA, packB], customerId: 'customer-b', text: '查詢庫存',
    capability: 'NEEDS_CLARIFICATION', clarification: ['CAPABILITY_NOT_RECOGNIZED'], route: 'CLARIFY', needs: ['UNSUPPORTED'], tool: [] },
  { name: 'a-mixed-document', packs: [packA, packB], customerId: 'customer-a', text: '請查 SKU-DEMO-RED 庫存可用量和 SOP',
    metric: 'availability', capability: 'RESOLVED', capabilityKey: 'inventory.availability',
    clarification: [], route: 'HYBRID', needs: ['TOOL', 'DOCUMENT'], tool: ['mock.inventory.availability.lookup'] },
  { name: 'b-unsupported', packs: [packA, packB], customerId: 'customer-b', text: '查詢庫存周轉率 料號 ABC-1',
    capability: 'NEEDS_CLARIFICATION', clarification: ['CAPABILITY_NOT_RECOGNIZED'], route: 'CLARIFY', needs: ['UNSUPPORTED'], tool: [] },
  { name: 'a-follow-up-inventory', packs: [packA, packB], customerId: 'customer-a', text: '那庫存呢？',
    seed: '請查 SKU-DEMO-RED 庫存可用量', effectiveMetric: 'availability',
    capability: 'RESOLVED', capabilityKey: 'inventory.availability',
    clarification: [], route: 'TOOL', needs: ['TOOL'], tool: ['mock.inventory.availability.lookup'] },
  { name: 'a-follow-up-availability', packs: [packA, packB], customerId: 'customer-a', text: '那可用量呢？',
    seed: '請查 SKU-DEMO-RED 庫存可用量', metric: 'availability', effectiveMetric: 'availability',
    capability: 'RESOLVED', capabilityKey: 'inventory.availability',
    clarification: [], route: 'TOOL', needs: ['TOOL'], tool: ['mock.inventory.availability.lookup'] },
  { name: 'b-follow-up-inventory', packs: [packA, packB], customerId: 'customer-b', text: '那庫存呢？',
    seed: '查詢庫存現量 料號 ABC-1', capability: 'RESOLVED', capabilityKey: 'inventory.stock',
    clarification: [], route: 'TOOL', needs: ['TOOL'], tool: ['inventory.stock-on-hand'] },
  // Pack B has no declared follow-up equivalence; its old stock-on-hand reuse is now rejected.
  { name: 'b-follow-up-availability', packs: [packA, packB], customerId: 'customer-b', text: '那可用量呢？',
    seed: '查詢庫存現量 料號 ABC-1', metric: 'availability', effectiveMetric: 'availability',
    clarification: ['FOLLOW_UP_TARGET_UNVERIFIED'], route: 'INSUFFICIENT', needs: ['UNSUPPORTED'], tool: [] }
];

describe('inventory availability semantic boundary characterization', () => {
  it.each(scenarios)('$name', async (scenario) => {
      const harness = await createFeature011DirectHarness(scenario.packs);
      const host = { ...baseHost, customerId: scenario.customerId };
      const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
        new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit),
        undefined, undefined, harness.registry, harness.parameters);
      const seed = scenario.seed ? await pipeline.understand({ requestId: host.requestId,
        sessionId: 'session-inventory', messageId: `seed-${scenario.name}`, text: scenario.seed,
        hostIntegrationContext: host }) : undefined;
      const output = await pipeline.understand({ requestId: host.requestId, sessionId: 'session-inventory',
        messageId: `message-${scenario.name}`, text: scenario.text, hostIntegrationContext: host,
        ...(seed ? { priorConversationContext: { semanticFrames: seed.currentSemanticFrame ? [seed.currentSemanticFrame] : [],
          capabilityFrames: seed.currentCapabilityFrame ? [seed.currentCapabilityFrame] : [] } as never } : {}) });
      const route = await planningRoute(output, host, scenario.text);
      expect(normalizeQueryText(scenario.text)).toBe(scenario.text);
      expect(output.currentSemanticFrame?.metricOrAspect?.value).toBe(scenario.metric);
      expect(output.followUpResolution?.resolvedFrame?.metricOrAspect?.value).toBe(scenario.effectiveMetric);
      expect(output.currentSemanticFrame?.resource?.value).toBe(scenario.text === '那可用量呢？' ? undefined : 'inventory');
      expect(output.currentSemanticFrame?.intent?.value).toBe(scenario.text.startsWith('那') ? undefined : 'read');
      expect(output.followUpResolution?.kind).toBe(scenario.seed ? 'INHERIT' : undefined);
      expect(output.capabilityFollowUpResolution?.kind).toBe(scenario.seed && scenario.capability ? 'INHERIT' : undefined);
      expect(output.clarificationNeeds.map((need) => need.reason)).toEqual(scenario.clarification);
      expect(route.decision).toBe(scenario.clarification.length > 0 ? 'clarify' : 'continue');
      expect(route.groundedRetrievalPlan?.mode).toBe(scenario.route);
      expect(route.groundedRetrievalPlan?.needs.map((need) => need.kind)).toEqual(scenario.needs);
      expect(output.capabilityResolution?.outcome).toBe(scenario.capability);
      expect(output.capabilityResolution && 'capability' in output.capabilityResolution
        ? output.capabilityResolution.capability.capabilityKey : undefined).toBe(scenario.capabilityKey);
      expect(output.currentCapabilityFrame?.scope.customerId).toBe(scenario.capabilityKey ? scenario.customerId : undefined);
      expect(output.candidateTools.map((candidate) => candidate.key)).toEqual(scenario.tool);
  });
});

async function planningRoute(output: QueryUnderstandingOutput, host: typeof baseHost & { customerId: string }, text: string) {
  const service = new AssistantPlanningService(
    { understandAndPersist: jest.fn().mockResolvedValue({ output, persisted: { id: 'query-inventory' } }) } as never,
    { db: { executionPlan: { create: jest.fn(async ({ data }) => ({ ...data, id: 'plan-inventory',
      createdAt: new Date() })) } } } as never,
    { append: jest.fn().mockResolvedValue({ id: 'audit-inventory' }) } as never,
    undefined, undefined, new GroundedRetrievalRouterService()
  );
  return service.createPlan({ customerScope: createCustomerScopeFromHostIntegrationContext(host),
    requestId: host.requestId, sessionId: 'session-inventory', messageId: 'message-inventory', text,
    hostIntegrationContext: host });
}
