import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { RiskLevel } from '../../src/generated/prisma/enums';
import { QueryUnderstandingService } from '../../src/query-understanding/query-understanding.service';
import { QueryUnderstandingRepository } from '../../src/query-understanding/query-understanding.repository';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const capabilityPack = 'test/fixtures/capability-packs/customer-a-reference.v1.json';
const catalogScope = { customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' };

describe('QueryUnderstandingService Phase 1 authority boundary', () => {
  it('derives persistence scope from HostIntegrationContext and exposes no identity auth or transient reference to the pipeline', async () => {
    const understand = jest.fn().mockResolvedValue(output());
    const save = jest.fn().mockResolvedValue({ id: 'qu-001' });
    const append = jest.fn().mockResolvedValue({ id: 'audit-001' });
    const service = new QueryUnderstandingService(
      { understand } as never,
      { save } as unknown as QueryUnderstandingRepository,
      { append } as unknown as AuditWriterService
    );
    const hostIntegrationContext = {
      requestId: 'req-qu-boundary', customerId: 'customer-a', integrationId: 'integration-erp',
      organizationId: 'org-001', hostApp: 'erp', actorId: 'actor-001',
      roles: ['planner'] as const, permissionScopes: ['orders:read'] as const
    };

    await service.understandAndPersist({
      requestId: 'req-qu-boundary', sessionId: 'session-001', messageId: 'message-001', text: 'SO-10001',
      hostIntegrationContext,
      pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001' }
    });

    expect(understand).toHaveBeenCalledWith(expect.objectContaining({ hostIntegrationContext }));
    expect(understand.mock.calls[0][0]).not.toHaveProperty('identityContext');
    expect(understand.mock.calls[0][0]).not.toHaveProperty('transientConnectorContext');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      customerScope: expect.objectContaining({ customerId: 'customer-a', integrationId: 'integration-erp' })
    }));
  });
});

describe('Query understanding capability resolution boundary', () => {
  it('carries one exact scoped Tool candidate with bounded arguments and binding reason', async () => {
    const harness = await createFeature011DirectHarness([capabilityPack]);
    harness.tools.resolveExactExecutableTool.mockClear();
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    const resolve = jest.spyOn(resolver, 'resolve');
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), resolver);
    const result = await pipeline.understand(pipelineInput('請查庫存可用量 SKU-001'));

    expect(result.candidateTools).toEqual([{ key: 'mock.inventory.availability.lookup', version: '1.0.0',
      arguments: { entityId: 'SKU-001' }, reason: 'customer_capability_binding' }]);
    expect(result.capabilityResolution).toMatchObject({ outcome: 'RESOLVED',
      capability: { capabilityKey: 'inventory.availability' }, bindingRef: { bindingId: 'inventory.availability' } });
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ scope: catalogScope,
      auditContext: expect.objectContaining({ customerScope: expect.objectContaining(catalogScope) }) }));
    expect(harness.tools.resolveExactExecutableTool).toHaveBeenCalledWith('mock.inventory.availability.lookup', '1.0.0');
    expect(result.candidateTools[0]).not.toHaveProperty('connectorKey');
  });

  it('clarifies a missing required parameter without releasing a Tool candidate', async () => {
    const harness = await createFeature011DirectHarness([capabilityPack]);
    harness.tools.resolveExactExecutableTool.mockClear();
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
      new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit));
    const result = await pipeline.understand(pipelineInput('請查庫存可用量'));

    expect(result.capabilityResolution).toMatchObject({ outcome: 'NEEDS_CLARIFICATION',
      reasonCode: 'PARAMETER_ISSUES', missingParameters: ['entityRef'] });
    expect(result.candidateTools).toEqual([]);
    expect(result.clarificationNeeds).toEqual(expect.arrayContaining([expect.objectContaining({
      reason: 'PARAMETER_ISSUES', blocking: true })]));
    expect(result.confidence).toBeLessThan(0.7);
    expect(harness.tools.resolveExactExecutableTool).not.toHaveBeenCalled();
  });

  it('does not resolve a Customer pack under another Integration', async () => {
    const harness = await createFeature011DirectHarness([capabilityPack]);
    harness.tools.resolveExactExecutableTool.mockClear();
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
      new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit));
    const input = pipelineInput('請查庫存可用量 SKU-001');
    const result = await pipeline.understand({ ...input,
      hostIntegrationContext: { ...input.hostIntegrationContext, integrationId: 'integration-other' } });

    expect(result.capabilityResolution).toMatchObject({ outcome: 'NEEDS_CLARIFICATION', reasonCode: 'CAPABILITY_NOT_RECOGNIZED' });
    expect(result.candidateTools).toEqual([]);
    expect(harness.tools.resolveExactExecutableTool).not.toHaveBeenCalled();
  });

  it('does not release a Tool candidate from an inactive exact binding', async () => {
    const harness = await createFeature011DirectHarness([capabilityPack]);
    harness.tools.resolveExactExecutableTool.mockClear();
    const selected = harness.registry.resolveCatalog(catalogScope);
    if (!selected.available) throw new Error('Expected Customer A capability catalog');
    const registry = new CapabilityCatalogRegistry();
    registry.installRelease([{ ...selected.catalog, bindings: selected.catalog.bindings.map((binding) =>
      binding.bindingId === 'inventory.availability' ? { ...binding, active: false } : binding) }]);
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(),
      new CapabilityResolutionService(registry, harness.semantic, harness.parameters, harness.binding, harness.audit));
    const result = await pipeline.understand(pipelineInput('請查庫存可用量 SKU-001'));

    expect(result.capabilityResolution).toMatchObject({ outcome: 'CAPABILITY_UNAVAILABLE',
      reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' });
    expect(result.candidateTools).toEqual([]);
    expect(harness.tools.resolveExactExecutableTool).not.toHaveBeenCalled();
  });
});

function output() {
  return {
    taskType: 'order_status_lookup', sentences: [], tokens: [], phrases: [], normalizedTerms: [], timeRanges: [],
    resolvedReferences: [], entityCandidates: [], subTasks: [], candidateTools: [], riskLevel: RiskLevel.low,
    confidence: 0.9, clarificationNeeds: [], requiredEvidence: []
  };
}

function pipelineInput(text: string) {
  return {
    requestId: 'req-t094', sessionId: 'session-t094', messageId: 'message-t094', text,
    hostIntegrationContext: {
      requestId: 'req-t094', customerId: 'customer-a', integrationId: 'integration-erp',
      organizationId: 'org-001', hostApp: 'erp', actorId: 'actor-001',
      roles: ['planner'] as const, permissionScopes: ['inventory:read'] as const
    }
  };
}
