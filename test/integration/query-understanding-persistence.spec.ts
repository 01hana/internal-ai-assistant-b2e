import { Prisma } from '../../src/generated/prisma/client';
import { QueryUnderstandingRepository } from '../../src/query-understanding/query-understanding.repository';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RiskLevel } from '../../src/generated/prisma/enums';

describe('query understanding persistence integration', () => {
  it('persists query-understanding output through the Prisma-backed repository', async () => {
    const upsert = jest.fn().mockResolvedValue({
      id: 'qu-001',
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
        candidateTools: [{ key: 'mock.orders.status.lookup', reason: 'order status query' }],
        riskLevel: RiskLevel.low,
        confidence: 0.92,
        clarificationNeeds: [],
        requiredEvidence: ['identity_context', 'structured_record']
      }
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { messageId: 'message-001' },
        create: expect.objectContaining({
          requestId: 'req-qu-persist',
          messageId: 'message-001',
          confidence: 0.92
        })
      })
    );
    expect(result.id).toBe('qu-001');
  });
});
