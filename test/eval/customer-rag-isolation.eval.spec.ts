import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { PHASE5_RAG_FIXTURE_IDS, installPhase5CustomerRagFixtures } from '../support/customer-rag-phase5-fixtures';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const describeCustomerUs2 = process.env.RUN_CUSTOMER_US2_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs2('Customer RAG isolation eval contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    }));
    installPhase5CustomerRagFixtures(state);
  });

  afterEach(async () => app.close());

  it('keeps the existing own-Customer SOP answer and evidence path functional', async () => {
    const response = await send(app, fixture, 'customerA', 'session-owned-001', 'req-us2-eval-own-sop', '退貨流程 SOP 怎麼說？');
    const finalData = final(response.text);

    expect(response.status).toBe(200);
    expect(finalData).toEqual(expect.objectContaining({ answerDecision: 'answered', evidenceRefs: expect.arrayContaining([expect.any(String)]) }));
    expect(JSON.stringify(state.evidenceRefs.filter((item) => item.sourceType === 'document_chunk'))).not.toContain('CUSTOMER_B_PRIVATE_RETURN_RULE');
  });

  it('treats foreign-only knowledge as the same safe no-evidence outcome as a truly empty query', async () => {
    const foreignResponse = await send(app, fixture, 'customerA', 'session-owned-001', 'req-us2-eval-foreign-only', 'foreign-only-return-sop');
    const emptyResponse = await send(app, fixture, 'customerA', 'session-owned-001', 'req-us2-eval-empty', 'manual quantum flux calibration');
    const foreignFinal = final(foreignResponse.text);
    const emptyFinal = final(emptyResponse.text);
    const foreignState = JSON.stringify(recordsForRequest(state, 'req-us2-eval-foreign-only'));

    expect(foreignFinal).toEqual(expect.objectContaining({ answerDecision: 'no_answer', noAnswerReason: 'no_evidence', evidenceRefs: [] }));
    expect(foreignFinal).toEqual(emptyFinal);
    expect(foreignState).not.toContain('CUSTOMER_B_FOREIGN_ONLY_RETURN_RULE');
    expect(foreignState).not.toContain('knowledge-document-customer-b-foreign-only-001');
    expect(foreignState).not.toContain('knowledge-chunk-customer-b-foreign-only-001');
  });

  it('treats invalid legacy policy as safe no-evidence and never produces a grounded answer', async () => {
    const response = await send(app, fixture, 'customerA', 'session-owned-001', 'req-us2-eval-invalid-policy', `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.invalidLegacy.marker}`);
    const finalData = final(response.text);
    const serialized = JSON.stringify(recordsForRequest(state, 'req-us2-eval-invalid-policy'));

    expect(finalData).toEqual(expect.objectContaining({ answerDecision: 'no_answer', noAnswerReason: 'no_evidence', evidenceRefs: [] }));
    expect(serialized).not.toContain(PHASE5_RAG_FIXTURE_IDS.invalidLegacy.marker);
    expect(serialized).not.toContain(PHASE5_RAG_FIXTURE_IDS.invalidLegacy.documentId);
    expect(serialized).not.toContain(PHASE5_RAG_FIXTURE_IDS.invalidLegacy.chunkId);
  });
});

async function send(
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

function final(responseText: string) {
  return parseSseResponse(responseText).find((event) => event.event === 'final')?.data?.data;
}

function recordsForRequest(state: Us1TestState, requestId: string) {
  return {
    // The raw query is caller-controlled input rather than retrieved knowledge.
    retrievalRuns: state.retrievalRuns
      .filter((item) => item.requestId === requestId)
      .map(({ query: _query, normalizedQuery: _normalizedQuery, ...run }) => run),
    retrievalCandidates: state.retrievalCandidates,
    evidenceRefs: state.evidenceRefs.filter((item) => item.requestId === requestId),
    answerDecisions: state.answerDecisions.filter((item) => item.requestId === requestId),
    auditEvents: state.auditEvents.filter((item) => item.requestId === requestId)
  };
}
