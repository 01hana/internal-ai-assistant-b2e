import { Injectable } from '@nestjs/common';
import { AuditTransactionClient } from '../audit/audit-writer.interface';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { AnswerDecisionStatus, FeedbackRating, NoAnswerReason, ReviewItemStatus, ReviewPriority, ReviewSourceType } from '../generated/prisma/enums';
import { assertCustomerScopeMatchesIdentityContext } from '../identity/customer-scope-consistency';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { CustomerScope } from '../identity/customer-scope.types';
import { PrismaService } from '../prisma/prisma.service';
import { sessionOwnedByScopePredicate } from '../prisma/customer-scope.predicate';
import type { UnsupportedQuestionReasonCode } from '../assistant/message/unsupported-question';

export interface CreateReviewItemFromAssistantOutcomeInput {
  customerScope: CustomerScope;
  requestId: string; sessionId: string; messageId: string; identityContext: RequestIdentityContext;
  answerDecisionId: string; answerDecision: AnswerDecisionStatus; noAnswerReason: NoAnswerReason;
  toolName?: string; toolCallId?: string; evidenceRefCount: number; permissionDeniedReason?: string; toolFailureReason?: string; conflictReason?: string; conflictFieldPaths?: string[]; evidenceRefIds?: string[];
}
export interface CreateReviewItemFromFeedbackInput {
  customerScope: CustomerScope;
  requestId: string; sessionId: string; messageId: string; identityContext: RequestIdentityContext;
  feedbackEventId: string; answerDecision: AnswerDecisionStatus; rating: FeedbackRating; intent: string; reason?: string; comment?: string; toolCallIds: string[]; evidenceRefIds: string[];
}
/** Feature 013 US5: a question the assistant could not map to any capability. The user's text is never copied. */
export interface CreateUnsupportedQuestionInput {
  customerScope: CustomerScope; identityContext: RequestIdentityContext;
  requestId: string; sessionId: string; userMessageId: string;
  reasonCode: UnsupportedQuestionReasonCode; module?: string;
}
export const UNSUPPORTED_QUESTION_SUMMARY = 'unsupported_question: assistant could not recognize the requested capability';
export interface ReviewVisibilityInput { customerScope: CustomerScope; identityContext: RequestIdentityContext; status?: ReviewItemStatus; sourceType?: ReviewSourceType; priority?: ReviewPriority; }
export interface ReviewTransitionInput { customerScope: CustomerScope; requestId: string; identityContext: RequestIdentityContext; reviewItemId: string; reason?: string; }

@Injectable()
export class ReviewItemService {
  constructor(private readonly prisma: PrismaService, private readonly auditWriter: AuditWriterService) {}

  async createFromAssistantOutcome(input: CreateReviewItemFromAssistantOutcomeInput, database?: ReviewTransactionClient) {
    assertCustomerScopeMatchesIdentityContext(input.customerScope, input.identityContext);
    if (database) return this.createAssistantOutcomeInDatabase(input, database);
    return this.prisma.db.$transaction((transaction) => this.createAssistantOutcomeInDatabase(input, transaction as ReviewTransactionClient));
  }

  async createFromFeedback(input: CreateReviewItemFromFeedbackInput, database?: ReviewTransactionClient) {
    assertCustomerScopeMatchesIdentityContext(input.customerScope, input.identityContext);
    if (database) return this.createFeedbackInDatabase(input, database);
    return this.prisma.db.$transaction((transaction) => this.createFeedbackInDatabase(input, transaction as ReviewTransactionClient));
  }

  /** Every occurrence is recorded (no de-duplication): the count itself is the demand signal. */
  async createUnsupportedQuestion(input: CreateUnsupportedQuestionInput) {
    assertCustomerScopeMatchesIdentityContext(input.customerScope, input.identityContext);
    return this.prisma.db.$transaction(async (transaction) => {
      const database = transaction as ReviewTransactionClient;
      await this.assertParents(database, input.customerScope, input.sessionId, input.userMessageId, [], []);
      const suggestedImprovement = { reasonCode: input.reasonCode, module: input.module ?? null };
      const reviewItem = await database.reviewItem.create({ data: { customerId: input.customerScope.customerId,
        sourceType: ReviewSourceType.unsupported_question, sourceId: input.userMessageId, status: ReviewItemStatus.open,
        priority: ReviewPriority.medium, summary: UNSUPPORTED_QUESTION_SUMMARY, suggestedImprovement: toJsonInput(suggestedImprovement) } });
      await this.auditWriter.append({ customerScope: input.customerScope, requestId: input.requestId, sessionId: input.sessionId,
        messageId: input.userMessageId, eventType: 'review_item_created', metadata: toJsonInput({ reviewItemId: reviewItem.id,
          sourceType: ReviewSourceType.unsupported_question, ...suggestedImprovement }) }, database);
      return reviewItem;
    });
  }

