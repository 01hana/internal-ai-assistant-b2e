export type SseEventType =
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'evidence_attached'
  | 'approval_required'
  | 'confirmation_required'
  | 'answer_delta'
  | 'final'
  | 'error';

export type SseEventEnvelope<TData = unknown> = {
  requestId: string;
  sessionId: string;
  messageId: string;
  eventType: SseEventType;
  sequence: number;
  data: TData;
};
