import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditWriterService } from '../audit/audit-writer.service';
import { getPageEntityRef } from '../assistant/page-context/page-context.mapper';
import { Prisma } from '../generated/prisma/client';
import { ApprovalRequestStatus, RiskLevel, ToolOperation } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApprovalRequestDecisionInput,
  ApprovalRequestListFilters,
  ApprovalRequestPreview,
  ApprovalRequestResponse,
  CreateApprovalRequestInput,
  ListApprovalRequestsInput
} from './approval-request.types';
import { SideEffectExecutionGuardService } from './side-effect-execution-guard.service';
import { SideEffectToolContractResolver, toPersistedSideEffectToolContract } from './side-effect-tool-contract.resolver';
import { assertCustomerWorkflowCreateParents, assertCustomerWorkflowIdentityConsistency, workflowNotFound } from './customer-workflow-context';

const APPROVABLE_STATUSES = new Set<ApprovalRequestStatus>([ApprovalRequestStatus.pending]);

@Injectable()
export class ApprovalRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly sideEffectGuard: SideEffectExecutionGuardService,
    private readonly toolContractResolver: SideEffectToolContractResolver
  ) {}

  async createForHighRisk(input: CreateApprovalRequestInput): Promise<ApprovalRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    await assertCustomerWorkflowCreateParents({ db: this.prisma.db, ...input });
    const tool = await this.toolContractResolver.resolveForApprovalRequest(input);
    const preview = buildApprovalPreview(input, tool);
    const toolContract = toPersistedSideEffectToolContract(tool);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const actionSummary = toJsonInput({
      action: 'approval_required',
      toolName: preview.toolName,
      toolDefinitionId: tool.id,
      toolVersion: tool.version,
      hasSideEffect: tool.hasSideEffect,
      requiresConfirmation: tool.requiresConfirmation,
      requiresApproval: tool.requiresApproval,
      resource: preview.resource,
      operation: preview.operation,
      entityType: preview.entityType,
      entityId: preview.entityId,
      toolContract
    });
    const payloadSummary = toJsonInput({
      resource: preview.resource,
      entityType: preview.entityType,
      entityId: preview.entityId,
      riskLevel: tool.riskLevel,
      visibleFieldCount: input.pageContext?.visibleColumns?.length ?? 0,
      toolContract
    });

    const approvalRequest = await this.prisma.db.$transaction(async (db) => {
      const created = await db.approvalRequest.create({
      data: {
        customerId: input.customerScope.customerId,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        requesterActorId: input.identityContext.actor.actorId,
        approverActorId: null,
        riskLevel: tool.riskLevel,
        status: ApprovalRequestStatus.pending,
        actionSummary,
        payloadSummary,
        evidenceRefIds: [],
        auditEventIds: [],
        expiresAt
      }
      });
      await this.appendAudit({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      customerScope: input.customerScope,
      eventType: 'approval_request_created',
      riskLevel: created.riskLevel,
      metadata: buildApprovalAuditMetadata({ approvalRequest: created, includeExpiresAt: true })
      }, db);
      return created;
    });

    return toApprovalRequestResponse(approvalRequest);
  }

  async getVisibleRequest(input: ApprovalRequestDecisionInput): Promise<ApprovalRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    const approvalRequest = await this.loadVisibleRequest(input.approvalRequestId, input.customerScope);
    return toApprovalRequestResponse(approvalRequest);
  }

  async listVisibleRequests(input: ListApprovalRequestsInput) {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    const items = await this.prisma.db.approvalRequest.findMany({
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
          actorId: item.requesterActorId
        }
      });
      if (session && isApprovalVisibleToActor(item, input.customerScope)) {
        visibleItems.push(item);
      }
    }

    return {
      items: visibleItems.map(toApprovalRequestResponse),
      filters: input.filters
    };
  }

  async approve(input: ApprovalRequestDecisionInput): Promise<ApprovalRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    ensureActorCanApprove(input.customerScope);
    const approvalRequest = await this.loadVisibleRequest(input.approvalRequestId, input.customerScope);

    if (approvalRequest.status === ApprovalRequestStatus.approved) {
      if (input.idempotencyKey && approvalRequest.idempotencyKey === input.idempotencyKey) {
        const duplicateResult = await this.sideEffectGuard.execute({
          requestId: input.requestId,
          sessionId: approvalRequest.sessionId,
          messageId: approvalRequest.messageId,
          identityContext: input.identityContext,
          customerScope: input.customerScope,
          sourceType: 'approval_request',
          sourceId: approvalRequest.id,
          requesterActorId: approvalRequest.requesterActorId,
          approverActorId: approvalRequest.approverActorId,
          toolName: extractActionString(approvalRequest.actionSummary, 'toolName') ?? 'unknown',
          resource: extractActionString(approvalRequest.actionSummary, 'resource') ?? 'unknown',
          operation: requireActionToolOperation(approvalRequest.actionSummary),
          riskLevel: approvalRequest.riskLevel,
          expectedToolContract: extractToolContract(approvalRequest.actionSummary),
          entityId: extractActionString(approvalRequest.actionSummary, 'entityId'),
          idempotencyKey: input.idempotencyKey,
          requiresConfirmation: false,
          requiresApproval: true
        });
        return {
          ...toApprovalRequestResponse(approvalRequest),
          duplicateSafe: duplicateResult.duplicateSafe,
          executionStatus: duplicateResult.executionStatus
        };
      }

      throw new ConflictException(`Approval request cannot be approved from ${approvalRequest.status} status.`);
    }

    ensurePendingAndFresh(approvalRequest, 'approved');

    const execution = await this.sideEffectGuard.execute({
      requestId: input.requestId,
      sessionId: approvalRequest.sessionId,
      messageId: approvalRequest.messageId,
      identityContext: input.identityContext,
      customerScope: input.customerScope,
      sourceType: 'approval_request',
      sourceId: approvalRequest.id,
      requesterActorId: approvalRequest.requesterActorId,
          approverActorId: input.customerScope.actorId,
      toolName: extractActionString(approvalRequest.actionSummary, 'toolName') ?? 'unknown',
      resource: extractActionString(approvalRequest.actionSummary, 'resource') ?? 'unknown',
      operation: requireActionToolOperation(approvalRequest.actionSummary),
      riskLevel: approvalRequest.riskLevel,
      expectedToolContract: extractToolContract(approvalRequest.actionSummary),
      entityId: extractActionString(approvalRequest.actionSummary, 'entityId'),
      idempotencyKey: input.idempotencyKey,
      requiresConfirmation: false,
      requiresApproval: true
    });

    const updated = await this.prisma.db.$transaction(async (database) => {
      const transitioned = await this.transition(database, approvalRequest, input.customerScope, {
        status: ApprovalRequestStatus.approved,
        approverActorId: input.customerScope.actorId,
        idempotencyKey: input.idempotencyKey ?? approvalRequest.idempotencyKey,
        decidedAt: new Date()
      });

      await this.appendAudit({
        requestId: input.requestId,
        sessionId: transitioned.sessionId,
        messageId: transitioned.messageId,
        customerScope: input.customerScope,
        eventType: 'approval_request_approved',
        riskLevel: transitioned.riskLevel,
        metadata: buildApprovalAuditMetadata({
          approvalRequest: transitioned,
          idempotencyKeyPresent: Boolean(input.idempotencyKey)
        })
      }, database);

      return transitioned;
    });

    return {
      ...toApprovalRequestResponse(updated),
      executionStatus: execution.executionStatus
    };
  }

  async reject(input: ApprovalRequestDecisionInput): Promise<ApprovalRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    ensureActorCanApprove(input.customerScope);
    const approvalRequest = await this.loadVisibleRequest(input.approvalRequestId, input.customerScope);
    ensurePendingAndFresh(approvalRequest, 'rejected');

    const updated = await this.prisma.db.$transaction(async (database) => {
      const transitioned = await this.transition(database, approvalRequest, input.customerScope, {
        status: ApprovalRequestStatus.rejected,
        approverActorId: input.customerScope.actorId,
        decisionReason: input.reason ?? null,
        decidedAt: new Date()
      });

      await this.appendAudit({
        requestId: input.requestId,
        sessionId: transitioned.sessionId,
        messageId: transitioned.messageId,
        customerScope: input.customerScope,
        eventType: 'approval_request_rejected',
        riskLevel: transitioned.riskLevel,
        metadata: buildApprovalAuditMetadata({
          approvalRequest: transitioned,
          reasonProvided: Boolean(input.reason)
        })
      }, database);

      return transitioned;
    });

    return toApprovalRequestResponse(updated);
  }

  async cancel(input: ApprovalRequestDecisionInput): Promise<ApprovalRequestResponse> {
    assertCustomerWorkflowIdentityConsistency(input.customerScope, input.identityContext);
    const approvalRequest = await this.loadVisibleRequest(input.approvalRequestId, input.customerScope);
    if (!canCancel(approvalRequest, input.customerScope)) {
      throw new ForbiddenException('Approval request cannot be cancelled by this actor.');
    }
    ensurePendingAndFresh(approvalRequest, 'cancelled');

    const updated = await this.prisma.db.$transaction(async (database) => {
      const transitioned = await this.transition(database, approvalRequest, input.customerScope, {
        status: ApprovalRequestStatus.cancelled,
        decisionReason: input.reason ?? null,
        decidedAt: new Date()
      });

      await this.appendAudit({
        requestId: input.requestId,
        sessionId: transitioned.sessionId,
        messageId: transitioned.messageId,
        customerScope: input.customerScope,
        eventType: 'approval_request_cancelled',
        riskLevel: transitioned.riskLevel,
        metadata: buildApprovalAuditMetadata({
          approvalRequest: transitioned,
          reasonProvided: Boolean(input.reason)
        })
      }, database);

      return transitioned;
    });

    return toApprovalRequestResponse(updated);
  }

  private async loadVisibleRequest(approvalRequestId: string, customerScope: import('../identity/customer-scope.types').CustomerScope) {
    const approvalRequest = await this.prisma.db.approvalRequest.findFirst({
      where: { customerId: customerScope.customerId, id: approvalRequestId }
    });
    if (!approvalRequest) {
      throw workflowNotFound();
    }

    const session = await this.prisma.db.assistantSession.findFirst({
      where: {
        id: approvalRequest.sessionId,
        customerId: customerScope.customerId,
        organizationId: customerScope.organizationId,
        hostApp: customerScope.hostApp,
        actorId: approvalRequest.requesterActorId
      }
    });
    if (!session || !isApprovalVisibleToActor(approvalRequest, customerScope)) {
      throw workflowNotFound();
    }

    return approvalRequest;
  }

  private appendAudit(input: {
    requestId: string;
    sessionId: string;
    messageId?: string | null;
    customerScope: import('../identity/customer-scope.types').CustomerScope;
    eventType: string;
    riskLevel: RiskLevel;
    metadata: Prisma.InputJsonValue;
  }, database?: Parameters<typeof this.auditWriter.appendCustomerWorkflowEvent>[1]) {
    return this.auditWriter.appendCustomerWorkflowEvent({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId ?? undefined,
      eventType: input.eventType,
      riskLevel: input.riskLevel,
      metadata: input.metadata
    }, database);
  }

  private async transition(
    database: Pick<Prisma.TransactionClient, 'approvalRequest'>,
    approvalRequest: { id: string; status: ApprovalRequestStatus },
    customerScope: import('../identity/customer-scope.types').CustomerScope,
    data: Prisma.ApprovalRequestUpdateManyMutationInput
  ) {
    const result = await database.approvalRequest.updateMany({ where: { customerId: customerScope.customerId, id: approvalRequest.id, status: approvalRequest.status }, data });
    if (result.count !== 1) throw new ConflictException('Approval request transition conflict.');
    const updated = await database.approvalRequest.findFirst({ where: { customerId: customerScope.customerId, id: approvalRequest.id } });
    if (!updated) throw workflowNotFound();
    return updated;
  }
}

