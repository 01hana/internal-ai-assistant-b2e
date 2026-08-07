import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { getPageEntityRef } from '../assistant/page-context/page-context.mapper';
import { Prisma } from '../generated/prisma/client';
import {
  EscalationOwnerType,
  EscalationReason,
  EscalationStatus,
  RiskLevel,
  ToolOperation
} from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEscalationRequestInput,
  EscalationRequestDecisionInput,
  EscalationRequestListFilters,
  EscalationRequestResponse,
  ListEscalationRequestsInput
} from './escalation-request.types';
import { assertCustomerWorkflowCreateParents, assertCustomerWorkflowIdentityConsistency, workflowNotFound } from './customer-workflow-context';

@Injectable()
export class EscalationRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService
  ) {}

  async createForCriticalRisk(input: CreateEscalationRequestInput): Promise<EscalationRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    await assertCustomerWorkflowCreateParents({ db: this.prisma.db, ...input });
    const summary = buildEscalationSummary(input);
    const escalationRequest = await this.prisma.db.$transaction(async (db) => {
      const created = await db.escalationRequest.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        reason: EscalationReason.policy_required,
        status: EscalationStatus.open,
        ownerType: EscalationOwnerType.approver,
        summary: toJsonInput(summary)
      }
      });
      await this.appendAudit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      customerScope: input.customerScope,
      eventType: 'escalation_request_created',
      metadata: buildEscalationAuditMetadata(created)
      }, db);
      return created;
    });

    return toEscalationRequestResponse(escalationRequest);
  }

  async getVisibleRequest(input: EscalationRequestDecisionInput): Promise<EscalationRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    const escalationRequest = await this.loadVisibleRequest(input.escalationRequestId, input.customerScope);
    return toEscalationRequestResponse(escalationRequest);
  }

  async listVisibleRequests(input: ListEscalationRequestsInput) {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    const items = await this.prisma.db.escalationRequest.findMany({
      where: buildListWhere(input.customerScope, input.filters),
      orderBy: {
        createdAt: 'desc'
      }
    });
    const visibleItems = [];
    for (const item of items) {
      const session = await this.prisma.db.assistantSession.findFirst({
        where: {
          id: item.sessionId,
          customerId: input.customerScope.customerId,
          organizationId: input.customerScope.organizationId,
          hostApp: input.customerScope.hostApp,
          actorId: extractSummaryString(item.summary, 'requesterActorId') ?? input.customerScope.actorId
        }
      });
      if (
        session &&
        isEscalationVisibleToActor(item.summary, input.customerScope) &&
        matchesListFilters(item, input.filters)
      ) {
        visibleItems.push(item);
      }
    }

    return {
      items: visibleItems.map(toEscalationRequestResponse),
      filters: input.filters
    };
  }

  async resolve(input: EscalationRequestDecisionInput): Promise<EscalationRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    const escalationRequest = await this.loadVisibleRequest(input.escalationRequestId, input.customerScope);
    ensureActorCanManageEscalation(input.customerScope);
    ensureOpenAndFresh(escalationRequest, 'resolved');

    const updated = await this.prisma.db.$transaction(async (database) => {
      const transitioned = await this.transition(database, escalationRequest, input.customerScope, {
        status: EscalationStatus.resolved,
        resolvedAt: new Date(),
        summary: toJsonInput({
          ...toSummaryObject(escalationRequest.summary),
          status: EscalationStatus.resolved,
          assignedActorId: input.customerScope.actorId,
          reasonProvided: Boolean(input.reason)
        })
      });

      await this.appendAudit({
        requestId: input.requestId,
        sessionId: transitioned.sessionId,
        messageId: transitioned.messageId,
        customerScope: input.customerScope,
        eventType: 'escalation_request_resolved',
        metadata: buildEscalationAuditMetadata(transitioned, { reasonProvided: Boolean(input.reason) })
      }, database);

      return transitioned;
    });

    return toEscalationRequestResponse(updated);
  }

  async cancel(input: EscalationRequestDecisionInput): Promise<EscalationRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    const escalationRequest = await this.loadVisibleRequest(input.escalationRequestId, input.customerScope);
    if (!canCancelEscalation(escalationRequest.summary, input.customerScope)) {
      throw new ForbiddenException('Escalation request cannot be cancelled by this actor.');
    }
    ensureOpenAndFresh(escalationRequest, 'cancelled');

    const updated = await this.prisma.db.$transaction(async (database) => {
      const transitioned = await this.transition(database, escalationRequest, input.customerScope, {
        status: EscalationStatus.cancelled,
        resolvedAt: new Date(),
        summary: toJsonInput({
          ...toSummaryObject(escalationRequest.summary),
          status: EscalationStatus.cancelled,
          reasonProvided: Boolean(input.reason)
        })
      });

      await this.appendAudit({
        requestId: input.requestId,
        sessionId: transitioned.sessionId,
        messageId: transitioned.messageId,
        customerScope: input.customerScope,
        eventType: 'escalation_request_cancelled',
        metadata: buildEscalationAuditMetadata(transitioned, { reasonProvided: Boolean(input.reason) })
      }, database);

      return transitioned;
    });

    return toEscalationRequestResponse(updated);
  }

  private async loadVisibleRequest(escalationRequestId: string, customerScope: EscalationRequestDecisionInput['customerScope']) {
    const escalationRequest = await this.prisma.db.escalationRequest.findFirst({
      where: { customerId: customerScope.customerId, id: escalationRequestId }
    });
    if (!escalationRequest) {
      throw workflowNotFound();
    }

    const requesterActorId = extractSummaryString(escalationRequest.summary, 'requesterActorId');
    const session = await this.prisma.db.assistantSession.findFirst({
      where: {
        id: escalationRequest.sessionId,
        customerId: customerScope.customerId,
        organizationId: customerScope.organizationId,
        hostApp: customerScope.hostApp,
        actorId: requesterActorId ?? customerScope.actorId
      }
    });
    if (!session || !isEscalationVisibleToActor(escalationRequest.summary, customerScope)) {
      throw workflowNotFound();
    }

    return escalationRequest;
  }

  private appendAudit(input: {
    requestId: string;
    sessionId: string;
    messageId?: string | null;
    customerScope: EscalationRequestDecisionInput['customerScope'];
    eventType: string;
    metadata: Prisma.InputJsonValue;
  }, database?: Parameters<typeof this.auditWriter.appendCustomerWorkflowEvent>[1]) {
    return this.auditWriter.appendCustomerWorkflowEvent({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId ?? undefined,
      eventType: input.eventType,
      riskLevel: RiskLevel.critical,
      metadata: input.metadata
    }, database);
  }

  private async transition(
    database: Pick<Prisma.TransactionClient, 'escalationRequest'>,
    request: { id: string; status: EscalationStatus },
    customerScope: EscalationRequestDecisionInput['customerScope'],
    data: Prisma.EscalationRequestUpdateManyMutationInput
  ) {
    const result = await database.escalationRequest.updateMany({ where: { customerId: customerScope.customerId, id: request.id, status: request.status }, data });
    if (result.count !== 1) throw new ConflictException('Escalation request transition conflict.');
    const updated = await database.escalationRequest.findFirst({ where: { customerId: customerScope.customerId, id: request.id } });
    if (!updated) throw workflowNotFound();
    return updated;
  }
}

