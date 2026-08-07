import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('US4 Customer-scoped workflow finalization recovery expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Record<string, any>;
  let connector: MockConnectorAdapter;

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
    connector = app.get(MockConnectorAdapter);
  });
  afterEach(async () => app?.close());

  it('keeps Approval connector execution Customer-scoped while a failed finalization must be recoverable', async () => {
    const idempotencyKey = 'idem-us4-approval-finalization-recovery';
    const approvalId = 'approval-request-pending-approve-001';
    const connectorExecute = jest.spyOn(connector, 'execute');
    state.workflowAuditFailureEventTypes.push('approval_request_approved');

    const first = await request(app.getHttpServer())
      .post(`/api/v1/assistant/approval-requests/${approvalId}/approve`)
      .set(headers('customerA', 'req-us4-approval-first'))
      .send({ idempotencyKey });
    const afterFirst = structuredClone(byId(state.approvalRequests, approvalId));
    const aToolCallsAfterFirst = workflowToolCalls('customer-a', idempotencyKey, approvalId);

    const retry = await request(app.getHttpServer())
      .post(`/api/v1/assistant/approval-requests/${approvalId}/approve`)
      .set(headers('customerA', 'req-us4-approval-retry'))
      .send({ idempotencyKey });
    const afterRetry = byId(state.approvalRequests, approvalId);

    const customerB = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-customer-b-pending-001/approve')
      .set(headers('customerB', 'req-us4-approval-customer-b'))
      .send({ idempotencyKey });

    const aToolCalls = workflowToolCalls('customer-a', idempotencyKey, approvalId);
    const bToolCalls = workflowToolCalls('customer-b', idempotencyKey, 'approval-request-customer-b-pending-001');
    const approvedAudits = state.auditEvents.filter((item) => item.customerId === 'customer-a' && item.eventType === 'approval_request_approved');

    expect(first.status).toBe(500);
    expect(aToolCallsAfterFirst).toHaveLength(1);
    expect(aToolCallsAfterFirst[0]).toMatchObject({ customerId: 'customer-a', status: 'success', executionStatus: 'executed' });
    expect(retry.status).toBe(200);
    expect(customerB.status).toBe(200);
    expect(connectorExecute).toHaveBeenCalledTimes(2);
    expect(prismaMock.toolCall.create).toHaveBeenCalledTimes(2);
    expect(aToolCalls).toHaveLength(1);
    expect(bToolCalls).toHaveLength(1);
    expect({
      firstStatus: afterFirst.status,
      retryStatus: afterRetry.status,
      approvedAuditCount: approvedAudits.length,
      customerAToolCallCount: aToolCalls.length,
      customerBToolCallCount: bToolCalls.length
    }).toEqual({
      firstStatus: 'pending',
      retryStatus: 'approved',
      approvedAuditCount: 1,
      customerAToolCallCount: 1,
      customerBToolCallCount: 1
    });
  });

  it('keeps ActionDraft connector execution Customer-scoped while a failed finalization must be recoverable', async () => {
    const idempotencyKey = 'idem-us4-action-finalization-recovery';
    const actionDraftId = 'action-draft-waiting-001';
    const connectorExecute = jest.spyOn(connector, 'execute');
    state.workflowAuditFailureEventTypes.push('action_draft_confirmed');

    const first = await request(app.getHttpServer())
      .post(`/api/v1/assistant/action-drafts/${actionDraftId}/confirm`)
      .set(headers('customerA', 'req-us4-action-first'))
      .send({ idempotencyKey });
    const afterFirst = structuredClone(byId(state.actionDrafts, actionDraftId));
    const aToolCallsAfterFirst = workflowToolCalls('customer-a', idempotencyKey, actionDraftId);

    const retry = await request(app.getHttpServer())
      .post(`/api/v1/assistant/action-drafts/${actionDraftId}/confirm`)
      .set(headers('customerA', 'req-us4-action-retry'))
      .send({ idempotencyKey });
    const afterRetry = byId(state.actionDrafts, actionDraftId);

    const customerB = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-customer-b-waiting-001/confirm')
      .set(headers('customerB', 'req-us4-action-customer-b'))
      .send({ idempotencyKey });

    const aToolCalls = workflowToolCalls('customer-a', idempotencyKey, actionDraftId);
    const bToolCalls = workflowToolCalls('customer-b', idempotencyKey, 'action-draft-customer-b-waiting-001');
    const confirmedAudits = state.auditEvents.filter((item) => item.customerId === 'customer-a' && item.eventType === 'action_draft_confirmed');

    expect(first.status).toBe(500);
    expect(aToolCallsAfterFirst).toHaveLength(1);
    expect(aToolCallsAfterFirst[0]).toMatchObject({ customerId: 'customer-a', status: 'success', executionStatus: 'executed' });
    expect(retry.status).toBe(200);
    expect(customerB.status).toBe(200);
    expect(connectorExecute).toHaveBeenCalledTimes(2);
    expect(prismaMock.toolCall.create).toHaveBeenCalledTimes(2);
    expect(aToolCalls).toHaveLength(1);
    expect(bToolCalls).toHaveLength(1);
    expect({
      firstStatus: afterFirst.status,
      retryStatus: afterRetry.status,
      confirmedAuditCount: confirmedAudits.length,
      customerAToolCallCount: aToolCalls.length,
      customerBToolCallCount: bToolCalls.length
    }).toEqual({
      firstStatus: 'waiting_confirmation',
      retryStatus: 'executed',
      confirmedAuditCount: 1,
      customerAToolCallCount: 1,
      customerBToolCallCount: 1
    });
  });

  function headers(customer: 'customerA' | 'customerB', requestId: string) {
    return createAuthorizedInternalIdentityHeaders(jwt, {
      claims: {
        ...jwt.canonicalClaims[customer],
        roles: customer === 'customerA' ? ['approver'] : ['approver'],
        permission_scopes: ['orders:read', 'orders:approve', 'orders:update']
      },
      requestId
    });
  }

  function workflowToolCalls(customerId: string, idempotencyKey: string, sourceId: string) {
    return state.toolCalls.filter((toolCall) => {
      const inputSummary = toolCall.inputSummary as { sourceId?: string } | null;
      return toolCall.customerId === customerId && toolCall.idempotencyKey === idempotencyKey && inputSummary?.sourceId === sourceId;
    });
  }
});

function byId<T extends { id: string }>(records: T[], id: string): T {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error(`Missing workflow fixture ${id}`);
  return record;
}