function buildApprovalPreview(input: CreateApprovalRequestInput, tool: { key: string; operation: ToolOperation }): ApprovalRequestPreview {
  const entityRef = getPageEntityRef(input.pageContext);
  return {
    toolName: tool.key,
    resource: input.pageContext?.module ?? entityRef.entityType ?? 'unknown',
    operation: tool.operation,
    entityType: entityRef.entityType ?? null,
    entityId: entityRef.entityId ?? null
  };
}

function buildApprovalAuditMetadata(input: {
  approvalRequest: {
    id: string;
    status: ApprovalRequestStatus;
    riskLevel: RiskLevel;
    requesterActorId: string;
    approverActorId: string | null;
    actionSummary: Prisma.JsonValue;
    expiresAt: Date | null;
  };
  includeExpiresAt?: boolean;
  idempotencyKeyPresent?: boolean;
  reasonProvided?: boolean;
}): Prisma.InputJsonValue {
  const action = extractApprovalActionAuditMetadata(input.approvalRequest.actionSummary);
  return toJsonInput({
    approvalRequestId: input.approvalRequest.id,
    status: input.approvalRequest.status,
    riskLevel: input.approvalRequest.riskLevel,
    requesterActorId: input.approvalRequest.requesterActorId,
    approverActorId: input.approvalRequest.approverActorId,
    ...action,
    ...(input.includeExpiresAt ? { expiresAt: input.approvalRequest.expiresAt?.toISOString() ?? null } : {}),
    ...(typeof input.idempotencyKeyPresent === 'boolean'
      ? { idempotencyKeyPresent: input.idempotencyKeyPresent }
      : {}),
    ...(typeof input.reasonProvided === 'boolean' ? { reasonProvided: input.reasonProvided } : {})
  });
}

