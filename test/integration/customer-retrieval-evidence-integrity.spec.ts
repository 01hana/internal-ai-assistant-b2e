import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  Us1TestState
} from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

const describeCustomerUs2 = process.env.RUN_CUSTOMER_US2_TESTS === 'true' ? describe : describe.skip;

describeCustomerUs2('Customer-qualified retrieval and evidence integrity contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Awaited<ReturnType<typeof createUs1TestAppWithState>>['prismaMock'];

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks }
    }));
  });

  afterEach(async () => app.close());

  it('persists RetrievalRun, all candidates, and EvidenceRef with canonical Customer ownership and qualified parents', async () => {
    const requestId = 'req-us2-integrity-owned';
    const response = await sendDocumentQuestion(app, fixture, 'customerA', 'session-owned-001', requestId, 'shared return SOP policy');
    const run = state.retrievalRuns.find((item) => item.requestId === requestId);
    const candidates = state.retrievalCandidates.filter((item) => item.retrievalRunId === run?.id);
    const evidence = state.evidenceRefs.filter((item) => item.requestId === requestId && item.sourceType === 'document_chunk');
    const retrievalRunCreate = prismaMock.retrievalRun.create.mock.calls.at(-1)?.[0]?.data;
    const candidateCreates = prismaMock.retrievalCandidate.create.mock.calls.map(([input]) => input.data);
    const evidenceCreates = prismaMock.evidenceRef.create.mock.calls.map(([input]) => input.data);

    expect(response.status).toBe(200);
    expect(run).toEqual(expect.objectContaining({ customerId: 'customer-a', messageId: expect.any(String) }));
    expect(retrievalRunCreate).toEqual(expect.objectContaining({ customerId: 'customer-a' }));
    expect(candidates).not.toHaveLength(0);
    expect(candidates.every((candidate) => candidate.customerId === 'customer-a')).toBe(true);
    expect(candidateCreates).toEqual(expect.arrayContaining([expect.objectContaining({ customerId: 'customer-a', retrievalRunId: run?.id })]));
    expect(evidence).not.toHaveLength(0);
    expect(evidence.every((item) => item.customerId === 'customer-a')).toBe(true);
    expect(evidenceCreates).toEqual(expect.arrayContaining([expect.objectContaining({ customerId: 'customer-a', messageId: expect.any(String), documentId: expect.any(String), chunkId: expect.any(String) })]));
  });

  it.each([
    ['customerA', 'session-hidden-001'],
    ['customerB', 'session-owned-001']
  ] as const)('does not leave retrieval/evidence records when %s attempts a foreign parent traversal', async (customer, foreignSessionId) => {
    const before = recordCounts(state);
    const response = await sendDocumentQuestion(app, fixture, customer, foreignSessionId, `req-us2-integrity-${customer}-foreign`, 'shared return SOP policy');

    expect(response.status).toBe(404);
    expect(recordCounts(state)).toEqual(before);
    expect(response.text).not.toContain('event:');
  });

  it('uses Customer-qualified evidence reads for history mapping instead of a bare message relation', async () => {
    const requestId = 'req-us2-integrity-history';
    await sendDocumentQuestion(app, fixture, 'customerA', 'session-owned-001', requestId, 'shared return SOP policy');
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: `${requestId}-history` }));
    const evidenceQueries = prismaMock.evidenceRef.findMany.mock.calls.map(([input]) => input.where);

    expect(response.status).toBe(200);
    expect(evidenceQueries).toEqual(expect.arrayContaining([expect.objectContaining({ customerId: 'customer-a' })]));
  });
});

async function sendDocumentQuestion(
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

function recordCounts(state: Us1TestState) {
  return {
    retrievalRuns: state.retrievalRuns.length,
    retrievalCandidates: state.retrievalCandidates.length,
    evidenceRefs: state.evidenceRefs.length
  };
}
