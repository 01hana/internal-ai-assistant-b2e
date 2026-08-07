import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createIdentityHeaders, createUs1TestAppWithState, parseSseResponse, Us1TestState } from '../support/us1-test-app.helper';

describe('message history evidence link integration', () => {
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

  it('returns assistant message evidence refs for the same reply after sending a new message', async () => {
    const postResponse = await request(app.getHttpServer())
      .post('/api/v1/assistant/sessions/session-owned-001/messages')
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-history-link-send' }))
      .send({
        message: '請幫我查 SO-10001 訂單目前狀態',
        pageContext: {
          module: 'orders',
          entityType: 'order',
          entityId: 'SO-10001',
          visibleColumns: ['status', 'customerName']
        }
      });

    expect(postResponse.status).toBe(200);

    const events = parseSseResponse(postResponse.text);
    expect(events.map((event) => event.event)).toEqual([
      'tool_call_started',
      'tool_call_completed',
      'evidence_attached',
      'answer_delta',
      'final'
    ]);

    const toolCallStartedEvent = events.find((event) => event.event === 'tool_call_started');
    const finalEvent = events.find((event) => event.event === 'final');

    expect(finalEvent?.data).toEqual(
      expect.objectContaining({
        messageId: expect.any(String),
        data: expect.objectContaining({
          evidenceRefs: expect.arrayContaining([expect.any(String)])
        })
      })
    );

    const assistantMessageId = finalEvent?.data?.messageId as string;
    const toolCallId = toolCallStartedEvent?.data?.data?.toolCallId as string;
    const expectedEvidenceRefs = finalEvent?.data?.data?.evidenceRefs as string[];
    const finalAnswerJson = JSON.stringify(finalEvent?.data?.data);

    expect(toolCallId).toEqual(expect.any(String));
    expect(finalAnswerJson).not.toContain('amount');
    expect(finalAnswerJson).not.toContain('128000');

    const historyResponse = await request(app.getHttpServer())
      .get('/api/v1/assistant/sessions/session-owned-001/messages')
      .query({ limit: 50, order: 'asc' })
      .set(createIdentityHeaders({ 'x-request-id': 'req-us1-history-link-read' }));

    expect(historyResponse.status).toBe(200);
    expect(JSON.stringify(historyResponse.body.data)).not.toContain('amount');
    expect(JSON.stringify(historyResponse.body.data)).not.toContain('128000');

    const createdAssistantMessage = historyResponse.body.data.messages.find(
      (message: { messageId: string }) => message.messageId === assistantMessageId
    );

    expect(createdAssistantMessage).toEqual(
      expect.objectContaining({
        role: 'assistant',
        evidenceRefs: expectedEvidenceRefs,
        toolSummary: expect.objectContaining({
          toolCallIds: expect.arrayContaining([toolCallId])
        })
      })
    );

    const userMessage = state.messages.find(
      (message) => message.requestId === 'req-us1-history-link-send' && message.role === 'user'
    );
    const persistedAssistantMessage = state.messages.find((message) => message.id === assistantMessageId);
    const persistedToolCall = state.toolCalls.find((toolCall) => toolCall.id === toolCallId);
    const persistedEvidenceRef = state.evidenceRefs.find((evidenceRef) => expectedEvidenceRefs.includes(evidenceRef.id));

    expect(userMessage?.id).toEqual(expect.any(String));
    expect(persistedAssistantMessage).toEqual(
      expect.objectContaining({
        id: assistantMessageId,
        role: 'assistant',
        answerDecision: expect.any(String)
      })
    );
    expect(persistedAssistantMessage?.content).not.toContain('amount');
    expect(persistedAssistantMessage?.content).not.toContain('128000');
    expect(persistedToolCall).toEqual(
      expect.objectContaining({
        id: toolCallId,
        messageId: assistantMessageId
      })
    );
    expect(persistedEvidenceRef).toEqual(
      expect.objectContaining({
        messageId: assistantMessageId,
        toolCallId
      })
    );
    expect(persistedToolCall?.messageId).not.toBe(userMessage?.id);
    expect(persistedEvidenceRef?.messageId).not.toBe(userMessage?.id);
    expect(JSON.stringify(persistedToolCall?.outputSummary)).not.toContain('amount');
    expect(JSON.stringify(persistedToolCall?.outputSummary)).not.toContain('128000');
    expect(JSON.stringify(persistedEvidenceRef?.summary)).not.toContain('amount');
    expect(JSON.stringify(persistedEvidenceRef?.summary)).not.toContain('128000');
  });
});
