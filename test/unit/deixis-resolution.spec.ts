import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';

const identityContext = {
  requestId: 'req-deixis-001',
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

describe('deixis resolution', () => {
  const service = new RuleBasedQueryUnderstandingPipeline();

  it('resolves pronoun-like references from PageContext entityType/entityId', async () => {
    const result = await service.understand({
      requestId: 'req-deixis-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      text: '這筆目前狀態？',
      identityContext,
      pageContext: {
        module: 'orders',
        entityType: 'order',
        entityId: 'SO-10001'
      }
    });

    expect(result.resolvedReferences).toEqual([
      expect.objectContaining({
        source: 'page_context',
        entityType: 'order',
        entityId: 'SO-10001',
        needsClarification: false
      })
    ]);
    expect(result.clarificationNeeds).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'missing_page_context' })])
    );
  });

  it('does not guess when PageContext misses entityId', async () => {
    const result = await service.understand({
      requestId: 'req-deixis-002',
      sessionId: 'session-001',
      messageId: 'message-002',
      text: '這張訂單目前狀態？',
      identityContext,
      pageContext: {
        module: 'orders',
        entityType: 'order'
      }
    });

    expect(result.resolvedReferences).toEqual([
      expect.objectContaining({
        source: 'page_context',
        entityType: 'order',
        needsClarification: true,
        reason: 'missing_entity_id'
      })
    ]);
    expect(result.clarificationNeeds).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'missing_page_context', blocking: true })])
    );
  });

  it('requires clarification when selectedRows contains multiple candidates', async () => {
    const result = await service.understand({
      requestId: 'req-deixis-003',
      sessionId: 'session-001',
      messageId: 'message-003',
      text: '剛剛選取的訂單狀態？',
      identityContext,
      pageContext: {
        module: 'orders',
        entityType: 'order',
        selectedRows: [{ id: 'SO-10001' }, { id: 'SO-10002' }]
      }
    });

    expect(result.clarificationNeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'multiple_candidates',
          candidateRefs: expect.arrayContaining([
            expect.objectContaining({ entityId: 'SO-10001' }),
            expect.objectContaining({ entityId: 'SO-10002' })
          ]),
          blocking: true
        })
      ])
    );
  });

  it('prefers PageContext over AssistantContextState when both are present', async () => {
    const result = await service.understand({
      requestId: 'req-deixis-004',
      sessionId: 'session-001',
      messageId: 'message-004',
      text: '目前這筆狀態？',
      identityContext,
      pageContext: {
        entityType: 'order',
        entityId: 'SO-PAGE-001'
      },
      assistantContextState: {
        currentEntityType: 'order',
        currentEntityId: 'SO-CONTEXT-001'
      }
    });

    expect(result.resolvedReferences[0]).toEqual(
      expect.objectContaining({
        source: 'page_context',
        entityId: 'SO-PAGE-001'
      })
    );
  });

  it('falls back to AssistantContextState when PageContext is insufficient', async () => {
    const result = await service.understand({
      requestId: 'req-deixis-005',
      sessionId: 'session-001',
      messageId: 'message-005',
      text: '目前這筆狀態？',
      identityContext,
      assistantContextState: {
        currentEntityType: 'order',
        currentEntityId: 'SO-CONTEXT-001'
      }
    });

    expect(result.resolvedReferences).toEqual([
      expect.objectContaining({
        source: 'context_state',
        entityType: 'order',
        entityId: 'SO-CONTEXT-001',
        needsClarification: false
      })
    ]);
  });
});
