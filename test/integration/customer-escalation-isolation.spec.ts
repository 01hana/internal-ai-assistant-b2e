import { INestApplication, NotFoundException } from '@nestjs/common';
import request = require('supertest');
import { EscalationRequestService } from '../../src/approvals/escalation-request.service';
import { PersistedExecutionPlan } from '../../src/assistant/planning/assistant-planning.types';
import { ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, InternalIdentityTokenVerifier } from '../../src/identity/identity-token.types';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('T060 Customer A/B escalation isolation expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  const header = (customer: 'customerA' | 'customerB', requestId: string) => createAuthorizedInternalIdentityHeaders(jwt, { claims: { ...jwt.canonicalClaims[customer], roles: ['approver'], permission_scopes: ['orders:read', 'orders:approve'] }, requestId });
  beforeAll(async () => ({ app, state } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks } })));
  afterAll(async () => app?.close());

  it('requires critical-risk creation and workflow audit to own the canonical caller Customer', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t060-create');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    expect(customerScope.customerId).toBe('customer-a');

    const service = app.get(EscalationRequestService);
    await service.createForCriticalRisk({
      requestId: identityContext.requestId,
      customerScope,
      sessionId: 'session-owned-001',
      messageId: 'message-owned-user-001',
      identityContext,
      executionPlan: executionPlan(customerScope.customerId),
      pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] }
    });

    expect(state.escalationRequests.at(-1)).toEqual(expect.objectContaining({ customerId: 'customer-a' }));
    expect(state.auditEvents.at(-1)).toEqual(expect.objectContaining({ customerId: 'customer-a' }));
  });

  it('requires a foreign escalation to stop before update and audit with no payload disclosure', async () => {
    const foreign = state.escalationRequests.find((item) => item.customerId === 'customer-b')!;
    const before = { status: foreign.status, resolvedAt: foreign.resolvedAt, auditCount: state.auditEvents.length };
    const response = await request(app.getHttpServer()).post(`/api/v1/assistant/escalation-requests/${foreign.id}/resolve`).set(header('customerA', 'req-t060-foreign')).send({ reason: 'foreign' });
    expect(response.status).toBe(404);
    expect(foreign.status).toBe(before.status);
    expect(foreign.resolvedAt).toBe(before.resolvedAt);
    expect(state.auditEvents).toHaveLength(before.auditCount);
    expect(JSON.stringify(response.body)).not.toContain('SO-20002');
  });

  it('rejects a foreign execution plan and parent before escalation creation or audit', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t060-foreign-parent');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const before = { workflows: state.escalationRequests.length, audits: state.auditEvents.length, toolCalls: state.toolCalls.length };

    await expect(
      app.get(EscalationRequestService).createForCriticalRisk({
        requestId: identityContext.requestId,
        customerScope,
        sessionId: 'session-hidden-001',
        messageId: 'message-hidden-assistant-001',
        identityContext,
        executionPlan: executionPlan('customer-b', 'session-hidden-001', 'message-hidden-assistant-001'),
        pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-20002', visibleColumns: ['status'] }
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(customerScope.customerId).toBe('customer-a');
    expect(state.escalationRequests).toHaveLength(before.workflows);
    expect(state.auditEvents).toHaveLength(before.audits);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
  });

  it('rejects a mismatched verified identity before any workflow work', async () => {
    const scope = createCustomerScopeFromIdentityContext(await verifiedIdentityContext('customerA', 'req-t060-scope'));
    const identityContext = await verifiedIdentityContext('customerB', 'req-t060-identity');
    const before = { workflows: state.escalationRequests.length, audits: state.auditEvents.length, tools: state.toolCalls.length };
    await expect(app.get(EscalationRequestService).createForCriticalRisk({ customerScope: scope, requestId: identityContext.requestId, sessionId: 'session-owned-001', messageId: 'message-owned-user-001', identityContext, executionPlan: executionPlan('customer-a'), pageContext: { module: 'orders' } })).rejects.toBeInstanceOf(NotFoundException);
    expect({ workflows: state.escalationRequests.length, audits: state.auditEvents.length, tools: state.toolCalls.length }).toEqual(before);
  });

  async function verifiedIdentityContext(customer: 'customerA' | 'customerB', requestId: string) {
    const authorization = createAuthorizedInternalIdentityHeaders(jwt, {
      claims: {
        ...jwt.canonicalClaims[customer],
        roles: ['approver'],
        permission_scopes: ['orders:read', 'orders:approve']
      }
    }).authorization;
    const verifier = app.get<InternalIdentityTokenVerifier>(INTERNAL_IDENTITY_TOKEN_VERIFIER);
    const verified = await verifier.verify({ authorization });
    return { ...validateVerifiedInternalIdentityClaims(verified), requestId };
  }
});

function executionPlan(customerId: string, sessionId = 'session-owned-001', messageId = 'message-owned-user-001'): PersistedExecutionPlan {
  return {
    id: 'plan-t060-customer-a',
    customerId,
    sessionId,
    messageId,
    taskType: 'order_escalation',
    requiredEvidence: [],
    candidateTools: [],
    permissionChecks: [{ scope: 'orders:approve', result: 'passed' }],
    riskAssessment: RiskLevel.critical,
    clarificationNeeds: null,
    expectedAnswerShape: null,
    requiresMultiStepToolUse: false,
    decision: ExecutionDecision.escalation_required,
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  };
}
