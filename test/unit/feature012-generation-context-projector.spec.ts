import { GenerationContextProjectorService } from '../../src/assistant/generation/generation-context-projector.service';
import type { GroundedContextBundleV1 } from '../../src/assistant/grounding/grounded-context-bundle.types';

const scope = { customerId: 'customer-a', sessionId: 'session-1', integrationId: 'integration-a', organizationId: 'same-org', hostApp: 'erp', actorId: 'same-actor' };
const projector = new GenerationContextProjectorService();

function exchange(id: number, overrides: Record<string, unknown> = {}) {
  return {
    exchangeId: `exchange-${id}`, requestId: `request-${id}`, userMessageId: `user-${id}`, assistantMessageId: `assistant-${id}`,
    userText: `question-${id}`, assistantText: `answer-${id}`, createdAt: `2026-09-${String(id).padStart(2, '0')}T00:00:00.000Z`,
    capabilityFrame: { scope: { customerId: scope.customerId, integrationId: scope.integrationId, hostApp: scope.hostApp } },
    evidenceRefIds: [], ...overrides
  };
}

function bundle(overrides: Record<string, unknown> = {}): GroundedContextBundleV1 {
  return {
    version: '1', currentRequest: { messageId: 'current', normalizedQuestion: '目前庫存？' },
    conversationContext: { boundedRecentTurns: [] },
    retrieval: { mode: 'TOOL', requestedNeeds: [{ id: 'need-1', kind: 'TOOL' }], needResults: [{ needId: 'need-1', status: 'COVERED', evidenceRefIds: ['evidence-1'] }], coverage: 'COMPLETE' },
    evidence: [{ kind: 'TOOL', needId: 'need-1', evidenceRefId: 'evidence-1', toolCallId: 'call-1', canonicalToolKey: 'inventory.stock-on-hand', projectedFacts: { count: 80 }, fieldPaths: ['count'], observedAt: '2026-10-03T00:00:00.000Z' }],
    citations: [{ citationId: 'citation-1', evidenceRefId: 'evidence-1', needId: 'need-1', sourceKind: 'TOOL', safeLabel: 'Inventory' }],
    unsupportedNeeds: [], locale: 'zh-TW', ...overrides
  } as unknown as GroundedContextBundleV1;
}

function context(exchanges: unknown[]) {
  const evidenceRefIds = exchanges.flatMap((item) => (item as { evidenceRefIds?: string[] }).evidenceRefIds ?? []);
  const completedAssistantAnswers = exchanges.flatMap((item) => {
    const value = item as ReturnType<typeof exchange>;
    if (!value.assistantText || !value.userText) return [];
    return [{ exchangeId: value.exchangeId, userText: value.userText, assistantText: value.assistantText,
      createdAt: value.createdAt, capabilityScope: (value.capabilityFrame as { scope?: unknown } | undefined)?.scope }];
  });
  return { scope: { customerId: scope.customerId, sessionId: scope.sessionId, organizationId: scope.organizationId, hostApp: scope.hostApp, actorId: scope.actorId },
    exchanges, completedAssistantAnswers, selectedExchangeIdsNewestFirst: [], chronologicalExchangeIds: [], semanticFrames: [], capabilityFrames: [], evidenceRefs: [], evidenceRefIds, rejectedReasonCodes: [] };
}

