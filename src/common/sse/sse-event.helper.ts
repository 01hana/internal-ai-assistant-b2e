import { MessageEvent } from '@nestjs/common';
import { SseEventEnvelope, SseEventType } from './sse-event.types';

export class SseSequence {
  private current = 0;

  next() {
    this.current += 1;
    return this.current;
  }
}

export type CreateSseEventInput<TData> = {
  requestId: string;
  sessionId: string;
  messageId: string;
  eventType: SseEventType;
  data: TData;
  sequence: number;
};

export function createSseEvent<TData>(input: CreateSseEventInput<TData>): SseEventEnvelope<TData> {
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    eventType: input.eventType,
    sequence: input.sequence,
    data: input.data
  };
}

export function toNestMessageEvent<TData>(event: SseEventEnvelope<TData>): MessageEvent {
  return {
    type: event.eventType,
    data: event
  };
}
