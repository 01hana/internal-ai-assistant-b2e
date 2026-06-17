import { Injectable } from '@nestjs/common';
import { createSseEvent, SseSequence } from '../../common/sse/sse-event.helper';
import { SseEventEnvelope } from '../../common/sse/sse-event.types';
import { AssistantSseBuildInput, AssistantSseEventRecord } from './assistant-sse.types';

@Injectable()
export class AssistantSseEventBuilder {
  buildMessageEvents(input: AssistantSseBuildInput): AssistantSseEventRecord[] {
    const sequence = new SseSequence();
    const events: AssistantSseEventRecord[] = [];

    if (input.toolLifecycle === 'completed') {
      events.push(this.buildToolStartedEvent(input, sequence));
      events.push(
        this.wrap(
          createSseEvent({
            requestId: input.requestId,
            sessionId: input.sessionId,
            messageId: input.messageId,
            eventType: 'tool_call_completed',
            sequence: sequence.next(),
            data: {
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              status: 'completed',
              executionStatus: 'executed'
            }
          })
        )
      );

      if (input.evidenceRefIds.length > 0) {
        events.push(
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
          )
        );
      }
    }

    if (input.toolLifecycle === 'blocked') {
      events.push(
        this.wrap(
          createSseEvent({
            requestId: input.requestId,
            sessionId: input.sessionId,
            messageId: input.messageId,
            eventType: 'tool_call_blocked',
            sequence: sequence.next(),
            data: {
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              status: 'blocked',
              executionStatus: 'not_started',
              deniedReason: input.deniedReason
            }
          })
        )
      );
    }

    if (input.toolLifecycle === 'failed') {
      events.push(this.buildToolStartedEvent(input, sequence));
      events.push(
        this.wrap(
          createSseEvent({
            requestId: input.requestId,
            sessionId: input.sessionId,
            messageId: input.messageId,
            eventType: 'tool_call_failed',
            sequence: sequence.next(),
            data: {
              toolCallId: input.toolCallId,
              toolName: input.toolName,
              status: 'failed',
              executionStatus: 'failed',
              errorCode: input.errorCode
            }
          })
        )
      );
    }

    events.push(
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
      )
    );
    events.push(
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
    );

    return events;
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

  private buildToolStartedEvent(input: AssistantSseBuildInput, sequence: SseSequence): AssistantSseEventRecord {
    return this.wrap(
      createSseEvent({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        eventType: 'tool_call_started',
        sequence: sequence.next(),
        data: {
          toolCallId: input.toolCallId,
          toolName: input.toolName
        }
      })
    );
  }
}
