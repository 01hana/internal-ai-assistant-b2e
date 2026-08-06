import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { ActionDraftService } from '../../approvals/action-draft.service';
import { ApprovalRequestService } from '../../approvals/approval-request.service';
import { EscalationRequestService } from '../../approvals/escalation-request.service';
import { AttachedEvidence, EvidenceRefService } from '../../evidence/evidence-ref.service';
import { Prisma } from '../../generated/prisma/client';
import { createCustomerScopeFromIdentityContext } from '../../identity/customer-scope.factory';
import { AnswerDecisionStatus, AssistantMessageRole, NoAnswerReason, RiskLevel } from '../../generated/prisma/enums';
import { ReviewItemService } from '../../feedback/review-item.service';
import { RetrievalService } from '../../retrieval/retrieval.service';
import { AnswerDecisionService } from '../answer/answer-decision.service';
import { ClarificationQuestionService } from '../answer/clarification-question.service';
import { EvidenceConflictDetectorService, NormalizedEvidenceFact } from '../answer/evidence-conflict-detector.service';
import { NoAnswerGateService } from '../answer/no-answer-gate.service';
import { AssistantContextStateService } from '../context/assistant-context-state.service';
import { toPageContextAuditMetadata, toPageContextPersistence } from '../page-context/page-context.mapper';
import { AssistantPlanningService } from '../planning/assistant-planning.service';
import { AssistantPlanningResult } from '../planning/assistant-planning.types';
import { AssistantReadonlyRuntimeService } from '../runtime/assistant-readonly-runtime.service';
import { AssistantSessionService } from '../session/assistant-session.service';
import { AssistantSseEventBuilder } from '../sse/assistant-sse-event.builder';
import { AssistantSseEventRecord } from '../sse/assistant-sse.types';
import { AssistantMessageRepository } from './assistant-message.repository';
import { SendAssistantMessageInput } from './assistant-message.types';

@Injectable()
export class AssistantMessageService {
  constructor(
    private readonly sessionService: AssistantSessionService,
    private readonly messageRepository: AssistantMessageRepository,
    private readonly planningService: AssistantPlanningService,
    private readonly readonlyRuntimeService: AssistantReadonlyRuntimeService,
    private readonly retrievalService: RetrievalService,
    private readonly evidenceRefService: EvidenceRefService,
    private readonly answerDecisionService: AnswerDecisionService,
    private readonly noAnswerGateService: NoAnswerGateService,
    private readonly evidenceConflictDetector: EvidenceConflictDetectorService,
    private readonly clarificationQuestionService: ClarificationQuestionService,
    private readonly reviewItemService: ReviewItemService,
    private readonly contextStateService: AssistantContextStateService,
    private readonly actionDraftService: ActionDraftService,
    private readonly approvalRequestService: ApprovalRequestService,
    private readonly escalationRequestService: EscalationRequestService,
    private readonly auditWriter: AuditWriterService,
    private readonly sseEventBuilder: AssistantSseEventBuilder
  ) {}

