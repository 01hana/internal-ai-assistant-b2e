import { Injectable } from '@nestjs/common';
import {
  CapabilityFollowUpFrameV1,
  ConversationSemanticFrame,
  SemanticDimension
} from './conversation.types';
import { MAX_SEMANTIC_VALUE_LENGTH } from './conversation-limits';
import type { ScopedCapabilityCatalogV1 } from '../../capabilities/capability-pack.types';
import { validateCapabilityCanonicalValue } from '../../capabilities/capability-parameter-resolver.service';

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

  reconstructCapabilityFrame(input: unknown, catalog?: ScopedCapabilityCatalogV1): CapabilityFollowUpFrameV1 | undefined {
    if (!isExactRecord(input, ['version', 'scope', 'packId', 'packVersion', 'capabilityKey', 'sourceMessageId', 'parameters']) || input.version !== '1') return undefined;
    const scope = input.scope;
    if (!isExactRecord(scope, ['customerId', 'integrationId', 'hostApp'])) return undefined;
    if (![scope.customerId, scope.integrationId, scope.hostApp, input.packId, input.packVersion, input.capabilityKey, input.sourceMessageId]
      .every(boundedIdentifier)) return undefined;
    if (catalog && (scope.customerId !== catalog.customerId || scope.integrationId !== catalog.integrationId || scope.hostApp !== catalog.hostApp ||
      input.packId !== catalog.packId || input.packVersion !== catalog.packVersion)) return undefined;
    const capability = catalog && typeof input.capabilityKey === 'string'
      ? catalog.capabilities.find((entry) => entry.active && entry.capabilityKey === input.capabilityKey)
      : undefined;
    if (catalog && !capability) return undefined;
    if (!Array.isArray(input.parameters) || input.parameters.length > (capability?.parameters.length ?? 16)) return undefined;
    const seen = new Set<string>();
    const parameters = [];
    for (const candidate of input.parameters) {
      if (!isExactRecord(candidate, ['parameterName', 'value', 'source', 'sourceMessageId']) ||
        !boundedIdentifier(candidate.parameterName) || !boundedIdentifier(candidate.sourceMessageId) ||
        (candidate.source !== 'current_explicit' && candidate.source !== 'inherited') || seen.has(candidate.parameterName)) return undefined;
      const definition = capability?.parameters.find((entry) => entry.parameterName === candidate.parameterName);
      const value = definition ? validateCapabilityCanonicalValue(definition, candidate.value) : safeCanonicalScalar(candidate.value);
      if (value === undefined) return undefined;
      seen.add(candidate.parameterName);
      parameters.push(Object.freeze({ parameterName: candidate.parameterName, value, source: candidate.source, sourceMessageId: candidate.sourceMessageId }));
    }
    return Object.freeze({
      version: '1', scope: Object.freeze({ customerId: scope.customerId as string, integrationId: scope.integrationId as string, hostApp: scope.hostApp as string }),
      packId: input.packId as string, packVersion: input.packVersion as string, capabilityKey: input.capabilityKey as string,
      sourceMessageId: input.sourceMessageId as string,
      parameters: Object.freeze(parameters.sort((a, b) => a.parameterName.localeCompare(b.parameterName, 'en-US')))
    });
  }
}

function safeCanonicalScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') return value.length > 0 && value.length <= 256 ? value : undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'boolean' ? value : undefined;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SEMANTIC_VALUE_LENGTH;
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
