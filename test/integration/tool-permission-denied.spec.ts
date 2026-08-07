import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('US2 tool permission denied before execution', () => {
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

  it('fails closed before tool execution, keeps unauthorized data out of downstream payloads, and audits the denial', async () => {
    const initialToolCallCount = state.toolCalls.length;
    const initialAuditCount = state.auditEvents.length;

    const response = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(
        createIdentityHeaders({
          'x-request-id': 'req-us2-tool-denied',
          'x-permission-scopes': 'orders:read'
        })
      )
      .send({
        message: '請查 SKU-DEMO-RED 目前庫存',
        pageContext: {
          module: 'inventory',
          entityType: 'item',
          entityId: 'SKU-DEMO-RED',
          visibleColumns: ['availableQuantity', 'incomingQuantity', 'allocatedQuantity']
        }
      });

    expect(response.status).toBe(200);

    const events = parseSseResponse(response.text);
    const eventNames = events.map((event) => event.event);
    const finalEvent = events.find((event) => event.event === 'final');
    const newAuditEvents = state.auditEvents.slice(initialAuditCount);
    const latestAssistantMessage = state.messages[state.messages.length - 1];
    const newToolCalls = state.toolCalls.slice(initialToolCallCount);

    expect(eventNames).toEqual(['tool_call_blocked', 'answer_delta', 'final']);
    expect(eventNames).not.toContain('tool_call_completed');
    expect(eventNames).not.toContain('evidence_attached');
    expect(events.find((event) => event.event === 'tool_call_blocked')?.data?.data).toEqual(
      expect.objectContaining({
        toolName: 'mock.inventory.availability.lookup',
        status: 'blocked',
        executionStatus: 'not_started',
        deniedReason: 'missing_scope'
      })
    );
    expect(newToolCalls).toEqual([
      expect.objectContaining({
        toolName: 'mock.inventory.availability.lookup',
        status: 'blocked',
        executionStatus: 'not_started',
        errorCode: 'missing_scope',
        outputSummary: {}
      })
    ]);
    expect(state.evidenceRefs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: newToolCalls[0]?.id
        })
      ])
    );
    expect(newAuditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'tool_permission_denied',
          metadata: expect.objectContaining({
            deniedReason: 'missing_scope'
          })
        })
      ])
    );
    expect(JSON.stringify(finalEvent?.data)).not.toContain('availableQuantity');
    expect(JSON.stringify(finalEvent?.data)).not.toContain('incomingQuantity');
    expect(JSON.stringify(finalEvent?.data)).not.toContain('allocatedQuantity');
    expect(JSON.stringify(finalEvent?.data)).not.toContain('36');
    expect(JSON.stringify(latestAssistantMessage)).not.toContain('availableQuantity');
    expect(JSON.stringify(latestAssistantMessage)).not.toContain('incomingQuantity');
    expect(JSON.stringify(latestAssistantMessage)).not.toContain('allocatedQuantity');
  });
});