  async listForReview(input: ReviewVisibilityInput) {
    assertCustomerScopeMatchesIdentityContext(input.customerScope, input.identityContext);
    // Only filters the caller supplied; an omitted filter is never sent as `undefined`.
    const items = await this.prisma.db.reviewItem.findMany({ where: { customerId: input.customerScope.customerId,
      ...(input.status ? { status: input.status } : {}), ...(input.sourceType ? { sourceType: input.sourceType } : {}),
      ...(input.priority ? { priority: input.priority } : {}) }, orderBy: { createdAt: 'desc' } });
    const visible = await Promise.all(items.map(async (item) => (await this.hasValidSource(item, this.prisma.db, input.customerScope)) ? toReviewItemResponse(item) : undefined));
    return visible.filter((item): item is ReviewItemResponse => item !== undefined);
  }

  async getForReview(input: ReviewVisibilityInput & { reviewItemId: string }) {
    assertCustomerScopeMatchesIdentityContext(input.customerScope, input.identityContext);
    const item = await this.prisma.db.reviewItem.findFirst({ where: { customerId: input.customerScope.customerId, id: input.reviewItemId } });
    if (!item || !(await this.hasValidSource(item, this.prisma.db, input.customerScope))) return null;
    return toReviewItemResponse(item);
  }

  async markResolved(input: ReviewTransitionInput) { return this.transitionReviewItem(input, ReviewItemStatus.resolved, 'review_item_resolved'); }
  async markDismissed(input: ReviewTransitionInput) { return this.transitionReviewItem(input, ReviewItemStatus.dismissed, 'review_item_dismissed'); }

  private async createAssistantOutcomeInDatabase(input: CreateReviewItemFromAssistantOutcomeInput, database: ReviewTransactionClient) {
    await this.assertParents(database, input.customerScope, input.sessionId, input.messageId, input.toolCallId ? [input.toolCallId] : [], input.evidenceRefIds ?? []);
    const answerDecision = await database.answerDecision.findFirst({ where: { customerId: input.customerScope.customerId, id: input.answerDecisionId, messageId: input.messageId } });
    if (!answerDecision || answerDecision.status !== input.answerDecision) throw reviewNotFound();
    const sourceType = toReviewSourceType(input.noAnswerReason);
    const reviewItem = await database.reviewItem.create({ data: { customerId: input.customerScope.customerId, sourceType, sourceId: input.answerDecisionId, status: ReviewItemStatus.open, priority: toReviewPriority(input.noAnswerReason), summary: `${input.noAnswerReason}: assistant answer requires review`, suggestedImprovement: toJsonInput({ requestId: input.requestId, messageId: input.messageId, toolName: input.toolName ?? null, toolCallId: input.toolCallId ?? null, answerDecision: input.answerDecision, noAnswerReason: input.noAnswerReason, evidenceRefCount: input.evidenceRefCount, permissionDeniedReason: input.permissionDeniedReason ?? null, toolFailureReason: input.toolFailureReason ?? null, conflictReason: input.conflictReason ?? null, conflictFieldPaths: input.conflictFieldPaths ?? [], evidenceRefIds: input.evidenceRefIds ?? [] }) } });
    await this.auditWriter.append({ customerScope: input.customerScope, requestId: input.requestId, sessionId: input.sessionId, messageId: input.messageId, eventType: 'review_item_created', decision: input.answerDecision, toolCallId: input.toolCallId, evidenceRefIds: input.evidenceRefIds, metadata: toJsonInput({ reviewItemId: reviewItem.id, sourceType, answerDecision: input.answerDecision, noAnswerReason: input.noAnswerReason, toolName: input.toolName ?? null, toolCallId: input.toolCallId ?? null, evidenceRefCount: input.evidenceRefCount }) }, database);
    return reviewItem;
  }

