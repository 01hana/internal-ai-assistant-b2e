import { ReviewItemService, UNSUPPORTED_QUESTION_SUMMARY } from '../../src/feedback/review-item.service';
import type { AuditWriterService } from '../../src/audit/audit-writer.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { CustomerScope } from '../../src/identity/customer-scope.types';
import type { RequestIdentityContext } from '../../src/identity/identity-context.types';

const customerScope = { customerId: 'customer-a', integrationId: 'integration-a', organizationId: 'org-a', hostApp: 'erp',
  actorId: 'actor-a', roles: [], permissionScopes: [] } as unknown as CustomerScope;
const identityContext = { customer: { customerId: 'customer-a', integrationId: 'integration-a' }, organization: { organizationId: 'org-a' },
  hostApp: { hostApp: 'erp' }, actor: { actorId: 'actor-a', roles: [], permissionScopes: [] } } as unknown as RequestIdentityContext;

/** Feature 013 US5 (T045): the stored record carries only the reason and the page module, never the question. */
describe('ReviewItemService.createUnsupportedQuestion', () => {
  function harness(options: { messageExists?: boolean } = {}) {
    const created: Array<Record<string, unknown>> = [];
    const database = {
      assistantSession: { findFirst: jest.fn(async () => ({ id: 'session-a' })) },
      assistantMessage: { findFirst: jest.fn(async () => (options.messageExists === false ? null
        : { id: 'message-user-1', sessionId: 'session-a', content: '幫我看一下明天的天氣' })) },
      reviewItem: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'review-1', ...data }; }) }
    };
    const prisma = { db: { $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(database)) } } as unknown as PrismaService;
    const append = jest.fn(async () => undefined);
    const service = new ReviewItemService(prisma, { append } as unknown as AuditWriterService);
    return { service, created, append };
  }

  const input = { customerScope, identityContext, requestId: 'req-1', sessionId: 'session-a', userMessageId: 'message-user-1' };

  it('stores the user message as source and only reasonCode and module as improvement', async () => {
    const { service, created, append } = harness();
    await service.createUnsupportedQuestion({ ...input, reasonCode: 'CAPABILITY_NOT_RECOGNIZED', module: 'orders' });

    expect(created).toEqual([expect.objectContaining({ customerId: 'customer-a', sourceType: 'unsupported_question',
      sourceId: 'message-user-1', status: 'open', summary: UNSUPPORTED_QUESTION_SUMMARY,
      suggestedImprovement: { reasonCode: 'CAPABILITY_NOT_RECOGNIZED', module: 'orders' } })]);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'review_item_created', messageId: 'message-user-1',
      metadata: { reviewItemId: 'review-1', sourceType: 'unsupported_question', reasonCode: 'CAPABILITY_NOT_RECOGNIZED', module: 'orders' } }),
      expect.anything());
    expect(JSON.stringify([created, append.mock.calls])).not.toContain('天氣');
  });

  it('records a null module when the page has none', async () => {
    const { service, created } = harness();
    await service.createUnsupportedQuestion({ ...input, reasonCode: 'LLM_NO_MATCH' });
    expect(created[0].suggestedImprovement).toEqual({ reasonCode: 'LLM_NO_MATCH', module: null });
  });

  it('writes nothing when the user message is not in the session', async () => {
    const { service, created, append } = harness({ messageExists: false });
    await expect(service.createUnsupportedQuestion({ ...input, reasonCode: 'LLM_NO_MATCH' })).rejects.toThrow('Review resource not found.');
    expect(created).toEqual([]);
    expect(append).not.toHaveBeenCalled();
  });
});
