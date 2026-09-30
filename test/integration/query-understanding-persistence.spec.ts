import { Prisma } from '../../src/generated/prisma/client';
import { QueryUnderstandingRepository } from '../../src/query-understanding/query-understanding.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RiskLevel } from '../../src/generated/prisma/enums';
import { ConversationContextRepository } from '../../src/assistant/conversation/conversation-context.repository';
import { CUSTOMER_SCOPE_FIXTURES, createCustomerScopeFixtureScope } from '../support/customer-scope-fixtures';

describe('query understanding persistence integration', () => {
  it('persists query-understanding output through the Prisma-backed repository', async () => {
    const upsert = jest.fn().mockResolvedValue({
      id: 'qu-001',
      customerId: 'customer-a',
      requestId: 'req-qu-persist',
      messageId: 'message-001',
      sentences: [{ index: 0, text: '查 SO-10001 訂單狀態' }],
      tokens: [],
      phrases: [],
      normalizedTerms: ['so-10001'],
      timeRanges: null,
      resolvedReferences: null,
      entityCandidates: [{ type: 'orderId', value: 'SO-10001', confidence: 0.95 }],
      subTasks: null,
      confidence: 0.92,
      clarificationNeeds: null,
      createdAt: new Date('2026-06-15T00:00:00.000Z')
    });
    const repository = new QueryUnderstandingRepository({
      db: {
        queryUnderstandingResult: {
          upsert
        }
      }
    } as unknown as PrismaService);

    const result = await repository.save({
      customerScope: createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA),
      requestId: 'req-qu-persist',
      messageId: 'message-001',
      output: {
        taskType: 'order_status_lookup',
        sentences: [{ index: 0, text: '查 SO-10001 訂單狀態' }],
        tokens: [],
        phrases: [],
        normalizedTerms: [
          {
            originalTerm: 'SO-10001',
            normalizedTerm: 'SO-10001',
            category: 'entity',
            confidence: 0.98,
            reason: 'identifier_pattern'
          }
        ],
        timeRanges: [],
        resolvedReferences: [],
        entityCandidates: [{ type: 'orderId', value: 'SO-10001', confidence: 0.95 }],
        subTasks: [],
        candidateTools: [{ key: 'mock.orders.status.lookup', arguments: { entityId: 'SO-10001' }, reason: 'metadata_discovery' }],
        riskLevel: RiskLevel.low,
        confidence: 0.92,
        clarificationNeeds: [],
        requiredEvidence: ['identity_context', 'structured_record']
      }
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          customerId_messageId: { customerId: 'customer-a', messageId: 'message-001' }
        },
        create: expect.objectContaining({
          customerId: 'customer-a',
          requestId: 'req-qu-persist',
          messageId: 'message-001',
          confidence: 0.92
        })
      })
    );
    expect(result.id).toBe('qu-001');
  });

  it('persists a safe capability frame in a versioned resolvedReferences envelope without changing legacy references', async () => {
    const upsert = jest.fn().mockImplementation(async ({ create }) => ({
      id: 'qu-capability', createdAt: new Date('2026-09-25T00:00:00.000Z'), ...create
    }));
    const repository = new QueryUnderstandingRepository({ db: { queryUnderstandingResult: { upsert } } } as unknown as PrismaService);
    const output: any = {
      taskType: 'general_lookup', sentences: [], tokens: [], phrases: [], normalizedTerms: [], timeRanges: [],
      resolvedReferences: [{ source: 'page_context', confidence: 1, needsClarification: false, reason: 'resolved' }],
      entityCandidates: [], subTasks: [], candidateTools: [], riskLevel: RiskLevel.low, confidence: 0.9,
      clarificationNeeds: [], requiredEvidence: [],
      currentCapabilityFrame: capabilityFrame()
    };

    await repository.save({
      customerScope: createCustomerScopeFixtureScope(CUSTOMER_SCOPE_FIXTURES.customerA),
      requestId: 'req-capability', messageId: 'message-capability', output
    });

    expect(upsert.mock.calls[0][0].create.resolvedReferences).toEqual({
      version: '1', kind: 'CAPABILITY_FOLLOW_UP_FRAME_ENVELOPE',
      references: output.resolvedReferences,
      capabilityFrame: capabilityFrame()
    });
  });

  it('unwraps the envelope for bounded conversation reconstruction without exposing it as legacy semantic data', async () => {
    const now = new Date('2026-09-25T00:00:00.000Z');
    const repository = new ConversationContextRepository({ db: {
      assistantSession: { findFirst: jest.fn().mockResolvedValue({ status: 'active' }) },
      assistantMessage: { findMany: jest.fn().mockResolvedValue([
        { id: 'assistant-1', requestId: 'req-1', role: 'assistant', createdAt: now, answerDecisions: [{ id: 'decision-1', status: 'answered' }], groundingChecks: [], evidenceRefs: [] },
        { id: 'user-1', requestId: 'req-1', role: 'user', content: 'synthetic', createdAt: now, queryUnderstanding: {
          resolvedReferences: { version: '1', kind: 'CAPABILITY_FOLLOW_UP_FRAME_ENVELOPE', references: [], capabilityFrame: capabilityFrame() },
          phrases: [], normalizedTerms: [], timeRanges: [], entityCandidates: [], subTasks: [], confidence: 0.9
        } }
      ]) }
    } } as unknown as PrismaService);

    const records = await repository.loadScopedContext({ scope: {
      customerId: 'customer-a', sessionId: 'session-a', organizationId: 'org-a', hostApp: 'host-a', actorId: 'actor-a'
    } });
    expect(records[0].queryUnderstanding).toMatchObject({ resolvedReferences: [], capabilityFollowUpFrame: capabilityFrame() });
  });
});

function capabilityFrame() {
  return {
    version: '1', scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'host-a' },
    packId: 'customer-a.pack', packVersion: '1.0.0', capabilityKey: 'work-orders.count',
    sourceMessageId: 'message-capability',
    parameters: [{ parameterName: 'timeRange', value: 'this_month', source: 'current_explicit', sourceMessageId: 'message-capability' }]
  };
}
