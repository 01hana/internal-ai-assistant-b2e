import { INestApplication, NotFoundException } from '@nestjs/common';
import request = require('supertest');
import { ActionDraftService } from '../../src/approvals/action-draft.service';
import { PersistedExecutionPlan } from '../../src/assistant/planning/assistant-planning.types';
import { ExecutionDecision, RiskLevel } from '../../src/generated/prisma/enums';
import { createCustomerScopeFromIdentityContext } from '../../src/identity/customer-scope.factory';
import { validateVerifiedInternalIdentityClaims } from '../../src/identity/identity-context.validator';
import { INTERNAL_IDENTITY_TOKEN_VERIFIER, InternalIdentityTokenVerifier } from '../../src/identity/identity-token.types';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('T059 Customer A/B action draft isolation expected-red', () => {
  const jwt = createInternalIdentityJwtFixture();
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Record<string, any>;
  const header = (customer: 'customerA' | 'customerB', requestId: string) => createAuthorizedInternalIdentityHeaders(jwt, { claims: { ...jwt.canonicalClaims[customer], permission_scopes: ['orders:read', 'orders:update'] }, requestId });
  beforeAll(async () => ({ app, state, prismaMock } = await createUs1TestAppWithState({ internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks } })));
  afterAll(async () => app?.close());

  it('requires medium-risk creation to persist caller Customer rather than body/header Customer', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t059-create');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    expect(customerScope.customerId).toBe('customer-a');

    const service = app.get(ActionDraftService);
    await service.createForMediumRisk({
      requestId: identityContext.requestId,
      customerScope,
      sessionId: 'session-owned-001',
      messageId: 'message-owned-assistant-001',
      identityContext,
      executionPlan: executionPlan(customerScope.customerId),
      pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] }
    });

    expect(state.actionDrafts.at(-1)).toEqual(expect.objectContaining({ customerId: 'customer-a' }));
  });

  it('requires a foreign duplicate row to leave connector, ToolCall, and state untouched', async () => {
    const foreign = state.actionDrafts.find((item) => item.customerId === 'customer-b')!;
    const before = { status: foreign.status, toolCalls: state.toolCalls.length, audits: state.auditEvents.length, creates: prismaMock.toolCall.create.mock.calls.length };
    const response = await request(app.getHttpServer()).post(`/api/v1/assistant/action-drafts/${foreign.id}/confirm`).set(header('customerA', 'req-t059-foreign-precheck')).send({ idempotencyKey: 'workflow-shared-idempotency-key' });
    expect(response.status).toBe(404);
    expect(foreign.status).toBe(before.status);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
    expect(state.auditEvents).toHaveLength(before.audits);
    expect(prismaMock.toolCall.create).toHaveBeenCalledTimes(before.creates);
  });

  it('rejects a foreign execution plan and parent before workflow creation or side effects', async () => {
    const identityContext = await verifiedIdentityContext('customerA', 'req-t059-foreign-parent');
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    const before = { workflows: state.actionDrafts.length, audits: state.auditEvents.length, toolCalls: state.toolCalls.length };

    await expect(
      app.get(ActionDraftService).createForMediumRisk({
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
    expect(state.actionDrafts).toHaveLength(before.workflows);
    expect(state.auditEvents).toHaveLength(before.audits);
    expect(state.toolCalls).toHaveLength(before.toolCalls);
  });

  it('rejects a mismatched verified identity before any workflow work', async () => {
    const scope = createCustomerScopeFromIdentityContext(await verifiedIdentityContext('customerA', 'req-t059-scope'));
    const identityContext = await verifiedIdentityContext('customerB', 'req-t059-identity');
    const before = { workflows: state.actionDrafts.length, audits: state.auditEvents.length, tools: state.toolCalls.length };
    await expect(app.get(ActionDraftService).createForMediumRisk({ customerScope: scope, requestId: identityContext.requestId, sessionId: 'session-owned-001', messageId: 'message-owned-assistant-001', identityContext, executionPlan: executionPlan('customer-a'), pageContext: { module: 'orders' } })).rejects.toBeInstanceOf(NotFoundException);
    expect({ workflows: state.actionDrafts.length, audits: state.auditEvents.length, tools: state.toolCalls.length }).toEqual(before);
  });

  async function verifiedIdentityContext(customer: 'customerA' | 'customerB', requestId: string) {
    const authorization = createAuthorizedInternalIdentityHeaders(jwt, {
      claims: {
        ...jwt.canonicalClaims[customer],
        permission_scopes: ['orders:read', 'orders:update']
      }
    }).authorization;
    const verifier = app.get<InternalIdentityTokenVerifier>(INTERNAL_IDENTITY_TOKEN_VERIFIER);
    const verified = await verifier.verify({ authorization });
    return { ...validateVerifiedInternalIdentityClaims(verified), requestId };
  }
});

function executionPlan(customerId: string, sessionId = 'session-owned-001', messageId = 'message-owned-user-001'): PersistedExecutionPlan {
  return {
    id: 'plan-t059-customer-a',
    customerId,
    sessionId,
    messageId,
    taskType: 'order_status_update',
    requiredEvidence: [],
    candidateTools: [{ key: 'mock.orders.status.update' }],
    permissionChecks: [{ scope: 'orders:update', result: 'passed' }],
    riskAssessment: RiskLevel.medium,
    clarificationNeeds: null,
    expectedAnswerShape: null,
    requiresMultiStepToolUse: false,
    decision: ExecutionDecision.confirmation_required,
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  };
}
