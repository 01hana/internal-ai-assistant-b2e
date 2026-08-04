import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import {
  AnswerDecisionStatus,
  AssistantMessageRole,
  FeedbackRating,
  ReviewItemStatus
} from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewItemService } from './review-item.service';

export interface SubmitFeedbackInput {
  requestId: string;
  messageId: string;
  identityContext: RequestIdentityContext;
  rating: FeedbackRating;
  intent?: string;
  reason?: string;
  comment?: string;
}

@Injectable()
export class FeedbackEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewItemService: ReviewItemService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async submitFeedback(input: SubmitFeedbackInput) {
    const message = await this.prisma.db.assistantMessage.findUnique({
      where: { id: input.messageId }
    });
    if (!message) {
      throw new NotFoundException('Assistant message not found');
    }

    const session = await this.prisma.db.assistantSession.findFirst({
      where: {
        id: message.sessionId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId
      }
    });
    if (!session || session.status !== 'active') {
      throw new NotFoundException('Assistant message not found');
    }

    if (message.role !== AssistantMessageRole.assistant) {
      throw new BadRequestException('Feedback can only be submitted for assistant messages.');
    }
    if (!message.answerDecision) {
      throw new BadRequestException('Feedback requires an assistant answer decision.');
    }

    const toolCalls = await this.prisma.db.toolCall.findMany({ where: { messageId: input.messageId } });
    const evidenceRefs = await this.prisma.db.evidenceRef.findMany({ where: { messageId: { in: [input.messageId] } } });
    const intent = input.intent ?? 'other';
    const feedbackEvent = await this.prisma.db.feedbackEvent.create({
      data: {
        requestId: input.requestId,
        messageId: input.messageId,
        rating: input.rating,
        reason: input.reason,
        comment: input.comment,
        intent,
        toolCallIds: toolCalls.map((toolCall: { id: string }) => toolCall.id),
        evidenceRefIds: evidenceRefs.map((evidenceRef: { id: string }) => evidenceRef.id),
        answerDecision: message.answerDecision as AnswerDecisionStatus
      }
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: message.sessionId,
      messageId: input.messageId,
      eventType: 'feedback_received',
      decision: message.answerDecision,
      evidenceRefIds: evidenceRefs.map((evidenceRef: { id: string }) => evidenceRef.id),
      metadata: toJsonInput({
        feedbackEventId: feedbackEvent.id,
        rating: input.rating,
        intent,
        reasonProvided: Boolean(input.reason),
        commentProvided: Boolean(input.comment),
        toolCallIds: toolCalls.map((toolCall: { id: string }) => toolCall.id),
        evidenceRefIds: evidenceRefs.map((evidenceRef: { id: string }) => evidenceRef.id),
        answerDecision: message.answerDecision
      })
    });

    const reviewItem = isActionableFeedback(input.rating, intent)
      ? await this.reviewItemService.createFromFeedback({
          requestId: input.requestId,
          sessionId: message.sessionId,
          messageId: input.messageId,
          identityContext: input.identityContext,
          feedbackEventId: feedbackEvent.id,
          answerDecision: message.answerDecision as AnswerDecisionStatus,
          rating: input.rating,
          intent,
          reason: input.reason,
          comment: input.comment,
          toolCallIds: toolCalls.map((toolCall: { id: string }) => toolCall.id),
          evidenceRefIds: evidenceRefs.map((evidenceRef: { id: string }) => evidenceRef.id)
        })
      : undefined;

    return {
      feedbackEventId: feedbackEvent.id,
      messageId: input.messageId,
      rating: feedbackEvent.rating,
      intent: feedbackEvent.intent,
      reviewItemId: reviewItem?.id ?? null
    };
  }
}

function isActionableFeedback(rating: FeedbackRating, intent: string): boolean {
  return rating === FeedbackRating.negative || ['correction', 'unsafe', 'not_helpful', 'missing_evidence'].includes(intent);
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
