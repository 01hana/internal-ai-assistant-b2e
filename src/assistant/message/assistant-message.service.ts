import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { EvidenceRefService } from '../../evidence/evidence-ref.service';
import { Prisma } from '../../generated/prisma/client';
import { AnswerDecisionService } from '../answer/answer-decision.service';
import { AssistantContextStateService } from '../context/assistant-context-state.service';
import { toPageContextAuditMetadata, toPageContextPersistence } from '../page-context/page-context.mapper';
import { AssistantPlanningService } from '../planning/assistant-planning.service';
import { AssistantReadonlyRuntimeService } from '../runtime/assistant-readonly-runtime.service';
import { ToolCallService } from '../runtime/tool-call.service';
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
    private readonly toolCallService: ToolCallService,
    private readonly evidenceRefService: EvidenceRefService,
    private readonly answerDecisionService: AnswerDecisionService,
    private readonly contextStateService: AssistantContextStateService,
    private readonly auditWriter: AuditWriterService,
    private readonly sseEventBuilder: AssistantSseEventBuilder
  ) {}

  async sendMessage(input: SendAssistantMessageInput): Promise<AssistantSseEventRecord[]> {
    const session = await this.sessionService.getVisibleSession(input.sessionId, input.identityContext);
    const userMessage = await this.messageRepository.createUserMessage({
      sessionId: session.id,
      requestId: input.requestId,
      content: input.message,
      pageContext: input.pageContext
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: session.id,
      messageId: userMessage.id,
      eventType: 'message_received',
      metadata: toJsonInput({
        pageContext: toPageContextAuditMetadata(input.pageContext)
      })
    });

    const planningResult = await this.planningService.createPlan({
      requestId: input.requestId,
      sessionId: session.id,
      messageId: userMessage.id,
      text: input.message,
      identityContext: input.identityContext,
      pageContext: toPageContextPersistence(input.pageContext)
    });

    const assistantMessage = await this.messageRepository.createPendingAssistantMessage({
      sessionId: session.id,
      requestId: input.requestId
    });

    const runtimeResult = await this.readonlyRuntimeService.execute({
      requestId: input.requestId,
      sessionId: session.id,
      messageId: assistantMessage.id,
      identityContext: input.identityContext,
      executionPlan: planningResult.executionPlan,
      pageContext: input.pageContext
    });

    if (runtimeResult.deniedReason) {
      const answerDecision = await this.answerDecisionService.decide({
        requestId: input.requestId,
        messageId: assistantMessage.id,
        executionPlan: planningResult.executionPlan,
        evidenceRefs: []
      });

      await this.messageRepository.completeAssistantMessage({
        messageId: assistantMessage.id,
        content: answerDecision.answer.text,
        answerDecision: answerDecision.status
      });

      await this.contextStateService.updateAfterMessageFlow({
        sessionId: session.id,
        pageContext: input.pageContext,
        planningResult,
        toolCallIds: [],
        evidenceRefIds: []
      });

      await this.auditWriter.append({
        requestId: input.requestId,
        organizationId: input.identityContext.company.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        eventType: 'answer_generated',
        decision: answerDecision.status,
        evidenceRefIds: [],
        metadata: toJsonInput({
          toolName: runtimeResult.toolName,
          deniedReason: runtimeResult.deniedReason,
          answerDecisionId: answerDecision.answerDecisionId,
          groundingCheckId: answerDecision.groundingCheckId
        })
      });

      return this.sseEventBuilder.buildMessageEvents({
        requestId: input.requestId,
        sessionId: session.id,
        messageId: assistantMessage.id,
        toolCallId: 'not-executed',
        evidenceRefIds: [],
        answerDelta: answerDecision.answer.delta,
        finalData: {
          answerDecision: answerDecision.status,
          answer: answerDecision.answer.text,
          evidenceRefs: []
        }
      });
    }

    const { toolCall } = await this.toolCallService.createCompletedToolCall({
      requestId: input.requestId,
      sessionId: session.id,
      messageId: assistantMessage.id,
      identityContext: input.identityContext,
      toolName: runtimeResult.toolName,
      toolVersion: runtimeResult.toolVersion,
      entityId: runtimeResult.entityRef.entityId,
      visibleFields: runtimeResult.visibleFields,
      sanitizedResult: runtimeResult.sanitizedResult
    });

    const evidenceRef = runtimeResult.structuredRecord
      ? await this.evidenceRefService.attachStructuredRecordEvidence({
          requestId: input.requestId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          toolCallId: toolCall.id,
          identityContext: input.identityContext,
          entityType: runtimeResult.entityRef.entityType ?? 'order',
          entityId: runtimeResult.entityRef.entityId ?? runtimeResult.toolName,
          record: runtimeResult.structuredRecord,
          visibleFields: runtimeResult.visibleFields
        })
      : undefined;

    const answerDecision = await this.answerDecisionService.decide({
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
      messageId: assistantMessage.id,
      content: answerDecision.answer.text,
      answerDecision: answerDecision.status
    });

    await this.contextStateService.updateAfterMessageFlow({
      sessionId: session.id,
      pageContext: input.pageContext,
      planningResult,
      toolCallIds: [toolCall.id],
      evidenceRefIds: evidenceRef ? [evidenceRef.id] : []
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: session.id,
      messageId: assistantMessage.id,
      toolCallId: toolCall.id,
      eventType: 'answer_generated',
      decision: answerDecision.status,
      evidenceRefIds: evidenceRef ? [evidenceRef.id] : [],
      metadata: toJsonInput({
        toolName: toolCall.toolName,
        answerDecisionId: answerDecision.answerDecisionId,
        groundingCheckId: answerDecision.groundingCheckId
      })
    });

    return this.sseEventBuilder.buildMessageEvents({
      requestId: input.requestId,
      sessionId: session.id,
      messageId: assistantMessage.id,
      toolCallId: toolCall.id,
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
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