describe('Feature 012 bounded generation context', () => {
  it('T009 excludes foreign or unprovable integration context, even with colliding IDs', () => {
    const input = context([
      exchange(1),
      exchange(2, { capabilityFrame: { scope: { customerId: 'customer-b', integrationId: 'integration-a', hostApp: 'erp' } }, assistantText: 'foreign-customer' }),
      exchange(3, { capabilityFrame: { scope: { customerId: 'customer-a', integrationId: 'integration-b', hostApp: 'erp' } }, assistantText: 'foreign-integration' }),
      exchange(4, { capabilityFrame: undefined, assistantText: 'unproven-integration' })
    ]);
    const result = projector.project({ scope, context: input as never, bundle: bundle() });
    expect(result.priorExchanges.map((item: { assistantText: string }) => item.assistantText)).toEqual(['answer-1']);
    expect(JSON.stringify(result)).not.toMatch(/foreign-|unproven-/);
    for (const field of ['customerId', 'sessionId', 'organizationId', 'hostApp', 'actorId'] as const) {
      const foreign = context([exchange(1)]);
      foreign.scope[field] = `other-${field}`;
      expect(() => projector.project({ scope, context: foreign as never, bundle: bundle() })).toThrow('GENERATION_CONTEXT_INVALID');
    }
  });

  it('T010 includes only completed final text and rejects placeholders and unsafe text', () => {
    const input = context([
      exchange(1, { assistantText: 'Pending answer.' }), exchange(2, { assistantText: undefined }),
      exchange(3, { assistantText: 'Bearer abc' }), exchange(4)
    ]);
    expect(projector.project({ scope, context: input as never, bundle: bundle() }).priorExchanges.map((item: { assistantText: string }) => item.assistantText)).toEqual(['answer-4']);
  });

  it('T011 deterministically selects newest four, presents chronologically, and stays under byte budgets', () => {
    const input = context(Array.from({ length: 7 }, (_, index) => exchange(index + 1, { userText: '漢😀'.repeat(900), assistantText: '答😀'.repeat(900) })));
    const first = projector.project({ scope, context: input as never, bundle: bundle() });
    const second = projector.project({ scope, context: input as never, bundle: bundle() });
    expect(first.priorExchanges).toHaveLength(4);
    expect(first.priorExchanges[0].assistantText).toContain('答');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Buffer.byteLength(JSON.stringify(first), 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(Buffer.byteLength(JSON.stringify(first.priorExchanges), 'utf8')).toBeLessThanOrEqual(4 * 1024);
    expect(JSON.stringify(first)).not.toContain('\uFFFD');
  });

  it('T013 admits prior evidence only with current-request revalidation and never raw Tool fields', () => {
    const prior = context([exchange(1, { evidenceRefIds: ['evidence-1'] })]);
    expect(() => projector.project({ scope, context: prior as never, bundle: bundle() })).toThrow();
    const approved = projector.project({ scope, context: prior as never, bundle: bundle(), priorGroundedContext: {
      complete: true, needResults: [{ needId: 'need-1', status: 'COVERED', evidenceRefIds: ['evidence-1'] }],
      evidence: [bundle().evidence[0]], citations: bundle().citations
    } });
    expect(approved.toolEvidence).toEqual([expect.objectContaining({ facts: { count: 80 } })]);
    expect(JSON.stringify(approved)).not.toMatch(/toolCallId|canonicalToolKey|projectedFacts|connectorContextRef/);
  });

  it('T011 fails closed when required citation metadata or a covered fact cannot fit', () => {
    expect(() => projector.project({ scope, context: context([]) as never, bundle: bundle({ citations: [] }) })).toThrow();
    const huge = bundle({ evidence: [{ ...(bundle().evidence[0] as object), projectedFacts: { count: 'x'.repeat(5_000) } }] });
    expect(() => projector.project({ scope, context: context([]) as never, bundle: huge })).toThrow();
    const longId = 'citation-' + 'x'.repeat(1100);
    expect(() => projector.project({ scope, context: context([]) as never,
      bundle: bundle({ citations: [{ ...bundle().citations[0], citationId: longId }] }) })).toThrow();
  });

  it('T011 enforces current-question and document allocations without splitting Unicode', () => {
    const document = bundle({
      retrieval: { mode: 'RAG', requestedNeeds: [{ id: 'need-1', kind: 'DOCUMENT' }],
        needResults: [{ needId: 'need-1', status: 'COVERED', evidenceRefIds: ['document-1'] }], coverage: 'COMPLETE' },
      evidence: [{ kind: 'DOCUMENT', needId: 'need-1', evidenceRefId: 'document-1', content: '漢😀'.repeat(900),
        title: 'Doc', documentId: 'doc', chunkId: 'chunk', documentVersion: '1', sourceKey: 'source',
        observedAt: '2026-10-03T00:00:00Z', trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE' }],
      citations: [{ citationId: 'citation-document', evidenceRefId: 'document-1', needId: 'need-1', sourceKind: 'DOCUMENT', safeLabel: 'Doc' }],
      currentRequest: { messageId: 'current', normalizedQuestion: '問😀'.repeat(900) }
    });
    const result = projector.project({ scope, context: context([]) as never, bundle: document });
    expect(Buffer.byteLength(JSON.stringify(result.currentQuestion), 'utf8')).toBeLessThanOrEqual(2 * 1024);
    expect(Buffer.byteLength(JSON.stringify(result.documentEvidence), 'utf8')).toBeLessThanOrEqual(6 * 1024);
    expect(JSON.stringify(result)).not.toContain('\uFFFD');
    expect(result.documentEvidence[0].text).toContain('漢');
  });

  it('T013 rejects unauthorized prior refs and prohibited current or document sources', () => {
    const prior = context([exchange(1, { evidenceRefIds: ['evidence-1'] })]);
    const denied = { complete: false, needResults: [], evidence: [], citations: [] } as const;
    expect(() => projector.project({ scope, context: prior as never, bundle: bundle(), priorGroundedContext: denied })).toThrow();
    expect(() => projector.project({ scope, context: context([]) as never,
      bundle: bundle({ currentRequest: { messageId: 'current', normalizedQuestion: 'Bearer abc' } }) })).toThrow();
    const badDocument = bundle({
      retrieval: { mode: 'RAG', requestedNeeds: [{ id: 'need-1', kind: 'DOCUMENT' }],
        needResults: [{ needId: 'need-1', status: 'COVERED', evidenceRefIds: ['document-1'] }], coverage: 'COMPLETE' },
      evidence: [{ kind: 'DOCUMENT', needId: 'need-1', evidenceRefId: 'document-1', content: 'Bearer abc' }],
      citations: [{ citationId: 'citation-document', evidenceRefId: 'document-1', needId: 'need-1', sourceKind: 'DOCUMENT', safeLabel: 'Doc' }]
    });
    expect(() => projector.project({ scope, context: context([]) as never, bundle: badDocument })).toThrow();
  });
});
