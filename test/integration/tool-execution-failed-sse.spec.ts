import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('US2 failed tool execution SSE lifecycle', () => {
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

  it('emits failed lifecycle events without completed or evidence events when connector returns NOT_FOUND', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const initialEvidenceRefCount = state.evidenceRefs.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us2-tool-failed',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({
        message: '請查 SO-99999 訂單狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-99999',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const failedEvent = events.find((event) => event.event === 'tool_call_failed');
    const finalEvent = events.find((event) => event.event === 'final');
    const newToolCalls = state.toolCalls.slice(initialToolCallCount);

    expect(eventNames).toEqual(['tool_call_started', 'tool_call_failed', 'answer_delta', 'final']);
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(failedEvent?.data?.data).toEqual(
      expect.objectContaining({
        toolName: 'mock.orders.status.lookup',
        status: 'failed',
        executionStatus: 'failed',
        errorCode: 'NOT_FOUND'
      })
    );
    expect(newToolCalls).toEqual([
      expect.objectContaining({
        toolName: 'mock.orders.status.lookup',
        status: 'failed',
        executionStatus: 'failed',
        errorCode: 'NOT_FOUND',
        outputSummary: {}
      })
    ]);
    expect(state.evidenceRefs).toHaveLength(initialEvidenceRefCount);
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'no_answer',
        evidenceRefs: []
      })
    );
  });
});
