import { RiskLevel } from '../generated/prisma/enums';
import {
  QueryUnderstandingEntityCandidate,
  QueryUnderstandingResolvedReference,
  QueryUnderstandingSentence,
  QueryUnderstandingSubTask
} from './query-understanding.types';
import type { ConversationSemanticFrame } from '../assistant/conversation/conversation.types';
import {
  MAX_RETRIEVAL_NEEDS,
  RetrievalNeed
} from '../retrieval/grounded-retrieval.types';

export { MAX_RETRIEVAL_NEEDS } from '../retrieval/grounded-retrieval.types';

export interface RetrievalNeedDecompositionResult {
  readonly needs: readonly RetrievalNeed[];
  readonly overflowCount: number;
  readonly reasonCode?: 'RETRIEVAL_NEED_LIMIT_EXCEEDED';
}

export function inferTaskType(text: string): string {
  if (text.length === 0 || isPunctuationOnly(text)) {
    return 'clarification_required';
  }

  if (isDocumentKnowledgeQuery(text)) {
    if (text.includes('欄位')) return 'field_explanation_lookup';
    if (text.includes('政策')) return 'policy_lookup';
    if (text.includes('錯誤代碼')) return 'error_code_lookup';
    return 'document_knowledge_lookup';
  }

  return 'general_lookup';
}

export function inferRequiredEvidence(
  taskType: string,
  entities: QueryUnderstandingEntityCandidate[],
  resolvedReferences: QueryUnderstandingResolvedReference[]
): string[] {
  const evidence = ['identity_context'];

  if (entities.length > 0 || resolvedReferences.some((reference) => !reference.needsClarification)) {
    evidence.push('structured_record');
  }

  if (taskType === 'general_lookup') {
    evidence.push('manual_review');
  }

  if (isDocumentTaskType(taskType)) {
    evidence.push('document_chunk');
  }

  return evidence;
}

export function inferRiskLevel(text: string): RiskLevel {
  const hasCriticalSignal =
    text.includes('升級') || text.includes('重大') || text.includes('緊急') || text.includes('人工介入');
  const hasSideEffectIntent =
    text.includes('刪除') ||
    text.includes('取消') ||
    text.includes('核准') ||
    text.includes('更新') ||
    text.includes('修改');

  if (hasCriticalSignal && hasSideEffectIntent) {
    return RiskLevel.critical;
  }

  if (text.includes('刪除') || text.includes('取消') || text.includes('核准')) {
    return RiskLevel.high;
  }

  if (text.includes('更新') || text.includes('修改')) {
    return RiskLevel.medium;
  }

  return RiskLevel.low;
}

export function decomposeSubTasks(
  sentences: QueryUnderstandingSentence[],
  fallbackTaskType = 'general_lookup'
): QueryUnderstandingSubTask[] {
  return sentences.map((sentence) => ({
    type: fallbackTaskType === 'general_lookup' ? inferTaskType(sentence.text) : fallbackTaskType,
    text: sentence.text
  }));
}

export function decomposeRetrievalNeeds(
  subTasks: readonly QueryUnderstandingSubTask[],
  semanticFrames: readonly ConversationSemanticFrame[] = []
): RetrievalNeedDecompositionResult {
  const overflowCount = Math.max(0, subTasks.length - MAX_RETRIEVAL_NEEDS);
  const admittedCount = overflowCount > 0 ? MAX_RETRIEVAL_NEEDS - 1 : Math.min(subTasks.length, MAX_RETRIEVAL_NEEDS);
  const needs: RetrievalNeed[] = subTasks.slice(0, admittedCount).map((subTask, index) => {
    const id = `need-${index + 1}`;
    if (isDocumentTaskType(subTask.type)) {
      return Object.freeze({ id, kind: 'DOCUMENT' as const, query: subTask.text.trim() });
    }
    return Object.freeze({ id, kind: 'TOOL' as const, frame: semanticFrames[index] ?? Object.freeze({}) });
  });

  if (overflowCount > 0) {
    needs.push(Object.freeze({
      id: `need-${MAX_RETRIEVAL_NEEDS}`,
      kind: 'UNSUPPORTED',
      reasonCode: 'RETRIEVAL_NEED_LIMIT_EXCEEDED'
    }));
  }

  return Object.freeze({
    needs: Object.freeze(needs),
    overflowCount,
    ...(overflowCount > 0 ? { reasonCode: 'RETRIEVAL_NEED_LIMIT_EXCEEDED' as const } : {})
  });
}

export function isPunctuationOnly(text: string): boolean {
  return /^[\s,，。！？!?;；:：-]+$/.test(text);
}

export function isDocumentKnowledgeQuery(text: string): boolean {
  return (
    /\bSOP\b/i.test(text) ||
    text.includes('作業規範') ||
    text.includes('操作流程') ||
    text.includes('流程') ||
    text.includes('欄位說明') ||
    text.includes('欄位') ||
    text.includes('政策') ||
    text.includes('規定') ||
    text.includes('申請期限') ||
    text.includes('規則') ||
    text.includes('手冊') ||
    text.includes('manual') ||
    text.includes('field guide') ||
    text.includes('錯誤代碼')
  );
}

export function isDocumentTaskType(taskType: string): boolean {
  return ['document_knowledge_lookup', 'field_explanation_lookup', 'policy_lookup', 'error_code_lookup'].includes(taskType);
}
