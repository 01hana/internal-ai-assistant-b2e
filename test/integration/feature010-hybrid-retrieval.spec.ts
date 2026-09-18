import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 explicit Hybrid coordination (T060)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterEach(async () => app.close());

  it('executes one declared Tool lane and one RAG lane with COMPLETE coverage', async () => {
    const before = counts();
    await send('req-f010-hybrid-complete', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    expect(counts()).toEqual({ tools: before.tools + 1, retrievals: before.retrievals + 1 });
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid-complete').map((item) => item.sourceType).sort())
      .toEqual(['document_chunk', 'structured_record']);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-hybrid-complete')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'HYBRID', coverage: 'COMPLETE' }));
  });

  it('keeps Tool evidence and reports PARTIAL when the document lane has no evidence', async () => {
    state.knowledgeDocuments.splice(0); state.knowledgeChunks.splice(0);
    await send('req-f010-hybrid-partial', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    const metadata = state.answerDecisions.find((item) => item.requestId === 'req-f010-hybrid-partial')?.metadata;
    expect(metadata).toEqual(expect.objectContaining({ mode: 'HYBRID', coverage: 'PARTIAL' }));
    expect(state.evidenceRefs.filter((item) => item.requestId === 'req-f010-hybrid-partial').map((item) => item.sourceType)).toEqual(['structured_record']);
  });

  function counts() { return { tools: state.toolCalls.length, retrievals: state.retrievalRuns.length }; }
  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }
});