function extractApprovalActionAuditMetadata(actionSummary: Prisma.JsonValue) {
  if (!actionSummary || typeof actionSummary !== 'object' || Array.isArray(actionSummary)) {
    return {};
  }

  return {
    ...(typeof actionSummary.toolName === 'string' ? { toolName: actionSummary.toolName } : {}),
    ...(typeof actionSummary.resource === 'string' ? { resource: actionSummary.resource } : {}),
    ...(typeof actionSummary.operation === 'string' ? { operation: actionSummary.operation } : {})
  };
}

function buildListWhere(customerScope: import('../identity/customer-scope.types').CustomerScope, filters: ApprovalRequestListFilters) {
  const where: Record<string, unknown> = {
    customerId: customerScope.customerId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.riskLevel ? { riskLevel: filters.riskLevel } : {}),
    ...(filters.requesterActorId ? { requesterActorId: filters.requesterActorId } : {}),
    ...(filters.approverActorId ? { approverActorId: filters.approverActorId } : {}),
    ...(filters.createdAtFrom || filters.createdAtTo
      ? {
          createdAt: {
            ...(filters.createdAtFrom ? { gte: new Date(filters.createdAtFrom) } : {}),
            ...(filters.createdAtTo ? { lte: new Date(filters.createdAtTo) } : {})
          }
        }
      : {})
  };

  if (!hasApprovalAuthority(customerScope)) {
    where.requesterActorId = customerScope.actorId;
  }

  return where;
}

