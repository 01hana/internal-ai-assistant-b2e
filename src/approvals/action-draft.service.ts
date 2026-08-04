import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { ActionDraftStatus, RiskLevel, ToolOperation } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { getPageEntityRef } from '../assistant/page-context/page-context.mapper';
import { CreateActionDraftInput, ActionDraftDecisionInput, ActionDraftResponse } from './action-draft.types';
import { SideEffectExecutionGuardService } from './side-effect-execution-guard.service';
import { SideEffectToolContractResolver, toPersistedSideEffectToolContract } from './side-effect-tool-contract.resolver';

const CONFIRMABLE_STATUSES = new Set<ActionDraftStatus>([
  ActionDraftStatus.draft,
  ActionDraftStatus.waiting_confirmation
]);

@Injectable()
export class ActionDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly sideEffectGuard: SideEffectExecutionGuardService,
    private readonly toolContractResolver: SideEffectToolContractResolver
  ) {}

  async createForMediumRisk(input: CreateActionDraftInput): Promise<ActionDraftResponse> {
    const entityRef = getPageEntityRef(input.pageContext);
    const tool = await this.toolContractResolver.resolveForActionDraft(input);
    const toolContract = toPersistedSideEffectToolContract(tool);
    const resource = input.pageContext?.module ?? entityRef.entityType ?? 'unknown';
    const operation = tool.operation;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const preview = toJsonInput({
      action: 'confirmation_required',
      resource,
      entityType: entityRef.entityType,
      entityId: entityRef.entityId,
      operation,
      toolContract
    });
    const payloadSummary = toJsonInput({
      resource,
      entityType: entityRef.entityType,
      entityId: entityRef.entityId,
      visibleFieldCount: input.pageContext?.visibleColumns?.length ?? 0,
      toolContract
    });

    const draft = await this.prisma.db.actionDraft.create({
      data: {
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        actorId: input.identityContext.actor.actorId,
        toolName: tool.key,
        resource,
        operation,
        riskLevel: tool.riskLevel,
        payloadSummary,
        preview,
        status: ActionDraftStatus.waiting_confirmation,
        expiresAt
      }
    });

    await this.appendAudit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      identityContext: input.identityContext,
      eventType: 'action_draft_created',
      metadata: {
        actionDraftId: draft.id,
        riskLevel: draft.riskLevel,
        toolName: draft.toolName,
        toolVersion: tool.version,
        resource: draft.resource,
        operation: draft.operation,
        expiresAt: draft.expiresAt?.toISOString() ?? null
      }
    });

    return toActionDraftResponse(draft);
  }

  async getVisibleDraft(input: ActionDraftDecisionInput): Promise<ActionDraftResponse> {
    const draft = await this.loadVisibleDraft(input.actionDraftId, input.identityContext);
    return toActionDraftResponse(draft);
  }

  async confirm(input: ActionDraftDecisionInput): Promise<ActionDraftResponse & { recheck: Record<string, string> }> {
    const draft = await this.loadVisibleDraft(input.actionDraftId, input.identityContext);

    if (draft.status === ActionDraftStatus.executed) {
      if (input.idempotencyKey && draft.idempotencyKey === input.idempotencyKey) {
        const duplicateResult = await this.sideEffectGuard.execute({
          requestId: input.requestId,
          sessionId: draft.sessionId,
          messageId: draft.messageId,
          identityContext: input.identityContext,
          sourceType: 'action_draft',
          sourceId: draft.id,
          requesterActorId: draft.actorId,
          toolName: draft.toolName,
          resource: draft.resource,
          operation: draft.operation,
          riskLevel: draft.riskLevel,
          expectedToolContract: extractToolContract(draft.payloadSummary),
          entityId: extractEntityId(draft.payloadSummary),
          idempotencyKey: input.idempotencyKey,
          requiresConfirmation: true,
          requiresApproval: false
        });
        return {
          ...toActionDraftResponse(draft),
          duplicateSafe: duplicateResult.duplicateSafe,
          recheck: {
            ...duplicateResult.recheck,
            draftStatus: 'passed'
          }
        };
      }

      throw new ConflictException(`Action draft cannot be confirmed from ${draft.status} status.`);
    }

    ensureDraftIsFresh(draft);
    if (
      draft.status === ActionDraftStatus.confirmed &&
      input.idempotencyKey &&
      draft.idempotencyKey === input.idempotencyKey
    ) {
      return {
        ...toActionDraftResponse(draft),
        duplicateSafe: true,
        recheck: {
          organizationBoundary: 'passed',
          draftStatus: 'passed',
          freshness: 'passed',
          permission: 'pending_execution_guard',
          toolContract: 'pending_execution_guard',
          idempotency: 'duplicate'
        }
      };
    }

    if (!CONFIRMABLE_STATUSES.has(draft.status)) {
      throw new ConflictException(`Action draft cannot be confirmed from ${draft.status} status.`);
    }

    const execution = await this.sideEffectGuard.execute({
      requestId: input.requestId,
      sessionId: draft.sessionId,
      messageId: draft.messageId,
      identityContext: input.identityContext,
      sourceType: 'action_draft',
      sourceId: draft.id,
      requesterActorId: draft.actorId,
      toolName: draft.toolName,
      resource: draft.resource,
      operation: draft.operation,
      riskLevel: draft.riskLevel,
      expectedToolContract: extractToolContract(draft.payloadSummary),
      entityId: extractEntityId(draft.payloadSummary),
      idempotencyKey: input.idempotencyKey,
      requiresConfirmation: true,
      requiresApproval: false
    });

    const updated = await this.prisma.db.actionDraft.update({
      where: { id: draft.id },
      data: {
        status: ActionDraftStatus.executed,
        confirmedAt: new Date(),
        executedAt: new Date(),
        idempotencyKey: input.idempotencyKey ?? draft.idempotencyKey
      }
    });

    await this.appendAudit({
      requestId: input.requestId,
      sessionId: updated.sessionId,
      messageId: updated.messageId,
      identityContext: input.identityContext,
      eventType: 'action_draft_confirmed',
      metadata: {
        actionDraftId: updated.id,
        riskLevel: updated.riskLevel,
        toolName: updated.toolName,
        resource: updated.resource,
        operation: updated.operation,
        idempotencyKeyPresent: Boolean(input.idempotencyKey)
      }
    });

    return {
      ...toActionDraftResponse(updated),
      recheck: execution.recheck
    };
  }

  async cancel(input: ActionDraftDecisionInput): Promise<ActionDraftResponse> {
    const draft = await this.loadVisibleDraft(input.actionDraftId, input.identityContext);
    if (!CONFIRMABLE_STATUSES.has(draft.status)) {
      throw new ConflictException(`Action draft cannot be cancelled from ${draft.status} status.`);
    }

    const updated = await this.prisma.db.actionDraft.update({
      where: { id: draft.id },
      data: {
        status: ActionDraftStatus.cancelled
      }
    });

    await this.appendAudit({
      requestId: input.requestId,
      sessionId: updated.sessionId,
      messageId: updated.messageId,
      identityContext: input.identityContext,
      eventType: 'action_draft_cancelled',
      metadata: {
        actionDraftId: updated.id,
        riskLevel: updated.riskLevel,
        toolName: updated.toolName,
        resource: updated.resource,
        operation: updated.operation
      }
    });

    return toActionDraftResponse(updated);
  }

  private async loadVisibleDraft(actionDraftId: string, identityContext: ActionDraftDecisionInput['identityContext']) {
    const draft = await this.prisma.db.actionDraft.findUnique({
      where: { id: actionDraftId }
    });
    if (!draft) {
      throw new NotFoundException('Action draft not found.');
    }

    const session = await this.prisma.db.assistantSession.findFirst({
      where: {
        id: draft.sessionId,
        organizationId: identityContext.organization.organizationId,
        hostApp: identityContext.hostApp.hostApp,
        actorId: identityContext.actor.actorId
      }
    });
    if (!session || draft.actorId !== identityContext.actor.actorId) {
      throw new NotFoundException('Action draft not found.');
    }

    return draft;
  }

  private appendAudit(input: {
    requestId: string;
    sessionId: string;
    messageId?: string | null;
    identityContext: ActionDraftDecisionInput['identityContext'];
    eventType: string;
    metadata: Prisma.InputJsonValue;
  }) {
    return this.auditWriter.append({
      requestId: input.requestId,
      organizationId: input.identityContext.organization.organizationId,
      hostApp: input.identityContext.hostApp.hostApp,
      actorId: input.identityContext.actor.actorId,
      sessionId: input.sessionId,
      messageId: input.messageId ?? undefined,
      eventType: input.eventType,
      riskLevel: RiskLevel.medium,
      metadata: input.metadata
    });
  }
}

