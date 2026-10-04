import { GenerationContextProjectorService } from '../../src/assistant/generation/generation-context-projector.service';
import type { GroundedContextBundleV1 } from '../../src/assistant/grounding/grounded-context-bundle.types';

describe('Feature 012 current evidence outranks prior answer eval', () => {
  it('retains prior 100 as conversation only and current approved 80 as the sole cited fact', () => {
    const scope = { customerId: 'customer-a', sessionId: 'session-a', integrationId: 'integration-a', organizationId: 'org', hostApp: 'erp', actorId: 'actor' };
    const context = { scope, selectedExchangeIdsNewestFirst: ['prior'], chronologicalExchangeIds: ['prior'], semanticFrames: [], capabilityFrames: [],
      evidenceRefs: [], evidenceRefIds: [], rejectedReasonCodes: [],
      completedAssistantAnswers: [{ exchangeId: 'prior', userText: 'How many before?', assistantText: 'Inventory is 100.',
        createdAt: '2026-10-02T00:00:00Z', capabilityScope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'erp' } }],
      exchanges: [{ exchangeId: 'prior', requestId: 'prior', userMessageId: 'user-prior',
        assistantMessageId: 'assistant-prior', userText: 'How many before?', createdAt: '2026-10-02T00:00:00Z',
        capabilityFrame: { scope: { customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'erp' } }, evidenceRefIds: [] }] };
    const bundle = { version: '1', currentRequest: { messageId: 'current', normalizedQuestion: 'What is it now?' }, conversationContext: { boundedRecentTurns: [] },
      retrieval: { mode: 'TOOL', coverage: 'COMPLETE', requestedNeeds: [{ id: 'need', kind: 'TOOL', frame: {} }],
        needResults: [{ needId: 'need', status: 'COVERED', evidenceRefIds: ['current-evidence'] }] },
      evidence: [{ kind: 'TOOL', needId: 'need', evidenceRefId: 'current-evidence', toolCallId: 'current-call', canonicalToolKey: 'inventory.stock-on-hand',
        projectedFacts: { count: 80 }, fieldPaths: ['count'], observedAt: '2026-10-03T00:00:00Z' }],
      citations: [{ citationId: 'current-citation', evidenceRefId: 'current-evidence', needId: 'need', sourceKind: 'TOOL', safeLabel: 'Inventory' }],
      unsupportedNeeds: [], locale: 'zh-TW' } as GroundedContextBundleV1;
    const output = new GenerationContextProjectorService().project({ scope, context: context as never, bundle });
    expect(output.priorExchanges[0].assistantText).toContain('100');
    expect(output.toolEvidence[0].facts).toEqual({ count: 80 });
    expect(output.allowedEvidenceRefIds).toEqual(['current-evidence']);
    expect(JSON.stringify(output.toolEvidence)).not.toContain('100');
  });
});
