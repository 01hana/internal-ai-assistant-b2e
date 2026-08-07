import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { claimsForToolScenario } from '../support/customer-tool-phase6-fixtures';

const describeUs3 = process.env.RUN_CUSTOMER_US3_TESTS === 'true' ? describe : describe.skip;

describeUs3('Customer tool permission pre-execution contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state'];
  let prismaMock: Awaited<ReturnType<typeof createUs1TestAppWithState>>['prismaMock'];

  beforeEach(async () => ({ app, state, prismaMock } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks } })));
  afterEach(async () => app.close());

  it.each([
    ['empty arrays', claimsForToolScenario(fixture, 'customerA', { roles: [], permission_scopes: [] })],
    ['header conflict', claimsForToolScenario(fixture, 'customerA', { roles: [], permission_scopes: [] })]
  ])('denies %s before connector, successful ToolCall, evidence, or side effect', async (_name, claims) => {
    const before = { evidence: state.evidenceRefs.length, successfulToolCalls: successfulToolCallCount(state) };
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set({ ...createAuthorizedInternalIdentityHeaders(fixture, { claims, requestId: `req-us3-${_name}` }), 'x-permission-scopes': 'orders:read,orders:update', 'x-customer-id': 'customer-b' })
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });
    expect(prismaMock.customerToolPolicy.findUnique).toHaveBeenCalled();
    expect(response.text).not.toContain('SO-10001');
    expect({ evidence: state.evidenceRefs.length, successfulToolCalls: successfulToolCallCount(state) }).toEqual(before);
    // T057 expected-red: final denial audit is minimal and owned by the caller;
    // the current AuditWriter cannot persist customerId yet.
    expect(state.auditEvents.some((event) => event.customerId === claims.customer_id)).toBe(true);
  });

  it('defines the future enabled-policy and complete-permission structured-tool success contract', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: claimsForToolScenario(fixture, 'customerA', { permission_scopes: ['orders:read'] }), requestId: 'req-us3-own-success' }))
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });
    expect(response.text).toContain('event: tool_call_completed');
    expect(state.toolCalls.some((item) => item.customerId === 'customer-a')).toBe(true);
    expect(state.evidenceRefs.some((item) => item.customerId === 'customer-a')).toBe(true);
  });
});

function successfulToolCallCount(state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state']): number {
  return state.toolCalls.filter((item) => item.status === 'success').length;
}
