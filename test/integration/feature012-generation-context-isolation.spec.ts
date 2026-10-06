import { ConversationContextLoaderService } from '../../src/assistant/conversation/conversation-context-loader.service';
import { GenerationContextProjectorService } from '../../src/assistant/generation/generation-context-projector.service';
import type { GroundedContextBundleV1 } from '../../src/assistant/grounding/grounded-context-bundle.types';
import { LlmExecutionService } from '../../src/llm/llm-execution.service';

describe('Feature 012 two-Customer generation-context isolation', () => {
  it('does not materialize foreign text or references when organization, HostApp, actor, and source IDs collide', async () => {
    const generate = jest.spyOn(LlmExecutionService.prototype, 'generateAnswer');
    const common = { sessionId: 'session-shared', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared' };
    const scope = { customerId: 'customer-a', integrationId: 'integration-a', ...common };
    const a = record('customer-a', 'integration-a', 'approved answer');
    const b = record('customer-b', 'integration-b', 'FOREIGN_PRIVATE_ANSWER');
    const loader = new ConversationContextLoaderService({ loadScopedContext: async () => [b, a] });
    const context = await loader.load({ scope });
    const projector = new GenerationContextProjectorService();
    const result = projector.project({ scope, context, bundle: currentBundle() });
    expect(result.priorExchanges).toEqual([expect.objectContaining({ assistantText: 'approved answer' })]);
    expect(JSON.stringify(result)).not.toMatch(/FOREIGN_PRIVATE_ANSWER|foreign-ref|customer-b|integration-b/);
    expect(result.allowedEvidenceRefIds).toEqual(['current-ref']);
    expect(generate).not.toHaveBeenCalled();
    generate.mockRestore();
  });
});

function record(customerId: string, integrationId: string, content: string) {
  return {
    exchangeId: `exchange-${customerId}`, requestId: `request-${customerId}`,
    scope: { customerId, sessionId: 'session-shared', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared' },
    sessionStatus: 'active', completed: true,
    userMessage: { id: `user-${customerId}`, content: 'What is the inventory?' },
    assistantMessage: { id: `assistant-${customerId}`, content, answerDecision: 'answered', finalized: true },
    answerDecision: { id: `decision-${customerId}`, status: 'answered', groundingCheckId: `grounding-${customerId}` },
    queryUnderstanding: { capabilityFollowUpFrame: {
      version: '1', scope: { customerId, integrationId, hostApp: 'erp' }, packId: 'pack', packVersion: '1.0.0',
      capabilityKey: 'inventory.count', sourceMessageId: `user-${customerId}`, parameters: []
    } },
    evidence: [{ id: customerId === 'customer-a' ? 'same-source' : 'foreign-ref', sourceType: 'structured_record', sourceId: 'same-source' }],
    createdAt: '2026-10-02T00:00:00.000Z'
  };
}

function currentBundle(): GroundedContextBundleV1 {
  return { version: '1', currentRequest: { messageId: 'current', normalizedQuestion: 'What is the inventory?' },
    conversationContext: { boundedRecentTurns: [] }, retrieval: { mode: 'TOOL', coverage: 'COMPLETE',
      requestedNeeds: [{ id: 'need', kind: 'TOOL', frame: {} }], needResults: [{ needId: 'need', status: 'COVERED', evidenceRefIds: ['current-ref'] }] },
    evidence: [{ kind: 'TOOL', needId: 'need', evidenceRefId: 'current-ref', toolCallId: 'call', canonicalToolKey: 'inventory.count',
      projectedFacts: { count: 80 }, fieldPaths: ['count'], observedAt: '2026-10-03T00:00:00.000Z' }],
    citations: [{ citationId: 'citation-current', evidenceRefId: 'current-ref', needId: 'need', sourceKind: 'TOOL', safeLabel: 'Inventory' }],
    unsupportedNeeds: [], locale: 'zh-TW' } as GroundedContextBundleV1;
}
