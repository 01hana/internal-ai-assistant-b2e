import { ConversationContextRepository } from '../../src/assistant/conversation/conversation-context.repository';

const scope = { customerId: 'customer-a', sessionId: 'session-1', organizationId: 'org-1', hostApp: 'erp', actorId: 'actor-1' };

describe('Feature 012 completed assistant answer source', () => {
  it.each([
    ['answered final', 'answered', 'answered', 'A verified final answer.', true, true],
    ['placeholder', 'answered', 'answered', 'Pending answer.', false, false],
    ['missing message completion', 'answered', 'no_answer', 'partial stream', false, false],
    ['completed no-answer reply', 'no_answer', 'no_answer', 'rejected text', false, true]
  ])('%s exposes only durable completion and finalization', async (_name, decision, messageDecision, content, finalized, included) => {
    const prisma = { db: {
      assistantSession: { findFirst: jest.fn().mockResolvedValue({ status: 'active' }) },
      assistantMessage: { findMany: jest.fn().mockResolvedValue([
        { id: 'user', requestId: 'request-1', role: 'user', content: 'question', createdAt: new Date('2026-10-03T00:00:00Z') },
        { id: 'assistant', requestId: 'request-1', role: 'assistant', content, answerDecision: messageDecision,
          answerDecisions: [{ id: 'decision', status: decision, groundingCheckId: 'grounding-1' }], createdAt: new Date('2026-10-03T00:00:01Z') }
      ]) }
    } };
    const source = new ConversationContextRepository(prisma as never);
    const records = await source.loadScopedContext({ scope });
    expect(records).toHaveLength(included ? 1 : 0);
    if (included) expect(records[0].assistantMessage).toMatchObject({ content, finalized });
  });
});
