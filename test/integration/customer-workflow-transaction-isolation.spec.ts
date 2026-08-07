import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('US4 workflow transition audit rollback expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  const headers = (customer: 'customerA' | 'customerB', requestId: string, approver = false) => createAuthorizedInternalIdentityHeaders(jwt, { claims: { ...jwt.canonicalClaims[customer], ...(approver ? { roles: ['approver'], permission_scopes: ['orders:read', 'orders:approve', 'orders:update'] } : { permission_scopes: ['orders:read', 'orders:update'] }) }, requestId });

  beforeEach(async () => ({ app, state } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks } })));
  afterEach(async () => app?.close());

  it.each([
    ['approval reject', 'approvalRequests', 'approval-request-pending-reject-001', 'approval_request_rejected', '/api/v1/assistant/approval-requests/approval-request-pending-reject-001/reject', 'customerA', true],
    ['approval cancel', 'approvalRequests', 'approval-request-pending-cancel-001', 'approval_request_cancelled', '/api/v1/assistant/approval-requests/approval-request-pending-cancel-001/cancel', 'customerA', true],
    ['action cancel', 'actionDrafts', 'action-draft-draft-001', 'action_draft_cancelled', '/api/v1/assistant/action-drafts/action-draft-draft-001/cancel', 'customerA', false],
    ['escalation resolve', 'escalationRequests', 'escalation-request-open-001', 'escalation_request_resolved', '/api/v1/assistant/escalation-requests/escalation-request-open-001/resolve', 'customerA', true],
    ['escalation cancel', 'escalationRequests', 'escalation-request-customer-b-open-001', 'escalation_request_cancelled', '/api/v1/assistant/escalation-requests/escalation-request-customer-b-open-001/cancel', 'customerB', true]
  ] as const)('%s must rollback when lifecycle audit fails', async (_name, collection, id, eventType, route, customer, approver) => {
    const before = structuredClone((state[collection] as Array<{ id: string }>).find((record) => record.id === id)!);
    const auditCount = state.auditEvents.length;
    state.workflowAuditFailureEventTypes.push(eventType);
    const response = await request(app.getHttpServer()).post(route).set(headers(customer, `req-${eventType}`, approver)).send({ reason: 'rollback' });
    expect(response.status).toBe(500);
    const after = (state[collection] as Array<{ id: string }>).find((record) => record.id === id);
    expect(after).toEqual(before);
    expect(state.auditEvents).toHaveLength(auditCount);
  });
});
