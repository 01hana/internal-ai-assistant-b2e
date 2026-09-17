import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  MAX_COMPLETED_EXCHANGES,
  MAX_PRIOR_EVIDENCE_REFS
} from './conversation-limits';
import { ConversationSourceGuard } from './conversation-source-guard';
import { ConversationSemanticReconstructorService } from './conversation-semantic-reconstructor.service';
import {
  BoundedConversationContext,
  ConversationScope,
  ConversationSourceRejectionReason,
  SafeCompletedConversationExchange,
  SafePriorEvidenceRefCandidate
} from './conversation.types';

export interface LoadConversationContextInput {
  readonly scope: ConversationScope;
  readonly maxCompletedExchanges?: number;
  readonly maxEvidenceRefs?: number;
}

export interface ConversationContextSource {
  loadScopedContext(input: { readonly scope: ConversationScope }): Promise<readonly unknown[]>;
}

@Injectable()
export class ConversationContextLoaderService {
  private readonly guard: ConversationSourceGuard;
  private readonly reconstructor: ConversationSemanticReconstructorService;

  constructor(
    @Inject('ConversationContextSource')
    private readonly repository: ConversationContextSource,
    @Optional() guard?: ConversationSourceGuard,
    @Optional() reconstructor?: ConversationSemanticReconstructorService
  ) {
    this.guard = guard ?? new ConversationSourceGuard();
    this.reconstructor = reconstructor ?? new ConversationSemanticReconstructorService();
  }

  async load(input: LoadConversationContextInput): Promise<BoundedConversationContext> {
    const records = await this.repository.loadScopedContext({ scope: input.scope });
    const reasons = new Set<ConversationSourceRejectionReason>();
    const completed = records
      .filter(isRecord)
      .filter((record) => hasExactScope(record, input.scope))
      .filter(isCompleteExchange)
      .sort(compareNewestFirst)
      .slice(0, boundedLimit(input.maxCompletedExchanges, MAX_COMPLETED_EXCHANGES));

    const evidenceRefs: SafePriorEvidenceRefCandidate[] = [];
    const evidenceRefLimit = boundedLimit(input.maxEvidenceRefs, MAX_PRIOR_EVIDENCE_REFS);
    const newestFirstExchanges: SafeCompletedConversationExchange[] = [];
    for (const record of completed) {
      const user = asRecord(record.userMessage)!;
      const assistant = asRecord(record.assistantMessage)!;
      const queryUnderstanding = record.queryUnderstanding;
      let semanticFrame;
      if (queryUnderstanding !== undefined) {
        const guarded = this.guard.guard(queryUnderstanding);
        if (guarded.accepted) {
          semanticFrame = this.reconstructor.reconstruct(guarded.value, text(user.id)!);
        } else {
          reasons.add(guarded.reasonCode);
        }
      }

      const exchangeEvidenceIds: string[] = [];
      for (const candidate of Array.isArray(record.evidence) ? record.evidence : []) {
        const guarded = this.guard.guard(candidate);
        if (!guarded.accepted) {
          reasons.add(guarded.reasonCode);
          continue;
        }
        const safe = toEvidenceCandidate(candidate);
        if (!safe) {
          reasons.add('CONTEXT_MALFORMED_VALUE');
          continue;
        }
        if (evidenceRefs.length < evidenceRefLimit) {
          evidenceRefs.push(safe);
          exchangeEvidenceIds.push(safe.id);
        }
      }

      const userContent = text(user.content);
      const guardedUser = userContent === undefined ? undefined : this.guard.guard(userContent);
      if (guardedUser && !guardedUser.accepted) reasons.add(guardedUser.reasonCode);
      newestFirstExchanges.push(Object.freeze({
        exchangeId: text(record.exchangeId) ?? text(record.requestId)!,
        requestId: text(record.requestId),
        userMessageId: text(user.id)!,
        assistantMessageId: text(assistant.id)!,
        userText: guardedUser?.accepted && typeof guardedUser.value === 'string' ? guardedUser.value : undefined,
        createdAt: isoText(record.createdAt),
        semanticFrame,
        evidenceRefIds: Object.freeze(exchangeEvidenceIds)
      }));
    }

    const chronological = [...newestFirstExchanges].reverse();
    return deepFreeze({
      scope: Object.freeze({ ...input.scope }),
      selectedExchangeIdsNewestFirst: newestFirstExchanges.map((exchange) => exchange.exchangeId),
      chronologicalExchangeIds: chronological.map((exchange) => exchange.exchangeId),
      exchanges: chronological,
      semanticFrames: chronological.flatMap((exchange) => exchange.semanticFrame ? [exchange.semanticFrame] : []),
      evidenceRefs,
      evidenceRefIds: evidenceRefs.map((evidence) => evidence.id),
      rejectedReasonCodes: [...reasons].sort()
    });
  }
}

function isCompleteExchange(record: Record<string, unknown>): boolean {
  return record.completed === true
    && asRecord(record.userMessage) !== undefined
    && asRecord(record.assistantMessage) !== undefined
    && asRecord(record.answerDecision) !== undefined;
}

function hasExactScope(record: Record<string, unknown>, expected: ConversationScope): boolean {
  const scope = asRecord(record.scope);
  return record.sessionStatus === 'active'
    && scope?.customerId === expected.customerId
    && scope.sessionId === expected.sessionId
    && scope.organizationId === expected.organizationId
    && scope.hostApp === expected.hostApp
    && scope.actorId === expected.actorId;
}

function compareNewestFirst(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const time = Date.parse(isoText(right.createdAt)) - Date.parse(isoText(left.createdAt));
  if (time !== 0) return time;
  return (text(right.exchangeId) ?? '').localeCompare(text(left.exchangeId) ?? '');
}

function toEvidenceCandidate(value: unknown): SafePriorEvidenceRefCandidate | undefined {
  const record = asRecord(value);
  const id = text(record?.id);
  if (!id) return undefined;
  return Object.freeze({
    id,
    messageId: text(record?.messageId),
    sourceType: text(record?.sourceType),
    sourceId: text(record?.sourceId),
    observedAt: text(record?.timestamp)
  });
}

function boundedLimit(requested: number | undefined, maximum: number): number {
  return typeof requested === 'number' && Number.isInteger(requested) && requested > 0
    ? Math.min(requested, maximum)
    : maximum;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isoText(value: unknown): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return '1970-01-01T00:00:00.000Z';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