function buildEscalationSummary(input: CreateEscalationRequestInput) {
  const entityRef = getPageEntityRef(input.pageContext);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const actionSummary = {
    toolName: inferEscalationToolName(input),
    resource: input.pageContext?.module ?? entityRef.entityType ?? 'unknown',
    operation: ToolOperation.update,
    entityType: entityRef.entityType,
    entityId: entityRef.entityId
  };

  return {
    riskLevel: input.executionPlan.riskAssessment,
    reasonCode: EscalationReason.policy_required,
    reasonSummary: 'Critical-risk action requires manual escalation before any system side effect.',
    requesterActorId: input.identityContext.actor.actorId,
    assignedActorId: null,
    status: EscalationStatus.open,
    actionSummary,
    contextSummary: {
      module: input.pageContext?.module ?? null,
      entityType: entityRef.entityType,
      entityId: entityRef.entityId,
      visibleFieldCount: input.pageContext?.visibleColumns?.length ?? 0
    },
    expiresAt: expiresAt.toISOString()
  };
}

function inferEscalationToolName(input: CreateEscalationRequestInput): string {
  const entityRef = getPageEntityRef(input.pageContext);
  if (input.pageContext?.module === 'orders' || entityRef.entityType === 'order') {
    return 'mock.orders.cancel';
  }

  return 'manual.escalation.review';
}

