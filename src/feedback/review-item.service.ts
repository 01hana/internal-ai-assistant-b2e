import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import {
  AnswerDecisionStatus,
  NoAnswerReason,
  ReviewItemStatus,
  ReviewPriority,
  ReviewSourceType,
  FeedbackRating
} from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateReviewItemFromAssistantOutcomeInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  answerDecisionId: string;
  answerDecision: AnswerDecisionStatus;
  noAnswerReason: NoAnswerReason;
  toolName?: string;
  toolCallId?: string;
  evidenceRefCount: number;
  permissionDeniedReason?: string;
  toolFailureReason?: string;
  conflictReason?: string;
  conflictFieldPaths?: string[];
  evidenceRefIds?: string[];
}

export interface CreateReviewItemFromFeedbackInput {
  requestId: string;
  sessionId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  feedbackEventId: string;
  answerDecision: AnswerDecisionStatus;
  rating: FeedbackRating;
  intent: string;
  reason?: string;
  comment?: string;
  toolCallIds: string[];
  evidenceRefIds: string[];
}

@Injectable()
export class ReviewItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async createFromAssistantOutcome(input: CreateReviewItemFromAssistantOutcomeInput) {
    const sourceType = toReviewSourceType(input.noAnswerReason);
    const reviewItem = await this.prisma.db.reviewItem.create({
      data: {
        sourceType,
        sourceId: input.answerDecisionId,
        status: ReviewItemStatus.open,
        priority: toReviewPriority(input.noAnswerReason),
        summary: `${input.noAnswerReason}: assistant answer requires review`,
        suggestedImprovement: toJsonInput({
          organizationId: input.identityContext.company.organizationId,
          hostApp: input.identityContext.hostApp.hostApp,
          requestId: input.requestId,
          messageId: input.messageId,
          toolName: input.toolName ?? null,
          toolCallId: input.toolCallId ?? null,
          answerDecision: input.answerDecision,
          noAnswerReason: input.noAnswerReason,
          evidenceRefCount: input.evidenceRefCount,
          permissionDeniedReason: input.permissionDeniedReason ?? null,
          toolFailureReason: input.toolFailureReason ?? null,
          conflictReason: input.conflictReason ?? null,
          conflictFieldPaths: input.conflictFieldPaths ?? [],
          evidenceRefIds: input.evidenceRefIds ?? []
        })
      }
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'review_item_created',
      decision: input.answerDecision,
      toolCallId: input.toolCallId,
      metadata: toJsonInput({
        reviewItemId: reviewItem.id,
        sourceType,
        answerDecision: input.answerDecision,
        noAnswerReason: input.noAnswerReason,
        toolName: input.toolName ?? null,
        toolCallId: input.toolCallId ?? null,
        evidenceRefCount: input.evidenceRefCount,
        permissionDeniedReason: input.permissionDeniedReason ?? null,
        toolFailureReason: input.toolFailureReason ?? null,
        conflictReason: input.conflictReason ?? null,
        conflictFieldPaths: input.conflictFieldPaths ?? [],
        evidenceRefIds: input.evidenceRefIds ?? []
      })
    });

