import { RiskLevel } from '../../src/generated/prisma/enums';
import { QueryUnderstandingPlaceholderService } from '../../src/query-understanding/query-understanding-placeholder.service';

describe('QueryUnderstandingPlaceholderService', () => {
  const service = new QueryUnderstandingPlaceholderService();
  const identityContext = {
    requestId: 'req-qu-001',
    actor: {
      actorId: 'actor-001',
      role: 'planner',
      permissionScopes: ['orders:read']
    },
    hostApp: {
      hostApp: 'erp'
    },
    company: {
      organizationId: 'org-001'
    }
  };

  it('produces deterministic task type, candidate tools, and risk level for an order query', async () => {
    const result = await service.understand({
      requestId: 'req-qu-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '請幫我查 SO-10001 訂單目前狀態',
      identityContext
    });

    expect(result.taskType).toBe('order_status_lookup');
    expect(result.candidateTools).toEqual([
      {
        key: 'mock.orders.status.lookup',
        reason: 'order status query'
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
      identityContext
    });

    expect(result.clarificationNeeds).toEqual([
      expect.objectContaining({
        reason: 'empty_query'
      })
    ]);
    expect(result.confidence).toBe(0);
  });

  it('keeps low-confidence queries in clarification mode when identifiers are missing', async () => {
    const result = await service.understand({
      requestId: 'req-qu-003',
      sessionId: 'session-001',
      messageId: 'message-003',
      text: '請查一下訂單',
      identityContext
    });

    expect(result.taskType).toBe('order_status_lookup');
    expect(result.clarificationNeeds.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.7);
  });
});
