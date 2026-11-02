import { RiskLevel } from '../../src/generated/prisma/enums';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { createCapabilityResolutionFixtureService } from '../support/tool-discovery.fixture';

describe('RuleBasedQueryUnderstandingPipeline', () => {
  let service: RuleBasedQueryUnderstandingPipeline;
  beforeAll(async () => {
    service = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), await createCapabilityResolutionFixtureService());
  });
  const hostIntegrationContext = {
    requestId: 'req-qu-001',
    customerId: 'customer-a',
    integrationId: 'integration-erp',
    organizationId: 'org-001',
    actorId: 'actor-001',
    roles: ['planner'] as const,
    permissionScopes: ['orders:read'] as const,
    hostApp: 'erp'
  };

  it('produces deterministic task type, candidate tools, and risk level for an order query', async () => {
    const input = {
      requestId: 'req-qu-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '查詢訂單目前狀態 SO-10001',
      hostIntegrationContext
    };

    expect(input).not.toHaveProperty('identityContext');
    expect(input).not.toHaveProperty('transientConnectorContext');
    expect(input).not.toHaveProperty('connectorContextRef');

    const result = await service.understand(input);

    expect(result.taskType).toBe('general_lookup');
    expect(result.candidateTools).toEqual([
      {
        key: 'mock.orders.status.lookup',
        version: '1.0.0',
        arguments: {
          entityId: 'SO-10001'
        },
        reason: 'customer_capability_binding'
      }
    ]);
    expect(result.riskLevel).toBe(RiskLevel.low);
    expect(result.entityCandidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'orderId', value: 'SO-10001' })])
    );
  });

  it('returns clarification-ready output for empty or punctuation-only queries', async () => {
    const result = await service.understand({
      requestId: 'req-qu-002',
      sessionId: 'session-001',
      messageId: 'message-002',
      text: '？？？',
      hostIntegrationContext
    });

    expect(result.clarificationNeeds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'empty_query'
      })
    ]));
    expect(result.confidence).toBe(0);
  });

  it('keeps low-confidence queries in clarification mode when identifiers are missing', async () => {
    const result = await service.understand({
      requestId: 'req-qu-003',
      sessionId: 'session-001',
      messageId: 'message-003',
      text: '查詢訂單目前狀態',
      hostIntegrationContext
    });

    expect(result.capabilityResolution).toMatchObject({ outcome: 'NEEDS_CLARIFICATION',
      reasonCode: 'PARAMETER_ISSUES', missingParameters: ['entityRef'] });
    expect(result.candidateTools).toEqual([]);
    expect(result.clarificationNeeds.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.7);
  });
});
