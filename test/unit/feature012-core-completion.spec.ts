import { AnswerDecisionStatus } from '../../src/generated/prisma/enums';
import { AnswerDecisionService } from '../../src/assistant/answer/answer-decision.service';
import { AssistantMessageRepository } from '../../src/assistant/message/assistant-message.repository';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';

const customerScope = createCustomerScopeFromIdentityContext({
  requestId: 'req-a', customer: { customerId: 'customer-a', integrationId: 'integration-a' },
  organization: { organizationId: 'org-a' }, hostApp: { hostApp: 'erp' },
  actor: { actorId: 'actor-a', roles: [], permissionScopes: [] },
  auth: { tokenId: 'test-only', gatewayIssuer: 'https://gateway.test.internal' }
});

describe('Feature 012 atomic core completion', () => {
  it('commits grounding, decision, final message, and protected audit in one transaction', async () => {
    const tx = {
      groundingCheck: { create: jest.fn().mockResolvedValue({ id: 'grounding-1' }) },
      answerDecision: { create: jest.fn().mockResolvedValue({ id: 'decision-1' }) },
      assistantMessage: { findUnique: jest.fn().mockResolvedValue({ id: 'message-a' }), findFirst: jest.fn().mockResolvedValue({ id: 'message-a' }),
        update: jest.fn().mockResolvedValue({ id: 'message-a' }) },
      assistantSession: { findFirst: jest.fn().mockResolvedValue({ id: 'session-a' }) },
      toolCall: { findFirst: jest.fn() }, evidenceRef: { findMany: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-a', timestamp: new Date(), customerId: 'customer-a', requestId: 'req-a', eventType: 'answer_generated', evidenceRefIds: [] }) }
    };
    const transaction = jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    const prisma = { db: { $transaction: transaction } } as unknown as PrismaService;
    const service = new AnswerDecisionService(prisma, new AssistantMessageRepository(prisma), new AuditWriterService(prisma));
    const result = await service.completeGeneratedAnswer({ customerScope, requestId: 'req-a', sessionId: 'session-a', messageId: 'message-a',
      text: '核准答案', evidenceRefIds: ['ev-a'], retrievalMode: 'RAG', coverage: 'COMPLETE' });
    expect(result.status).toBe(AnswerDecisionStatus.answered);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.groundingCheck.create).toHaveBeenCalledTimes(1);
    expect(tx.answerDecision.create).toHaveBeenCalledTimes(1);
    expect(tx.assistantMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: { content: '核准答案', answerDecision: AnswerDecisionStatus.answered } }));
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});
