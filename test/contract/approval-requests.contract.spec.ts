import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import {
  createAuthorizedInternalIdentityHeaders,
  createUs1TestAppWithState,
  Us1TestState
} from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('T058 Customer-scoped approval request contract', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  const headers = (customer: 'customerA' | 'customerB', requestId: string, approver = false) =>
    createAuthorizedInternalIdentityHeaders(jwt, {
      claims: {
        ...jwt.canonicalClaims[customer],
        ...(approver ? { roles: ['approver'], permission_scopes: ['orders:read', 'orders:approve'] } : {})
      },
      requestId
    });

  beforeAll(async () => {
    ({ app, state } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
  });
  afterAll(async () => app?.close());

  it('defines same-Customer get/list/approve/reject contracts from signed canonical identity only', async () => {
    const get = await request(app.getHttpServer())
      .get('/api/v1/assistant/approval-requests/approval-request-pending-get-001')
      .set({ ...headers('customerA', 'req-t058-get'), 'x-customer-id': 'customer-b' });
    expect(get.status).toBe(200);
    expect(get.body.data).toEqual(expect.objectContaining({ approvalRequestId: 'approval-request-pending-get-001' }));

    const list = await request(app.getHttpServer()).get('/api/v1/assistant/approval-requests?customerId=customer-b').set(headers('customerA', 'req-t058-list'));
    expect(list.status).toBe(200);
    expect(list.body.data.items).toEqual(expect.arrayContaining([expect.objectContaining({ approvalRequestId: 'approval-request-pending-get-001' })]));
    expect(list.body.data.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ approvalRequestId: 'approval-request-customer-b-pending-001' })]));

    const approve = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(headers('customerA', 'req-t058-approve', true))
      .send({ idempotencyKey: 'workflow-shared-idempotency-key', customerId: 'customer-b' });
    expect(approve.status).toBe(200);
    expect(approve.body.data).toEqual(expect.objectContaining({ status: expect.stringMatching(/approved|executed/) }));

    const reject = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-reject-001/reject')
      .set(headers('customerA', 'req-t058-reject', true))
      .send({ reason: 'same customer', customerId: 'customer-b' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('rejected');
  });

  it('requires a safe 404 and no mutation before foreign approval reads or decisions', async () => {
    const foreign = state.approvalRequests.find((item) => item.id === 'approval-request-customer-b-pending-001')!;
    const before = { status: foreign.status, audits: state.auditEvents.length, toolCalls: state.toolCalls.length };
    for (const [method, suffix] of [['get', ''], ['post', '/approve'], ['post', '/reject']] as const) {
      const response = await (method === 'get'
        ? request(app.getHttpServer()).get(`/api/v1/assistant/approval-requests/${foreign.id}`)
        : request(app.getHttpServer()).post(`/api/v1/assistant/approval-requests/${foreign.id}${suffix}`))
        .set(headers('customerA', `req-t058-foreign-${suffix || 'get'}`, suffix !== ''))
        .send(suffix === '/approve' ? { idempotencyKey: 'workflow-shared-idempotency-key' } : { reason: 'foreign' });
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(foreign.id);
      expect(JSON.stringify(response.body)).not.toContain('customer-b');
    }
    expect(foreign.status).toBe(before.status);
    expect(state.auditEvents).toHaveLength(before.audits);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
  });

});
