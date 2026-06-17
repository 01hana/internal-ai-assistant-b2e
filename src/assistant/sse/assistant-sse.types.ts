import { AnswerDecisionStatus } from '../../generated/prisma/enums';
import { SseEventEnvelope } from '../../common/sse/sse-event.types';

export interface AssistantSseBuildInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  evidenceRefIds: string[];
  answerDelta: string;
  finalData: {
    answerDecision: AnswerDecisionStatus;
    answer: string;
    evidenceRefs: string[];
  };
}

export interface AssistantSseEventRecord<TData = unknown> {
  event: string;
  payload: SseEventEnvelope<TData>;
}
