import type {
  GroundedCitation,
  GroundedContextBundleV1,
  GroundedDocumentEvidence,
  GroundedToolEvidence
} from '../../src/assistant/grounding/grounded-context-bundle.types';
import {
  RETRIEVAL_COVERAGES,
  RETRIEVAL_MODES
} from '../../src/retrieval/grounded-retrieval.types';
import { GroundedContextBundleService } from '../../src/assistant/grounding/grounded-context-bundle.service';
import type {
  DocumentRetrievalNeed,
  GroundedRetrievalNeedResult,
  RetrievalNeed,
  ToolRetrievalNeed,
  UnsupportedRetrievalNeed
} from '../../src/retrieval/grounded-retrieval.types';

type AssertNever<T extends never> = T;
type ForbiddenAuthorityKey =
  | 'operationKey'
  | 'toolDefinitionId'
  | 'connector'
  | 'adapter'
  | 'credentials'
  | 'permissionResult'
  | 'rawResponse'
  | 'preProjectionData';
type _DocumentAuthorityBoundary = AssertNever<Extract<keyof DocumentRetrievalNeed, ForbiddenAuthorityKey>>;
type _ToolAuthorityBoundary = AssertNever<Extract<keyof ToolRetrievalNeed, ForbiddenAuthorityKey | 'canonicalToolKey'>>;
type _UnsupportedAuthorityBoundary = AssertNever<Extract<keyof UnsupportedRetrievalNeed, ForbiddenAuthorityKey>>;

