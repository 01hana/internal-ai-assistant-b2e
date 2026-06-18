import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { Prisma } from '../generated/prisma/client';
import { ActionDraftStatus, RiskLevel, ToolOperation } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { getPageEntityRef } from '../assistant/page-context/page-context.mapper';
import { CreateActionDraftInput, ActionDraftDecisionInput, ActionDraftResponse } from './action-draft.types';

const CONFIRMABLE_STATUSES = new Set<ActionDraftStatus>([
  ActionDraftStatus.draft,
  ActionDraftStatus.waiting_confirmation
]);

@Injectable()
export class ActionDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async createForMediumRisk(input: CreateActionDraftInput): Promise<ActionDraftResponse> {
    const entityRef = getPageEntityRef(input.pageContext);
    const toolName = firstToolName(input.executionPlan.candidateTools);
    const resource = input.pageContext?.module ?? entityRef.entityType ?? 'unknown';
    const operation = resolveDraftOperation(input);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const preview = toJsonInput({
      action: 'confirmation_required',
      resource,
      entityType: entityRef.entityType,
      entityId: entityRef.entityId,
      operation
    });
    const payloadSummary = toJsonInput({
      resource,
      entityType: entityRef.entityType,
      entityId: entityRef.entityId,
      visibleFieldCount: input.pageContext?.visibleColumns?.length ?? 0
    });

    const draft = await this.prisma.db.actionDraft.create({
      data: {
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        actorId: input.identityContext.actor.actorId,
        toolName,
        resource,
        operation,
        riskLevel: RiskLevel.medium,
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

    const updated = await this.prisma.db.actionDraft.update({
      where: { id: draft.id },
      data: {
        status: ActionDraftStatus.confirmed,
        confirmedAt: new Date(),
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
      recheck: {
        organizationBoundary: 'passed',
        draftStatus: 'passed',
        freshness: 'passed',
        permission: 'pending_execution_guard',
        toolContract: 'pending_execution_guard',
        idempotency: 'reserved'
      }
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
        organizationId: identityContext.company.organizationId,
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
      organizationId: input.identityContext.company.organizationId,
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

function firstToolName(candidateTools: Prisma.JsonValue): string {
  if (!Array.isArray(candidateTools) || candidateTools.length === 0) {
    return 'mock.general.lookup';
  }

  const tool = candidateTools[0];
  if (tool && typeof tool === 'object' && 'key' in tool && typeof tool.key === 'string') {
    return tool.key;
  }

  return 'mock.general.lookup';
}

function resolveDraftOperation(_input: CreateActionDraftInput): ToolOperation {
  // MVP default: medium-risk ActionDraft currently represents an update preview.
  // T086/T087 should resolve this from execution plan, tool definition, or action intent.
  return ToolOperation.update;
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
