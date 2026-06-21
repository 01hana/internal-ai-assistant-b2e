import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { RiskLevel } from '../generated/prisma/enums';
import { QueryUnderstandingPipeline } from './query-understanding-pipeline.interface';
import {
  QueryUnderstandingClarificationNeed,
  QueryUnderstandingEntityCandidate,
  QueryUnderstandingInput,
  QueryUnderstandingOutput,
  QueryUnderstandingPhrase,
  QueryUnderstandingSentence,
  QueryUnderstandingSubTask,
  QueryUnderstandingToken,
  QueryUnderstandingToolCandidate
} from './query-understanding.types';

const ORDER_PATTERN = /\bSO-\d{4,}\b/i;
const WORK_ORDER_PATTERN = /\bWO-\d{4,}\b/i;
const SKU_PATTERN = /\bSKU-[A-Z0-9-]+\b/i;

@Injectable()
export class QueryUnderstandingPlaceholderService implements QueryUnderstandingPipeline {
  async understand(input: QueryUnderstandingInput): Promise<QueryUnderstandingOutput> {
    const normalizedText = normalizeText(input.text);
    const sentences = toSentences(normalizedText);
    const tokens = toTokens(sentences);
    const normalizedTerms = Array.from(new Set(tokens.map((token) => token.normalizedValue)));
    const phrases = toPhrases(tokens);
    const entityCandidates = toEntityCandidates(normalizedText);
    const candidateTools = inferCandidateTools(normalizedText, entityCandidates);
    const taskType = inferTaskType(normalizedText, candidateTools);
    const requiredEvidence = inferRequiredEvidence(taskType, entityCandidates);
    const riskLevel = inferRiskLevel(normalizedText);
    const confidence = inferConfidence(normalizedText, entityCandidates, candidateTools);
    const clarificationNeeds = inferClarificationNeeds(normalizedText, confidence, entityCandidates);
    const subTasks = toSubTasks(sentences, taskType);
    const timeRanges = inferTimeRanges(normalizedText);
    const resolvedReferences = inferResolvedReferences(input.pageContext);

    return {
      taskType,
      sentences,
      tokens,
      phrases,
      normalizedTerms,
      timeRanges,
      resolvedReferences,
      entityCandidates,
      subTasks,
      candidateTools,
      riskLevel,
      confidence,
      clarificationNeeds,
      requiredEvidence
    };
  }
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function toSentences(text: string): QueryUnderstandingSentence[] {
  const segments = text
    .split(/[。！？!?]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0 && text.length > 0) {
    return [{ index: 0, text }];
  }

  return segments.map((segment, index) => ({
    index,
    text: segment
  }));
}

function toTokens(sentences: QueryUnderstandingSentence[]): QueryUnderstandingToken[] {
  return sentences.flatMap((sentence) =>
    sentence.text
      .split(/[\s,，。！？!?;；:：]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => ({
        value: token,
        normalizedValue: token.toLowerCase(),
        sentenceIndex: sentence.index
      }))
  );
}

function toPhrases(tokens: QueryUnderstandingToken[]): QueryUnderstandingPhrase[] {
  return tokens.map((token) => ({
    value: token.value,
    normalizedValue: token.normalizedValue,
    category: inferPhraseCategory(token.normalizedValue)
  }));
}

function inferPhraseCategory(value: string): QueryUnderstandingPhrase['category'] {
  if (value.includes('今天') || value.includes('本週') || value.includes('昨天')) {
    return 'time';
  }

  if (value.includes('訂單') || value.includes('工單') || value.includes('庫存') || value.includes('客戶')) {
    return 'resource';
  }

  if (value.includes('查') || value.includes('看') || value.includes('確認')) {
    return 'intent';
  }

  return 'unknown';
}

function toEntityCandidates(text: string): QueryUnderstandingEntityCandidate[] {
  const entities: QueryUnderstandingEntityCandidate[] = [];
  const orderId = text.match(ORDER_PATTERN)?.[0];
  const workOrderId = text.match(WORK_ORDER_PATTERN)?.[0];
  const sku = text.match(SKU_PATTERN)?.[0];

  if (orderId) {
    entities.push({ type: 'orderId', value: orderId, confidence: 0.95 });
  }

  if (workOrderId) {
    entities.push({ type: 'workOrderId', value: workOrderId, confidence: 0.95 });
  }

  if (sku) {
    entities.push({ type: 'itemSku', value: sku, confidence: 0.9 });
  }

  return entities;
}

function inferCandidateTools(text: string, entities: QueryUnderstandingEntityCandidate[]): QueryUnderstandingToolCandidate[] {
  if (text.length === 0) {
    return [];
  }

  if (isDestructiveIntent(text)) {
    return [];
  }

  if (entities.some((entity) => entity.type === 'orderId') || text.includes('訂單')) {
    return [{ key: 'mock.orders.status.lookup', reason: 'order status query' }];
  }

  if (entities.some((entity) => entity.type === 'workOrderId') || text.includes('工單')) {
    return [{ key: 'mock.work-orders.progress.lookup', reason: 'work order progress query' }];
  }

  if (entities.some((entity) => entity.type === 'itemSku') || text.includes('庫存')) {
    return [{ key: 'mock.inventory.availability.lookup', reason: 'inventory availability query' }];
  }

  if (text.includes('客戶') || text.includes('供應商')) {
    return [{ key: 'mock.business-partner.history.lookup', reason: 'business partner history query' }];
  }

  return [{ key: 'mock.general.lookup', reason: 'generic internal lookup' }];
}

function isDestructiveIntent(text: string): boolean {
  return text.includes('刪除') || text.includes('取消') || text.includes('核准');
}

function inferTaskType(text: string, candidateTools: QueryUnderstandingToolCandidate[]): string {
  if (text.length === 0) {
    return 'clarification_required';
  }

  const firstTool = candidateTools[0]?.key ?? '';
  if (firstTool.includes('orders')) {
    return 'order_status_lookup';
  }
  if (firstTool.includes('work-orders')) {
    return 'work_order_progress_lookup';
  }
  if (firstTool.includes('inventory')) {
    return 'inventory_availability_lookup';
  }
  if (firstTool.includes('business-partner')) {
    return 'business_partner_history_lookup';
  }

  return 'general_lookup';
}

function inferRequiredEvidence(taskType: string, entities: QueryUnderstandingEntityCandidate[]): string[] {
  const evidence = ['identity_context'];

  if (entities.length > 0) {
    evidence.push('structured_record');
  }

  if (taskType === 'general_lookup') {
    evidence.push('manual_review');
  }

  return evidence;
}

function inferRiskLevel(text: string): RiskLevel {
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

function inferConfidence(
  text: string,
  entities: QueryUnderstandingEntityCandidate[],
  candidateTools: QueryUnderstandingToolCandidate[]
): number {
  if (text.length === 0 || /^[\s,，。！？!?;；:：-]+$/.test(text)) {
    return 0;
  }

  let confidence = 0.25;

  if (candidateTools.length > 0) {
    confidence += 0.2;
  }

  if (entities.length > 0) {
    confidence += 0.35;
  }

  if (text.length > 12) {
    confidence += 0.15;
  }

  return Math.min(1, Number(confidence.toFixed(2)));
}

function inferClarificationNeeds(
  text: string,
  confidence: number,
  entities: QueryUnderstandingEntityCandidate[]
): QueryUnderstandingClarificationNeed[] {
  if (text.length === 0 || /^[\s,，。！？!?;；:：-]+$/.test(text)) {
    return [
      {
        reason: 'empty_query',
        question: '請提供要查詢的內容或對象。'
      }
    ];
  }

  if (confidence < 0.7) {
    return [
      {
        reason: 'low_confidence',
        question: '請補充更明確的查詢目標，例如訂單號、工單號或料號。'
      }
    ];
  }

  if (text.includes('訂單') && !entities.some((entity) => entity.type === 'orderId')) {
    return [
      {
        reason: 'missing_order_identifier',
        question: '請提供訂單號，像是 SO-10001。'
      }
    ];
  }

  return [];
}

function toSubTasks(sentences: QueryUnderstandingSentence[], taskType: string): QueryUnderstandingSubTask[] {
  return sentences.map((sentence) => ({
    type: taskType,
    text: sentence.text
  }));
}

function inferTimeRanges(text: string): string[] {
  const ranges: string[] = [];

  if (text.includes('今天')) {
    ranges.push('today');
  }
  if (text.includes('本週')) {
    ranges.push('this_week');
  }
  if (text.includes('昨天')) {
    ranges.push('yesterday');
  }

  return ranges;
}

function inferResolvedReferences(pageContext: Prisma.InputJsonValue | undefined): string[] {
  if (!pageContext || typeof pageContext !== 'object' || Array.isArray(pageContext)) {
    return [];
  }

  return Object.keys(pageContext).filter(Boolean);
}
