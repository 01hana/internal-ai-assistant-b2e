import { AssistantSseEventBuilder } from '../../src/assistant/sse/assistant-sse-event.builder';
import { AnswerDecisionStatus } from '../../src/generated/prisma/enums';

describe('AssistantSseEventBuilder', () => {
  it('builds the stable US1 event sequence with envelopes', () => {
    const events = new AssistantSseEventBuilder().buildMessageEvents({
      requestId: 'req-sse',
      sessionId: 'session-001',
      messageId: 'message-001',
      toolCallId: 'tool-call-001',
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
