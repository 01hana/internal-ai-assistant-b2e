import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AssistantTaskState, ExecutionDecision } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerScope } from '../../identity/customer-scope.types';
import { getPageEntityRef, toPageContextPersistence } from '../page-context/page-context.mapper';
import { MarkWaitingClarificationInput, UpdateAssistantContextStateInput } from './assistant-context-state.types';

@Injectable()
export class AssistantContextStateService {
  constructor(private readonly prisma: PrismaService) {}

  async createInitialState(input: {
    customerScope: CustomerScope;
    sessionId: string;
    pageContext?: UpdateAssistantContextStateInput['pageContext'];
  }) {
    const entityRef = getPageEntityRef(input.pageContext);
    return this.prisma.db.assistantContextState.create({
      data: {
        customerId: input.customerScope.customerId,
        sessionId: input.sessionId,
        currentModule: input.pageContext?.module,
        currentPage: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull,
        currentEntityType: entityRef.entityType,
        currentEntityId: entityRef.entityId,
        taskState: AssistantTaskState.idle,
        lastToolCallIds: [],
        lastEvidenceRefIds: []
      }
    });
  }

  async loadLatest(customerScope: CustomerScope, sessionId: string) {
    return this.prisma.db.assistantContextState.findFirst({
      where: {
        customerId: customerScope.customerId,
        sessionId
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
  }

  async updateAfterMessageFlow(input: UpdateAssistantContextStateInput) {
    const entityRef = getPageEntityRef(input.pageContext);
    const data = {
      currentTask: input.planningResult.executionPlan.taskType,
      currentModule: input.pageContext?.module,
      currentPage: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull,
      currentEntityType: entityRef.entityType,
      currentEntityId: entityRef.entityId,
      lastIntent: input.planningResult.queryUnderstanding.taskType,
      lastEntities: toJsonInput(input.planningResult.queryUnderstanding.entityCandidates),
      lastToolCallIds: input.toolCallIds,
      lastEvidenceRefIds: input.evidenceRefIds,
      pendingClarification:
        input.planningResult.queryUnderstanding.clarificationNeeds.length > 0
          ? toJsonInput(input.planningResult.queryUnderstanding.clarificationNeeds)
          : Prisma.JsonNull,
      taskState:
        input.planningResult.executionPlan.decision === ExecutionDecision.clarify
          ? AssistantTaskState.waiting_clarification
          : AssistantTaskState.completed
    };

    return this.updateOrCreate(input.customerScope, input.sessionId, data);
  }

  async markWaitingClarification(input: MarkWaitingClarificationInput) {
    const entityRef = getPageEntityRef(input.pageContext);
    const data = {
      currentTask: input.planningResult.executionPlan.taskType,
      currentModule: input.pageContext?.module,
      currentPage: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull,
      currentEntityType: entityRef.entityType,
      currentEntityId: entityRef.entityId,
      lastIntent: input.planningResult.queryUnderstanding.taskType,
      lastEntities: toJsonInput(input.planningResult.queryUnderstanding.entityCandidates),
      lastToolCallIds: input.toolCallIds,
      lastEvidenceRefIds: input.evidenceRefIds,
      pendingClarification: toJsonInput({
        clarificationQuestionId: input.clarificationQuestionId,
        reason: input.reason,
        question: input.question,
        candidateRefs: input.candidateRefs,
        blocking: input.blocking
      }),
      pendingApprovalRequestId: null,
      taskState: AssistantTaskState.waiting_clarification
    };

    return this.updateOrCreate(input.customerScope, input.sessionId, data);
  }

  async markWaitingConfirmation(input: UpdateAssistantContextStateInput) {
    const entityRef = getPageEntityRef(input.pageContext);
    const data = {
      currentTask: input.planningResult.executionPlan.taskType,
      currentModule: input.pageContext?.module,
      currentPage: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull,
      currentEntityType: entityRef.entityType,
      currentEntityId: entityRef.entityId,
      lastIntent: input.planningResult.queryUnderstanding.taskType,
      lastEntities: toJsonInput(input.planningResult.queryUnderstanding.entityCandidates),
      lastToolCallIds: input.toolCallIds,
      lastEvidenceRefIds: input.evidenceRefIds,
      pendingClarification: Prisma.JsonNull,
      taskState: AssistantTaskState.waiting_confirmation
    };

    return this.updateOrCreate(input.customerScope, input.sessionId, data);
  }

  async markWaitingApproval(input: UpdateAssistantContextStateInput) {
    const entityRef = getPageEntityRef(input.pageContext);
    const data = {
      currentTask: input.planningResult.executionPlan.taskType,
      currentModule: input.pageContext?.module,
      currentPage: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull,
      currentEntityType: entityRef.entityType,
      currentEntityId: entityRef.entityId,
      lastIntent: input.planningResult.queryUnderstanding.taskType,
      lastEntities: toJsonInput(input.planningResult.queryUnderstanding.entityCandidates),
      lastToolCallIds: input.toolCallIds,
      lastEvidenceRefIds: input.evidenceRefIds,
      pendingClarification: Prisma.JsonNull,
      pendingApprovalRequestId: input.pendingApprovalRequestId ?? null,
      taskState: AssistantTaskState.waiting_approval
    };

    return this.updateOrCreate(input.customerScope, input.sessionId, data);
  }

  async markWaitingEscalation(input: UpdateAssistantContextStateInput) {
    const entityRef = getPageEntityRef(input.pageContext);
    const data = {
      currentTask: input.planningResult.executionPlan.taskType,
      currentModule: input.pageContext?.module,
      currentPage: toPageContextPersistence(input.pageContext) ?? Prisma.JsonNull,
      currentEntityType: entityRef.entityType,
      currentEntityId: entityRef.entityId,
      lastIntent: input.planningResult.queryUnderstanding.taskType,
      lastEntities: toJsonInput(input.planningResult.queryUnderstanding.entityCandidates),
      lastToolCallIds: input.toolCallIds,
      lastEvidenceRefIds: input.evidenceRefIds,
      pendingClarification: toJsonInput({
        type: 'escalation_required',
        escalationRequestId: input.pendingEscalationRequestId ?? null
      }),
      pendingApprovalRequestId: null,
      taskState: AssistantTaskState.waiting_escalation
    };

    return this.updateOrCreate(input.customerScope, input.sessionId, data);
  }

  private async updateOrCreate(
    customerScope: CustomerScope,
    sessionId: string,
    data: ContextStatePersistenceData
  ) {
    const updated = await this.prisma.db.assistantContextState.updateMany({
      where: {
        customerId: customerScope.customerId,
        sessionId
      },
      data
    });

    if (updated.count > 0) {
      return this.loadLatest(customerScope, sessionId);
    }

    await this.prisma.db.assistantContextState.create({
      data: {
        customerId: customerScope.customerId,
        sessionId,
        ...data
      }
    });

    return this.loadLatest(customerScope, sessionId);
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

type ContextStatePersistenceData = Omit<
  Prisma.AssistantContextStateUncheckedCreateInput,
  'id' | 'customerId' | 'sessionId' | 'createdAt' | 'updatedAt'
>;
