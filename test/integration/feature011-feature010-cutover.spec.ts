import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { GroundedRetrievalRouterService } from '../../src/retrieval/grounded-retrieval-router.service';
import { HybridRetrievalCoordinatorService } from '../../src/assistant/grounding/hybrid-retrieval-coordinator.service';
import { RetrievalCoverageService } from '../../src/assistant/grounding/retrieval-coverage.service';
import { createFeature011DirectHarness } from '../support/feature011-direct.fixture';

const packPath = 'customer-capability-packs/shinmone-scm-local/1.0.0.json';
const host = Object.freeze({
  requestId: 'req-f011-cutover', customerId: 'customer-shinmone-scm-local',
  integrationId: 'shinmone-scm-assistant-local', hostApp: 'shinmone-scm',
  organizationId: 'org-shared', actorId: 'actor-shared', roles: Object.freeze([]),
  permissionScopes: Object.freeze(['menu:SCM_DASHBOARD:read'])
});

describe('Feature 011 / Feature 010 request-path cutover', () => {
  it('selects the verified scoped pack and releases the exact monthly planning candidate without legacy discovery', async () => {
    const harness = await createFeature011DirectHarness([packPath]);
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    const discover = jest.fn(async () => ({
      candidates: [], taskType: 'clarification_required', requiredEvidence: [],
      matchConfidence: 0, clarificationNeeds: [], discoveredTaskTypes: []
    }));
    const pipeline = new RuleBasedQueryUnderstandingPipeline(
      new DefaultTokenizerAdapter(), Object.assign(resolver, { discover }) as never
    );

    const output = await pipeline.understand({
      requestId: host.requestId, sessionId: 'session-cutover', messageId: 'message-cutover',
      text: '這個月新增幾張工單？', hostIntegrationContext: host
    });

    expect(discover).not.toHaveBeenCalled();
    expect(output.candidateTools).toEqual([expect.objectContaining({
      key: 'work-orders.monthly-new-count', version: '1.0.0', arguments: {}
    })]);
    expect(output).toMatchObject({ capabilityResolution: {
      outcome: 'RESOLVED', capability: { capabilityKey: 'work-orders.count' },
      parameters: { timeRange: 'this_month' }
    } });
    expect(harness.audit.record).toHaveBeenCalledTimes(1);
  });

  it('keeps a semantically resolved candidate when current Customer Tool policy denies execution', async () => {
    const harness = await createFeature011DirectHarness([packPath]);
    harness.tools.resolveExactToolForCustomer.mockResolvedValue({ deniedReason: 'customer_policy_denied' } as never);
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic,
      harness.parameters, harness.binding, harness.audit);
    const output = await new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), resolver).understand({
      requestId: 'req-policy-denied', sessionId: 'session-policy', messageId: 'message-policy',
      text: '這個月新增幾張工單？', hostIntegrationContext: host
    });
    expect(output.capabilityResolution).toMatchObject({ outcome: 'RESOLVED' });
    expect(output.candidateTools).toEqual([expect.objectContaining({
      key: 'work-orders.monthly-new-count', version: '1.0.0', arguments: {}
    })]);
    expect(harness.tools.resolveExactToolForCustomer).not.toHaveBeenCalled();
  });

  it.each([
    ['請查工單新增數量', 'NEEDS_CLARIFICATION', 'PARAMETER_ISSUES'],
    ['今天工單新增數量', 'CAPABILITY_UNAVAILABLE', 'NO_COMPATIBLE_ACTIVE_BINDING']
  ])('projects %s without a Tool candidate or legacy discovery', async (text, outcome, reasonCode) => {
    const harness = await createFeature011DirectHarness([packPath]);
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic, harness.parameters, harness.binding, harness.audit);
    const discover = jest.fn(async () => ({
      candidates: [], taskType: 'clarification_required', requiredEvidence: [],
      matchConfidence: 0, clarificationNeeds: [], discoveredTaskTypes: []
    }));
    const pipeline = new RuleBasedQueryUnderstandingPipeline(
      new DefaultTokenizerAdapter(), Object.assign(resolver, { discover }) as never
    );
    const output = await pipeline.understand({
      requestId: host.requestId, sessionId: 'session-cutover', messageId: 'message-cutover',
      text, hostIntegrationContext: host
    });

    expect(discover).not.toHaveBeenCalled();
    expect(output.candidateTools).toEqual([]);
    expect(output).toMatchObject({ capabilityResolution: { outcome, reasonCode } });
    if (outcome === 'CAPABILITY_UNAVAILABLE') {
      expect(output.clarificationNeeds).toEqual([]);
    } else {
      expect(output.clarificationNeeds).toEqual(expect.arrayContaining([expect.objectContaining({ blocking: true })]));
    }
  });

  it('keeps an unavailable Tool need lane-local while a covered Document need yields PARTIAL', async () => {
    const router = new GroundedRetrievalRouterService();
    const documentExecute = jest.fn(async ({ need }: { need: { id: string } }) => ({
      needResult: { needId: need.id, status: 'COVERED' as const, evidenceRefIds: ['document-evidence'] },
      evidence: [], citations: []
    }));
    const toolExecute = jest.fn();
    const coordinator = new HybridRetrievalCoordinatorService(
      { execute: documentExecute } as never, { execute: toolExecute } as never
    );
    const plan = router.route({ decomposedNeeds: [
      { kind: 'UNSUPPORTED', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' },
      { kind: 'DOCUMENT', query: '請查相關文件' }
    ] });
    const coordinated = await coordinator.execute({ plan, documentInput: {} as never, toolInput: {} as never });
    const coverage = new RetrievalCoverageService().evaluate({ mode: plan.mode, requestedNeeds: plan.needs, needResults: coordinated.needResults });

    expect(coordinated.needResults).toEqual([
      expect.objectContaining({ status: 'UNSUPPORTED', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' }),
      expect.objectContaining({ status: 'COVERED' })
    ]);
    expect(coverage).toBe('PARTIAL');
    expect(documentExecute).toHaveBeenCalledTimes(1);
    expect(toolExecute).not.toHaveBeenCalled();
  });

  it('keeps an unavailable Tool-only need insufficient with zero Tool invocation', async () => {
    const toolExecute = jest.fn();
    const plan = new GroundedRetrievalRouterService().route({ decomposedNeeds: [
      { kind: 'UNSUPPORTED', reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' }
    ] });
    const coordinated = await new HybridRetrievalCoordinatorService(
      { execute: jest.fn() } as never, { execute: toolExecute } as never
    ).execute({ plan, documentInput: {} as never, toolInput: {} as never });
    const coverage = new RetrievalCoverageService().evaluate({ mode: plan.mode,
      requestedNeeds: plan.needs, needResults: coordinated.needResults });
    expect(coverage).toBe('INSUFFICIENT');
    expect(toolExecute).not.toHaveBeenCalled();
  });

  it('does not resolve a foreign scope even when its text matches the installed pack', async () => {
    const harness = await createFeature011DirectHarness([packPath]);
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic,
      harness.parameters, harness.binding, harness.audit);
    const discover = jest.fn(async () => ({
      candidates: [{ key: 'work-orders.monthly-new-count', arguments: {}, reason: 'metadata_discovery' }],
      taskType: 'general_lookup', requiredEvidence: ['structured_record'], matchConfidence: 1,
      clarificationNeeds: [], discoveredTaskTypes: ['general_lookup']
    }));
    const pipeline = new RuleBasedQueryUnderstandingPipeline(
      new DefaultTokenizerAdapter(), Object.assign(resolver, { discover }) as never
    );
    const output = await pipeline.understand({
      requestId: host.requestId, sessionId: 'session-foreign', messageId: 'message-foreign',
      text: '這個月新增幾張工單？', hostIntegrationContext: { ...host, customerId: 'customer-foreign' }
    });
    expect(output.candidateTools).toEqual([]);
    expect((output as unknown as { capabilityResolution?: unknown }).capabilityResolution).toMatchObject({ outcome: 'NEEDS_CLARIFICATION',
      reasonCode: 'CAPABILITY_NOT_RECOGNIZED' });
    expect(discover).not.toHaveBeenCalled();
  });

  it('does not release a resolved candidate when the capability audit fails', async () => {
    const harness = await createFeature011DirectHarness([packPath]);
    harness.audit.record.mockRejectedValueOnce(new Error('storage unavailable'));
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic,
      harness.parameters, harness.binding, harness.audit);
    await expect(resolver.resolve({ scope: { customerId: host.customerId,
      integrationId: host.integrationId, hostApp: host.hostApp }, text: '這個月新增幾張工單？' }))
      .rejects.toThrow('CAPABILITY_RESOLUTION_AUDIT_FAILED');
    expect(harness.audit.record).toHaveBeenCalledTimes(1);
  });

  it('revalidates a monthly follow-up against the current exact ERP test pack', async () => {
    const harness = await createFeature011DirectHarness([
      'test/fixtures/capability-packs/customer-a-monthly-followup.v1.json'
    ]);
    const resolver = new CapabilityResolutionService(harness.registry, harness.semantic,
      harness.parameters, harness.binding, harness.audit);
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), resolver,
      undefined, undefined, harness.registry, harness.parameters);
    const erpHost = { ...host, customerId: 'customer-a', integrationId: 'integration-erp', hostApp: 'erp' };
    const seed = await pipeline.understand({ requestId: 'req-seed', sessionId: 'session-erp',
      messageId: 'message-seed', text: '請查這個月新增工單數', hostIntegrationContext: erpHost });
    expect(seed.capabilityResolution).toMatchObject({ outcome: 'RESOLVED' });
    expect(seed.currentCapabilityFrame).toBeDefined();
    const followUp = await pipeline.understand({ requestId: 'req-followup', sessionId: 'session-erp',
      messageId: 'message-followup', text: '上個月呢？', hostIntegrationContext: erpHost,
      priorConversationContext: { semanticFrames: seed.currentSemanticFrame ? [seed.currentSemanticFrame] : [],
        capabilityFrames: [seed.currentCapabilityFrame] } as never });
    expect(followUp.capabilityFollowUpResolution).toMatchObject({ kind: 'REPLACE', replacedParameters: ['timeRange'] });
    expect(followUp.capabilityResolution).toMatchObject({ outcome: 'CAPABILITY_UNAVAILABLE',
      reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING', parameters: { timeRange: 'last_month' } });
    expect(followUp.candidateTools).toEqual([]);
  });

  it('keeps a policy-denied Tool lane from blocking independently covered Document evidence', async () => {
    const documentExecute = jest.fn(async ({ need }: { need: { id: string } }) => ({
      needResult: { needId: need.id, status: 'COVERED' as const, evidenceRefIds: ['document-evidence'] },
      evidence: [], citations: []
    }));
    const toolExecute = jest.fn(async ({ need }: { need: { id: string } }) => ({
      needResult: { needId: need.id, status: 'DENIED' as const, reasonCode: 'customer_policy_denied' },
      evidence: [], citations: []
    }));
    const plan = new GroundedRetrievalRouterService().route({ decomposedNeeds: [
      { kind: 'TOOL' }, { kind: 'DOCUMENT', query: '請查相關文件' }
    ] });
    const coordinated = await new HybridRetrievalCoordinatorService(
      { execute: documentExecute } as never, { execute: toolExecute } as never
    ).execute({ plan, documentInput: {} as never, toolInput: {} as never });
    const coverage = new RetrievalCoverageService().evaluate({ mode: plan.mode, requestedNeeds: plan.needs,
      needResults: coordinated.needResults });

    expect(coverage).toBe('PARTIAL');
    expect(documentExecute).toHaveBeenCalledTimes(1);
    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(coordinated.needResults[0].evidenceRefIds).toBeUndefined();
  });

});