  private async createFeedbackInDatabase(input: CreateReviewItemFromFeedbackInput, database: ReviewTransactionClient) {
    await this.assertParents(database, input.customerScope, input.sessionId, input.messageId, input.toolCallIds, input.evidenceRefIds);
    const feedback = await database.feedbackEvent.findFirst({ where: { customerId: input.customerScope.customerId, id: input.feedbackEventId, messageId: input.messageId } });
    if (!feedback || feedback.answerDecision !== input.answerDecision) throw reviewNotFound();
    const sourceType = toFeedbackReviewSourceType(input);
    const existing = await database.reviewItem.findFirst({ where: { customerId: input.customerScope.customerId, sourceType, sourceId: input.feedbackEventId, status: ReviewItemStatus.open } });
    if (existing) return existing;
    const reviewItem = await database.reviewItem.create({ data: { customerId: input.customerScope.customerId, sourceType, sourceId: input.feedbackEventId, status: ReviewItemStatus.open, priority: toFeedbackReviewPriority(input), summary: `${input.intent}: feedback requires review`, suggestedImprovement: toJsonInput({ requestId: input.requestId, messageId: input.messageId, feedbackEventId: input.feedbackEventId, answerDecision: input.answerDecision, toolCallIds: input.toolCallIds, evidenceRefIds: input.evidenceRefIds, rating: input.rating, intent: input.intent, reasonProvided: Boolean(input.reason), commentProvided: Boolean(input.comment) }) } });
    await this.auditWriter.append({ customerScope: input.customerScope, requestId: input.requestId, sessionId: input.sessionId, messageId: input.messageId, eventType: 'review_item_created', decision: input.answerDecision, evidenceRefIds: input.evidenceRefIds, metadata: toJsonInput({ reviewItemId: reviewItem.id, sourceType, feedbackEventId: input.feedbackEventId, answerDecision: input.answerDecision, rating: input.rating, intent: input.intent, reasonProvided: Boolean(input.reason), commentProvided: Boolean(input.comment), toolCallIds: input.toolCallIds, evidenceRefIds: input.evidenceRefIds }) }, database);
    return reviewItem;
  }

  private async transitionReviewItem(input: ReviewTransitionInput, status: ReviewItemStatus, eventType: string) {
    assertCustomerScopeMatchesIdentityContext(input.customerScope, input.identityContext);
    return this.prisma.db.$transaction(async (transaction) => {
      const database = transaction as ReviewTransactionClient;
      const existing = await database.reviewItem.findFirst({ where: { customerId: input.customerScope.customerId, id: input.reviewItemId } });
      if (!existing || !(await this.hasValidSource(existing, database, input.customerScope))) return null;
      const updatedCount = await database.reviewItem.updateMany({ where: { customerId: input.customerScope.customerId, id: input.reviewItemId, status: ReviewItemStatus.open }, data: { status, resolvedAt: new Date() } });
      if (updatedCount.count !== 1) return null;
      const updated = await database.reviewItem.findFirst({ where: { customerId: input.customerScope.customerId, id: input.reviewItemId } });
      if (!updated) return null;
      await this.auditWriter.append({ customerScope: input.customerScope, requestId: input.requestId, eventType, metadata: toJsonInput({ reviewItemId: updated.id, status: updated.status, sourceType: updated.sourceType, sourceId: updated.sourceId, reasonProvided: Boolean(input.reason) }) }, database);
      return toReviewItemResponse(updated);
    });
  }

  private async assertParents(database: ReviewTransactionClient, customerScope: CustomerScope, sessionId: string, messageId: string, toolCallIds: string[], evidenceRefIds: string[]) {
    const session = await database.assistantSession.findFirst({ where: sessionOwnedByScopePredicate(customerScope, sessionId) });
    const message = await database.assistantMessage.findFirst({ where: { customerId: customerScope.customerId, id: messageId, sessionId } });
    if (!session || !message) throw reviewNotFound();
    const toolIds = [...new Set(toolCallIds)];
    if (toolIds.length > 0 && (await database.toolCall.findMany({ where: { customerId: customerScope.customerId, id: { in: toolIds }, sessionId, messageId } })).length !== toolIds.length) throw reviewNotFound();
    const evidenceIds = [...new Set(evidenceRefIds)];
    if (evidenceIds.length > 0 && (await database.evidenceRef.findMany({ where: { customerId: customerScope.customerId, id: { in: evidenceIds }, messageId } })).length !== evidenceIds.length) throw reviewNotFound();
  }

