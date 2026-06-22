import { Injectable } from '@nestjs/common';
import { AnswerDecisionStatus, ExecutionDecision, NoAnswerReason, RiskLevel } from '../../generated/prisma/enums';
import { AssistantReadonlyRuntimeResult } from '../runtime/runtime.types';
import { AssistantPlanningResult } from '../planning/assistant-planning.types';
import { EvidenceConflictResult } from './evidence-conflict-detector.service';

export type AssistantSafeGateDecision =
  | {
      kind: 'clarification';
      status: typeof AnswerDecisionStatus.clarification_required;
      question: string;
      reason: NoAnswerReason;
      clarificationReason: string;
      candidateRefs: unknown[];
      blocking: boolean;
    }
  | {
      kind: 'no_answer';
      status: typeof AnswerDecisionStatus.no_answer | typeof AnswerDecisionStatus.permission_denied | typeof AnswerDecisionStatus.tool_failed;
      noAnswerReason: NoAnswerReason;
      answer: string;
      delta: string;
      errorCode?: string;
      permissionDeniedReason?: string;
      toolFailureReason?: string;
      conflictReason?: string;
      conflictFieldPaths?: string[];
      conflictEvidenceRefIds?: string[];
    };

@Injectable()
export class NoAnswerGateService {
  evaluatePreRuntime(planningResult: AssistantPlanningResult): AssistantSafeGateDecision | undefined {
    const blockingNeed = planningResult.queryUnderstanding.clarificationNeeds.find((need) => need.blocking);
    const shouldClarifyReadOnly =
      planningResult.executionPlan.riskAssessment === RiskLevel.low &&
      (planningResult.executionPlan.decision === ExecutionDecision.clarify ||
        planningResult.queryUnderstanding.confidence < 0.7 ||
        planningResult.queryUnderstanding.clarificationNeeds.length > 0);

    if (!blockingNeed && !shouldClarifyReadOnly) {
      return undefined;
    }

    const need = blockingNeed ?? planningResult.queryUnderstanding.clarificationNeeds[0];
    const reason = toNoAnswerReason(need?.reason, planningResult.queryUnderstanding.confidence);
    return {
      kind: 'clarification',
      status: AnswerDecisionStatus.clarification_required,
      question: toClarificationQuestion(need?.reason, need?.question),
      reason,
      clarificationReason: need?.reason ?? (planningResult.queryUnderstanding.confidence < 0.7 ? 'low_confidence' : 'ambiguous_query'),
      candidateRefs: Array.isArray(need?.candidateRefs) ? need.candidateRefs : [],
      blocking: need?.blocking ?? true
    };
  }

  evaluatePostRuntime(input: {
    runtimeResult: AssistantReadonlyRuntimeResult;
    evidenceRefCount: number;
  }): AssistantSafeGateDecision | undefined {
    if (input.runtimeResult.toolLifecycle === 'failed') {
      return {
        kind: 'no_answer',
        status: AnswerDecisionStatus.no_answer,
        noAnswerReason: NoAnswerReason.tool_failure,
        answer: '目前無法取得工具結果，因此不能產生確定答案。請稍後再試或改用其他查詢條件。',
        delta: '目前無法取得工具結果',
        errorCode: input.runtimeResult.connectorErrorCode,
        toolFailureReason: input.runtimeResult.connectorErrorCode
      };
    }

    if (input.runtimeResult.toolLifecycle === 'blocked') {
      return {
        kind: 'no_answer',
        status: AnswerDecisionStatus.permission_denied,
        noAnswerReason: NoAnswerReason.permission_denied,
        answer: '目前權限不足，無法取得足夠 evidence 來回答這個問題。',
        delta: '目前權限不足，無法取得足夠 evidence',
        permissionDeniedReason: input.runtimeResult.deniedReason
      };
    }

    if (input.runtimeResult.toolLifecycle === 'completed' && input.evidenceRefCount === 0) {
      return {
        kind: 'no_answer',
        status: AnswerDecisionStatus.no_answer,
        noAnswerReason: NoAnswerReason.no_evidence,
        answer: '目前沒有足夠 evidence 可以回答這個問題。',
        delta: '目前沒有足夠 evidence 可以回答'
      };
    }

    return undefined;
  }

  evaluateEvidenceConflict(conflict: EvidenceConflictResult): AssistantSafeGateDecision | undefined {
    if (!conflict.hasConflict) {
      return undefined;
    }

    return {
      kind: 'no_answer',
      status: AnswerDecisionStatus.no_answer,
      noAnswerReason: NoAnswerReason.evidence_conflict,
      answer: '目前 evidence 之間有衝突，無法產生確定答案。',
      delta: '目前 evidence 之間有衝突',
      conflictReason: conflict.conflictReason,
      conflictFieldPaths: conflict.conflictFieldPaths,
      conflictEvidenceRefIds: conflict.evidenceRefIds
    };
  }
}

function toNoAnswerReason(reason: string | undefined, confidence: number): NoAnswerReason {
  if (reason === 'missing_page_context') {
    return NoAnswerReason.missing_page_context;
  }
  if (reason === 'multiple_candidates' || reason === 'ambiguous_reference' || reason === 'entity_conflict') {
    return NoAnswerReason.ambiguous_query;
  }
  if (confidence < 0.7) {
    return NoAnswerReason.low_confidence;
  }

  return NoAnswerReason.ambiguous_query;
}

function toClarificationQuestion(reason: string | undefined, fallbackQuestion: string | undefined): string {
  if (reason === 'multiple_candidates' || reason === 'ambiguous_reference') {
    return '你選取了多筆資料，請指定要查詢哪一筆。';
  }
  if (reason === 'missing_page_context') {
    return '請指定要查詢的資料，或在頁面上選取單一資料。';
  }

  return fallbackQuestion ?? '請提供更明確的查詢目標，例如訂單號 SO-10001。';
}
