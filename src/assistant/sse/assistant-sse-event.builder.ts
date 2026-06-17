import { Injectable } from '@nestjs/common';
import { createSseEvent, SseSequence } from '../../common/sse/sse-event.helper';
import { SseEventEnvelope } from '../../common/sse/sse-event.types';
import { AssistantSseBuildInput, AssistantSseEventRecord } from './assistant-sse.types';

@Injectable()
export class AssistantSseEventBuilder {
  buildMessageEvents(input: AssistantSseBuildInput): AssistantSseEventRecord[] {
    const sequence = new SseSequence();

    return [
      this.wrap(
        createSseEvent({
          requestId: input.requestId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          eventType: 'tool_call_started',
          sequence: sequence.next(),
          data: {
            toolCallId: input.toolCallId
          }
        })
      ),
      this.wrap(
        createSseEvent({
          requestId: input.requestId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          eventType: 'tool_call_completed',
          sequence: sequence.next(),
          data: {
            toolCallId: input.toolCallId,
            status: 'completed'
          }
        })
      ),
      this.wrap(
        createSseEvent({
          requestId: input.requestId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          eventType: 'evidence_attached',
          sequence: sequence.next(),
          data: {
            evidenceRefs: input.evidenceRefIds
          }
        })
      ),
      this.wrap(
        createSseEvent({
          requestId: input.requestId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          eventType: 'answer_delta',
          sequence: sequence.next(),
          data: {
            delta: input.answerDelta
          }
        })
      ),
      this.wrap(
        createSseEvent({
          requestId: input.requestId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          eventType: 'final',
          sequence: sequence.next(),
          data: input.finalData
        })
      )
    ];
  }

  buildErrorEvent(input: { requestId: string; sessionId: string; code: string; message: string }): AssistantSseEventRecord {
    return this.wrap(
      createSseEvent({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.sessionId,
        eventType: 'error',
        sequence: 1,
        data: {
          code: input.code,
          message: input.message
        }
      })
    );
  }

  private wrap<TData>(payload: SseEventEnvelope<TData>): AssistantSseEventRecord<TData> {
    return {
      event: payload.eventType,
      payload
    };
  }
}
