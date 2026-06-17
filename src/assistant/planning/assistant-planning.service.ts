import { Injectable } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { Prisma, ExecutionPlan } from '../../generated/prisma/client';
import { ExecutionDecision } from '../../generated/prisma/enums';
import { createRuntimeDecisionMetadata } from '../../observability/observability-metadata.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryUnderstandingService } from '../../query-understanding/query-understanding.service';
import { QueryUnderstandingOutput } from '../../query-understanding/query-understanding.types';
import { AssistantPlanningInput, AssistantPlanningResult, PersistedExecutionPlan } from './assistant-planning.types';

@Injectable()
export class AssistantPlanningService {
  constructor(
    private readonly queryUnderstandingService: QueryUnderstandingService,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async createPlan(input: AssistantPlanningInput): Promise<AssistantPlanningResult> {
    const startedAt = new Date();
    const { output, persisted } = await this.queryUnderstandingService.understandAndPersist(input);
    const executionPlan = await this.prisma.db.executionPlan.create({
      data: toExecutionPlanCreateInput(input, output)
    });

    await this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'execution_plan_created',
      riskLevel: executionPlan.riskAssessment,
      metadata: toJsonInput({
        executionPlanId: executionPlan.id,
        taskType: executionPlan.taskType,
        decision: executionPlan.decision,
        queryUnderstandingId: persisted.id,
        ...createRuntimeDecisionMetadata({
          durationMs: Math.max(0, Date.now() - startedAt.getTime())
        })
      })
    });

    return {
      queryUnderstanding: output,
      persistedQueryUnderstanding: persisted,
      executionPlan: mapExecutionPlan(executionPlan),
      decision: executionPlan.decision
    };
  }
}

export function determinePlanningDecision(output: QueryUnderstandingOutput): ExecutionDecision {
  if (output.clarificationNeeds.length > 0 || output.confidence < 0.7) {
    return ExecutionDecision.clarify;
  }

  if (output.taskType === 'unsupported_scope') {
    return ExecutionDecision.no_answer;
  }

  return ExecutionDecision.continue;
}

function toExecutionPlanCreateInput(
  input: AssistantPlanningInput,
  output: QueryUnderstandingOutput
): Prisma.ExecutionPlanUncheckedCreateInput {
  return {
    sessionId: input.sessionId,
    messageId: input.messageId,
    taskType: output.taskType,
    requiredEvidence: toJsonInput(output.requiredEvidence),
    candidateTools: toJsonInput(output.candidateTools),
    permissionChecks: toJsonInput([
      {
        organizationId: input.identityContext.company.organizationId,
        hostApp: input.identityContext.hostApp.hostApp,
        actorId: input.identityContext.actor.actorId,
        scopes: input.identityContext.actor.permissionScopes
      }
    ]),
    riskAssessment: output.riskLevel,
    clarificationNeeds: output.clarificationNeeds.length > 0 ? toJsonInput(output.clarificationNeeds) : Prisma.JsonNull,
    expectedAnswerShape: toJsonInput({
      format: 'text',
      includesEvidence: true
    }),
    requiresMultiStepToolUse: output.candidateTools.length > 1,
    decision: determinePlanningDecision(output)
  };
}

function mapExecutionPlan(plan: ExecutionPlan): PersistedExecutionPlan {
  return {
    id: plan.id,
    sessionId: plan.sessionId,
    messageId: plan.messageId ?? undefined,
    taskType: plan.taskType,
    requiredEvidence: plan.requiredEvidence,
    candidateTools: plan.candidateTools,
    permissionChecks: plan.permissionChecks,
    riskAssessment: plan.riskAssessment,
    clarificationNeeds: plan.clarificationNeeds,
    expectedAnswerShape: plan.expectedAnswerShape,
    requiresMultiStepToolUse: plan.requiresMultiStepToolUse,
    decision: plan.decision,
    createdAt: plan.createdAt
  };
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
