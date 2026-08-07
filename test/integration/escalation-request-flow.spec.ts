import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('US3 escalation request flow', () => {
  let app: INestApplication;
  let state: Us1TestState;

  beforeEach(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
    state = testApp.state;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates an EscalationRequest for critical-risk actions and does not execute side effects', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-escalation-create',
          'x-permission-scopes': 'orders:read,orders:update'
        })
      )
      .send({
        message: '請緊急升級取消 SO-10001 訂單，這是重大風險操作',
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
    const escalationEvent = events.find((event) => event.event === 'escalation_required');
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);

    expect(eventNames).toEqual(['escalation_required', 'final']);
    expect(eventNames).not.toContain('tool_call_started');
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'escalation_required',
        escalationRequestId: expect.any(String),
        evidenceRefs: []
      })
    );
    expect(escalationEvent?.data?.data).toEqual(
      expect.objectContaining({
        escalationRequestId: finalEvent?.data?.data?.escalationRequestId,
        riskLevel: 'critical',
        reasonCode: 'policy_required'
      })
    );
    expect(state.toolCalls.slice(initialToolCallCount)).toHaveLength(0);
    expect(state.escalationRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: finalEvent?.data?.data?.escalationRequestId,
          status: 'open'
        })
      ])
    );
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'escalation_request_created',
          metadata: expect.objectContaining({
            escalationRequestId: finalEvent?.data?.data?.escalationRequestId,
            riskLevel: 'critical',
            reasonCode: 'policy_required',
            requesterActorId: 'actor-001',
            status: 'open',
            toolName: 'mock.orders.cancel',
            resource: 'orders',
            operation: 'update'
          })
        }),
        expect.objectContaining({
          eventType: 'answer_generated',
          decision: 'escalation_required'
        })
      ])
    );
    expect(JSON.stringify(newAuditEvents)).not.toContain('visibleColumns');
    expect(JSON.stringify(newAuditEvents)).not.toContain('rawPayload');
    expect(JSON.stringify(newAuditEvents)).not.toContain('idempotencyKey');
  });

  it('allows requester to get own escalation and managers to list and resolve it', async () => {
    const getResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests/escalation-request-open-001')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-escalation-get' }));

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data).toEqual(
      expect.objectContaining({
        escalationRequestId: 'escalation-request-open-001',
        status: 'open',
        reason: 'policy_required'
      })
    );

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests?status=open')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-escalation-list',
          'x-actor-id': 'approver-001',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      );

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          escalationRequestId: 'escalation-request-open-001'
        })
      ])
    );

    const resolveResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/escalation-requests/escalation-request-open-001/resolve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-escalation-resolve',
          'x-actor-id': 'approver-001',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      )
      .send({ reason: '人工已完成確認，不由系統執行 side effect' });

    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.data).toEqual(
      expect.objectContaining({
        escalationRequestId: 'escalation-request-open-001',
        status: 'resolved',
        resolvedAt: expect.any(String)
      })
    );
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'escalation_request_resolved',
          metadata: expect.objectContaining({
            escalationRequestId: 'escalation-request-open-001',
            assignedActorId: 'approver-001',
            status: 'resolved',
            reasonProvided: true
          })
        })
      ])
    );
    expect(JSON.stringify(state.auditEvents)).not.toContain('人工已完成確認');
  });

  it('fails closed for non-manager resolve and prevents repeated terminal transitions', async () => {
    const deniedResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/escalation-requests/escalation-request-open-001/resolve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-escalation-denied',
          'x-role': 'planner',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({ reason: 'try resolve' });

    expect(deniedResponse.status).toBe(403);

    const resolvedAgain = await request(app.getHttpServer())
      .post('/api/v1/assistant/escalation-requests/escalation-request-resolved-001/resolve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-escalation-resolved-again',
          'x-actor-id': 'approver-001',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      )
      .send({ reason: 'again' });

    expect(resolvedAgain.status).toBe(409);

    const expiredResolve = await request(app.getHttpServer())
      .post('/api/v1/assistant/escalation-requests/escalation-request-expired-001/resolve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-escalation-expired',
          'x-actor-id': 'approver-001',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      )
      .send({ reason: 'expired' });

    expect(expiredResolve.status).toBe(409);

    const expiredCancel = await request(app.getHttpServer())
      .post('/api/v1/assistant/escalation-requests/escalation-request-expired-001/cancel')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-escalation-expired-cancel' }))
      .send({ reason: 'expired cancel' });

    expect(expiredCancel.status).toBe(409);

    const expiredGet = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests/escalation-request-expired-001')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-escalation-expired-get' }));

    expect(expiredGet.status).toBe(200);
    expect(expiredGet.body.data).toEqual(
      expect.objectContaining({
        escalationRequestId: 'escalation-request-expired-001',
        status: 'expired'
      })
    );
  });

  it('allows requester to cancel pending escalation and writes minimized audit metadata', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/escalation-requests/escalation-request-open-001/cancel')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-escalation-cancel' }))
      .send({ reason: '不用處理了' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        escalationRequestId: 'escalation-request-open-001',
        status: 'cancelled'
      })
    );
    expect(state.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'escalation_request_cancelled',
          metadata: expect.objectContaining({
            escalationRequestId: 'escalation-request-open-001',
            status: 'cancelled',
            reasonProvided: true
          })
        })
      ])
    );
    expect(JSON.stringify(state.auditEvents)).not.toContain('不用處理了');
  });

  it('keeps high-risk approval and medium-risk action draft flows unchanged', async () => {
    const highRiskResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-escalation-high', 'x-permission-scopes': 'orders:read,orders:update' }))
      .send({
        message: '請取消 SO-10001 訂單',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status']
        }
      });
    expect(parseSseResponse(highRiskResponse.text).map((event) => event.event)).toContain('approval_required');

    const mediumRiskResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-escalation-medium', 'x-permission-scopes': 'orders:read,orders:update' }))
      .send({
        message: '請更新 SO-10001 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status']
        }
      });
    expect(parseSseResponse(mediumRiskResponse.text).map((event) => event.event)).toContain('confirmation_required');
  });
});
