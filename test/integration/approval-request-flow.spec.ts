import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

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
        createIdentityHeaders({
          'x-request-id': 'req-us3-approval-create',
          'x-permission-scopes': 'orders:read,orders:update'
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
    expect(newToolCalls).toHaveLength(0);
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'approval_request_created'
        })
      ])
    );
  });

  it('fails closed when the requester tries to approve directly without approver permission', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-001/approve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-approval-fail-closed',
          'x-role': 'planner',
          'x-permission-scopes': 'orders:read,orders:update'
        })
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
