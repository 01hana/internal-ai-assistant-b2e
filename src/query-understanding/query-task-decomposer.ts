import { RiskLevel } from '../generated/prisma/enums';
import { hasEntity } from './entity-extractor';
import {
  QueryUnderstandingEntityCandidate,
  QueryUnderstandingNormalizedTerm,
  QueryUnderstandingResolvedReference,
  QueryUnderstandingSentence,
  QueryUnderstandingSubTask,
  QueryUnderstandingToolCandidate
} from './query-understanding.types';

export function inferCandidateTools(
  text: string,
  entities: QueryUnderstandingEntityCandidate[],
  normalizedTerms: QueryUnderstandingNormalizedTerm[]
): QueryUnderstandingToolCandidate[] {
  if (text.length === 0 || isPunctuationOnly(text)) {
    return [];
  }

  if (isDestructiveIntent(text)) {
    return [];
  }

  const tools: QueryUnderstandingToolCandidate[] = [];
  if (hasEntity(entities, 'orderId') || hasNormalized(normalizedTerms, 'order')) {
    tools.push({ key: 'mock.orders.status.lookup', reason: 'order status query' });
  }
  if (hasEntity(entities, 'workOrderId') || hasNormalized(normalizedTerms, 'workOrder')) {
    tools.push({ key: 'mock.work-orders.progress.lookup', reason: 'work order progress query' });
  }
  if (hasEntity(entities, 'itemSku') || hasNormalized(normalizedTerms, 'inventory') || hasNormalized(normalizedTerms, 'itemSku')) {
    tools.push({ key: 'mock.inventory.availability.lookup', reason: 'inventory availability query' });
  }
  if (hasNormalized(normalizedTerms, 'businessPartner')) {
    tools.push({ key: 'mock.business-partner.history.lookup', reason: 'business partner history query' });
  }

  return tools.length > 0 ? tools : [{ key: 'mock.general.lookup', reason: 'generic internal lookup' }];
}

export function inferTaskType(text: string, candidateTools: QueryUnderstandingToolCandidate[]): string {
  if (text.length === 0 || isPunctuationOnly(text)) {
    return 'clarification_required';
  }

  if (candidateTools.length > 1) {
    return 'multi_intent_lookup';
  }

  const firstTool = candidateTools[0]?.key ?? '';
  if (firstTool.includes('orders')) return 'order_status_lookup';
  if (firstTool.includes('work-orders')) return 'work_order_progress_lookup';
  if (firstTool.includes('inventory')) return 'inventory_availability_lookup';
  if (firstTool.includes('business-partner')) return 'business_partner_history_lookup';

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
  text: string,
  candidateTools: QueryUnderstandingToolCandidate[]
): QueryUnderstandingSubTask[] {
  if (candidateTools.length <= 1) {
    return sentences.map((sentence) => ({
      type: inferTaskType(sentence.text, candidateTools),
      text: sentence.text
    }));
  }

  return candidateTools.map((tool) => ({
    type: tool.key.includes('inventory') ? 'inventory_availability_lookup' : 'order_status_lookup',
    text
  }));
}

export function isPunctuationOnly(text: string): boolean {
  return /^[\s,，。！？!?;；:：-]+$/.test(text);
}

function hasNormalized(terms: QueryUnderstandingNormalizedTerm[], normalizedTerm: string): boolean {
  return terms.some((term) => term.normalizedTerm === normalizedTerm);
}

function isDestructiveIntent(text: string): boolean {
  return text.includes('刪除') || text.includes('取消') || text.includes('核准');
}
