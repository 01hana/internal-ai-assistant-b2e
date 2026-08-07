import { AssistantSseEventBuilder } from '../../src/assistant/sse/assistant-sse-event.builder';
import { AnswerDecisionStatus } from '../../src/generated/prisma/enums';

describe('AssistantSseEventBuilder', () => {
  it('builds the stable US1 event sequence with envelopes', () => {
    const events = new AssistantSseEventBuilder().buildMessageEvents({
      requestId: 'req-sse',
      sessionId: 'session-001',
      messageId: 'message-001',
      toolCallId: 'tool-call-001',
      toolName: 'mock.orders.status.lookup',
      toolLifecycle: 'completed',
      evidenceRefIds: ['evidence-001'],
      answerDelta: '這張訂單目前狀態為已確認',
      finalData: {
        answerDecision: AnswerDecisionStatus.answered,
        answer: '這張訂單目前狀態為已確認。',
        evidenceRefs: ['evidence-001']
      }
    });

    expect(events.map((event) => event.event)).toEqual([
      'tool_call_started',
      'tool_call_completed',
      'evidence_attached',
      'answer_delta',
      'final'
    ]);
    expect(events.map((event) => event.payload.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(events[4].payload.data).toEqual(
      expect.objectContaining({
        answerDecision: AnswerDecisionStatus.answered
      })
    );
  });

  it('omits evidence_attached on completed tool calls without evidence refs', () => {
    const events = new AssistantSseEventBuilder().buildMessageEvents({
      requestId: 'req-sse',
      sessionId: 'session-001',
      messageId: 'message-001',
      toolCallId: 'tool-call-001',
      toolName: 'mock.orders.status.lookup',
      toolLifecycle: 'completed',
      evidenceRefIds: [],
      answerDelta: '目前沒有足夠 evidence 可以回答',
      finalData: {
        answerDecision: AnswerDecisionStatus.no_answer,
        answer: '目前沒有足夠 evidence 可以回答這個問題。',
        evidenceRefs: []
      }
    });

    expect(events.map((event) => event.event)).toEqual(['tool_call_started', 'tool_call_completed', 'answer_delta', 'final']);
    expect(events.map((event) => event.payload.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('builds blocked lifecycle events without started, completed, or evidence events', () => {
    const events = new AssistantSseEventBuilder().buildMessageEvents({
      requestId: 'req-sse',
      sessionId: 'session-001',
      messageId: 'message-001',
      toolCallId: 'tool-call-001',
      toolName: 'mock.inventory.availability.lookup',
      toolLifecycle: 'blocked',
      deniedReason: 'missing_scope',
      evidenceRefIds: [],
      answerDelta: '目前沒有足夠 evidence 可以回答',
      finalData: {
        answerDecision: AnswerDecisionStatus.no_answer,
        answer: '目前沒有足夠 evidence 可以回答這個問題。',
        evidenceRefs: []
      }
    });

    expect(events.map((event) => event.event)).toEqual(['tool_call_blocked', 'answer_delta', 'final']);
    expect(events[0].payload.data).toEqual(
      expect.objectContaining({
        toolCallId: 'tool-call-001',
        toolName: 'mock.inventory.availability.lookup',
        status: 'blocked',
        executionStatus: 'not_started',
        deniedReason: 'missing_scope'
      })
    );
  });

  it('builds failed lifecycle events without completed or evidence events', () => {
    const events = new AssistantSseEventBuilder().buildMessageEvents({
      requestId: 'req-sse',
      sessionId: 'session-001',
      messageId: 'message-001',
      toolCallId: 'tool-call-001',
      toolName: 'mock.orders.status.lookup',
      toolLifecycle: 'failed',
      errorCode: 'NOT_FOUND',
      evidenceRefIds: [],
      answerDelta: '目前沒有足夠 evidence 可以回答',
      finalData: {
        answerDecision: AnswerDecisionStatus.no_answer,
        answer: '目前沒有足夠 evidence 可以回答這個問題。',
        evidenceRefs: []
      }
    });

    expect(events.map((event) => event.event)).toEqual(['tool_call_started', 'tool_call_failed', 'answer_delta', 'final']);
    expect(events[1].payload.data).toEqual(
      expect.objectContaining({
        toolCallId: 'tool-call-001',
        toolName: 'mock.orders.status.lookup',
        status: 'failed',
        executionStatus: 'failed',
        errorCode: 'NOT_FOUND'
      })
    );
  });

  it('builds an SSE error event envelope', () => {
    expect(
      new AssistantSseEventBuilder().buildErrorEvent({
        requestId: 'req-sse-error',
        sessionId: 'session-001',
        code: 'NOT_FOUND',
        message: 'Assistant session not found.'
      })
    ).toEqual(
      expect.objectContaining({
        event: 'error',
        payload: expect.objectContaining({
          requestId: 'req-sse-error',
          eventType: 'error',
          sequence: 1
        })
      })
    );
  });
});
