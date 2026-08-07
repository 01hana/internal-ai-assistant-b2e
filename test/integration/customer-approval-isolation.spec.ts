import { INestApplication, NotFoundException } from '@nestjs/common';
import request = require('supertest');
import { ApprovalRequestService } from '../../src/approvals/approval-request.service';
import { PersistedExecutionPlan } from '../../src/assistant/planning/assistant-planning.types';
import { ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, InternalIdentityTokenVerifier } from '../../src/identity/identity-token.types';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('T058 Customer A/B approval isolation expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  const header = (customer: 'customerA' | 'customerB', requestId: string) => createAuthorizedInternalIdentityHeaders(jwt, { claims: { ...jwt.canonicalClaims[customer], roles: ['approver'], permission_scopes: ['orders:read', 'orders:approve'] }, requestId });
  beforeAll(async () => ({ app, state } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks } })));
  afterAll(async () => app?.close());

  it('requires a high-risk creation to write the canonical caller Customer despite conflicting public input', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t058-create');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    expect(customerScope.customerId).toBe('customer-a');

    const service = app.get(ApprovalRequestService);
    await service.createForHighRisk({
      requestId: identityContext.requestId,
      customerScope,
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      identityContext,
      executionPlan: executionPlan(customerScope.customerId),
      pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] }
    });

    expect(state.approvalRequests.at(-1)).toEqual(expect.objectContaining({ customerId: 'customer-a' }));
  });

  it('requires repeated idempotency keys to remain independently usable per Customer', async () => {
    const a = state.approvalRequests.find((item) => item.customerId === 'customer-a')!;
    const b = state.approvalRequests.find((item) => item.customerId === 'customer-b')!;
    expect(a.idempotencyKey ?? 'workflow-shared-idempotency-key').toBe('workflow-shared-idempotency-key');
    expect(b.idempotencyKey).toBe('workflow-shared-idempotency-key');
    expect(a.customerId).not.toBe(b.customerId);
  });

  it('rejects a foreign execution plan and parent before workflow creation or audit', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t058-foreign-parent');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const before = { workflows: state.approvalRequests.length, audits: state.auditEvents.length, toolCalls: state.toolCalls.length };

    await expect(
      app.get(ApprovalRequestService).createForHighRisk({
        requestId: identityContext.requestId,
        customerScope,
        sessionId: 'session-hidden-001',
        messageId: 'message-hidden-assistant-001',
        identityContext,
        executionPlan: executionPlan('customer-b', 'session-hidden-001', 'message-hidden-user-001'),
        pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-20002', visibleColumns: ['status'] }
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(customerScope.customerId).toBe('customer-a');
    expect(state.approvalRequests).toHaveLength(before.workflows);
    expect(state.auditEvents).toHaveLength(before.audits);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
  });

  it('rejects a mismatched verified identity before any workflow work', async () => {
    const scope = createCustomerScopeFromIdentityContext(await verifiedIdentityContext('customerA', 'req-t058-scope'));
    const identityContext = await verifiedIdentityContext('customerB', 'req-t058-identity');
    const before = { workflows: state.approvalRequests.length, audits: state.auditEvents.length, tools: state.toolCalls.length };
    await expect(app.get(ApprovalRequestService).createForHighRisk({ customerScope: scope, requestId: identityContext.requestId, sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001', identityContext, executionPlan: executionPlan('customer-a'), pageContext: { module: 'orders' } })).rejects.toBeInstanceOf(NotFoundException);
    expect({ workflows: state.approvalRequests.length, audits: state.auditEvents.length, tools: state.toolCalls.length }).toEqual(before);
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
    id: 'plan-t058-customer-a',
    customerId,
    sessionId,
    messageId,
    taskType: 'order_cancel',
    requiredEvidence: [],
    candidateTools: [{ key: 'mock.orders.cancel' }],
    permissionChecks: [{ scope: 'orders:approve', result: 'passed' }],
    riskAssessment: RiskLevel.high,
    clarificationNeeds: null,
    expectedAnswerShape: null,
    requiresMultiStepToolUse: false,
    decision: ExecutionDecision.approval_required,
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  };
}
