import { createSseEvent, SseSequence, toNestMessageEvent } from '../../src/common/sse/sse-event.helper';

describe('SSE helpers', () => {
  it('creates ordered SSE envelopes and Nest message events', () => {
    const sequence = new SseSequence();
    const event = createSseEvent({
      requestId: 'req-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      eventType: 'answer_delta',
      sequence: sequence.next(),
      data: {
        delta: 'hello'
      }
    });

    expect(event).toMatchObject({
      requestId: 'req-001',
      sessionId: 'session-001',
      messageId: 'message-001',
      eventType: 'answer_delta',
      sequence: 1
    });
    expect(toNestMessageEvent(event)).toMatchObject({
      type: 'answer_delta',
      data: event
    });
  });
});