describe('Feature 010 GroundedContextBundleV1 contract (T026)', () => {
  it('fixes the canonical retrieval modes and coverage states', () => {
    expect(RETRIEVAL_MODES).toEqual(['CONTEXT_ONLY', 'RAG', 'TOOL', 'HYBRID', 'CLARIFY', 'INSUFFICIENT']);
    expect(RETRIEVAL_COVERAGES).toEqual(['COMPLETE', 'PARTIAL', 'INSUFFICIENT', 'CLARIFY']);
  });

  it('keeps requested need identity distinct from linked result identity', () => {
    const needs: readonly RetrievalNeed[] = [
      { id: 'need-document', kind: 'DOCUMENT', query: 'travel policy', topicKey: 'travel' },
      { id: 'need-tool', kind: 'TOOL', frame: {} },
      { id: 'need-unsupported', kind: 'UNSUPPORTED', reasonCode: 'UNSUPPORTED_NEED' }
    ];
    const results: readonly GroundedRetrievalNeedResult[] = needs.map((need) => ({
      needId: need.id,
      status: need.kind === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'COVERED',
      evidenceRefIds: need.kind === 'UNSUPPORTED' ? [] : [`evidence-${need.id}`]
    }));
    expect(needs.map((need) => need.id)).toEqual(results.map((result) => result.needId));
    expect(needs.every((need) => !Object.hasOwn(need, 'needId'))).toBe(true);
    expect(results.every((result) => !Object.hasOwn(result, 'id'))).toBe(true);
  });

  it('exposes complete document provenance and only projected Tool evidence fields', () => {
    const document: GroundedDocumentEvidence = {
      kind: 'DOCUMENT', evidenceRefId: 'evidence-document', needId: 'need-document', content: 'policy',
      title: 'Travel policy', documentId: 'document-1', chunkId: 'chunk-1', documentVersion: 'v1',
      sourceKey: 'travel-policy', observedAt: '2026-09-17T00:00:00.000Z', trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE'
    };
    const tool: GroundedToolEvidence = {
      kind: 'TOOL', evidenceRefId: 'evidence-tool', needId: 'need-tool', toolCallId: 'tool-call-1',
      canonicalToolKey: 'inventory.stock-on-hand', projectedFacts: { quantity: 17 },
      fieldPaths: ['quantity'], observedAt: '2026-09-17T00:00:00.000Z'
    };
    expect(document).toMatchObject({ documentId: 'document-1', chunkId: 'chunk-1', documentVersion: 'v1' });
    expect(tool).toMatchObject({ projectedFacts: { quantity: 17 }, fieldPaths: ['quantity'] });
    expect(tool).not.toHaveProperty('rawResponse');
    expect(tool).not.toHaveProperty('preProjectionData');
  });

  it('provides the complete safe Feature 011 consumer view with separate citations', () => {
    const bundle: GroundedContextBundleV1 = {
      version: '1',
      currentRequest: { messageId: 'message-1', normalizedQuestion: 'policy?' },
      conversationContext: { boundedRecentTurns: [] },
      retrieval: {
        mode: 'RAG', requestedNeeds: [{ id: 'need-1', kind: 'DOCUMENT', query: 'policy' }],
        needResults: [{ needId: 'need-1', status: 'COVERED', evidenceRefIds: ['evidence-1'] }],
        coverage: 'COMPLETE'
      },
      evidence: [{
        kind: 'DOCUMENT', evidenceRefId: 'evidence-1', needId: 'need-1', content: 'policy', title: 'Policy',
        documentId: 'document-1', chunkId: 'chunk-1', documentVersion: 'v1', sourceKey: 'policy',
        observedAt: '2026-09-17T00:00:00.000Z', trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE'
      }],
      citations: [{ citationId: 'citation-1', evidenceRefId: 'evidence-1', needId: 'need-1', sourceKind: 'DOCUMENT', safeLabel: 'Policy' }],
      unsupportedNeeds: [],
      locale: 'zh-TW'
    };
    expect(bundle).toMatchObject({ version: '1', retrieval: { mode: 'RAG', coverage: 'COMPLETE' }, locale: 'zh-TW' });
    expect(bundle.evidence[0]).not.toHaveProperty('citations');
    expect(bundle.citations[0]).toMatchObject({ evidenceRefId: 'evidence-1', needId: 'need-1' });
  });

  it('keeps the contract deeply readonly at compile time', () => {
    const compileOnly = (bundle: GroundedContextBundleV1) => {
      // @ts-expect-error contract root is readonly
      bundle.locale = 'en';
      // @ts-expect-error requested needs are readonly
      bundle.retrieval.requestedNeeds.push({ id: 'unsafe', kind: 'UNSUPPORTED', reasonCode: 'unsafe' });
      // @ts-expect-error nested request fields are readonly
      bundle.currentRequest.messageId = 'other';
    };
    expect(typeof compileOnly).toBe('function');
  });

  it.each([
    ['RAG', ['DOCUMENT'], ['COVERED'], 'COMPLETE'],
    ['TOOL', ['TOOL'], ['COVERED'], 'COMPLETE'],
    ['HYBRID', ['DOCUMENT', 'TOOL'], ['COVERED', 'COVERED'], 'COMPLETE'],
    ['HYBRID', ['DOCUMENT', 'TOOL'], ['COVERED', 'FAILED'], 'PARTIAL'],
    ['CONTEXT_ONLY', ['DOCUMENT', 'TOOL'], ['COVERED', 'COVERED'], 'COMPLETE'],
    ['INSUFFICIENT', ['DOCUMENT'], ['UNSUPPORTED'], 'INSUFFICIENT'],
    ['CLARIFY', ['UNSUPPORTED'], ['CLARIFY'], 'CLARIFY']
  ] as const)('assembles %s with exact requested-need/result linkage and %s coverage', (mode, kinds, statuses, coverage) => {
    const service = new GroundedContextBundleService();
    const requestedNeeds = kinds.map((kind, index): RetrievalNeed => kind === 'DOCUMENT'
      ? { id: `need-${index + 1}`, kind, query: `query-${index + 1}`, topicKey: `topic-${index + 1}` }
      : kind === 'TOOL'
        ? { id: `need-${index + 1}`, kind, frame: { topicKey: `topic-${index + 1}` } }
        : { id: `need-${index + 1}`, kind, reasonCode: 'CLARIFICATION_REQUIRED' });
    const needResults = statuses.map((status, index): GroundedRetrievalNeedResult => ({
      needId: `need-${index + 1}`, status,
      evidenceRefIds: status === 'COVERED' ? [`evidence-${index + 1}`] : [],
      ...(status === 'COVERED' ? {} : { reasonCode: status === 'CLARIFY' ? 'CLARIFICATION_REQUIRED' : 'EVIDENCE_UNAVAILABLE' })
    }));
    const evidence: Array<GroundedDocumentEvidence | GroundedToolEvidence> = [];
    requestedNeeds.forEach((need, index) => {
      if (statuses[index] !== 'COVERED') return;
      if (need.kind === 'DOCUMENT') evidence.push({ kind: 'DOCUMENT', evidenceRefId: `evidence-${index + 1}`, needId: need.id,
        content: 'safe', title: 'Safe', documentId: `document-${index + 1}`, chunkId: `chunk-${index + 1}`,
        documentVersion: 'v1', sourceKey: `source-${index + 1}`, observedAt: '2026-09-18T00:00:00.000Z',
        trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE' });
      if (need.kind === 'TOOL') evidence.push({ kind: 'TOOL', evidenceRefId: `evidence-${index + 1}`, needId: need.id,
        toolCallId: `call-${index + 1}`, canonicalToolKey: 'inventory.stock-on-hand', projectedFacts: { quantity: 17 },
        fieldPaths: ['quantity'], observedAt: '2026-09-18T00:00:00.000Z' });
    });
    const citations: GroundedCitation[] = evidence.map((item, index) => ({ citationId: `citation-${index + 1}`, evidenceRefId: item.evidenceRefId,
      needId: item.needId, sourceKind: item.kind, safeLabel: 'Safe' }));
    const bundle = service.assemble({ currentRequest: { messageId: 'message-1', normalizedQuestion: 'safe request' },
      locale: 'zh-TW', mode, requestedNeeds, needResults, evidence, citations });
    expect(bundle.retrieval).toMatchObject({ mode, coverage });
    expect(bundle.retrieval.requestedNeeds.map((need) => need.id)).toEqual(bundle.retrieval.needResults.map((result) => result.needId));
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.retrieval.requestedNeeds)).toBe(true);
    expect(bundle.unsupportedNeeds.map((item) => item.needId)).toEqual(needResults.filter((item) => item.status !== 'COVERED').map((item) => item.needId));
  });

  it.each(['operationKey', 'toolDefinitionId', 'connector', 'connectorKey', 'adapter', 'adapterKey', 'deploymentKey',
    'credentials', 'secret', 'token', 'Authorization', 'proof', 'permissionResult', 'permissionSnapshot', 'rawResponse',
    'preProjectionData', 'transientConnectorContext', 'execute', 'retry', 'nextPlan', 'childPlan'])(
    'rejects prohibited authority field %s at every bundle boundary', (key) => {
    const service = new GroundedContextBundleService();
    expect(() => service.assemble({ currentRequest: { messageId: 'message-1', normalizedQuestion: 'safe', [key]: 'sentinel' },
      locale: 'zh-TW', mode: 'INSUFFICIENT', requestedNeeds: [], needResults: [], evidence: [], citations: [] })).toThrow(/Prohibited authority field/);
    }
  );

  it('allows canonicalToolKey only inside normalized Tool evidence', () => {
    const service = new GroundedContextBundleService();
    expect(() => service.assemble({ currentRequest: { messageId: 'message-1', normalizedQuestion: 'safe', canonicalToolKey: 'unsafe' },
      locale: 'zh-TW', mode: 'INSUFFICIENT', requestedNeeds: [], needResults: [], evidence: [], citations: [] })).toThrow(/canonicalToolKey/);
  });

  it('provides the exact safe Feature 011 handoff and complete need-to-citation linkage', () => {
    const service = new GroundedContextBundleService();
    const resolvedFrame = { topicKey: 'expense-reimbursement-policy', resource: {
      value: 'expenseReimbursement', source: 'inherited' as const, sourceMessageId: 'message-prior', confidence: 0.98
    } };
    const recentTurn = { exchangeId: 'exchange-1', requestId: 'request-prior', userMessageId: 'message-prior',
      assistantMessageId: 'message-prior-answer', createdAt: '2026-09-18T00:00:00.000Z', semanticFrame: resolvedFrame,
      evidenceRefIds: ['evidence-document'] };
    const bundle = service.assemble({
      currentRequest: { messageId: 'message-current', normalizedQuestion: 'expense deadline?', resolvedFrame },
      boundedRecentTurns: [recentTurn], locale: 'zh-TW', mode: 'HYBRID',
      requestedNeeds: [
        { id: 'need-document', kind: 'DOCUMENT', query: 'expense deadline', topicKey: 'expense-reimbursement-policy' },
        { id: 'need-tool', kind: 'TOOL', frame: { topicKey: 'inventory' } }
      ],
      needResults: [
        { needId: 'need-document', status: 'COVERED', evidenceRefIds: ['evidence-document'] },
        { needId: 'need-tool', status: 'COVERED', evidenceRefIds: ['evidence-tool'] }
      ],
      evidence: [
        { kind: 'DOCUMENT', needId: 'need-document', evidenceRefId: 'evidence-document', content: 'safe policy', title: 'Expense policy',
          documentId: 'document-1', chunkId: 'chunk-1', documentVersion: 'v3', sourceKey: 'expense-reimbursement-policy',
          observedAt: '2026-09-18T00:00:00.000Z', trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE' },
        { kind: 'TOOL', needId: 'need-tool', evidenceRefId: 'evidence-tool', toolCallId: 'tool-call-1',
          canonicalToolKey: 'inventory.stock-on-hand', projectedFacts: { availableQuantity: 17 }, fieldPaths: ['availableQuantity'],
          observedAt: '2026-09-18T00:00:01.000Z' }
      ],
      citations: [
        { citationId: 'citation-document', needId: 'need-document', evidenceRefId: 'evidence-document', sourceKind: 'DOCUMENT', safeLabel: 'Expense policy' },
        { citationId: 'citation-tool', needId: 'need-tool', evidenceRefId: 'evidence-tool', sourceKind: 'TOOL', safeLabel: 'inventory.stock-on-hand' }
      ]
    });
    expect(bundle).toEqual({ version: '1', currentRequest: { messageId: 'message-current', normalizedQuestion: 'expense deadline?', resolvedFrame },
      conversationContext: { boundedRecentTurns: [recentTurn] }, retrieval: { mode: 'HYBRID', requestedNeeds: expect.any(Array),
        needResults: expect.any(Array), coverage: 'COMPLETE' }, evidence: expect.any(Array), citations: expect.any(Array),
      unsupportedNeeds: [], locale: 'zh-TW' });
    for (const need of bundle.retrieval.requestedNeeds) {
      const result = bundle.retrieval.needResults.find((item) => item.needId === need.id)!;
      for (const evidenceRefId of result.evidenceRefIds) {
        const evidence = bundle.evidence.find((item) => item.needId === need.id && item.evidenceRefId === evidenceRefId)!;
        expect(bundle.citations).toContainEqual(expect.objectContaining({ needId: need.id, evidenceRefId, sourceKind: evidence.kind }));
      }
    }
    expect(bundle.evidence.find((item) => item.kind === 'DOCUMENT')).toEqual(expect.objectContaining({ documentId: 'document-1',
      chunkId: 'chunk-1', documentVersion: 'v3', sourceKey: 'expense-reimbursement-policy' }));
    expect(bundle.evidence.find((item) => item.kind === 'TOOL')).toEqual(expect.objectContaining({ toolCallId: 'tool-call-1',
      canonicalToolKey: 'inventory.stock-on-hand', projectedFacts: { availableQuantity: 17 }, fieldPaths: ['availableQuantity'] }));
  });
});
