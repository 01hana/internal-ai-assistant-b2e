import type {
  GroundedContextBundleV1,
  GroundedDocumentEvidence,
  GroundedToolEvidence
} from '../../src/assistant/grounding/grounded-context-bundle.types';
import {
  RETRIEVAL_COVERAGES,
  RETRIEVAL_MODES
} from '../../src/retrieval/grounded-retrieval.types';
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
});
