import { AnswerDecisionStatus } from '../../generated/prisma/enums';
import { SseEventEnvelope } from '../../common/sse/sse-event.types';
import { ToolPermissionDeniedReason } from '../../tools/tool-registry.types';

export type AssistantToolLifecycle = 'completed' | 'blocked' | 'failed';

export interface AssistantSseBuildInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  toolLifecycle: AssistantToolLifecycle;
  deniedReason?: ToolPermissionDeniedReason;
  errorCode?: string;
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
