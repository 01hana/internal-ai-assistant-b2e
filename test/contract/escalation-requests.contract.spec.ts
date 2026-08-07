import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('T060 Customer-scoped escalation request contract', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  const headers = (customer: 'customerA' | 'customerB', requestId: string, manager = false) => createAuthorizedInternalIdentityHeaders(jwt, {
    claims: { ...jwt.canonicalClaims[customer], ...(manager ? { roles: ['approver'], permission_scopes: ['orders:read', 'orders:approve'] } : {}) }, requestId
  });
  beforeAll(async () => ({ app, state } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks } })));
  afterAll(async () => app?.close());

  it('defines same-Customer get/list/resolve and Customer-owned redacted workflow audit contracts', async () => {
    const get = await request(app.getHttpServer()).get('/api/v1/assistant/escalation-requests/escalation-request-open-001').set({ ...headers('customerA', 'req-t060-get'), 'x-customer-id': 'customer-b' });
    expect(get.status).toBe(200);
    const list = await request(app.getHttpServer()).get('/api/v1/assistant/escalation-requests?customerId=customer-b').set(headers('customerA', 'req-t060-list', true));
    expect(list.status).toBe(200);
    expect(list.body.data.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ escalationRequestId: 'escalation-request-customer-b-open-001' })]));
    const resolved = await request(app.getHttpServer()).post('/api/v1/assistant/escalation-requests/escalation-request-open-001/resolve').set(headers('customerA', 'req-t060-resolve', true)).send({ reason: 'safe resolution', customerId: 'customer-b' });
    expect(resolved.status).toBe(200);
    const audit = state.auditEvents.at(-1);
    expect(audit).toEqual(expect.objectContaining({ customerId: 'customer-a', eventType: 'escalation_request_resolved' }));
    expect(JSON.stringify(audit)).not.toMatch(/Bearer |authorization|secret|credential|Error:/i);
  });

  it('requires safe foreign get/resolve with no status, resolver, or audit mutation', async () => {
    const foreign = state.escalationRequests.find((item) => item.id === 'escalation-request-customer-b-open-001')!;
    const before = { status: foreign.status, resolvedAt: foreign.resolvedAt, summary: JSON.stringify(foreign.summary), audits: state.auditEvents.length };
    const get = await request(app.getHttpServer()).get(`/api/v1/assistant/escalation-requests/${foreign.id}`).set(headers('customerA', 'req-t060-foreign-get'));
    const resolve = await request(app.getHttpServer()).post(`/api/v1/assistant/escalation-requests/${foreign.id}/resolve`).set(headers('customerA', 'req-t060-foreign-resolve', true)).send({ reason: 'foreign' });
    for (const response of [get, resolve]) {
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(foreign.id);
      expect(JSON.stringify(response.body)).not.toContain('SO-20002');
    }
    expect(foreign.status).toBe(before.status);
    expect(foreign.resolvedAt).toBe(before.resolvedAt);
    expect(JSON.stringify(foreign.summary)).toBe(before.summary);
    expect(state.auditEvents).toHaveLength(before.audits);
  });

});
