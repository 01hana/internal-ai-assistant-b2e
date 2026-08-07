import {
  createUs1PrismaMockForTest,
  createUs1TestStateForTest
} from '../support/us1-test-app.helper';

describe('US1 in-memory Prisma helper Customer predicates', () => {
  it('separates Customer A/B records for flat and compound session predicates', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);

    await expect(prisma.assistantSession.findFirst({ where: { customerId: 'customer-a', id: 'session-hidden-001' } })).resolves.toBeNull();
    await expect(prisma.assistantSession.findUnique({ where: { customerId_id: { customerId: 'customer-a', id: 'session-hidden-001' } } })).resolves.toBeNull();
    await expect(prisma.assistantSession.findUnique({ where: { customerId_id: { customerId: 'customer-b', id: 'session-hidden-001' } } })).resolves.toMatchObject({ customerId: 'customer-b' });
  });

  it('recognizes the Customer-qualified message selector and applies supplied message list scope', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);

    await expect(prisma.assistantMessage.findUnique({ where: { customerId_id: { customerId: 'customer-a', id: 'message-hidden-user-001' } } })).resolves.toBeNull();
    await expect(prisma.assistantMessage.findMany({ where: { customerId: 'customer-a', sessionId: 'session-owned-001' } })).resolves.toHaveLength(2);
    await expect(prisma.assistantMessage.findMany({ where: { customerId: 'customer-a', sessionId: 'session-hidden-001' } })).resolves.toEqual([]);
  });

  it('saves the explicitly supplied Customer on a context upsert without inferring missing scope', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);

    const created = await prisma.assistantContextState.upsert({
      where: { customerId_sessionId: { customerId: 'customer-b', sessionId: 'session-new-001' } },
      create: { customerId: 'customer-b', sessionId: 'session-new-001' },
      update: { currentTask: 'updated' }
    });
    expect(created.customerId).toBe('customer-b');

    const unscoped = await prisma.assistantSession.findUnique({ where: { id: 'session-hidden-001' } });
    expect(unscoped).toMatchObject({ customerId: 'customer-b' });
  });

  it('accepts explicit AND predicates and rejects unknown Customer compound selectors', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);

    await expect(prisma.assistantSession.findFirst({ where: { AND: [{ customerId: 'customer-a' }, { id: 'session-owned-001' }] } })).resolves.toMatchObject({ id: 'session-owned-001' });
    await expect(prisma.assistantSession.findFirst({ where: { customerId_unknown: { customerId: 'customer-a', unknown: 'session-owned-001' } } })).resolves.toBeNull();
  });

  it('rejects a supplied undefined Customer predicate while preserving observable bare-ID leakage', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);

    await expect(prisma.assistantSession.findFirst({ where: { customerId: undefined, id: 'session-hidden-001' } })).resolves.toBeNull();
    await expect(prisma.assistantSession.findUnique({ where: { id: 'session-hidden-001' } })).resolves.toMatchObject({ customerId: 'customer-b' });
  });

  it('matches AnswerDecision sources only with the exact Customer and message predicate supplied by production', async () => {
    const state = createUs1TestStateForTest();
    const prisma = createUs1PrismaMockForTest(state);
    state.answerDecisions.push({
      id: 'answer-a',
      customerId: 'customer-a',
      requestId: 'req-answer-a',
      messageId: 'message-a',
      status: 'permission_denied',
      noAnswerReason: null,
      clarificationQuestionId: null,
      groundingCheckId: null,
      metadata: null,
      createdAt: new Date('2026-08-07T00:00:00.000Z')
    });

    await expect(prisma.answerDecision.findFirst({ where: { customerId: 'customer-a', id: 'answer-a', messageId: 'message-a' } })).resolves.toMatchObject({ id: 'answer-a', customerId: 'customer-a' });
    await expect(prisma.answerDecision.findFirst({ where: { customerId: 'customer-b', id: 'answer-a', messageId: 'message-a' } })).resolves.toBeNull();
    await expect(prisma.answerDecision.findFirst({ where: { customerId: 'customer-a', id: 'answer-a', messageId: 'message-other' } })).resolves.toBeNull();
  });
});