function ensureDraftIsFresh(draft: { status: ActionDraftStatus; expiresAt: Date | null }) {
  if (draft.expiresAt && draft.expiresAt.getTime() <= Date.now()) {
    throw new ConflictException('Action draft cannot be confirmed from expired status.');
  }
}

function toActionDraftResponse(draft: {
  id: string;
  status: ActionDraftStatus;
  riskLevel: RiskLevel;
  toolName: string;
  resource: string;
  operation: ToolOperation;
  preview: Prisma.JsonValue;
  expiresAt: Date | null;
  requestId: string;
  messageId: string | null;
}): ActionDraftResponse {
  return {
    actionDraftId: draft.id,
    status: draft.status,
    riskLevel: draft.riskLevel,
    toolName: draft.toolName,
    resource: draft.resource,
    operation: draft.operation,
    preview: draft.preview,
    expiresAt: draft.expiresAt?.toISOString() ?? null,
    requestId: draft.requestId,
    messageId: draft.messageId
  };
}

function extractEntityId(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return typeof value.entityId === 'string' ? value.entityId : null;
}

function extractToolContract(value: Prisma.JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const contract = value.toolContract;
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return undefined;
  }

  return {
    toolDefinitionId: typeof contract.toolDefinitionId === 'string' ? contract.toolDefinitionId : undefined,
    toolName: typeof contract.toolName === 'string' ? contract.toolName : undefined,
    toolVersion: typeof contract.toolVersion === 'string' ? contract.toolVersion : undefined,
    operation: Object.values(ToolOperation).find((operation) => operation === contract.operation),
    riskLevel: Object.values(RiskLevel).find((riskLevel) => riskLevel === contract.riskLevel),
    hasSideEffect: typeof contract.hasSideEffect === 'boolean' ? contract.hasSideEffect : undefined,
    requiresConfirmation: typeof contract.requiresConfirmation === 'boolean' ? contract.requiresConfirmation : undefined,
    requiresApproval: typeof contract.requiresApproval === 'boolean' ? contract.requiresApproval : undefined
  };
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
