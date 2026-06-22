import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import {
  AnswerDecisionStatus,
  NoAnswerReason,
  ReviewItemStatus,
  ReviewPriority,
  ReviewSourceType
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