function ensurePendingAndFresh(
  approvalRequest: { status: ApprovalRequestStatus; expiresAt: Date | null },
  nextStatus: string
) {
  if (approvalRequest.expiresAt && approvalRequest.expiresAt.getTime() <= Date.now()) {
    throw new ConflictException(`Approval request cannot be ${nextStatus} from expired status.`);
  }
  if (!APPROVABLE_STATUSES.has(approvalRequest.status)) {
    throw new ConflictException(`Approval request cannot be ${nextStatus} from ${approvalRequest.status} status.`);
  }
}

function ensureActorCanApprove(identityContext: import('../identity/customer-scope.types').CustomerScope) {
  if (!hasApprovalAuthority(identityContext)) {
    throw new ForbiddenException('Approver permission is required.');
  }
}

function canCancel(
  approvalRequest: { requesterActorId: string; approverActorId: string | null },
  identityContext: import('../identity/customer-scope.types').CustomerScope
) {
  return (
    approvalRequest.requesterActorId === identityContext.actorId ||
    approvalRequest.approverActorId === identityContext.actorId ||
    hasApprovalAuthority(identityContext)
  );
}

function isApprovalVisibleToActor(
  approvalRequest: { requesterActorId: string; approverActorId: string | null },
  identityContext: import('../identity/customer-scope.types').CustomerScope
) {
  return (
    approvalRequest.requesterActorId === identityContext.actorId ||
    approvalRequest.approverActorId === identityContext.actorId ||
    hasApprovalAuthority(identityContext)
  );
}

function hasApprovalAuthority(identityContext: import('../identity/customer-scope.types').CustomerScope) {
  return (
    identityContext.roles.includes( 'approver' ) ||
    identityContext.permissionScopes.some((scope) => scope === 'orders:approve' || scope.endsWith(':approve'))
  );
}

function toApprovalRequestResponse(approvalRequest: {
  id: string;
  status: ApprovalRequestStatus;
  riskLevel: RiskLevel;
  requesterActorId: string;
  approverActorId: string | null;
  actionSummary: Prisma.JsonValue;
  payloadSummary: Prisma.JsonValue;
  evidenceRefIds: string[];
  expiresAt: Date | null;
  requestId: string;
  messageId: string | null;
  decisionReason: string | null;
  decidedAt: Date | null;
}): ApprovalRequestResponse {
  return {
    approvalRequestId: approvalRequest.id,
    status: approvalRequest.status,
    riskLevel: approvalRequest.riskLevel,
    requesterActorId: approvalRequest.requesterActorId,
    approverActorId: approvalRequest.approverActorId,
    actionSummary: approvalRequest.actionSummary,
    payloadSummary: approvalRequest.payloadSummary,
    evidenceRefIds: approvalRequest.evidenceRefIds,
    expiresAt: approvalRequest.expiresAt?.toISOString() ?? null,
    requestId: approvalRequest.requestId,
    messageId: approvalRequest.messageId,
    decisionReason: approvalRequest.decisionReason,
    decidedAt: approvalRequest.decidedAt?.toISOString() ?? null
  };
}

function extractActionString(actionSummary: Prisma.JsonValue, field: string): string | undefined {
  if (!actionSummary || typeof actionSummary !== 'object' || Array.isArray(actionSummary)) {
    return undefined;
  }

  const value = actionSummary[field];
  return typeof value === 'string' ? value : undefined;
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

function toToolOperation(value: string | undefined): ToolOperation | undefined {
  return Object.values(ToolOperation).find((operation) => operation === value);
}

function requireActionToolOperation(actionSummary: Prisma.JsonValue): ToolOperation {
  const operation = toToolOperation(extractActionString(actionSummary, 'operation'));
  if (!operation) {
    throw new ForbiddenException('Approval request side-effect tool contract mismatch.');
  }

  return operation;
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
