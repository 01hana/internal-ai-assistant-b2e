import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 current-authorized prior grounded recall (T066)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterAll(async () => app.close());

  it('reuses a complete Hybrid evidence set with zero new lane calls', async () => {
    await send('req-f010-recall-seed', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    const ids = evidenceIds('req-f010-recall-seed');
    const before = counts();
    await send('req-f010-recall', '把剛才的庫存和 SOP 證據再列一次');
    expect(counts()).toEqual(before);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-recall')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE', evidenceIds: ids }));
  });

  function counts() { return { tools: state.toolCalls.length, retrievals: state.retrievalRuns.length }; }
  function evidenceIds(requestId: string) { return state.evidenceRefs.filter((item) => item.requestId === requestId).map((item) => item.id); }
  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }
});
