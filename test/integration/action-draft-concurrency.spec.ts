import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { MockConnectorAdapter } from '../../src/connectors/mock/mock-connector.adapter';
import { createAuthorizedInternalIdentityHeaders, createUs1TestAppWithState, Us1TestState } from '../support/us1-test-app.helper';
import { createInternalIdentityJwtFixture, TEST_BACKEND_AUDIENCE, TEST_GATEWAY_ISSUER } from '../support/internal-identity-jwt.helper';

describe('Action Draft concurrent confirmation characterization', () => {
  const jwt = createInternalIdentityJwtFixture();
  const draftId = 'action-draft-waiting-001';
  let app: INestApplication;
  let state: Us1TestState;
  let prismaMock: Record<string, any>;
  let connector: MockConnectorAdapter;

  beforeEach(async () => {
    ({ app, state, prismaMock } = await createUs1TestAppWithState({
      internalIdentity: { issuer: TEST_GATEWAY_ISSUER, audience: TEST_BACKEND_AUDIENCE, jwks: jwt.jwks }
    }));
    connector = app.get(MockConnectorAdapter);
  });
  afterEach(async () => app?.close());

  it('reserves one side effect when distinct keys both observe no prior workflow ToolCall', async () => {
    const atRead = pauseTwoSourceReads(prismaMock);
    const connectorExecute = jest.spyOn(connector, 'execute');
    const responses = await Promise.all([
      confirm('req-concurrent-key-a', 'idem-concurrent-a'),
      confirm('req-concurrent-key-b', 'idem-concurrent-b')
    ]);

    expect(atRead.arrivals()).toBe(2);
    expect(connectorExecute).toHaveBeenCalledTimes(1);
    expect(sourceCalls()).toHaveLength(1);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('reserves one side effect for concurrent same-key requests', async () => {
    const atRead = pauseTwoSourceReads(prismaMock);
    const connectorExecute = jest.spyOn(connector, 'execute');
    const responses = await Promise.all([
      confirm('req-concurrent-same-a', 'idem-concurrent-same'),
      confirm('req-concurrent-same-b', 'idem-concurrent-same')
    ]);

    expect(atRead.arrivals()).toBe(2);
    expect(connectorExecute).toHaveBeenCalledTimes(1);
    expect(sourceCalls()).toHaveLength(1);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  });

  it('allows distinct Action Drafts to execute concurrently', async () => {
    const connectorExecute = jest.spyOn(connector, 'execute');
    const responses = await Promise.all([
      confirm('req-distinct-draft-a', 'idem-distinct-draft-a'),
      request(app.getHttpServer())
        .post('/api/v1/assistant/action-drafts/action-draft-draft-001/confirm')
        .set(createAuthorizedInternalIdentityHeaders(jwt, {
          claims: { ...jwt.canonicalClaims.customerA, permission_scopes: ['orders:read', 'orders:update'] },
          requestId: 'req-distinct-draft-b'
        }))
        .send({ idempotencyKey: 'idem-distinct-draft-b' })
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(connectorExecute).toHaveBeenCalledTimes(2);
    expect(state.toolCalls.filter((call) => (call.inputSummary as { sourceType?: string } | null)?.sourceType === 'action_draft' &&
      ['action-draft-waiting-001', 'action-draft-draft-001'].includes((call.inputSummary as { sourceId?: string }).sourceId ?? ''))).toHaveLength(2);
  });

  it('keeps in-progress duplicate and foreign Integration requests from starting another side effect', async () => {
    const originalExecute = connector.execute.bind(connector);
    let entered!: () => void;
    let release!: () => void;
    const insideConnector = new Promise<void>((resolve) => { entered = resolve; });
    const connectorGate = new Promise<void>((resolve) => { release = resolve; });
    const connectorExecute = jest.spyOn(connector, 'execute').mockImplementation(async (input) => {
      entered();
      await connectorGate;
      return originalExecute(input);
    });
    const first = confirm('req-in-progress-original', 'idem-in-progress').then((response) => response);
    await insideConnector;

    try {
      expect(sourceCalls()).toEqual([expect.objectContaining({ status: 'pending', executionStatus: 'in_progress' })]);
      const [sameKey, otherKey, foreignIntegration] = await Promise.all([
        confirm('req-in-progress-same', 'idem-in-progress'),
        confirm('req-in-progress-other', 'idem-in-progress-other'),
        confirm('req-in-progress-foreign', 'idem-in-progress-foreign', 'integration-other')
      ]);
      expect([sameKey.status, otherKey.status, foreignIntegration.status]).toEqual([409, 409, 404]);
      expect(sourceCalls()).toHaveLength(1);
      expect(connectorExecute).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }

    expect((await first).status).toBe(200);
    expect(sourceCalls()).toEqual([expect.objectContaining({ status: 'success', executionStatus: 'executed' })]);
  });

  it('does not re-execute after a successful ToolCall whose Action Draft audit finalization failed', async () => {
    state.workflowAuditFailureEventTypes.push('action_draft_confirmed');
    const connectorExecute = jest.spyOn(connector, 'execute');
    const first = await confirm('req-audit-failure-original', 'idem-audit-failure');
    expect(first.status).toBe(500);
    expect(sourceCalls()).toEqual([expect.objectContaining({ status: 'success', executionStatus: 'executed' })]);
    expect(state.actionDrafts.find((draft) => draft.id === draftId)?.status).toBe('waiting_confirmation');

    const retries = await Promise.all([
      confirm('req-audit-failure-retry-a', 'idem-audit-failure'),
      confirm('req-audit-failure-retry-b', 'idem-audit-failure')
    ]);
    expect(retries.every((response) => response.status === 200 || response.status === 409)).toBe(true);
    expect(connectorExecute).toHaveBeenCalledTimes(1);
    expect(sourceCalls()).toHaveLength(1);
    expect(state.actionDrafts.find((draft) => draft.id === draftId)?.status).toBe('executed');
  });

  it('does not turn a failed ToolCall into success when two different-key confirmations arrive', async () => {
    const failed = state.toolCalls[0];
    state.toolCalls.push({
      ...failed,
      id: 'tool-call-failed-before-retry',
      toolDefinitionId: 'tool-definition-orders-update-001',
      toolName: 'mock.orders.status.update',
      toolVersion: '1.0.0',
      inputSummary: { sourceType: 'action_draft', sourceId: draftId, entityId: 'SO-10001' },
      status: 'failed',
      executionStatus: 'failed',
      idempotencyKey: 'idem-failed-original'
    });
    const connectorExecute = jest.spyOn(connector, 'execute');
    const responses = await Promise.all([
      confirm('req-failed-retry-a', 'idem-failed-new-a'),
      confirm('req-failed-retry-b', 'idem-failed-new-b')
    ]);
    expect(responses.map((response) => response.status)).toEqual([409, 409]);
    expect(connectorExecute).not.toHaveBeenCalled();
    expect(sourceCalls()).toHaveLength(1);
    expect(state.actionDrafts.find((draft) => draft.id === draftId)?.status).toBe('waiting_confirmation');
  });

  function confirm(requestId: string, idempotencyKey: string, integrationId?: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/assistant/action-drafts/${draftId}/confirm`)
      .set(createAuthorizedInternalIdentityHeaders(jwt, {
        claims: {
          ...jwt.canonicalClaims.customerA,
          ...(integrationId ? { integration_id: integrationId } : {}),
          permission_scopes: ['orders:read', 'orders:update']
        },
        requestId
      }))
      .send({ idempotencyKey });
  }

  function sourceCalls() {
    return state.toolCalls.filter((call) => (call.inputSummary as { sourceId?: string } | null)?.sourceId === draftId);
  }
});

function pauseTwoSourceReads(prismaMock: Record<string, any>) {
  const originalFindMany = prismaMock.toolCall.findMany.getMockImplementation();
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  prismaMock.toolCall.findMany.mockImplementation(async (args: { where: { sessionId?: string } }) => {
    const result = await originalFindMany(args);
    if (args.where.sessionId === 'session-owned-001') {
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
    }
    return result;
  });
  return { arrivals: () => arrivals };
}
