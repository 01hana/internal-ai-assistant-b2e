import { Prisma } from '../../generated/prisma/client';
import { AnswerDecisionStatus, NoAnswerReason } from '../../generated/prisma/enums';
import { PersistedExecutionPlan } from '../planning/assistant-planning.types';

export interface AnswerPlan {
  answerType: 'grounded_text' | 'clarification' | 'no_answer';
  expectedAnswerShape: unknown;
  selectedEvidenceRefs: string[];
  allowedClaims: string[];
  disallowedClaims: string[];
  missingInformation: string[];
}

export interface BuildAnswerDecisionInput {
  requestId: string;
  messageId: string;
  executionPlan: PersistedExecutionPlan;
  evidenceRefs: Array<{
    id: string;
    summary: Record<string, unknown>;
  }>;
}

export interface RecordSafeAnswerDecisionInput {
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
