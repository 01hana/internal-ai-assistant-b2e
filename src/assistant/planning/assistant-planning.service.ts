import { Injectable, Optional } from '@nestjs/common';
import { AuditWriterService } from '../../audit/audit-writer.service';
import { Prisma, ExecutionPlan } from '../../generated/prisma/client';
import { ExecutionDecision } from '../../generated/prisma/enums';
import { createRuntimeDecisionMetadata } from '../../observability/observability-metadata.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryUnderstandingService } from '../../query-understanding/query-understanding.service';
import { QueryUnderstandingOutput } from '../../query-understanding/query-understanding.types';
import {
  AssistantPlanningInput,
  AssistantPlanningResult,
  PersistedExecutionPlan,
  PlannedOperationCandidate
} from './assistant-planning.types';
import { ConversationContextLoaderService } from '../conversation/conversation-context-loader.service';
import { ConversationAuditService } from '../conversation/conversation-audit.service';
import { GroundedRetrievalRouterService } from '../../retrieval/grounded-retrieval-router.service';
import type { GroundedRetrievalPlan, RetrievalNeedCandidate } from '../../retrieval/grounded-retrieval.types';
import { decomposeRetrievalNeeds } from '../../query-understanding/query-task-decomposer';

const MAX_ARGUMENT_KEYS = 32;
const MAX_ARGUMENT_DEPTH = 4;
const MAX_ARRAY_ITEMS = 100;
const MAX_ARGUMENT_STRING_LENGTH = 512;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const MAX_CANDIDATE_TEXT_LENGTH = 256;
const PROHIBITED_ARGUMENT_KEY = /(sql|url|uri|path|query|command|credential|password|secret|token|connectorcontextref|connectorkey|adapterkey|endpoint)/i;
const PROHIBITED_ARGUMENT_VALUE = /(^|\s)(select|insert|update|delete|drop|alter|create|exec(?:ute)?)\s|https?:\/\/|^[/.]{1,2}\/|\b(?:bearer|basic)\s+|(?:^|\s)(?:curl|wget|bash|sh|powershell)\s/i;

@Injectable()
export class AssistantPlanningService {
  constructor(
    private readonly queryUnderstandingService: QueryUnderstandingService,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    @Optional() private readonly conversationContextLoader?: ConversationContextLoaderService,
    @Optional() private readonly conversationAudit?: ConversationAuditService,
    @Optional() private readonly groundedRetrievalRouter?: GroundedRetrievalRouterService
  ) {}

  async createPlan(input: AssistantPlanningInput): Promise<AssistantPlanningResult> {
    const startedAt = new Date();
    const priorConversationContext = this.conversationContextLoader
      ? await this.conversationContextLoader.load({
          scope: {
            customerId: input.customerScope.customerId,
            sessionId: input.sessionId,
            organizationId: input.customerScope.organizationId,
            hostApp: input.customerScope.hostApp,
            actorId: input.customerScope.actorId
          }
        })
      : undefined;
    if (priorConversationContext && this.conversationAudit) {
      await this.conversationAudit.recordLoaded({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        exchangeCount: priorConversationContext.exchanges.length,
        evidenceRefCount: priorConversationContext.evidenceRefs.length,
        rejectedReasonCodes: priorConversationContext.rejectedReasonCodes
      });
    }
    const { output, persisted } = await this.queryUnderstandingService.understandAndPersist({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      text: input.text,
      hostIntegrationContext: input.hostIntegrationContext,
      pageContext: input.pageContext,
      assistantContextState: input.assistantContextState,
      priorConversationContext
    });
    if (output.followUpResolution && this.conversationAudit) {
      await this.conversationAudit.recordResolution({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        decision: output.followUpResolution,
        priorFrameCount: priorConversationContext?.semanticFrames.length ?? 0
      });
    }
    const routingFrame = output.followUpResolution?.resolvedFrame ?? output.currentSemanticFrame;
    const shouldBuildGroundedPlan = Boolean(output.followUpResolution) || output.requiredEvidence.includes('document_chunk') || output.candidateTools.length > 0;
    const groundedRetrievalPlan = this.groundedRetrievalRouter && shouldBuildGroundedPlan
      ? this.groundedRetrievalRouter.route({
          requestId: input.requestId,
          decomposedNeeds: toRetrievalNeedCandidates(input.text, output),
          resolvedFrame: routingFrame,
          followUpResolution: output.followUpResolution
        })
      : undefined;
    const executionPlan = await this.prisma.db.executionPlan.create({
      data: toExecutionPlanCreateInput(input, output)
    });

    await this.auditWriter.append({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      eventType: 'execution_plan_created',
      riskLevel: executionPlan.riskAssessment,
      metadata: toJsonInput({
        executionPlanId: executionPlan.id,
        taskType: executionPlan.taskType,
        decision: executionPlan.decision,
        queryUnderstandingId: persisted.id,
        ...(groundedRetrievalPlan ? {
          retrievalMode: groundedRetrievalPlan.mode,
          retrievalReasonCode: groundedRetrievalPlan.reasonCode
        } : {}),
        ...createRuntimeDecisionMetadata({
          durationMs: Math.max(0, Date.now() - startedAt.getTime())
        })
      })
    });

    return {
      queryUnderstanding: output,
      persistedQueryUnderstanding: persisted,
      executionPlan: mapExecutionPlan(executionPlan),
      decision: executionPlan.decision,
      groundedRetrievalPlan,
      priorConversationContext
    };
  }
}

