import { RiskLevel } from '../../src/generated/prisma/enums';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';

describe('US2 tool risk classification and selection', () => {
  const service = new RuleBasedQueryUnderstandingPipeline();
  const identityContext = {
    requestId: 'req-us2-tools',
    customer: {
      customerId: 'customer-a',
      integrationId: 'integration-erp'
    },
    organization: {
      organizationId: 'org-001'
    },
    actor: {
      actorId: 'actor-001',
      roles: ['planner'],
      permissionScopes: ['orders:read', 'inventory:read']
    },
    hostApp: {
      hostApp: 'erp'
    },
    auth: {
      tokenId: 'jwt-tool-risk',
      gatewayIssuer: 'https://gateway.test.internal'
    }
  };

  it('classifies read-only live business data lookup as low risk and selects a connector-style tool candidate', async () => {
    const result = await service.understand({
      requestId: 'req-us2-tools-order',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '請查 SO-10001 訂單狀態',
      identityContext
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
      identityContext
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