    return reviewItem;
  }

  async createFromFeedback(input: CreateReviewItemFromFeedbackInput) {
    const sourceType = toFeedbackReviewSourceType(input);
    const existing = await this.findExistingFeedbackReviewItem({ ...input, sourceType });
    if (existing) {
      return existing;
    }

    const reviewItem = await this.prisma.db.reviewItem.create({
      data: {
        sourceType,
        sourceId: input.feedbackEventId,
        status: ReviewItemStatus.open,
        priority: toFeedbackReviewPriority(input),
        summary: `${input.intent}: feedback requires review`,
        suggestedImprovement: toJsonInput({
          organizationId: input.identityContext.company.organizationId,
          hostApp: input.identityContext.hostApp.hostApp,
          requestId: input.requestId,
          messageId: input.messageId,
          feedbackEventId: input.feedbackEventId,
          answerDecision: input.answerDecision,
          toolCallIds: input.toolCallIds,
          evidenceRefIds: input.evidenceRefIds,
          rating: input.rating,
          intent: input.intent,
          reasonProvided: Boolean(input.reason),
          commentProvided: Boolean(input.comment)
        })
      }
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'review_item_created',
      decision: input.answerDecision,
      evidenceRefIds: input.evidenceRefIds,
      metadata: toJsonInput({
        reviewItemId: reviewItem.id,
        sourceType,
        feedbackEventId: input.feedbackEventId,
        answerDecision: input.answerDecision,
        rating: input.rating,
        intent: input.intent,
        reasonProvided: Boolean(input.reason),
        commentProvided: Boolean(input.comment),
        toolCallIds: input.toolCallIds,
        evidenceRefIds: input.evidenceRefIds
      })
    });

    return reviewItem;
  }

  private async findExistingFeedbackReviewItem(input: CreateReviewItemFromFeedbackInput & { sourceType: ReviewSourceType }) {
    const candidates = await this.prisma.db.reviewItem.findMany({
      where: {
        sourceType: input.sourceType,
        status: ReviewItemStatus.open
      }
    });

    return (
      candidates.find((item) => {
        const metadata = toRecord(item.suggestedImprovement);
        return (
          metadata.organizationId === input.identityContext.company.organizationId &&
          metadata.hostApp === input.identityContext.hostApp.hostApp &&
          metadata.messageId === input.messageId &&
          metadata.answerDecision === input.answerDecision &&
          metadata.intent === input.intent
        );
      }) ?? null
    );
  }

  async listForReview(input: {
    identityContext: RequestIdentityContext;
    status?: ReviewItemStatus;
    sourceType?: ReviewSourceType;
    priority?: ReviewPriority;
  }) {
    const items = await this.prisma.db.reviewItem.findMany({
      where: {
        status: input.status,
        sourceType: input.sourceType,
        priority: input.priority
      },
      orderBy: { createdAt: 'desc' }
    });

    return items.filter((item) => isVisibleReviewItem(item, input.identityContext)).map(toReviewItemResponse);
  }

  async getForReview(input: { identityContext: RequestIdentityContext; reviewItemId: string }) {
    const item = await this.prisma.db.reviewItem.findUnique({ where: { id: input.reviewItemId } });
    if (!item || !isVisibleReviewItem(item, input.identityContext)) {
      return null;
    }

    return toReviewItemResponse(item);
  }

  async markResolved(input: {
    requestId: string;
    identityContext: RequestIdentityContext;
    reviewItemId: string;
    reason?: string;
  }) {
    return this.transitionReviewItem({
      ...input,
      status: ReviewItemStatus.resolved,
      eventType: 'review_item_resolved'
    });
  }

  async markDismissed(input: {
    requestId: string;
    identityContext: RequestIdentityContext;
    reviewItemId: string;
    reason?: string;
  }) {
    return this.transitionReviewItem({
      ...input,
      status: ReviewItemStatus.dismissed,
      eventType: 'review_item_dismissed'
    });
  }

  private async transitionReviewItem(input: {
    requestId: string;
    identityContext: RequestIdentityContext;
    reviewItemId: string;
    status: ReviewItemStatus;
    eventType: string;
    reason?: string;
  }) {
    const existing = await this.prisma.db.reviewItem.findUnique({ where: { id: input.reviewItemId } });
    if (!existing || !isVisibleReviewItem(existing, input.identityContext)) {
      return null;
    }

    const updated = await this.prisma.db.reviewItem.update({
      where: { id: input.reviewItemId },
      data: {
        status: input.status,
        resolvedAt: new Date()
      }
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      eventType: input.eventType,
      metadata: toJsonInput({
        reviewItemId: updated.id,
        status: updated.status,
        sourceType: updated.sourceType,
        sourceId: updated.sourceId,
        reasonProvided: Boolean(input.reason)
      })
    });

    return toReviewItemResponse(updated);
  }
}

function toReviewSourceType(reason: NoAnswerReason): ReviewSourceType {
  if (reason === NoAnswerReason.tool_failure) {
    return ReviewSourceType.tool_failure;
  }
  if (reason === NoAnswerReason.no_evidence) {
    return ReviewSourceType.no_answer;
  }
  if (reason === NoAnswerReason.permission_denied) {
    return ReviewSourceType.permission_mapping_issue;
  }
  if (reason === NoAnswerReason.evidence_conflict) {
    return ReviewSourceType.missing_evidence;
  }

  return ReviewSourceType.failed_query;
}

function toReviewPriority(reason: NoAnswerReason): ReviewPriority {
  if (reason === NoAnswerReason.permission_denied || reason === NoAnswerReason.tool_failure) {
    return ReviewPriority.high;
  }

  return ReviewPriority.medium;
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toFeedbackReviewSourceType(input: { intent: string }): ReviewSourceType {
  return input.intent === 'missing_evidence' ? ReviewSourceType.missing_evidence : ReviewSourceType.negative_feedback;
}

function toFeedbackReviewPriority(input: { rating: FeedbackRating; intent: string }): ReviewPriority {
  if (['correction', 'missing_evidence', 'unsafe'].includes(input.intent)) {
    return ReviewPriority.high;
  }

  return ReviewPriority.medium;
}

function isVisibleReviewItem(item: { suggestedImprovement: Prisma.JsonValue }, identityContext: RequestIdentityContext): boolean {
  const metadata = toRecord(item.suggestedImprovement);
  return (
    metadata.organizationId === identityContext.company.organizationId &&
    metadata.hostApp === identityContext.hostApp.hostApp
  );
}

function toReviewItemResponse(item: {
  id: string;
  sourceType: ReviewSourceType;
  sourceId: string;
  status: ReviewItemStatus;
  priority: ReviewPriority;
  summary: string;
  suggestedImprovement: Prisma.JsonValue;
  createdAt: Date;
  resolvedAt: Date | null;
}) {
  return {
    reviewItemId: item.id,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    status: item.status,
    priority: item.priority,
    summary: item.summary,
    suggestedImprovement: item.suggestedImprovement,
    createdAt: item.createdAt.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString() ?? null
  };
}

function toRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