function toRetrievalNeedCandidates(text: string, output: QueryUnderstandingOutput): readonly RetrievalNeedCandidate[] {
  if (output.followUpResolution?.kind === 'CLARIFY') {
    return [{ kind: 'AMBIGUOUS', reasonCode: output.followUpResolution.reasonCode }];
  }
  const frame = output.followUpResolution?.resolvedFrame ?? output.currentSemanticFrame;
  if (frame?.timeRange?.value === 'last_month' && output.candidateTools.length === 0) {
    return [{ kind: 'UNSUPPORTED', reasonCode: 'UNSUPPORTED_TIME_RANGE' }];
  }
  if (output.subTasks.length > 1) {
    const decomposed = decomposeRetrievalNeeds(output.subTasks, output.subTasks.map(() => frame ?? Object.freeze({})));
    return decomposed.needs.map((need) => {
      if (need.kind === 'DOCUMENT') return { kind: 'DOCUMENT' as const, query: need.query,
        ...(frame?.resource?.value === 'travelSubsidyPolicy' && frame.topicKey ? { topicKey: frame.topicKey } : {}) };
      if (need.kind === 'TOOL') return output.candidateTools.length > 0
        ? { kind: 'TOOL' as const, frame: need.frame }
        : { kind: 'UNSUPPORTED' as const, reasonCode: 'NO_CURRENT_RETRIEVAL_CAPABILITY' };
      return { kind: 'UNSUPPORTED' as const, reasonCode: need.reasonCode };
    });
  }
  if (output.requiredEvidence.includes('document_chunk')) {
    return [{ kind: 'DOCUMENT', query: text, ...(frame?.topicKey ? { topicKey: frame.topicKey } : {}) }];
  }
  if (output.candidateTools.length > 0) {
    return [{ kind: 'TOOL', frame }];
  }
  return [{ kind: 'UNSUPPORTED', reasonCode: 'NO_CURRENT_RETRIEVAL_CAPABILITY' }];
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
  const candidateTools = normalizePlannedCandidates(output.candidateTools);

  return {
    customerId: input.customerScope.customerId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    taskType: output.taskType,
    requiredEvidence: toJsonInput(output.requiredEvidence),
    candidateTools: toJsonInput(candidateTools),
    permissionChecks: toJsonInput([
      {
        organizationId: input.hostIntegrationContext.organizationId,
        hostApp: input.hostIntegrationContext.hostApp,
        actorId: input.hostIntegrationContext.actorId,
        scopes: input.hostIntegrationContext.permissionScopes
      }
    ]),
    riskAssessment: output.riskLevel,
    clarificationNeeds: output.clarificationNeeds.length > 0 ? toJsonInput(output.clarificationNeeds) : Prisma.JsonNull,
    expectedAnswerShape: toJsonInput({
      format: 'text',
      includesEvidence: true
    }),
    requiresMultiStepToolUse: candidateTools.length > 1,
    decision: determinePlanningDecision(output)
  };
}

function mapExecutionPlan(plan: ExecutionPlan): PersistedExecutionPlan {
  return {
    id: plan.id,
    customerId: plan.customerId,
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

function normalizePlannedCandidates(value: unknown): PlannedOperationCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }

    const key = boundedText(candidate.key);
    const reason = boundedText(candidate.reason);
    if (!key || !reason) {
      return [];
    }

    return [
      {
        key,
        arguments: normalizePlannedArguments(candidate.arguments),
        reason
      }
    ];
  });
}

function normalizePlannedArguments(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const keyCounter = { value: 0 };
  const normalized = normalizeArgumentRecord(value, 1, keyCounter);
  if (!normalized) {
    return {};
  }

  try {
    return Buffer.byteLength(JSON.stringify(normalized), 'utf8') <= MAX_ARGUMENT_BYTES ? normalized : {};
  } catch {
    return {};
  }
}

function normalizeArgumentRecord(
  value: Record<string, unknown>,
  depth: number,
  keyCounter: { value: number }
): Record<string, unknown> | undefined {
  if (depth > MAX_ARGUMENT_DEPTH) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    keyCounter.value += 1;
    if (keyCounter.value > MAX_ARGUMENT_KEYS || !isSafeArgumentKey(key)) {
      continue;
    }

    const normalized = normalizeArgumentValue(entry, depth, keyCounter);
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }

  return output;
}

function normalizeArgumentValue(
  value: unknown,
  depth: number,
  keyCounter: { value: number }
): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= MAX_ARGUMENT_STRING_LENGTH && !PROHIBITED_ARGUMENT_VALUE.test(trimmed)
      ? trimmed
      : undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_ARGUMENT_DEPTH || value.length > MAX_ARRAY_ITEMS) {
      return undefined;
    }
    const normalized = value.map((entry) => normalizeArgumentValue(entry, depth + 1, keyCounter));
    return normalized.some((entry) => entry === undefined) ? undefined : normalized;
  }
  if (isRecord(value)) {
    return normalizeArgumentRecord(value, depth + 1, keyCounter);
  }
  return undefined;
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_CANDIDATE_TEXT_LENGTH ? trimmed : undefined;
}

function isSafeArgumentKey(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) && !PROHIBITED_ARGUMENT_KEY.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