function buildEscalationAuditMetadata(
  escalationRequest: {
    id: string;
    status: EscalationStatus;
    reason: EscalationReason;
    summary: Prisma.JsonValue;
  },
  options?: { reasonProvided?: boolean }
): Prisma.InputJsonValue {
  const summary = toSummaryObject(escalationRequest.summary);
  const actionSummary = toSummaryObject(summary.actionSummary);
  return toJsonInput({
    escalationRequestId: escalationRequest.id,
    riskLevel: summary.riskLevel ?? RiskLevel.critical,
    reasonCode: escalationRequest.reason,
    requesterActorId: typeof summary.requesterActorId === 'string' ? summary.requesterActorId : null,
    assignedActorId: typeof summary.assignedActorId === 'string' ? summary.assignedActorId : null,
    status: escalationRequest.status,
    toolName: typeof actionSummary.toolName === 'string' ? actionSummary.toolName : undefined,
    resource: typeof actionSummary.resource === 'string' ? actionSummary.resource : undefined,
    operation: typeof actionSummary.operation === 'string' ? actionSummary.operation : undefined,
    expiresAt: typeof summary.expiresAt === 'string' ? summary.expiresAt : null,
    ...(typeof options?.reasonProvided === 'boolean' ? { reasonProvided: options.reasonProvided } : {})
  });
}

function buildListWhere(customerScope: EscalationRequestDecisionInput['customerScope'], filters: EscalationRequestListFilters) {
  return {
    customerId: customerScope.customerId,
    ...(filters.status ? { status: filters.status } : {})
  };
}

function matchesListFilters(
  escalationRequest: { status: EscalationStatus; summary: Prisma.JsonValue },
  filters: EscalationRequestListFilters
) {
  const summary = toSummaryObject(escalationRequest.summary);
  return (
    (!filters.status || escalationRequest.status === filters.status) &&
    (!filters.riskLevel || summary.riskLevel === filters.riskLevel) &&
    (!filters.requesterActorId || summary.requesterActorId === filters.requesterActorId)
  );
}

function ensureOpenAndFresh(
  escalationRequest: { status: EscalationStatus; summary: Prisma.JsonValue },
  nextStatus: string
) {
  if (escalationRequest.status !== EscalationStatus.open) {
    throw new ConflictException(`Escalation request cannot be ${nextStatus} from ${escalationRequest.status} status.`);
  }

  const expiresAt = extractSummaryString(escalationRequest.summary, 'expiresAt');
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw new ConflictException(`Escalation request cannot be ${nextStatus} after expiration.`);
  }
}

function ensureActorCanManageEscalation(identityContext: EscalationRequestDecisionInput['customerScope']) {
  if (!hasEscalationManageAuthority(identityContext)) {
    throw new ForbiddenException('Escalation management permission is required.');
  }
}

function canCancelEscalation(summary: Prisma.JsonValue, identityContext: EscalationRequestDecisionInput['customerScope']) {
  return extractSummaryString(summary, 'requesterActorId') === identityContext.actorId || hasEscalationManageAuthority(identityContext);
}

function isEscalationVisibleToActor(summary: Prisma.JsonValue, identityContext: EscalationRequestDecisionInput['customerScope']) {
  return (
    extractSummaryString(summary, 'requesterActorId') === identityContext.actorId ||
    extractSummaryString(summary, 'assignedActorId') === identityContext.actorId ||
    hasEscalationManageAuthority(identityContext)
  );
}

export function hasEscalationManageAuthority(identityContext: EscalationRequestDecisionInput['customerScope']) {
  return (
    identityContext.roles.includes( 'admin' ) ||
    identityContext.roles.includes( 'approver' ) ||
    identityContext.permissionScopes.some((scope) => scope === 'escalation:manage' || scope === 'orders:approve')
  );
}

function toEscalationRequestResponse(escalationRequest: {
  id: string;
  status: EscalationStatus;
  reason: EscalationReason;
  ownerType: EscalationOwnerType;
  summary: Prisma.JsonValue;
  createdAt: Date;
  resolvedAt: Date | null;
  requestId: string;
  messageId: string | null;
}): EscalationRequestResponse {
  return {
    escalationRequestId: escalationRequest.id,
    status: escalationRequest.status,
    reason: escalationRequest.reason,
    ownerType: escalationRequest.ownerType,
    summary: escalationRequest.summary,
    createdAt: escalationRequest.createdAt.toISOString(),
    resolvedAt: escalationRequest.resolvedAt?.toISOString() ?? null,
    requestId: escalationRequest.requestId,
    messageId: escalationRequest.messageId
  };
}

function extractSummaryString(summary: Prisma.JsonValue, field: string): string | undefined {
  const value = toSummaryObject(summary)[field];
  return typeof value === 'string' ? value : undefined;
}

function toSummaryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
