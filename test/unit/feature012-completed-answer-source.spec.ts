import { ConversationContextRepository } from '../../src/assistant/conversation/conversation-context.repository';

const scope = { customerId: 'customer-a', sessionId: 'session-1', organizationId: 'org-1', hostApp: 'erp', actorId: 'actor-1' };

describe('Feature 012 completed assistant answer source', () => {
  it.each([
    ['answered final', 'answered', 'answered', 'A verified final answer.', true],
    ['placeholder', 'answered', 'answered', 'Pending answer.', false],
    ['missing message completion', 'answered', 'no_answer', 'partial stream', false],
    ['rejected decision', 'no_answer', 'no_answer', 'rejected text', false]
  ])('%s exposes finalization only when durable decision and message agree', async (_name, decision, messageDecision, content, finalized) => {
    const prisma = { db: {
      assistantSession: { findFirst: jest.fn().mockResolvedValue({ status: 'active' }) },
      assistantMessage: { findMany: jest.fn().mockResolvedValue([
        { id: 'user', requestId: 'request-1', role: 'user', content: 'question', createdAt: new Date('2026-10-03T00:00:00Z') },
        { id: 'assistant', requestId: 'request-1', role: 'assistant', content, answerDecision: messageDecision,
          answerDecisions: [{ id: 'decision', status: decision }], createdAt: new Date('2026-10-03T00:00:01Z') }
      ]) }
    } };
    const source = new ConversationContextRepository(prisma as never);
    const records = await source.loadScopedContext({ scope });
    expect(records).toHaveLength(1);
    expect(records[0].assistantMessage).toMatchObject({ content, finalized });
  });
});