  private async hasValidSource(item: { sourceType: ReviewSourceType; sourceId: string }, database: ReviewTransactionClient, customerScope: CustomerScope) {
    if (item.sourceType === ReviewSourceType.unsupported_question) {
      const userMessage = await database.assistantMessage.findFirst({ where: { customerId: customerScope.customerId, id: item.sourceId } });
      return userMessage ? this.isVisibleIntegrationSession(database, customerScope, userMessage.sessionId) : false;
    }
    const [feedback, decision] = await Promise.all([
      database.feedbackEvent.findFirst({ where: { customerId: customerScope.customerId, id: item.sourceId } }),
      database.answerDecision.findFirst({ where: { customerId: customerScope.customerId, id: item.sourceId } })
    ]);
    const source = item.sourceType === ReviewSourceType.negative_feedback
      ? feedback
      : item.sourceType === ReviewSourceType.missing_evidence
        ? Boolean(feedback) !== Boolean(decision) ? feedback ?? decision : null
        : decision;
    if (!source) return false;
    const message = await database.assistantMessage.findFirst({ where: { customerId: customerScope.customerId, id: source.messageId } });
    if (!message) return false;
    return this.isVisibleIntegrationSession(database, customerScope, message.sessionId);
  }

  /** Reviewers may inspect another actor's items, but never another Integration's Session. */
  private async isVisibleIntegrationSession(database: ReviewTransactionClient, customerScope: CustomerScope, sessionId: string) {
    return Boolean(await database.assistantSession.findFirst({ where: {
      customerId: customerScope.customerId, integrationId: customerScope.integrationId,
      organizationId: customerScope.organizationId, hostApp: customerScope.hostApp, id: sessionId
    } }));
  }
}

type ReviewTransactionClient = Pick<PrismaClient, 'assistantSession' | 'assistantMessage' | 'answerDecision' | 'feedbackEvent' | 'toolCall' | 'evidenceRef' | 'reviewItem' | 'auditEvent'> & AuditTransactionClient;
type ReviewItemResponse = ReturnType<typeof toReviewItemResponse>;
function reviewNotFound(): Error { return new Error('Review resource not found.'); }
function toReviewSourceType(reason: NoAnswerReason): ReviewSourceType { if (reason === NoAnswerReason.tool_failure) return ReviewSourceType.tool_failure; if (reason === NoAnswerReason.no_evidence) return ReviewSourceType.no_answer; if (reason === NoAnswerReason.permission_denied) return ReviewSourceType.permission_mapping_issue; if (reason === NoAnswerReason.evidence_conflict) return ReviewSourceType.missing_evidence; return ReviewSourceType.failed_query; }
function toReviewPriority(reason: NoAnswerReason): ReviewPriority { return reason === NoAnswerReason.permission_denied || reason === NoAnswerReason.tool_failure ? ReviewPriority.high : ReviewPriority.medium; }
function toFeedbackReviewSourceType(input: { intent: string }): ReviewSourceType { return input.intent === 'missing_evidence' ? ReviewSourceType.missing_evidence : ReviewSourceType.negative_feedback; }
function toFeedbackReviewPriority(input: { intent: string }): ReviewPriority { return ['correction', 'missing_evidence', 'unsafe'].includes(input.intent) ? ReviewPriority.high : ReviewPriority.medium; }
function toJsonInput<T>(value: T): Prisma.InputJsonValue { return value as unknown as Prisma.InputJsonValue; }
function toReviewItemResponse(item: { id: string; sourceType: ReviewSourceType; sourceId: string; status: ReviewItemStatus; priority: ReviewPriority; summary: string; suggestedImprovement: Prisma.JsonValue; createdAt: Date; resolvedAt: Date | null }) { return { reviewItemId: item.id, sourceType: item.sourceType, sourceId: item.sourceId, status: item.status, priority: item.priority, summary: item.summary, suggestedImprovement: item.suggestedImprovement, createdAt: item.createdAt.toISOString(), resolvedAt: item.resolvedAt?.toISOString() ?? null }; }
