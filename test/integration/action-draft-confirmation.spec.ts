import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';
import { DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE } from '../support/internal-identity-jwt.helper';

describe('US3 medium-risk action draft confirmation baseline', () => {
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

  it('creates an ActionDraft and returns confirmation_required semantics before any side-effect execution', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: { permission_scopes: ['orders:read', 'orders:update'] },
          requestId: 'req-us3-action-draft-create'
        })
      )
      .send({
        message: '請幫我更新 SO-10001 的訂單狀態為已確認',
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

    expect(eventNames).toContain('confirmation_required');
    expect(eventNames).not.toContain('tool_call_started');
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'confirmation_required',
        actionDraftId: expect.any(String)
      })
    );
    expect(newToolCalls).toHaveLength(0);
    const createdDraft = state.actionDrafts.find((draft) => draft.id === finalEvent?.data?.data?.actionDraftId);
    const executionPlan = state.executionPlans.at(-1);
    const planningMessage = state.messages.find((message) => message.id === executionPlan?.messageId);
    const workflowMessage = state.messages.find((message) => message.id === createdDraft?.messageId);
    expect(createdDraft).toEqual(
      expect.objectContaining({
        customerId: 'customer-a',
        messageId: expect.any(String),
        actorId: 'actor-shared',
        operation: 'update',
        riskLevel: 'medium'
      })
    );
    expect(executionPlan).toEqual(expect.objectContaining({ customerId: 'customer-a', sessionId: 'session-owned-001' }));
    expect(planningMessage).toEqual(expect.objectContaining({ role: 'user', customerId: 'customer-a' }));
    expect(workflowMessage).toEqual(expect.objectContaining({ role: 'assistant', customerId: 'customer-a' }));
    expect(executionPlan?.messageId).not.toBe(createdDraft?.messageId);
    expect(createdDraft?.payloadSummary).toEqual(
      expect.objectContaining({
        toolContract: expect.objectContaining({
          toolDefinitionId: 'tool-definition-orders-update-001',
          toolName: 'mock.orders.status.update',
          toolVersion: '1.0.0',
          operation: 'update',
          riskLevel: 'medium',
          hasSideEffect: true,
          requiresConfirmation: true,
          requiresApproval: false
        })
      })
    );
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'action_draft_created',
          customerId: 'customer-a',
          sessionId: 'session-owned-001',
          messageId: createdDraft?.messageId
        })
      ])
    );
  });

  it('executes medium-risk side effects only after confirmation re-checks pass', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/action-drafts/action-draft-waiting-001/confirm')
      .set(
        createAuthorizedInternalIdentityHeaders(DEFAULT_INTERNAL_IDENTITY_JWT_FIXTURE, {
          claims: { permission_scopes: ['orders:read', 'orders:update'] },
          requestId: 'req-us3-action-draft-recheck'
        })
      )
      .send({
        idempotencyKey: 'idem-us3-action-draft-001'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-action-draft-recheck',
        data: expect.objectContaining({
          actionDraftId: 'action-draft-waiting-001',
          status: 'executed',
          recheck: expect.objectContaining({
            organizationBoundary: 'passed',
            draftStatus: 'passed',
            freshness: 'passed',
            permission: 'passed',
            toolContract: 'passed',
            idempotency: 'reserved'
          })
        })
      })
    );
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(1);
  });
});
