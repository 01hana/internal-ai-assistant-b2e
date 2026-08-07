import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import {
  createInternalIdentityJwtFixture,
  TEST_BACKEND_AUDIENCE,
  TEST_GATEWAY_ISSUER
} from '../support/internal-identity-jwt.helper';

const describeCustomerUs2 = process.env.RUN_CUSTOMER_US2_TESTS === 'true' ? describe : describe.skip;

const customerA = {
  documentId: 'knowledge-document-customer-a-return-001',
  chunkId: 'knowledge-chunk-customer-a-return-001',
  marker: 'CUSTOMER_A_RETURN_RULE'
} as const;
const customerB = {
  documentId: 'knowledge-document-customer-b-return-001',
  chunkId: 'knowledge-chunk-customer-b-return-001',
  marker: 'CUSTOMER_B_PRIVATE_RETURN_RULE'
} as const;
const foreignOnlyCustomerB = {
  documentId: 'knowledge-document-customer-b-foreign-only-001',
  chunkId: 'knowledge-chunk-customer-b-foreign-only-001',
  sourceKey: 'customer-b-foreign-only-return-sop',
  title: 'Foreign-only Return SOP',
  marker: 'CUSTOMER_B_FOREIGN_ONLY_RETURN_RULE'
} as const;

describeCustomerUs2('Customer knowledge retrieval isolation contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    }));
  });

  afterEach(async () => app.close());

  it('keeps repeated sourceKey/version fixtures independently owned by Customer', () => {
    const sharedDocuments = state.knowledgeDocuments.filter(
      (document) => document.sourceKey === 'shared-return-sop' && document.version === '1.0.0'
    );

    expect(sharedDocuments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: customerA.documentId, customerId: 'customer-a' }),
        expect.objectContaining({ id: customerB.documentId, customerId: 'customer-b' })
      ])
    );
    expect(new Set(sharedDocuments.map((document) => document.customerId))).toEqual(new Set(['customer-a', 'customer-b']));
    expect(state.knowledgeChunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: customerA.chunkId, customerId: 'customer-a', documentId: customerA.documentId }),
        expect.objectContaining({ id: customerB.chunkId, customerId: 'customer-b', documentId: customerB.documentId })
      ])
    );
    expect(fixture.canonicalClaims.customerA).toEqual(
      expect.objectContaining({ org_id: 'org-shared', sub: 'actor-shared', host_app: 'erp' })
    );
    expect(fixture.canonicalClaims.customerB).toEqual(
      expect.objectContaining({ org_id: 'org-shared', sub: 'actor-shared', host_app: 'erp' })
    );
  });

  it.each([
    ['customerA', 'session-owned-001', customerA, customerB],
    ['customerB', 'session-hidden-001', customerB, customerA]
  ] as const)('allows %s to materialize only its own matching knowledge', async (customer, sessionId, own, foreign) => {
    const requestId = `req-us2-own-${customer}`;
    const response = await sendKnowledgeQuestion(app, fixture, customer, sessionId, requestId, 'shared return SOP policy');
    const observation = retrievalObservation(state, requestId, response.text);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(observation.selectedChunkIds).toContain(own.chunkId);
    expect(observation.selectedChunkIds).not.toContain(foreign.chunkId);
    expect(observation.evidenceDocumentIds).toContain(own.documentId);
    expect(observation.evidenceDocumentIds).not.toContain(foreign.documentId);
    expect(observation.serializedPublicOutput).not.toContain(foreign.marker);
    expect(observation.serializedPublicOutput).not.toContain(foreign.documentId);
    expect(observation.serializedPublicOutput).not.toContain(foreign.chunkId);
    expect(observation.serializedState).not.toContain(foreign.marker);
    expect(observation.serializedState).not.toContain(foreign.documentId);
    expect(observation.serializedState).not.toContain(foreign.chunkId);
  });

  it('returns safe no-evidence when only Customer B owns the matching source', async () => {
    const requestId = 'req-us2-foreign-only';
    const response = await sendKnowledgeQuestion(
      app,
      fixture,
      'customerA',
      'session-owned-001',
      requestId,
      'foreign-only-return-sop'
    );
    const events = parseSseResponse(response.text);
    const finalData = events.find((event) => event.event === 'final')?.data?.data;
    const observation = retrievalObservation(state, requestId, response.text);

    expect(response.status).toBe(200);
    expect(finalData).toEqual(expect.objectContaining({ answerDecision: 'no_answer', noAnswerReason: 'no_evidence', evidenceRefs: [] }));
    expect(observation.selectedChunkIds).not.toContain(foreignOnlyCustomerB.chunkId);
    expect(observation.evidenceDocumentIds).not.toContain(foreignOnlyCustomerB.documentId);
    expect(observation.serializedPublicOutput).not.toContain(foreignOnlyCustomerB.marker);
    expect(observation.serializedPublicOutput).not.toContain(foreignOnlyCustomerB.documentId);
    expect(observation.serializedPublicOutput).not.toContain(foreignOnlyCustomerB.chunkId);
    expect(observation.serializedPublicOutput).not.toContain(foreignOnlyCustomerB.sourceKey);
    expect(observation.serializedPublicOutput).not.toContain(foreignOnlyCustomerB.title);
    expect(observation.serializedState).not.toContain(foreignOnlyCustomerB.marker);
    expect(observation.serializedState).not.toContain(foreignOnlyCustomerB.documentId);
    expect(observation.serializedState).not.toContain(foreignOnlyCustomerB.chunkId);
    expect(observation.serializedState).not.toContain(foreignOnlyCustomerB.sourceKey);
  });
});

async function sendKnowledgeQuestion(
  app: INestApplication,
  fixture: ReturnType<typeof createInternalIdentityJwtFixture>,
  customer: 'customerA' | 'customerB',
  sessionId: string,
  requestId: string,
  message: string
) {
  return request(app.getHttpServer())
    .post(`/api/v1/assistant/sessions/${sessionId}/messages`)
    .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId }))
    .send({ message, pageContext: { module: 'orders', visibleColumns: ['status'] } });
}

function retrievalObservation(state: Us1TestState, requestId: string, responseText: string) {
  const run = state.retrievalRuns.find((item) => item.requestId === requestId);
  const candidates = state.retrievalCandidates.filter((item) => item.retrievalRunId === run?.id && item.selected);
  const evidence = state.evidenceRefs.filter((item) => item.requestId === requestId && item.sourceType === 'document_chunk');
  const requestAudit = state.auditEvents.filter((item) => item.requestId === requestId);
  const requestDecisions = state.answerDecisions.filter((item) => item.requestId === requestId);

  return {
    selectedChunkIds: candidates.map((item) => item.chunkId),
    evidenceDocumentIds: evidence.map((item) => item.documentId),
    serializedPublicOutput: JSON.stringify({ responseText, events: parseSseResponse(responseText) }),
    serializedState: JSON.stringify({
      selectedCandidates: candidates,
      evidenceRefs: evidence,
      answerDecision: requestDecisions,
      auditEvents: requestAudit
    })
  };
}
