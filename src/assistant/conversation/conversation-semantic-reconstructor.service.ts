import { Injectable } from '@nestjs/common';
import {
  ConversationSemanticFrame,
  SemanticDimension
} from './conversation.types';
import { MAX_SEMANTIC_VALUE_LENGTH } from './conversation-limits';

@Injectable()
export class ConversationSemanticReconstructorService {
  reconstruct(input: unknown, sourceMessageId: string): ConversationSemanticFrame | undefined {
    if (!isRecord(input)) return undefined;

    const normalizedTerms = records(input.normalizedTerms);
    const phrases = records(input.phrases);
    const resource = dimension(
      firstText(normalizedTerms, 'category', 'resource', ['normalizedTerm', 'value']),
      sourceMessageId,
      firstConfidence(normalizedTerms, 'category', 'resource')
    );
    const metricOrAspect = dimension(
      firstText(normalizedTerms, 'category', 'metric', ['normalizedTerm', 'value'])
        ?? firstText(phrases, 'category', 'metric', ['normalizedValue', 'value']),
      sourceMessageId,
      firstConfidence(normalizedTerms, 'category', 'metric')
    );
    const intent = dimension(
      firstText(phrases, 'category', 'intent', ['normalizedValue', 'value']),
      sourceMessageId,
      firstConfidence(phrases, 'category', 'intent')
    );
    const timeRecord = records(input.timeRanges)[0];
    const timeRange = dimension(
      boundedText(timeRecord?.label) ?? boundedTimeRange(timeRecord),
      sourceMessageId,
      confidence(timeRecord?.confidence)
    );
    const entityRecord = records(input.entityCandidates)[0] ?? records(input.resolvedReferences)[0];
    const entityValue = boundedText(entityRecord?.value) ?? boundedText(entityRecord?.entityId);
    const entityType = boundedText(entityRecord?.type) ?? boundedText(entityRecord?.entityType);
    const entityBase = dimension(entityValue, sourceMessageId, confidence(entityRecord?.confidence));
    const entity = entityBase && entityType ? Object.freeze({ ...entityBase, entityType }) : undefined;

    if (!resource && !intent && !metricOrAspect && !timeRange && !entity) return undefined;
    const topicKey = [resource?.value, entity?.entityType, entity?.value].filter(Boolean).join(':') || undefined;
    return Object.freeze({ resource, intent, metricOrAspect, timeRange, entity, topicKey });
  }
}

function dimension(value: string | undefined, sourceMessageId: string, score = 1): SemanticDimension | undefined {
  return value
    ? Object.freeze({ value, source: 'current_explicit' as const, sourceMessageId, confidence: score })
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstText(
  values: Record<string, unknown>[],
  discriminator: string,
  expected: string,
  fields: readonly string[]
): string | undefined {
  const record = values.find((candidate) => candidate[discriminator] === expected);
  return fields.map((field) => boundedText(record?.[field])).find(Boolean);
}

function firstConfidence(values: Record<string, unknown>[], discriminator: string, expected: string): number {
  return confidence(values.find((candidate) => candidate[discriminator] === expected)?.confidence);
}

function boundedTimeRange(record: Record<string, unknown> | undefined): string | undefined {
  const start = boundedText(record?.start);
  const end = boundedText(record?.end);
  return start && end ? `${start}/${end}`.slice(0, MAX_SEMANTIC_VALUE_LENGTH) : undefined;
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_SEMANTIC_VALUE_LENGTH ? normalized : undefined;
}

function confidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

