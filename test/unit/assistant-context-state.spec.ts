import { AssistantTaskState } from '../../src/generated/prisma/enums';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';

describe('assistant context state and page context parsing', () => {
  const service = new RuleBasedQueryUnderstandingPipeline();
  const identityContext = {
    requestId: 'req-assistant-context',
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
      permissionScopes: ['orders:read']
    },
    hostApp: {
      hostApp: 'erp'
    },
    auth: {
      tokenId: 'jwt-assistant-context',
      gatewayIssuer: 'https://gateway.test.internal'
    }
  };

  it('keeps the expected assistant context state shape for follow-up turns and clarification flows', () => {
    const contextStateFixture = {
      sessionId: 'session-001',
      currentTask: 'order_status_lookup',
      currentModule: 'orders',
      currentPage: {
        module: 'orders',
        route: '/orders/SO-10001',
        screenId: 'order-detail',
        entityType: 'order',
        entityId: 'SO-10001',
        selectedRows: [],
        activeFilters: [],
        visibleColumns: ['status', 'customerName'],
        userVisibleState: {
          expandedSections: ['summary']
        }
      },
      currentEntityType: 'order',
      currentEntityId: 'SO-10001',
      lastIntent: 'order_status_lookup',
      lastEntities: [{ type: 'orderId', value: 'SO-10001' }],
      lastToolCallIds: ['tool-call-001'],
      lastEvidenceRefIds: ['ev-001'],
      pendingClarification: {
        reason: 'missing_order_identifier',
        question: '請提供訂單號。'
      },
      pendingApprovalRequestId: null,
      taskState: AssistantTaskState.waiting_clarification
    };

    expect(contextStateFixture).toEqual(
      expect.objectContaining({
        sessionId: 'session-001',
        currentModule: 'orders',
        currentEntityType: 'order',
        currentEntityId: 'SO-10001',
        taskState: AssistantTaskState.waiting_clarification
      })
    );
    expect(contextStateFixture.currentPage).toEqual(
      expect.objectContaining({
        screenId: 'order-detail',
        visibleColumns: ['status', 'customerName']
      })
    );
  });

  it('resolves page-context keys into query-understanding references instead of ignoring the host screen state', async () => {
    const result = await service.understand({
      requestId: 'req-assistant-context',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '這張訂單目前狀態？',
      identityContext,
      pageContext: {
        module: 'orders',
        screenId: 'order-detail',
        entityType: 'order',
        entityId: 'SO-10001',
        visibleColumns: ['status', 'customerName']
      }
    });

    expect(result.resolvedReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'page_context',
          entityType: 'order',
          entityId: 'SO-10001',
          needsClarification: false
        })
      ])
    );
  });

  it('keeps pronoun-like queries in clarification mode when page context is missing', async () => {
    const result = await service.understand({
      requestId: 'req-assistant-context',
      sessionId: 'session-001',
      messageId: 'message-002',
      text: '這張訂單目前狀態？',
      identityContext
    });

    expect(result.confidence).toBeLessThan(0.7);
    expect(result.clarificationNeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: expect.stringMatching(/missing_page_context|low_confidence|missing_order_identifier/)
        })
      ])
    );
  });
});
