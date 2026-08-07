import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestApp } from '../support/us1-test-app.helper';

describe('US3 EscalationRequest contract', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createUs1TestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns requestId envelope for get/list/resolve/cancel endpoints', async () => {
    const getResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests/escalation-request-open-001')
      .set(createIdentityHeaders({ 'x-request-id': 'req-contract-escalation-get' }));
    expect(getResponse.status).toBe(200);
    expect(getResponse.body).toEqual(
      expect.objectContaining({
        requestId: 'req-contract-escalation-get',
        data: expect.objectContaining({
          escalationRequestId: 'escalation-request-open-001',
          status: 'open',
          summary: expect.any(Object)
        })
      })
    );

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-contract-escalation-list',
          'x-actor-id': 'approver-001',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items).toEqual(expect.any(Array));

    const resolveResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/escalation-requests/escalation-request-open-001/resolve')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-contract-escalation-resolve',
          'x-actor-id': 'approver-001',
          'x-role': 'approver',
          'x-permission-scopes': 'orders:read,orders:approve'
        })
      )
      .send({ reason: 'done' });
    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body.data.status).toBe('resolved');
  });

  it('fails closed for invisible escalation requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests/escalation-request-open-001')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-contract-escalation-hidden',
          'x-host-app': 'crm'
        })
      );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(
      expect.objectContaining({
        requestId: 'req-contract-escalation-hidden',
        error: expect.objectContaining({
          message: 'Escalation request not found.'
        })
      })
    );
  });

  it('supports status, riskLevel, requesterActorId, and combined list filters', async () => {
    const managerHeaders = createIdentityHeaders({
      'x-request-id': 'req-contract-escalation-filter',
      'x-actor-id': 'approver-001',
      'x-role': 'approver',
      'x-permission-scopes': 'orders:read,orders:approve'
    });

    const openResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests?status=open')
      .set(managerHeaders);
    expect(openResponse.status).toBe(200);
    expect(openResponse.body.data.items.every((item: { status: string }) => item.status === 'open')).toBe(true);
    expect(openResponse.body.data.items.map((item: { escalationRequestId: string }) => item.escalationRequestId)).toContain(
      'escalation-request-open-001'
    );

    const expiredResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests?status=expired')
      .set(managerHeaders);
    expect(expiredResponse.status).toBe(200);
    expect(expiredResponse.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          escalationRequestId: 'escalation-request-expired-001',
          status: 'expired'
        })
      ])
    );

    const riskResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests?riskLevel=critical')
      .set(managerHeaders);
    expect(riskResponse.status).toBe(200);
    expect(riskResponse.body.data.items.every((item: { summary: { riskLevel: string } }) => item.summary.riskLevel === 'critical')).toBe(true);

    const requesterResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests?requesterActorId=actor-001')
      .set(managerHeaders);
    expect(requesterResponse.status).toBe(200);
    expect(
      requesterResponse.body.data.items.every((item: { summary: { requesterActorId: string } }) => item.summary.requesterActorId === 'actor-001')
    ).toBe(true);

    const combinedResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/escalation-requests?status=open&riskLevel=critical&requesterActorId=actor-001')
      .set(managerHeaders);
    expect(combinedResponse.status).toBe(200);
    expect(combinedResponse.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          escalationRequestId: 'escalation-request-open-001',
          status: 'open',
          summary: expect.objectContaining({
            riskLevel: 'critical',
            requesterActorId: 'actor-001'
          })
        })
      ])
    );
    expect(combinedResponse.body.data.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          escalationRequestId: 'escalation-request-hidden-actor-001'
        })
      ])
    );
  });
});