  async sendMessage(input: SendAssistantMessageInput): Promise<AssistantSseEventRecord[]> {
    const customerScope = createCustomerScopeFromIdentityContext(input.identityContext);
    const session = await this.sessionService.getVisibleSession(input.sessionId, customerScope);
    const userMessage = await this.messageRepository.createUserMessage({
      customerScope,
      sessionId: session.id,
      requestId: input.requestId,
      content: input.message,
      pageContext: input.pageContext
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: session.id,
      messageId: userMessage.id,
      eventType: 'message_received',
      metadata: toJsonInput({
        pageContext: toPageContextAuditMetadata(input.pageContext)
      })
    });

    const latestContextState = await this.contextStateService.loadLatest(customerScope, session.id);
    const planningResult = await this.planningService.createPlan({
      customerScope,
      requestId: input.requestId,
      sessionId: session.id,
      messageId: userMessage.id,
      text: input.message,
      identityContext: input.identityContext,
      pageContext: toPageContextPersistence(input.pageContext),
      assistantContextState: latestContextState
        ? {
            currentModule: latestContextState.currentModule,
            currentEntityType: latestContextState.currentEntityType,
            currentEntityId: latestContextState.currentEntityId,
            currentPage: latestContextState.currentPage
          }
        : undefined
    });

    const assistantMessage = await this.messageRepository.createPendingAssistantMessage({
      customerScope,
      sessionId: session.id,
      requestId: input.requestId
    });
    this.assertResponseMessageOwnership(assistantMessage, customerScope.customerId, session.id);

    const preRuntimeGate = this.noAnswerGateService.evaluatePreRuntime(planningResult);
    if (
      preRuntimeGate?.kind === 'clarification' &&
      shouldApplyPreRuntimeClarificationGate(planningResult.executionPlan.riskAssessment, input.pageContext, preRuntimeGate.clarificationReason)
    ) {
      const clarificationQuestion = await this.clarificationQuestionService.create({
        customerScope,
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        identityContext: input.identityContext,
        question: preRuntimeGate.question,
        reason: preRuntimeGate.clarificationReason,
        candidateRefs: preRuntimeGate.candidateRefs,
        blocking: preRuntimeGate.blocking,
        confidence: planningResult.queryUnderstanding.confidence
      });

      const answerDecision = await this.answerDecisionService.recordSafeDecision({
        customerScope,
        requestId: input.requestId,
        messageId: assistantMessage.id,
        status: AnswerDecisionStatus.clarification_required,
        clarificationQuestionId: clarificationQuestion.id,
        answer: {
          text: preRuntimeGate.question,
          delta: preRuntimeGate.question
        },
        metadata: toJsonInput({
          clarificationQuestionId: clarificationQuestion.id,
          reason: preRuntimeGate.clarificationReason,
          candidateRefCount: preRuntimeGate.candidateRefs.length,
          confidence: planningResult.queryUnderstanding.confidence
        })
      });

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerDecision.answer.text,
        answerDecision: answerDecision.status
      });

      await this.contextStateService.markWaitingClarification({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: [],
        evidenceRefIds: [],
        clarificationQuestionId: clarificationQuestion.id,
        reason: preRuntimeGate.clarificationReason,
        question: preRuntimeGate.question,
        candidateRefs: preRuntimeGate.candidateRefs,
        blocking: preRuntimeGate.blocking
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        eventType: 'answer_generated',
        decision: answerDecision.status,
        evidenceRefIds: [],
        metadata: toJsonInput({
          answerDecisionId: answerDecision.answerDecisionId,
          clarificationQuestionId: clarificationQuestion.id,
          reason: preRuntimeGate.clarificationReason,
          candidateRefCount: preRuntimeGate.candidateRefs.length,
          groundingCheckId: answerDecision.groundingCheckId
        })
      });

