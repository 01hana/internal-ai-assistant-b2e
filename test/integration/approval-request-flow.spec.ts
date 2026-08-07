import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('US3 approval request baseline', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an ApprovalRequest for high-risk actions and does not execute any side effect before approval', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: { permission_scopes: ['orders:read', 'orders:update'] },
          requestId: 'req-us3-approval-create'
        })
      )
      .send({
        message: '請取消 SO-10001 訂單',
        pageContext: {
          module: 'orders',
          route: '/orders/SO-10001',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newToolCalls = state.toolCalls.slice(initialToolCallCount);
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);

    expect(eventNames).toContain('approval_required');
    expect(eventNames).not.toContain('tool_call_started');
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'approval_required',
        approvalRequestId: expect.any(String)
      })
    );
    const createdApprovalRequest = state.approvalRequests.find(
      (approvalRequest) => approvalRequest.id === finalEvent?.data?.data?.approvalRequestId
    );
    const executionPlan = state.executionPlans.at(-1);
    const planningMessage = state.messages.find((message) => message.id === executionPlan?.messageId);
    const workflowMessage = state.messages.find((message) => message.id === createdApprovalRequest?.messageId);
    expect(createdApprovalRequest).toEqual(
      expect.objectContaining({
        customerId: 'customer-a',
        messageId: expect.any(String),
        requesterActorId: 'actor-shared'
      })
    );
    expect(executionPlan).toEqual(expect.objectContaining({ customerId: 'customer-a', sessionId: 'session-owned-001' }));
    expect(planningMessage).toEqual(expect.objectContaining({ role: 'user', customerId: 'customer-a' }));
    expect(workflowMessage).toEqual(expect.objectContaining({ role: 'assistant', customerId: 'customer-a' }));
    expect(executionPlan?.messageId).not.toBe(createdApprovalRequest?.messageId);
    expect(createdApprovalRequest?.actionSummary).toEqual(
      expect.objectContaining({
        toolName: 'mock.orders.cancel',
        toolDefinitionId: 'tool-definition-orders-cancel-001',
        toolVersion: '1.0.0',
        operation: 'update',
        hasSideEffect: true,
        requiresConfirmation: false,
        requiresApproval: true,
        toolContract: expect.objectContaining({
          toolDefinitionId: 'tool-definition-orders-cancel-001',
          toolName: 'mock.orders.cancel',
          toolVersion: '1.0.0',
          operation: 'update',
          riskLevel: 'high',
          hasSideEffect: true,
          requiresConfirmation: false,
          requiresApproval: true
        })
      })
    );
    expect(newToolCalls).toHaveLength(0);
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'approval_request_created',
          customerId: 'customer-a',
          sessionId: 'session-owned-001',
          messageId: createdApprovalRequest?.messageId,
          metadata: expect.objectContaining({
            approvalRequestId: expect.any(String),
            status: 'pending',
            riskLevel: 'high',
            requesterActorId: 'actor-shared',
            approverActorId: null,
            toolName: 'mock.orders.cancel',
            resource: 'orders',
            operation: 'update',
            expiresAt: expect.any(String)
          })
        })
      ])
    );
    expect(JSON.stringify(newAuditEvents)).not.toContain('visibleColumns');
    expect(JSON.stringify(newAuditEvents)).not.toContain('rawPayload');
  });

  it('fails closed when the requester tries to approve directly without approver permission', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-denied-001/approve')
      .set(
        {
          ...createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
            claims: { permission_scopes: ['orders:read', 'orders:update'] },
            requestId: 'req-us3-approval-fail-closed'
          }),
          'x-role': 'planner',
          'x-permission-scopes': 'orders:read,orders:update'
        }
      )
      .send({
        idempotencyKey: 'idem-us3-approval-001'
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-approval-fail-closed',
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String)
        })
      })
    );
  });
});
