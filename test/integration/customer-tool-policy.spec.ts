import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';
import { CUSTOMER_TOOL_PHASE6 } from '../support/customer-tool-phase6-fixtures';

const describeUs3 = process.env.RUN_CUSTOMER_US3_TESTS === 'true' ? describe : describe.skip;

describeUs3('CustomerToolPolicy contract', () => {
  const fixture = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state'];
  let prismaMock: Awaited<ReturnType<typeof createUs1TestAppWithState>>['prismaMock'];

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: fixture.jwks } }));
  });
  afterEach(async () => app.close());

  it.each(['customerA', 'customerB'] as const)('requires a Customer-qualified policy lookup for %s on the shared global tool', async (customer) => {
    await request(app.getHttpServer())
      .post(`/api/v1/assistant/sessions/${customer === 'customerA' ? 'session-owned-001' : 'session-hidden-001'}/messages`)
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId: `req-us3-policy-${customer}` }))
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });
    expect(prismaMock.customerToolPolicy.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId_toolDefinitionId: { customerId: customer === 'customerA' ? 'customer-a' : 'customer-b', toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId } }
    }));
  });

  it.each([
    ['disabled', 'customerB', undefined],
    ['missing', 'customerA', () => { state.customerToolPolicies.splice(0, 1); }],
    ['foreign-only', 'customerA', () => { state.customerToolPolicies.splice(0, state.customerToolPolicies.length, { ...CUSTOMER_TOOL_PHASE6.policies.customerB, toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId }); }]
  ] as const)('executes %s policy flow as a safe, indistinguishable denial', async (_scenario, customer, arrange) => {
    arrange?.();
    const before = snapshotDeniedWork(state);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/assistant/sessions/${customer === 'customerA' ? 'session-owned-001' : 'session-hidden-001'}/messages`)
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims[customer], requestId: `req-us3-policy-${_scenario}` }))
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });

    const customerId = customer === 'customerA' ? 'customer-a' : 'customer-b';
    expect(prismaMock.customerToolPolicy.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId_toolDefinitionId: { customerId, toolDefinitionId: CUSTOMER_TOOL_PHASE6.toolDefinitionId } }
    }));
    expect(response.text).not.toContain('customer-a');
    expect(response.text).not.toContain('customer-b');
    expect(snapshotDeniedWork(state)).toEqual(before);
  });

  it('rejects an inactive global definition before Customer policy or connector work', async () => {
    const tool = state.toolDefinitions.find((item) => item.id === CUSTOMER_TOOL_PHASE6.toolDefinitionId);
    if (!tool) throw new Error('US3 global ToolDefinition fixture is missing.');
    tool.isActive = false;
    const before = snapshotDeniedWork(state);
    await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createAuthorizedInternalIdentityHeaders(fixture, { claims: fixture.canonicalClaims.customerA, requestId: 'req-us3-inactive' }))
      .send({ message: '這張訂單目前狀態？', pageContext: { module: 'orders', entityId: 'SO-10001', visibleColumns: ['status'] } });

    expect(prismaMock.customerToolPolicy.findUnique).not.toHaveBeenCalled();
    expect(snapshotDeniedWork(state)).toEqual(before);
  });
});

function snapshotDeniedWork(state: Awaited<ReturnType<typeof createUs1TestAppWithState>>['state']) {
  return {
    evidence: state.evidenceRefs.length,
    successfulToolCalls: state.toolCalls.filter((item) => item.status === 'success').length
  };
}
