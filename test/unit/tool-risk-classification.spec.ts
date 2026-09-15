import { RiskLevel } from '../../src/generated/prisma/enums';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { DefaultTokenizerAdapter } from '../../src/query-understanding/default-tokenizer.adapter';
import { createToolDiscoveryFixtureService } from '../support/tool-discovery.fixture';

describe('US2 tool risk classification and selection', () => {
  const service = new RuleBasedQueryUnderstandingPipeline(new DefaultTokenizerAdapter(), createToolDiscoveryFixtureService());
  const hostIntegrationContext = {
    requestId: 'req-us2-tools',
    customerId: 'customer-a',
    integrationId: 'integration-erp',
    organizationId: 'org-001',
    actorId: 'actor-001',
    roles: ['planner'] as const,
    permissionScopes: ['orders:read', 'inventory:read'] as const,
    hostApp: 'erp'
  };

  it('classifies read-only live business data lookup as low risk and selects a connector-style tool candidate', async () => {
    const result = await service.understand({
      requestId: 'req-us2-tools-order',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '請查 SO-10001 訂單狀態',
      hostIntegrationContext
    });

    expect(result.riskLevel).toBe(RiskLevel.low);
    expect(result.candidateTools).toEqual([
      expect.objectContaining({
        key: 'mock.orders.status.lookup'
      })
    ]);
    expect(result.requiredEvidence).toContain('structured_record');
  });

  it('does not keep routing destructive order intents to the read-only status lookup tool', async () => {
    const result = await service.understand({
      requestId: 'req-us2-tools-high-risk',
      sessionId: 'session-001',
      messageId: 'message-002',
      text: '請取消 SO-10001 訂單',
      hostIntegrationContext
    });

    expect(result.riskLevel).toBe(RiskLevel.high);
    expect(result.candidateTools).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'mock.orders.status.lookup'
        })
      ])
    );
  });
});
