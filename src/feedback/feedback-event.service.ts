import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { AuditTransactionClient } from '../audit/audit-writer.interface';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { AnswerDecisionStatus, AssistantMessageRole, FeedbackRating } from '../generated/prisma/enums';
import { assertCustomerScopeMatchesIdentityContext } from '../identity/customer-scope-consistency';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { CustomerScope } from '../identity/customer-scope.types';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewItemService } from './review-item.service';

export interface SubmitFeedbackInput {
  customerScope: CustomerScope;
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
  constructor(private readonly prisma: PrismaService, private readonly reviewItemService: ReviewItemService, private readonly auditWriter: AuditWriterService) {}

  async submitFeedback(input: SubmitFeedbackInput) {
    assertCustomerScopeMatchesIdentityContext(input.customerScope, input.identityContext);
    const { message, session, toolCalls, evidenceRefs } = await this.validateContext(input);
    const intent = input.intent ?? 'other';

    return this.prisma.db.$transaction(async (transaction) => {
      const database = transaction as FeedbackTransactionClient;
      const feedbackEvent = await database.feedbackEvent.create({
        data: {
          customerId: input.customerScope.customerId,
          requestId: input.requestId,
          messageId: input.messageId,
          rating: input.rating,
          reason: input.reason,
          comment: input.comment,
          intent,
          toolCallIds: toolCalls.map((toolCall) => toolCall.id),
          evidenceRefIds: evidenceRefs.map((evidenceRef) => evidenceRef.id),
          answerDecision: message.answerDecision as AnswerDecisionStatus
        }
      });

      await this.auditWriter.append({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: session.id,
        messageId: input.messageId,
        eventType: 'feedback_received',
        decision: message.answerDecision,
        evidenceRefIds: evidenceRefs.map((evidenceRef) => evidenceRef.id),
        metadata: toJsonInput({ feedbackEventId: feedbackEvent.id, rating: input.rating, intent, reasonProvided: Boolean(input.reason), commentProvided: Boolean(input.comment), toolCallIds: toolCalls.map((toolCall) => toolCall.id), evidenceRefIds: evidenceRefs.map((evidenceRef) => evidenceRef.id), answerDecision: message.answerDecision })
      }, database);

      const reviewItem = isActionableFeedback(input.rating, intent)
        ? await this.reviewItemService.createFromFeedback({
            customerScope: input.customerScope,
            requestId: input.requestId,
            sessionId: session.id,
            messageId: input.messageId,
            identityContext: input.identityContext,
            feedbackEventId: feedbackEvent.id,
            answerDecision: message.answerDecision as AnswerDecisionStatus,
            rating: input.rating,
            intent,
            reason: input.reason,
            comment: input.comment,
            toolCallIds: toolCalls.map((toolCall) => toolCall.id),
            evidenceRefIds: evidenceRefs.map((evidenceRef) => evidenceRef.id)
          }, database)
        : undefined;

      return { feedbackEventId: feedbackEvent.id, messageId: input.messageId, rating: feedbackEvent.rating, intent: feedbackEvent.intent, reviewItemId: reviewItem?.id ?? null };
    });
  }

  private async validateContext(input: SubmitFeedbackInput) {
    const { customerScope } = input;
    const message = await this.prisma.db.assistantMessage.findFirst({ where: { customerId: customerScope.customerId, id: input.messageId } });
    if (!message) throw feedbackNotFound();
    const session = await this.prisma.db.assistantSession.findFirst({ where: { customerId: customerScope.customerId, id: message.sessionId, organizationId: customerScope.organizationId, hostApp: customerScope.hostApp, actorId: customerScope.actorId } });
    if (!session || session.status !== 'active') throw feedbackNotFound();
    if (message.role !== AssistantMessageRole.assistant) throw new BadRequestException('Feedback can only be submitted for assistant messages.');
    if (!message.answerDecision) throw new BadRequestException('Feedback requires an assistant answer decision.');
    const answerDecision = message.answerDecision;

    const toolCalls = await this.prisma.db.toolCall.findMany({ where: { customerId: customerScope.customerId, messageId: input.messageId, sessionId: session.id } });
    const evidenceRefs = await this.prisma.db.evidenceRef.findMany({ where: { customerId: customerScope.customerId, messageId: { in: [input.messageId] } } });
    const toolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));
    if (evidenceRefs.some((evidenceRef) => evidenceRef.toolCallId && !toolCallIds.has(evidenceRef.toolCallId))) throw feedbackNotFound();
    return { message: { ...message, answerDecision }, session, toolCalls, evidenceRefs };
  }
}

type FeedbackTransactionClient = Pick<PrismaClient, 'feedbackEvent' | 'reviewItem' | 'assistantSession' | 'assistantMessage' | 'toolCall' | 'evidenceRef' | 'answerDecision' | 'auditEvent'> & AuditTransactionClient;

function feedbackNotFound(): NotFoundException {
  return new NotFoundException({ error: 'NOT_FOUND', message: 'Feedback resource not found.' });
}

function isActionableFeedback(rating: FeedbackRating, intent: string): boolean {
  return rating === FeedbackRating.negative || ['correction', 'unsafe', 'not_helpful', 'missing_evidence'].includes(intent);
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
