import { Prisma } from '../../generated/prisma/client';
import { AnswerDecisionStatus, NoAnswerReason } from '../../generated/prisma/enums';
import { PersistedExecutionPlan } from '../planning/assistant-planning.types';
import { CustomerScope } from '../../identity/customer-scope.types';
import type { GroundedContextBundleV1 } from '../grounding/grounded-context-bundle.types';
import type { FollowUpResolutionDecision } from '../conversation/conversation.types';
import type { RetrievalMode } from '../../retrieval/grounded-retrieval.types';

export interface AnswerPlan {
  answerType: 'grounded_text' | 'clarification' | 'no_answer';
  expectedAnswerShape: unknown;
  selectedEvidenceRefs: string[];
  allowedClaims: string[];
  disallowedClaims: string[];
  missingInformation: string[];
}

export interface BuildAnswerDecisionInput {
  customerScope: CustomerScope;
  requestId: string;
  messageId: string;
  executionPlan: PersistedExecutionPlan;
  evidenceRefs: Array<{
    id: string;
    summary: Record<string, unknown>;
  }>;
  groundedContextBundle?: GroundedContextBundleV1;
  followUpResolution?: FollowUpResolutionDecision;
  retrievalMode?: RetrievalMode;
}

export interface RecordSafeAnswerDecisionInput {
  customerScope: CustomerScope;
  requestId: string;
  messageId: string;
  status: AnswerDecisionStatus;
  noAnswerReason?: NoAnswerReason;
  clarificationQuestionId?: string;
  metadata?: Prisma.InputJsonValue;
  answer: {
    text: string;
    delta: string;
  };
  grounding?: {
    covered: boolean;
    checkedClaimCount?: number;
    unsupportedClaimCount?: number;
    evidenceRefIds?: string[];
    metadata?: Prisma.InputJsonValue;
  };
}

export interface PersistedAnswerDecisionResult {
  status: AnswerDecisionStatus;
  answerPlan: AnswerPlan;
  answer: {
    text: string;
    delta: string;
  };
  groundingCheckId?: string;
  answerDecisionId: string;
}
