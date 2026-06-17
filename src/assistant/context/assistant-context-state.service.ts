import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AssistantTaskState, ExecutionDecision } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { getPageEntityRef, toPageContextPersistence } from '../page-context/page-context.mapper';
import { UpdateAssistantContextStateInput } from './assistant-context-state.types';

@Injectable()
export class AssistantContextStateService {
  constructor(private readonly prisma: PrismaService) {}

  async createInitialState(sessionId: string, pageContext?: UpdateAssistantContextStateInput['pageContext']) {
    const entityRef = getPageEntityRef(pageContext);
    return this.prisma.db.assistantContextState.create({
      data: {
        sessionId,
        currentModule: pageContext?.module,
        currentPage: toPageContextPersistence(pageContext) ?? Prisma.JsonNull,
        currentEntityType: entityRef.entityType,
        currentEntityId: entityRef.entityId,
        taskState: AssistantTaskState.idle,
        lastToolCallIds: [],
        lastEvidenceRefIds: []
      }
    });
  }

  async loadLatest(sessionId: string) {
    return this.prisma.db.assistantContextState.findFirst({
      where: {
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

    const updated = await this.prisma.db.assistantContextState.updateMany({
      where: {
        sessionId: input.sessionId
      },
      data
    });

    if (updated.count > 0) {
      return this.loadLatest(input.sessionId);
    }

    await this.prisma.db.assistantContextState.create({
      data: {
        sessionId: input.sessionId,
        ...data
      }
    });

    return this.loadLatest(input.sessionId);
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
