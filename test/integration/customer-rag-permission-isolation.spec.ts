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

describeCustomerUs2('Customer RAG access-policy isolation contract', () => {
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

  it('allows CUSTOMER visibility across Organizations in the same Customer but excludes ORGANIZATION-only candidates before ranking', async () => {
    const requestId = 'req-us2-customer-wide-alt-org';
    const response = await ask(
      app,
      fixture,
      PHASE5_RAG_FIXTURE_IDS.sessions.alternateOrganization,
      requestId,
      { org_id: 'org-customer-a-alt' },
      `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.customerWide.marker} ${PHASE5_RAG_FIXTURE_IDS.organizationOnly.marker}`
    );
    const observation = observe(state, requestId, response.text);

    expect(observation.allCandidateChunkIds).toContain(PHASE5_RAG_FIXTURE_IDS.customerWide.chunkId);
    expect(observation.allCandidateChunkIds).not.toContain(PHASE5_RAG_FIXTURE_IDS.organizationOnly.chunkId);
    expect(observation.selectedChunkIds).not.toContain(PHASE5_RAG_FIXTURE_IDS.organizationOnly.chunkId);
    expectNoDisclosure(observation, PHASE5_RAG_FIXTURE_IDS.organizationOnly);
  });

  it('allows ORGANIZATION visibility only for the canonical allowlisted Organization', async () => {
    const requestId = 'req-us2-organization-allowlisted';
    const response = await ask(app, fixture, 'session-owned-001', requestId, {}, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.organizationOnly.marker}`);
    const observation = observe(state, requestId, response.text);

    expect(response.status).toBe(200);
    expect(observation.allCandidateChunkIds).toContain(PHASE5_RAG_FIXTURE_IDS.organizationOnly.chunkId);
    expect(observation.selectedChunkIds).toContain(PHASE5_RAG_FIXTURE_IDS.organizationOnly.chunkId);
  });

  it('requires every requiredPermissionScope before a candidate may materialize', async () => {
    const requestId = 'req-us2-all-scopes-denied';
    const response = await ask(app, fixture, 'session-owned-001', requestId, { permission_scopes: ['orders:read'] }, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.allScopes.marker}`);
    const observation = observe(state, requestId, response.text);

    expectSafeNoEvidence(response.text);
    expect(observation.allCandidateChunkIds).not.toContain(PHASE5_RAG_FIXTURE_IDS.allScopes.chunkId);
    expectNoDisclosure(observation, PHASE5_RAG_FIXTURE_IDS.allScopes);
  });

  it('permits a document with empty requiredPermissionScopes for a verified identity with no scopes', async () => {
    const requestId = 'req-us2-empty-scopes';
    const response = await ask(app, fixture, 'session-owned-001', requestId, { permission_scopes: [] }, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.emptyScopes.marker}`);
    const observation = observe(state, requestId, response.text);

    expect(response.status).toBe(200);
    expect(observation.selectedChunkIds).toContain(PHASE5_RAG_FIXTURE_IDS.emptyScopes.chunkId);
  });

  it('does not use HostApp as a knowledge visibility boundary', async () => {
    const requestId = 'req-us2-host-app-not-visibility';
    const response = await ask(
      app,
      fixture,
      PHASE5_RAG_FIXTURE_IDS.sessions.alternateHostApp,
      requestId,
      { host_app: 'warehouse' },
      `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.customerWide.marker}`
    );
    const observation = observe(state, requestId, response.text);

    expect(response.status).toBe(200);
    expect(observation.selectedChunkIds).toContain(PHASE5_RAG_FIXTURE_IDS.customerWide.chunkId);
  });

  it('denies invalid legacy policy before candidate selection without disclosure', async () => {
    const requestId = 'req-us2-invalid-legacy-policy';
    const response = await ask(app, fixture, 'session-owned-001', requestId, {}, `shared return SOP policy ${PHASE5_RAG_FIXTURE_IDS.invalidLegacy.marker}`);
    const observation = observe(state, requestId, response.text);

    expectSafeNoEvidence(response.text);
    expect(observation.allCandidateChunkIds).not.toContain(PHASE5_RAG_FIXTURE_IDS.invalidLegacy.chunkId);
    expectNoDisclosure(observation, PHASE5_RAG_FIXTURE_IDS.invalidLegacy);
  });
});

async function ask(
  app: INestApplication,
  fixture: ReturnType<typeof createInternalIdentityJwtFixture>,
  sessionId: string,
  requestId: string,
  claims: Record<string, unknown>,
  message: string
) {
  return request(app.getHttpServer())
    .post(`/api/v1/assistant/sessions/${sessionId}/messages`)
    .set(createAuthorizedInternalIdentityHeaders(fixture, { claims, requestId }))
    .send({ message, pageContext: { module: 'orders', visibleColumns: ['status'] } });
}

function observe(state: Us1TestState, requestId: string, responseText: string) {
  const run = state.retrievalRuns.find((item) => item.requestId === requestId);
  const candidates = state.retrievalCandidates.filter((item) => item.retrievalRunId === run?.id);
  const evidence = state.evidenceRefs.filter((item) => item.requestId === requestId && item.sourceType === 'document_chunk');
  return {
    allCandidateChunkIds: candidates.map((item) => item.chunkId),
    selectedChunkIds: candidates.filter((item) => item.selected).map((item) => item.chunkId),
    serialized: JSON.stringify({
      response: responseText,
      events: parseSseResponse(responseText),
      allCandidates: candidates,
      selectedCandidates: candidates.filter((item) => item.selected),
      evidenceRefs: evidence,
      answerDecisions: state.answerDecisions.filter((item) => item.requestId === requestId),
      // The query is caller-controlled input, not retrieved knowledge. Exclude it
      // from this disclosure observation so a caller cannot make its own marker
      // look like a forbidden-document leak.
      retrievalRuns: run ? [withoutCallerQuery(run)] : [],
      auditEvents: state.auditEvents.filter((item) => item.requestId === requestId)
    })
  };
}

function withoutCallerQuery(run: { query: string; normalizedQuery: string | null }) {
  const { query: _query, normalizedQuery: _normalizedQuery, ...safeRun } = run;
  return safeRun;
}

function expectSafeNoEvidence(responseText: string) {
  const finalData = parseSseResponse(responseText).find((event) => event.event === 'final')?.data?.data;
  expect(finalData).toEqual(expect.objectContaining({ answerDecision: 'no_answer', noAnswerReason: 'no_evidence', evidenceRefs: [] }));
}

function expectNoDisclosure(
  observation: { serialized: string },
  fixture: { documentId: string; chunkId: string; marker: string }
) {
  expect(observation.serialized).not.toContain(fixture.documentId);
  expect(observation.serialized).not.toContain(fixture.chunkId);
  expect(observation.serialized).not.toContain(fixture.marker);
}
