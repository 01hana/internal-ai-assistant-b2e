import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { RiskLevel } from '../../src/generated/prisma/enums';
import { QueryUnderstandingService } from '../../src/query-understanding/query-understanding.service';
import { QueryUnderstandingRepository } from '../../src/query-understanding/query-understanding.repository';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';

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

describe('T094 production query-understanding discovery boundary', () => {
  it('carries a unique metadata candidate with immutable bounded arguments and reason', async () => {
    const discover = jest.fn().mockResolvedValue({
      candidates: Object.freeze([{ key: 'generic.stock.lookup', arguments: Object.freeze({ sku: 'SKU-001' }), reason: 'metadata_discovery' }]),
      taskType: 'inventory_stock_lookup', requiredEvidence: Object.freeze(['identity_context', 'structured_record']),
      matchConfidence: 0.95, clarificationNeeds: Object.freeze([]), discoveredTaskTypes: Object.freeze(['inventory_stock_lookup'])
    });
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), { discover } as never);
    const result = await pipeline.understand(pipelineInput('請查 SKU-001 庫存'));

    expect(result.candidateTools).toEqual([{ key: 'generic.stock.lookup', arguments: { sku: 'SKU-001' }, reason: 'metadata_discovery' }]);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ customerScope: { customerId: 'customer-a' } }));
  });

  it.each([
    ['policy denial', 'tool_policy_denied'],
    ['inactive or write filtering', 'tool_not_discoverable'],
    ['invalid argument binding', 'tool_arguments_missing_or_invalid']
  ])('keeps %s on clarification with no executable candidate', async (_label, reason) => {
    const pipeline = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), {
      discover: jest.fn().mockResolvedValue({
        candidates: Object.freeze([]), taskType: 'clarification_required', requiredEvidence: Object.freeze([]),
        matchConfidence: 0, discoveredTaskTypes: Object.freeze([]),
        clarificationNeeds: Object.freeze([{ type: 'tool', reason, question: '請補充查詢內容。', blocking: true }])
      })
    } as never);
    const result = await pipeline.understand(pipelineInput('請查 SKU-001 庫存'));

    expect(result.candidateTools).toEqual([]);
    expect(result.clarificationNeeds).toEqual(expect.arrayContaining([expect.objectContaining({ reason, blocking: true })]));
    expect(result.confidence).toBeLessThan(0.7);
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