      return this.sseEventBuilder.buildAnswerOnlyEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        answerDelta: answerDecision.answer.delta,
        finalData: {
          answerDecision: answerDecision.status,
          answer: answerDecision.answer.text,
          clarificationQuestionId: clarificationQuestion.id,
          evidenceRefs: []
        }
      });
    }

    if (planningResult.executionPlan.riskAssessment === RiskLevel.medium) {
      const actionDraft = await this.actionDraftService.createForMediumRisk({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        identityContext: input.identityContext,
        executionPlan: planningResult.executionPlan,
        pageContext: input.pageContext
      });
      const answerText = '這項操作需要你先確認，確認前系統不會執行任何變更。';

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerText,
        answerDecision: AnswerDecisionStatus.confirmation_required
      });

      await this.contextStateService.markWaitingConfirmation({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: [],
        evidenceRefIds: []
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        eventType: 'answer_generated',
        decision: AnswerDecisionStatus.confirmation_required,
        metadata: toJsonInput({
          actionDraftId: actionDraft.actionDraftId,
          riskLevel: actionDraft.riskLevel,
          toolName: actionDraft.toolName,
          resource: actionDraft.resource,
          operation: actionDraft.operation,
          expiresAt: actionDraft.expiresAt,
          pageContext: toPageContextAuditMetadata(input.pageContext)
        })
      });

      return this.sseEventBuilder.buildConfirmationRequiredEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        actionDraftId: actionDraft.actionDraftId,
        riskLevel: actionDraft.riskLevel,
        preview: actionDraft.preview,
        expiresAt: actionDraft.expiresAt,
        answer: answerText
      });
    }

    if (
      planningResult.executionPlan.riskAssessment === RiskLevel.critical
    ) {
      const escalationRequest = await this.escalationRequestService.createForCriticalRisk({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        identityContext: input.identityContext,
        executionPlan: planningResult.executionPlan,
        pageContext: input.pageContext
      });
      const summary = toEscalationSummaryObject(escalationRequest.summary);
      const answerText = '這項重大風險操作需要升級由人工處理；升級完成前系統不會執行任何變更。';

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerText,
        answerDecision: AnswerDecisionStatus.escalation_required
      });

      await this.contextStateService.markWaitingEscalation({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: [],
        evidenceRefIds: [],
        pendingEscalationRequestId: escalationRequest.escalationRequestId
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        eventType: 'answer_generated',
        decision: AnswerDecisionStatus.escalation_required,
        metadata: toJsonInput({
          escalationRequestId: escalationRequest.escalationRequestId,
          riskLevel: planningResult.executionPlan.riskAssessment,
          reasonCode: summary.reasonCode,
          actionSummary: summary.actionSummary,
          pageContext: toPageContextAuditMetadata(input.pageContext)
        })
      });

      return this.sseEventBuilder.buildEscalationRequiredEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        escalationRequestId: escalationRequest.escalationRequestId,
        riskLevel: escalationRequest.summary && typeof escalationRequest.summary === 'object' && !Array.isArray(escalationRequest.summary)
          ? (summary.riskLevel as RiskLevel)
          : planningResult.executionPlan.riskAssessment,
        reasonCode: typeof summary.reasonCode === 'string' ? summary.reasonCode : 'policy_required',
        reasonSummary: typeof summary.reasonSummary === 'string' ? summary.reasonSummary : 'Critical-risk action requires manual escalation.',
        actionSummary: summary.actionSummary,
        expiresAt: typeof summary.expiresAt === 'string' ? summary.expiresAt : null,
        answer: answerText
      });
    }

    if (
      planningResult.executionPlan.riskAssessment === RiskLevel.high
    ) {
      const approvalRequest = await this.approvalRequestService.createForHighRisk({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        identityContext: input.identityContext,
        executionPlan: planningResult.executionPlan,
        pageContext: input.pageContext
      });
      const answerText = '這項高風險操作需要核准後才可繼續；核准前系統不會執行任何變更。';

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerText,
        answerDecision: AnswerDecisionStatus.approval_required
      });

      await this.contextStateService.markWaitingApproval({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: [],
        evidenceRefIds: [],
        pendingApprovalRequestId: approvalRequest.approvalRequestId
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        eventType: 'answer_generated',
        decision: AnswerDecisionStatus.approval_required,
        metadata: toJsonInput({
          approvalRequestId: approvalRequest.approvalRequestId,
          riskLevel: approvalRequest.riskLevel,
          actionSummary: approvalRequest.actionSummary,
          expiresAt: approvalRequest.expiresAt,
          pageContext: toPageContextAuditMetadata(input.pageContext)
        })
      });

      return this.sseEventBuilder.buildApprovalRequiredEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        approvalRequestId: approvalRequest.approvalRequestId,
        riskLevel: approvalRequest.riskLevel,
        actionSummary: approvalRequest.actionSummary,
        expiresAt: approvalRequest.expiresAt,
        answer: answerText
      });
    }

    if (requiresDocumentChunkEvidence(planningResult.executionPlan.requiredEvidence)) {
      let retrievalResult;
      try {
        retrievalResult = await this.retrievalService.runDocumentRetrieval({
          requestId: input.requestId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          identityContext: input.identityContext,
          customerScope,
          query: input.message,
          normalizedQuery: planningResult.queryUnderstanding.tokens.map((token) => token.normalizedValue).join(' '),
          limit: 2
        });
      } catch {
        return this.completeRetrievalFailure({
          customerScope,
          requestId: input.requestId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          identityContext: input.identityContext,
          pageContext: input.pageContext,
          planningResult
        });
      }

      if (retrievalResult.selectedCandidates.length === 0) {
        const answerDecision = await this.answerDecisionService.recordSafeDecision({
          customerScope,
          requestId: input.requestId,
          messageId: assistantMessage.id,
          status: AnswerDecisionStatus.no_answer,
          noAnswerReason: NoAnswerReason.no_evidence,
          answer: {
            text: '目前沒有找到足夠的文件 evidence 可以回答這個問題。',
            delta: '目前沒有找到足夠的文件 evidence 可以回答'
          },
          metadata: toJsonInput({
            retrievalRunId: retrievalResult.retrievalRunId,
            provider: retrievalResult.provider,
            candidateCount: retrievalResult.candidates.length,
            noAnswerReason: NoAnswerReason.no_evidence
          })
        });

        const reviewItem = await this.reviewItemService.createFromAssistantOutcome({
          requestId: input.requestId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          identityContext: input.identityContext,
          answerDecisionId: answerDecision.answerDecisionId,
          answerDecision: answerDecision.status,
          noAnswerReason: NoAnswerReason.no_evidence,
          evidenceRefCount: 0
        });

        await this.messageRepository.completeAssistantMessage({
          customerScope,
          messageId: assistantMessage.id,
          content: answerDecision.answer.text,
          answerDecision: answerDecision.status
        });

        await this.contextStateService.updateAfterMessageFlow({
          customerScope,
          sessionId: session.id,
          pageContext: input.pageContext,
          planningResult,
          toolCallIds: [],
          evidenceRefIds: []
        });

        await this.auditWriter.append({
          requestId: input.requestId,
          organizationId: input.identityContext.organization.organizationId,
          hostApp: input.identityContext.hostApp.hostApp,
          actorId: input.identityContext.actor.actorId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          eventType: 'answer_generated',
          decision: answerDecision.status,
          evidenceRefIds: [],
          metadata: toJsonInput({
            retrievalRunId: retrievalResult.retrievalRunId,
            provider: retrievalResult.provider,
            candidateCount: retrievalResult.candidates.length,
            noAnswerReason: NoAnswerReason.no_evidence,
            reviewItemId: reviewItem.id,
            answerDecisionId: answerDecision.answerDecisionId,
            groundingCheckId: answerDecision.groundingCheckId
          })
        });

        return this.sseEventBuilder.buildAnswerOnlyEvents({
          requestId: input.requestId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          answerDelta: answerDecision.answer.delta,
          finalData: {
            answerDecision: answerDecision.status,
            answer: answerDecision.answer.text,
            noAnswerReason: NoAnswerReason.no_evidence,
            evidenceRefs: []
          }
        });
      }

      const documentEvidenceRefs: AttachedEvidence<Record<string, unknown>>[] = [];
      for (const candidate of retrievalResult.selectedCandidates) {
        const documentId = stringFromMetadata(candidate.metadata.documentId);
        if (!candidate.chunkId || !documentId) {
          continue;
        }

        documentEvidenceRefs.push(
          await this.evidenceRefService.attachDocumentChunkEvidence({
            requestId: input.requestId,
            sessionId: session.id,
            messageId: assistantMessage.id,
            identityContext: input.identityContext,
            customerScope,
            retrievalRunId: retrievalResult.retrievalRunId,
            retrievalCandidateId: candidate.id,
            documentId,
            chunkId: candidate.chunkId,
          })
        );
      }

      await this.retrievalService.markSelectedEvidence({
        customerScope,
        retrievalRunId: retrievalResult.retrievalRunId,
        evidenceRefIds: documentEvidenceRefs.map((evidence) => evidence.id)
      });

      const answerDecision = await this.answerDecisionService.decide({
        customerScope,
        requestId: input.requestId,
        messageId: assistantMessage.id,
        executionPlan: planningResult.executionPlan,
        evidenceRefs: documentEvidenceRefs.map((evidence) => ({
          id: evidence.id,
          summary: evidence.summary
        }))
      });

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerDecision.answer.text,
        answerDecision: answerDecision.status
      });

      await this.contextStateService.updateAfterMessageFlow({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: [],
        evidenceRefIds: documentEvidenceRefs.map((evidence) => evidence.id)
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        eventType: 'answer_generated',
        decision: answerDecision.status,
        evidenceRefIds: documentEvidenceRefs.map((evidence) => evidence.id),
        metadata: toJsonInput({
          retrievalRunId: retrievalResult.retrievalRunId,
          provider: retrievalResult.provider,
          selectedChunkIds: retrievalResult.selectedCandidates.map((candidate) => candidate.chunkId),
          selectedDocumentIds: retrievalResult.selectedCandidates.map((candidate) => stringFromMetadata(candidate.metadata.documentId)),
          evidenceRefIds: documentEvidenceRefs.map((evidence) => evidence.id),
          answerDecisionId: answerDecision.answerDecisionId,
          groundingCheckId: answerDecision.groundingCheckId
        })
      });

      return this.sseEventBuilder.buildAnswerOnlyEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        answerDelta: answerDecision.answer.delta,
        finalData: {
          answerDecision: answerDecision.status,
          answer: answerDecision.answer.text,
          evidenceRefs: documentEvidenceRefs.map((evidence) => evidence.id)
        }
      });
    }

    const runtimeResult = await this.readonlyRuntimeService.execute({
      customerScope,
      requestId: input.requestId,
      sessionId: session.id,
      sourceMessageId: userMessage.id,
      responseMessageId: assistantMessage.id,
      identityContext: input.identityContext,
      executionPlan: planningResult.executionPlan,
      pageContext: input.pageContext
    });

    if (runtimeResult.toolLifecycle !== 'completed') {
      const gateDecision = this.noAnswerGateService.evaluatePostRuntime({
        runtimeResult,
        evidenceRefCount: 0
      });
      const answerDecision = await this.answerDecisionService.recordSafeDecision({
        customerScope,
        requestId: input.requestId,
        messageId: assistantMessage.id,
        status: gateDecision?.kind === 'no_answer' ? gateDecision.status : AnswerDecisionStatus.no_answer,
        noAnswerReason: gateDecision?.kind === 'no_answer' ? gateDecision.noAnswerReason : undefined,
        answer: {
          text: gateDecision?.kind === 'no_answer' ? gateDecision.answer : '目前沒有足夠 evidence 可以回答這個問題。',
          delta: gateDecision?.kind === 'no_answer' ? gateDecision.delta : '目前沒有足夠 evidence 可以回答'
        },
        metadata: toJsonInput({
          toolName: runtimeResult.toolName,
          toolCallId: runtimeResult.toolCallId ?? null,
          toolLifecycle: runtimeResult.toolLifecycle,
          deniedReason: runtimeResult.deniedReason ?? null,
          errorCode: runtimeResult.connectorErrorCode ?? null,
          noAnswerReason: gateDecision?.kind === 'no_answer' ? gateDecision.noAnswerReason : null
        })
      });

      const reviewItem = gateDecision?.kind === 'no_answer'
        ? await this.reviewItemService.createFromAssistantOutcome({
            requestId: input.requestId,
            sessionId: session.id,
            messageId: assistantMessage.id,
            identityContext: input.identityContext,
            answerDecisionId: answerDecision.answerDecisionId,
            answerDecision: answerDecision.status,
            noAnswerReason: gateDecision.noAnswerReason,
            toolName: runtimeResult.toolName,
            toolCallId: runtimeResult.toolCallId,
            evidenceRefCount: 0,
            permissionDeniedReason: gateDecision.permissionDeniedReason,
            toolFailureReason: gateDecision.toolFailureReason
          })
        : undefined;

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerDecision.answer.text,
        answerDecision: answerDecision.status
      });

      await this.contextStateService.updateAfterMessageFlow({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: runtimeResult.toolCallId ? [runtimeResult.toolCallId] : [],
        evidenceRefIds: []
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        eventType: 'answer_generated',
        decision: answerDecision.status,
        toolCallId: runtimeResult.toolCallId,
        evidenceRefIds: [],
        metadata: toJsonInput({
          toolName: runtimeResult.toolName,
          deniedReason: runtimeResult.deniedReason,
          errorCode: runtimeResult.connectorErrorCode,
          noAnswerReason: gateDecision?.kind === 'no_answer' ? gateDecision.noAnswerReason : null,
          reviewItemId: reviewItem?.id ?? null,
          answerDecisionId: answerDecision.answerDecisionId,
          groundingCheckId: answerDecision.groundingCheckId
        })
      });

      return this.sseEventBuilder.buildMessageEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        toolCallId: runtimeResult.toolCallId ?? 'not-executed',
        toolName: runtimeResult.toolName,
        toolLifecycle: runtimeResult.toolLifecycle,
        deniedReason: runtimeResult.deniedReason,
        errorCode: runtimeResult.connectorErrorCode,
        evidenceRefIds: [],
        answerDelta: answerDecision.answer.delta,
        finalData: {
          answerDecision: answerDecision.status,
          answer: answerDecision.answer.text,
          noAnswerReason: gateDecision?.kind === 'no_answer' ? gateDecision.noAnswerReason : undefined,
          errorCode: runtimeResult.connectorErrorCode,
          evidenceRefs: []
        }
      });
    }

    const evidenceRef = Object.keys(runtimeResult.sanitizedResult).length > 0 && runtimeResult.toolCallId
      ? await this.evidenceRefService.attachStructuredRecordEvidence({
          requestId: input.requestId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          toolCallId: runtimeResult.toolCallId,
          identityContext: input.identityContext,
          customerScope,
          entityType: runtimeResult.entityRef.entityType ?? 'order',
          entityId: runtimeResult.entityRef.entityId ?? runtimeResult.toolName,
          record: runtimeResult.sanitizedResult,
          visibleFields: Object.keys(runtimeResult.sanitizedResult)
        })
      : undefined;

    const noEvidenceGate = this.noAnswerGateService.evaluatePostRuntime({
      runtimeResult,
      evidenceRefCount: evidenceRef ? 1 : 0
    });

    if (noEvidenceGate?.kind === 'no_answer') {
      const answerDecision = await this.answerDecisionService.recordSafeDecision({
        customerScope,
        requestId: input.requestId,
        messageId: assistantMessage.id,
        status: noEvidenceGate.status,
        noAnswerReason: noEvidenceGate.noAnswerReason,
        answer: {
          text: noEvidenceGate.answer,
          delta: noEvidenceGate.delta
        },
        metadata: toJsonInput({
          toolName: runtimeResult.toolName,
          toolCallId: runtimeResult.toolCallId ?? null,
          toolLifecycle: runtimeResult.toolLifecycle,
          noAnswerReason: noEvidenceGate.noAnswerReason
        })
      });

      const reviewItem = await this.reviewItemService.createFromAssistantOutcome({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        identityContext: input.identityContext,
        answerDecisionId: answerDecision.answerDecisionId,
        answerDecision: answerDecision.status,
        noAnswerReason: noEvidenceGate.noAnswerReason,
        toolName: runtimeResult.toolName,
        toolCallId: runtimeResult.toolCallId,
        evidenceRefCount: 0
      });

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerDecision.answer.text,
        answerDecision: answerDecision.status
      });

      await this.contextStateService.updateAfterMessageFlow({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: runtimeResult.toolCallId ? [runtimeResult.toolCallId] : [],
        evidenceRefIds: []
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        toolCallId: runtimeResult.toolCallId,
        eventType: 'answer_generated',
        decision: answerDecision.status,
        evidenceRefIds: [],
        metadata: toJsonInput({
          toolName: runtimeResult.toolName,
          noAnswerReason: noEvidenceGate.noAnswerReason,
          reviewItemId: reviewItem.id,
          answerDecisionId: answerDecision.answerDecisionId,
          groundingCheckId: answerDecision.groundingCheckId
        })
      });

      return this.sseEventBuilder.buildMessageEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        toolCallId: runtimeResult.toolCallId ?? 'not-executed',
        toolName: runtimeResult.toolName,
        toolLifecycle: runtimeResult.toolLifecycle,
        evidenceRefIds: [],
        answerDelta: answerDecision.answer.delta,
        finalData: {
          answerDecision: answerDecision.status,
          answer: answerDecision.answer.text,
          noAnswerReason: noEvidenceGate.noAnswerReason,
          evidenceRefs: []
        }
      });
    }

    const conflict = this.evidenceConflictDetector.detect(evidenceRef ? toNormalizedEvidenceFacts(evidenceRef) : []);
    const conflictGate = this.noAnswerGateService.evaluateEvidenceConflict(conflict);

    if (conflictGate?.kind === 'no_answer') {
      const answerDecision = await this.answerDecisionService.recordSafeDecision({
        customerScope,
        requestId: input.requestId,
        messageId: assistantMessage.id,
        status: conflictGate.status,
        noAnswerReason: conflictGate.noAnswerReason,
        answer: {
          text: conflictGate.answer,
          delta: conflictGate.delta
        },
        metadata: toJsonInput({
          toolName: runtimeResult.toolName,
          toolCallId: runtimeResult.toolCallId ?? null,
          toolLifecycle: runtimeResult.toolLifecycle,
          noAnswerReason: conflictGate.noAnswerReason,
          conflictReason: conflictGate.conflictReason ?? null,
          conflictFieldPaths: conflictGate.conflictFieldPaths ?? [],
          evidenceRefCount: conflict.evidenceRefCount,
          evidenceRefIds: conflict.evidenceRefIds
        })
      });

      const reviewItem = await this.reviewItemService.createFromAssistantOutcome({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        identityContext: input.identityContext,
        answerDecisionId: answerDecision.answerDecisionId,
        answerDecision: answerDecision.status,
        noAnswerReason: conflictGate.noAnswerReason,
        toolName: runtimeResult.toolName,
        toolCallId: runtimeResult.toolCallId,
        evidenceRefCount: conflict.evidenceRefCount,
        conflictReason: conflictGate.conflictReason,
        conflictFieldPaths: conflictGate.conflictFieldPaths,
        evidenceRefIds: conflict.evidenceRefIds
      });

      await this.messageRepository.completeAssistantMessage({
        customerScope,
        messageId: assistantMessage.id,
        content: answerDecision.answer.text,
        answerDecision: answerDecision.status
      });

      await this.contextStateService.updateAfterMessageFlow({
        customerScope,
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: runtimeResult.toolCallId ? [runtimeResult.toolCallId] : [],
        evidenceRefIds: []
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.organization.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        toolCallId: runtimeResult.toolCallId,
        eventType: 'answer_generated',
        decision: answerDecision.status,
        evidenceRefIds: [],
        metadata: toJsonInput({
          toolName: runtimeResult.toolName,
          noAnswerReason: conflictGate.noAnswerReason,
          conflictReason: conflictGate.conflictReason ?? null,
          conflictFieldPaths: conflictGate.conflictFieldPaths ?? [],
          evidenceRefCount: conflict.evidenceRefCount,
          evidenceRefIds: conflict.evidenceRefIds,
          reviewItemId: reviewItem.id,
          answerDecisionId: answerDecision.answerDecisionId,
          groundingCheckId: answerDecision.groundingCheckId
        })
      });

      return this.sseEventBuilder.buildMessageEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        toolCallId: runtimeResult.toolCallId ?? 'not-executed',
        toolName: runtimeResult.toolName,
        toolLifecycle: runtimeResult.toolLifecycle,
        evidenceRefIds: [],
        answerDelta: answerDecision.answer.delta,
        finalData: {
          answerDecision: answerDecision.status,
          answer: answerDecision.answer.text,
          noAnswerReason: conflictGate.noAnswerReason,
          evidenceRefs: []
        }
      });
    }

    const answerDecision = await this.answerDecisionService.decide({
      customerScope,
      requestId: input.requestId,
      messageId: assistantMessage.id,
      executionPlan: planningResult.executionPlan,
      evidenceRefs: evidenceRef
        ? [
            {
              id: evidenceRef.id,
              summary: evidenceRef.summary
            }
          ]
        : []
    });

    await this.messageRepository.completeAssistantMessage({
      customerScope,
      messageId: assistantMessage.id,
      content: answerDecision.answer.text,
      answerDecision: answerDecision.status
    });

    await this.contextStateService.updateAfterMessageFlow({
      customerScope,
      sessionId: session.id,
      pageContext: input.pageContext,
      planningResult,
      toolCallIds: runtimeResult.toolCallId ? [runtimeResult.toolCallId] : [],
      evidenceRefIds: evidenceRef ? [evidenceRef.id] : []
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: session.id,
      messageId: assistantMessage.id,
      toolCallId: runtimeResult.toolCallId,
      eventType: 'answer_generated',
      decision: answerDecision.status,
      evidenceRefIds: evidenceRef ? [evidenceRef.id] : [],
      metadata: toJsonInput({
        toolName: runtimeResult.toolName,
        answerDecisionId: answerDecision.answerDecisionId,
        groundingCheckId: answerDecision.groundingCheckId
      })
    });

    return this.sseEventBuilder.buildMessageEvents({
      requestId: input.requestId,
      sessionId: session.id,
      messageId: assistantMessage.id,
      toolCallId: runtimeResult.toolCallId ?? 'not-executed',
      toolName: runtimeResult.toolName,
      toolLifecycle: runtimeResult.toolLifecycle,
      evidenceRefIds: evidenceRef ? [evidenceRef.id] : [],
      answerDelta: answerDecision.answer.delta,
      finalData: {
        answerDecision: answerDecision.status,
        answer: answerDecision.answer.text,
        evidenceRefs: evidenceRef ? [evidenceRef.id] : []
      }
    });
  }

  createErrorEvent(input: { requestId: string; sessionId: string; code: string; message: string }) {
    return this.sseEventBuilder.buildErrorEvent(input);
  }

  private assertResponseMessageOwnership(
    message: { customerId: string; sessionId: string; role: AssistantMessageRole },
    customerId: string,
    sessionId: string
  ): void {
    if (
      message.customerId !== customerId ||
      message.sessionId !== sessionId ||
      message.role !== AssistantMessageRole.assistant
    ) {
      throw new NotFoundException({
        error: 'NOT_FOUND',
        message: 'Assistant runtime context not found.'
      });
    }
  }

  private async completeRetrievalFailure(input: {
    customerScope: ReturnType<typeof createCustomerScopeFromIdentityContext>;
    requestId: string;
    sessionId: string;
    messageId: string;
    identityContext: SendAssistantMessageInput['identityContext'];
    pageContext: SendAssistantMessageInput['pageContext'];
    planningResult: AssistantPlanningResult;
  }): Promise<AssistantSseEventRecord[]> {
    const retrievalFailureReason = 'retrieval_unavailable';
    const answerDecision = await this.answerDecisionService.recordSafeDecision({
      customerScope: input.customerScope,
      requestId: input.requestId,
      messageId: input.messageId,
      status: AnswerDecisionStatus.no_answer,
      noAnswerReason: NoAnswerReason.tool_failure,
      answer: {
        text: '目前無法取得文件 evidence，請稍後再試。',
        delta: '目前無法取得文件 evidence'
      },
      metadata: toJsonInput({
        retrievalFailureReason,
        noAnswerReason: NoAnswerReason.tool_failure
      })
    });

    const reviewItem = await this.reviewItemService.createFromAssistantOutcome({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      identityContext: input.identityContext,
      answerDecisionId: answerDecision.answerDecisionId,
      answerDecision: answerDecision.status,
      noAnswerReason: NoAnswerReason.tool_failure,
      evidenceRefCount: 0,
      toolFailureReason: retrievalFailureReason
    });

    await this.messageRepository.completeAssistantMessage({
      customerScope: input.customerScope,
      messageId: input.messageId,
      content: answerDecision.answer.text,
      answerDecision: answerDecision.status
    });

    await this.contextStateService.updateAfterMessageFlow({
      customerScope: input.customerScope,
      sessionId: input.sessionId,
      pageContext: input.pageContext,
      planningResult: input.planningResult,
      toolCallIds: [],
      evidenceRefIds: []
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'answer_generated',
      decision: answerDecision.status,
      evidenceRefIds: [],
      metadata: toJsonInput({
        retrievalFailureReason,
        noAnswerReason: NoAnswerReason.tool_failure,
        reviewItemId: reviewItem.id,
        answerDecisionId: answerDecision.answerDecisionId,
        groundingCheckId: answerDecision.groundingCheckId
      })
    });

    return this.sseEventBuilder.buildAnswerOnlyEvents({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      answerDelta: answerDecision.answer.delta,
      finalData: {
        answerDecision: answerDecision.status,
        answer: answerDecision.answer.text,
        noAnswerReason: NoAnswerReason.tool_failure,
        evidenceRefs: []
      }
    });
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toEscalationSummaryObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function shouldApplyPreRuntimeClarificationGate(
  riskAssessment: RiskLevel,
  pageContext: SendAssistantMessageInput['pageContext'],
  reason: string
) {
  if (riskAssessment === RiskLevel.low) {
    return true;
  }

  if (!['missing_page_context', 'multiple_candidates', 'ambiguous_reference', 'entity_conflict'].includes(reason)) {
    return false;
  }

  if (!pageContext?.entityId) {
    return true;
  }

  return (pageContext.selectedRows?.length ?? 0) > 1;
}

function toNormalizedEvidenceFacts(evidence: {
  id: string;
  sourceType: string;
  entityType?: string;
  entityId?: string;
  summary: Record<string, unknown>;
}): NormalizedEvidenceFact[] {
  if (!evidence.entityType || !evidence.entityId) {
    return [];
  }

  return Object.entries(evidence.summary).flatMap(([fieldPath, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) => ({
      evidenceRefId: evidence.id,
      sourceType: 'structured_record' as const,
      entityType: evidence.entityType as string,
      entityId: evidence.entityId as string,
      fieldPath,
      normalizedValue: normalizeEvidenceValue(item)
    }));
  });
}

function normalizeEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim().toLowerCase();
  }

  return JSON.stringify(value);
}

function requiresDocumentChunkEvidence(requiredEvidence: Prisma.JsonValue): boolean {
  return Array.isArray(requiredEvidence) && requiredEvidence.includes('document_chunk');
}

function stringFromMetadata(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
