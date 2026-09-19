import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import type { DataAdapter } from '../../src/connectors/data-adapter.interface';
import { ConversationContextLoaderService } from '../../src/assistant/conversation/conversation-context-loader.service';
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  parseSseResponse,
  Us1TestState
} from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('Feature 010 semantic follow-up routing (T037-T042)', () => {
  let app: INestApplication;
  let state: Us1TestState;
  const businessAdapter = customerBBusinessAdapter();

  beforeEach(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      dataAdapterRegistrationsFactory: ({ mockRegistrations }) => Object.freeze([
        ...mockRegistrations,
        Object.freeze({ adapter: businessAdapter, connectorKey: 'business', customerId: 'customer-b', integrationId: 'integration-erp', hostApp: 'erp', active: true })
      ])
    }));
    state.customerToolPolicies.push({
      customerId: 'customer-b', toolDefinitionId: 'tool-definition-customer-b-stock-001', enabled: true,
      requiredRoles: [], requiredPermissionScopes: ['inventory:read']
    });
  });

  afterEach(async () => app.close());

  it('replaces the travel-policy aspect and re-enters RAG exactly once', async () => {
    await sendA('req-f010-p4-doc-seed', '公司員工旅遊補助規定是什麼？', { module: 'hr', visibleColumns: [] });
    const context = await loadAContext();
    expect(context.semanticFrames.at(-1)).toMatchObject({ resource: { value: 'travelSubsidyPolicy' }, metricOrAspect: { value: 'policyOverview' } });
    const before = counts();
    await sendA('req-f010-p4-doc-followup', '那申請期限呢？', { module: 'hr', visibleColumns: [] });
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns + 1);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
    expect(resolutionAudit('req-f010-p4-doc-followup')).toMatchObject({ kind: 'REPLACE', replacedDimensions: ['metricOrAspect'] });
    expect(planningAudit('req-f010-p4-doc-followup')).toMatchObject({ retrievalMode: 'RAG', retrievalReasonCode: 'RETRIEVAL_ROUTE_SELECTED' });
  });

  it('clarifies vague deixis without retrieval or Tool execution', async () => {
    await sendA('req-f010-p4-vague-seed', '公司員工旅遊補助規定是什麼？', { module: 'hr', visibleColumns: [] });
    const before = counts();
    const response = await sendA('req-f010-p4-vague', '那個呢？', { module: 'hr', visibleColumns: [] });
    expect(counts()).toEqual(before);
    expect(parseSseResponse(response.text).at(-1)?.data?.data?.answerDecision).toBe('clarification_required');
    expect(resolutionAudit('req-f010-p4-vague')).toMatchObject({ kind: 'CLARIFY', reasonCode: 'VAGUE_DEIXIS' });
    expect(planningAudit('req-f010-p4-vague')).toMatchObject({ retrievalMode: 'CLARIFY' });
  });

  it('replaces Customer B SKU and executes one newly discovered, currently authorized ToolCall', async () => {
    await sendB('req-f010-p4-sku-seed', '請查 SKU-B-001 庫存');
    const before = counts();
    const response = await sendB('req-f010-p4-sku-followup', 'SKU-B-002 呢？');
    expect(response.status).toBe(200);
    expect(state.toolCalls).toHaveLength(before.toolCalls + 1);
    expect(state.retrievalRuns).toHaveLength(before.retrievalRuns);
    expect(state.toolCalls.at(-1)).toMatchObject({
      customerId: 'customer-b', requestId: 'req-f010-p4-sku-followup', toolName: 'inventory.stock-on-hand',
      inputSummary: expect.objectContaining({ canonicalToolKey: 'inventory.stock-on-hand' }), status: 'success', executionStatus: 'executed'
    });
    expect(businessAdapter.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      requestId: 'req-f010-p4-sku-followup', operation: expect.objectContaining({ arguments: { sku: 'SKU-B-002' } })
    }));
    expect(resolutionAudit('req-f010-p4-sku-followup')).toMatchObject({ kind: 'REPLACE', replacedDimensions: ['entity'] });
    expect(planningAudit('req-f010-p4-sku-followup')).toMatchObject({ retrievalMode: 'TOOL' });
  });

  it('resolves last_month but clarifies unsupported capability with zero execution', async () => {
    await sendA('req-f010-p4-month-seed', '請查這個月新增工單數', { module: 'work-orders', visibleColumns: ['createdAt'] });
    const before = counts();
    const response = await sendA('req-f010-p4-month-followup', '上個月呢？', { module: 'work-orders', visibleColumns: ['createdAt'] });
    expect(counts()).toEqual(before);
    expect(parseSseResponse(response.text).at(-1)?.data?.data?.answerDecision).toBe('clarification_required');
    expect(resolutionAudit('req-f010-p4-month-followup')).toMatchObject({ kind: 'REPLACE', replacedDimensions: ['timeRange'] });
    expect(planningAudit('req-f010-p4-month-followup')).toMatchObject({ retrievalMode: 'INSUFFICIENT', retrievalReasonCode: 'RETRIEVAL_NEEDS_INSUFFICIENT' });
  });

  function counts() { return { retrievalRuns: state.retrievalRuns.length, toolCalls: state.toolCalls.length }; }
  function resolutionAudit(requestId: string) { return state.auditEvents.find((event) => event.requestId === requestId && event.eventType === 'conversation_followup_resolved')?.metadata; }
  function planningAudit(requestId: string) { return state.auditEvents.find((event) => event.requestId === requestId && event.eventType === 'execution_plan_created')?.metadata; }
  function loadAContext() {
    return app.get(ConversationContextLoaderService).load({ scope: { customerId: 'customer-a', sessionId: 'session-owned-001', organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared' } });
  }
  function sendA(requestId: string, message: string, pageContext: Record<string, unknown>) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerA, permission_scopes: ['menu:SCM_DASHBOARD:read', 'inventory:read'] }, requestId
      })).send({ message, pageContext });
  }
  function sendB(requestId: string, message: string) {
    return request(app.getHttpServer()).post('/api/v1/assistant/sessions/session-hidden-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
        claims: { ...DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE.canonicalClaims.customerB, permission_scopes: ['inventory:read'] }, requestId
      })).send({ message, pageContext: { module: 'inventory', entityType: 'item', visibleColumns: ['quantity'] } });
  }
});

function customerBBusinessAdapter(): DataAdapter & { execute: jest.Mock } {
  const execute = jest.fn(async (input) => ({
    toolKey: input.operation.canonicalToolKey, status: 'succeeded' as const,
    data: { sku: input.operation.arguments.sku, quantity: input.operation.arguments.sku === 'SKU-B-002' ? 31 : 23 }
  }));
  return {
    key: 'business', execute,
    metadata: { adapterKey: 'business-test', sourceSystem: 'synthetic-customer-b', supportedHostApps: ['erp'], supportedCapabilities: ['inventory.stock-on-hand'] },
    listTools: () => [], healthCheck: async () => ({ dependency: 'business-test', status: 'healthy', checkedAt: new Date().toISOString() }),
    isCompatible: ({ host, tool, operation }) => ({ compatible: host.customerId === 'customer-b' && host.hostApp === 'erp' && tool.key === 'inventory.stock-on-hand' && operation.canonicalToolKey === tool.key })
  };
}
