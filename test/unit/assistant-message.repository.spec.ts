import { AnswerDecisionStatus } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AssistantMessageRepository } from '../../src/assistant/message/assistant-message.repository';

describe('AssistantMessageRepository', () => {
  const customerScope = createCustomerScopeFromIdentityContext({
    requestId: 'req-message-repository',
    customer: { customerId: 'customer-a', integrationId: 'integration-a' },
    organization: { organizationId: 'org-001' },
    hostApp: { hostApp: 'erp' },
    actor: { actorId: 'actor-001', roles: [], permissionScopes: [] },
    auth: { tokenId: 'token-001', gatewayIssuer: 'https://gateway.example.test' }
  });

  it('creates a user message with persisted page context', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'message-001' });
    const repository = new AssistantMessageRepository({
      db: {
        assistantMessage: {
          create
        }
      }
    } as unknown as PrismaService);

    await repository.createUserMessage({
      customerScope,
      sessionId: 'session-001',
      requestId: 'req-001',
      content: '這張訂單目前狀態？',
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001'
      }
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'session-001',
          customerId: 'customer-a',
          requestId: 'req-001',
          content: '這張訂單目前狀態？'
        })
      })
    );
  });

  it('creates a pending assistant message and later completes it', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'message-002' });
    const update = jest.fn().mockResolvedValue({ id: 'message-002' });
    const findUnique = jest.fn().mockResolvedValue({ id: 'message-002', customerId: 'customer-a' });
    const repository = new AssistantMessageRepository({
      db: {
        assistantMessage: {
          create,
          update,
          findUnique
        }
      }
    } as unknown as PrismaService);

    await repository.createPendingAssistantMessage({
      customerScope,
      sessionId: 'session-001',
      requestId: 'req-002'
    });
    await repository.completeAssistantMessage({
      customerScope,
      messageId: 'message-002',
      content: '這張訂單目前狀態為已確認。',
      answerDecision: AnswerDecisionStatus.answered
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          answerDecision: AnswerDecisionStatus.no_answer
        })
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId_id: { customerId: 'customer-a', id: 'message-002' } },
        data: {
          content: '這張訂單目前狀態為已確認。',
          answerDecision: AnswerDecisionStatus.answered
        }
      })
    );
  });

  it('finds session messages with cursor and limit for history pagination', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'message-002' }]);
    const repository = new AssistantMessageRepository({
      db: {
        assistantMessage: {
          findMany
        }
      }
    } as unknown as PrismaService);

    await repository.findMessagesForSession({
      customerScope,
      sessionId: 'session-001',
      cursor: 'message-002',
      limit: 2
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        customerId: 'customer-a',
        sessionId: 'session-001'
      },
      cursor: {
        id: 'message-002'
      },
      skip: 1,
      orderBy: {
        createdAt: 'asc'
      },
      take: 2
    });
  });
});
