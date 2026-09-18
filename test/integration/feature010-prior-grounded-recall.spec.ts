import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';
import { AssistantPlanningService } from '../../src/assistant/planning/assistant-planning.service';

describe('Feature 010 current-authorized prior grounded recall (T066)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState());
    state.customerToolPolicies.push({ customerId: 'customer-a', toolDefinitionId: 'tool-definition-inventory-001', enabled: true, requiredRoles: [], requiredPermissionScopes: [] });
  });
  afterEach(async () => app.close());

  it('reuses a complete Hybrid evidence set with zero new lane calls', async () => {
    await send('req-f010-recall-seed', '請查 SKU-DEMO-RED 目前庫存，並依退貨流程 SOP 說明處理方式');
    const ids = evidenceIds('req-f010-recall-seed');
    const before = counts();
    const planning = app.get(AssistantPlanningService);
    const planningSpy = jest.spyOn(planning, 'createPlan');
    await send('req-f010-recall', '把剛才的庫存和 SOP 證據再列一次');
    const canonicalPlan = await planningSpy.mock.results.at(-1)?.value;
    expect(canonicalPlan?.groundedRetrievalPlan).toMatchObject({
      mode: 'HYBRID', needs: [{ kind: 'TOOL' }, { kind: 'DOCUMENT' }]
    });
    expect(counts()).toEqual(before);
    expect(state.answerDecisions.find((item) => item.requestId === 'req-f010-recall')?.metadata)
      .toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE', evidenceIds: ids }));
  });

  it('reuses complete document-only and Tool-only evidence with zero new lane calls', async () => {
    await send('req-f010-doc-seed', '退貨流程 SOP 怎麼說？');
    let before = counts();
    await send('req-f010-doc-recall', '你剛才引用的文件怎麼說？');
    expect(counts()).toEqual(before);
    expect(metadata('req-f010-doc-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE' }));

    await send('req-f010-tool-seed', '請查 SKU-DEMO-RED 目前庫存');
    before = counts();
    await send('req-f010-tool-recall', '你剛說庫存是多少？');
    expect(counts()).toEqual(before);
    expect(metadata('req-f010-tool-recall')).toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY', coverage: 'COMPLETE' }));
  });

  it('re-retrieves document evidence after version change or current access revocation', async () => {
    await send('req-f010-doc-version-seed', '退貨流程 SOP 怎麼說？');
    state.knowledgeDocuments.find((item) => item.id === 'knowledge-document-sop-return-001')!.version = '2.0.0';
    let before = counts();
    await send('req-f010-doc-version', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(before.retrievals + 1);
    expect(metadata('req-f010-doc-version')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));

    await send('req-f010-doc-access-seed', '退貨流程 SOP 怎麼說？');
    state.knowledgeDocuments.find((item) => item.id === 'knowledge-document-sop-return-001')!.requiredPermissionScopes = ['documents:restricted'];
    before = counts();
    await send('req-f010-doc-access', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(before.retrievals + 1);
    expect(metadata('req-f010-doc-access')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  it('does not reuse stale or currently unauthorized Tool evidence', async () => {
    await send('req-f010-tool-stale-seed', '請查 SKU-DEMO-RED 目前庫存');
    const stale = state.evidenceRefs.find((item) => item.requestId === 'req-f010-tool-stale-seed')!;
    stale.timestamp = new Date('2020-01-01T00:00:00.000Z');
    let before = counts();
    await send('req-f010-tool-stale', '你剛說庫存是多少？');
    expect(counts().tools).toBe(before.tools + 1);
    expect(metadata('req-f010-tool-stale')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));

    await send('req-f010-tool-policy-seed', '請查 SKU-DEMO-RED 目前庫存');
    state.customerToolPolicies.find((item) => item.toolDefinitionId === 'tool-definition-inventory-001')!.enabled = false;
    before = counts();
    await send('req-f010-tool-policy', '你剛說庫存是多少？');
    expect(counts().tools).toBe(before.tools);
    expect(metadata('req-f010-tool-policy')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  it('does not reuse evidence for an incompatible semantic need', async () => {
    await send('req-f010-incompatible-seed', '退貨流程 SOP 怎麼說？');
    const priorId = evidenceIds('req-f010-incompatible-seed')[0];
    const before = counts();
    await send('req-f010-incompatible', '公司旅遊補助政策怎麼說？');
    expect(counts().retrievals).toBeGreaterThanOrEqual(before.retrievals);
    expect((metadata('req-f010-incompatible')?.evidenceIds ?? [])).not.toContain(priorId);
    expect(metadata('req-f010-incompatible')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  it('does not reuse a cross-Customer candidate', async () => {
    await send('req-f010-cross-seed', '退貨流程 SOP 怎麼說？');
    state.evidenceRefs.find((item) => item.requestId === 'req-f010-cross-seed')!.customerId = 'customer-b';
    const crossBefore = counts();
    await send('req-f010-cross', '你剛才引用的文件怎麼說？');
    expect(counts().retrievals).toBe(crossBefore.retrievals + 1);
    expect(metadata('req-f010-cross')).not.toEqual(expect.objectContaining({ mode: 'CONTEXT_ONLY' }));
  });

  function counts() { return { tools: state.toolCalls.length, retrievals: state.retrievalRuns.length }; }
  function evidenceIds(requestId: string) { return state.evidenceRefs.filter((item) => item.requestId === requestId).map((item) => item.id); }
  function metadata(requestId: string): any { return state.answerDecisions.find((item) => item.requestId === requestId)?.metadata; }
  function send(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['orders:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'inventory', entityType: 'item', entityId: 'SKU-DEMO-RED', visibleColumns: ['availableQuantity', 'incomingQuantity'] } });
  }
});
