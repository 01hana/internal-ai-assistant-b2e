import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('US4 clarification required gate', () => {
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

  it('creates a clarification question and does not execute a tool when selected rows are ambiguous', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const initialClarificationCount = state.clarificationQuestions.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us4-clarification-missing-context'
        })
      )
      .send({
        message: '目前狀態？',
        pageContext: {
          module: 'orders',
          screenId: 'order-list',
          selectedRows: [
            { id: 'SO-10001', data: { entityType: 'order' } },
            { id: 'SO-10002', data: { entityType: 'order' } }
          ],
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newClarifications = state.clarificationQuestions.slice(initialClarificationCount);
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);
    const latestContextState = [...state.contextStates]
      .filter((contextState) => contextState.sessionId === 'session-owned-001')
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];

    expect(eventNames).toEqual(['answer_delta', 'final']);
    expect(eventNames).not.toContain('tool_call_started');
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(state.toolCalls).toHaveLength(initialToolCallCount);
    expect(newClarifications).toEqual([
      expect.objectContaining({
        requestId: 'req-us4-clarification-missing-context',
        question: expect.stringContaining('請'),
        status: 'pending'
      })
    ]);
    expect(finalEvent?.data?.data).toEqual(
      expect.objectContaining({
        answerDecision: 'clarification_required',
        answer: newClarifications[0].question,
        clarificationQuestionId: newClarifications[0].id,
        evidenceRefs: []
      })
    );
    expect(latestContextState).toEqual(
      expect.objectContaining({
        taskState: 'waiting_clarification',
        pendingClarification: expect.objectContaining({
          clarificationQuestionId: newClarifications[0].id,
          reason: 'multiple_candidates',
          question: newClarifications[0].question,
          candidateRefs: expect.any(Array),
          blocking: true
        })
      })
    );
    expect(JSON.stringify(latestContextState.pendingClarification)).not.toContain('visibleColumns');
    expect(JSON.stringify(latestContextState.pendingClarification)).not.toContain('status');
    expect(JSON.stringify(latestContextState.pendingClarification)).not.toContain('customerName');
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'clarification_question_created',
          metadata: expect.objectContaining({
            clarificationQuestionId: newClarifications[0].id,
            blocking: true
          })
        }),
        expect.objectContaining({
          eventType: 'answer_generated',
          decision: 'clarification_required'
        })
      ])
    );
    expect(JSON.stringify(newAuditEvents)).not.toContain('目前狀態');
  });

  it('blocks same-anchor metadata ambiguity before tool execution', async () => {
    const original = state.toolDefinitions.find((tool) => tool.name === 'mock.orders.status.lookup');
    if (!original) throw new Error('Missing order lookup fixture.');
    state.toolDefinitions.push({ ...original, id: 'tool-definition-orders-ambiguous-001', name: 'generic.orders.status.alternate' });
    state.customerToolPolicies.push({
      customerId: 'customer-a', toolDefinitionId: 'tool-definition-orders-ambiguous-001',
      enabled: true, requiredRoles: [], requiredPermissionScopes: []
    });
    const initialToolCallCount = state.toolCalls.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-tool-metadata-ambiguity' }))
      .send({
        message: '請查 SO-10001 訂單目前狀態',
        pageContext: { module: 'orders', entityType: 'order', entityId: 'SO-10001', visibleColumns: ['status'] }
      });

    expect(response.status).toBe(200);
    expect(state.toolCalls).toHaveLength(initialToolCallCount);
    expect(state.clarificationQuestions.at(-1)).toEqual(expect.objectContaining({ reason: 'tool_ambiguity' }));
    expect(parseSseResponse(response.text).map(({ event }) => event)).toEqual(['answer_delta', 'final']);
  });
});
