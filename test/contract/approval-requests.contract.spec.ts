import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState } from '../support/us1-test-app.helper';

describe('US3 approval requests contract baseline', () => {
  // These fixture ids are intentionally isolated per state-changing test so
  // future T084 runtime/status transitions do not create cross-test pollution.
  let app: INestApplication;

  beforeAll(async () => {
    const testApp = await createUs1TestAppWithState();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a single approval request with requester, approver, risk, and evidence summary metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/approval-requests/approval-request-pending-get-001')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-approval-get' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-approval-get',
        data: expect.objectContaining({
          approvalRequestId: 'approval-request-pending-get-001',
          status: 'pending',
          riskLevel: expect.stringMatching(/high|critical/),
          requesterActorId: expect.any(String),
          approverActorId: expect.any(String),
          actionSummary: expect.anything(),
          payloadSummary: expect.anything(),
          evidenceRefIds: expect.any(Array)
        })
      })
    );
  });

  it('lists approval requests with the full filter baseline and a consistent response envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/approval-requests')
      .query({
        status: 'pending',
        riskLevel: 'high',
        requesterActorId: 'actor-001',
        approverActorId: 'approver-001',
        createdAtFrom: '2026-06-01T00:00:00.000Z',
        createdAtTo: '2026-06-30T23:59:59.999Z'
      })
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-approval-list' }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-approval-list',
        data: expect.objectContaining({
          items: expect.any(Array),
          filters: expect.objectContaining({
            status: 'pending',
            riskLevel: 'high',
            requesterActorId: 'actor-001',
            approverActorId: 'approver-001',
            createdAtFrom: '2026-06-01T00:00:00.000Z',
            createdAtTo: '2026-06-30T23:59:59.999Z'
          })
        })
      })
    );
  });

  it('allows an approver to approve a pending request without exposing side-effect payloads in the response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-approve-001/approve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-approval-approve',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      )
      .send({
        idempotencyKey: 'idem-approval-approve-001'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-approval-approve',
        data: expect.objectContaining({
          approvalRequestId: 'approval-request-pending-approve-001',
          status: expect.stringMatching(/approved|executed/)
        })
      })
    );
  });

  it('fails closed when a non-approver tries to approve a request', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-denied-001/approve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-approval-denied',
          'x-role': 'planner',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({
        idempotencyKey: 'idem-approval-denied-001'
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-approval-denied',
        error: expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String)
        })
      })
    );
  });

  it('supports reject and cancel status transitions with the same response envelope shape', async () => {
    const rejectResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-reject-001/reject')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us3-approval-reject',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      )
      .send({
        reason: 'Requester must provide more evidence.'
      });

    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-approval-reject',
        data: expect.objectContaining({
          approvalRequestId: 'approval-request-pending-reject-001',
          status: 'rejected'
        })
      })
    );

    const cancelResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/approval-requests/approval-request-pending-cancel-001/cancel')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us3-approval-cancel' }));

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body).toEqual(
      expect.objectContaining({
        requestId: 'req-us3-approval-cancel',
        data: expect.objectContaining({
          approvalRequestId: 'approval-request-pending-cancel-001',
          status: 'cancelled'
        })
      })
    );
  });
});
