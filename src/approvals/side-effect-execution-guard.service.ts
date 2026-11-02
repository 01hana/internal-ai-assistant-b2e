import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditWriterService } from '../audit/audit-writer.service';
import { DataAdapterRegistry } from '../connectors/data-adapter-registry.service';
import { Prisma } from '../generated/prisma/client';
import { RiskLevel, ToolCallStatus, ToolExecutionStatus, ToolOperation } from '../generated/prisma/enums';
import { RequestIdentityContext } from '../identity/identity-context.types';
import { CustomerScope } from '../identity/customer-scope.types';
import { ToolPermissionPrecheckService } from '../permissions/tool-permission-precheck.service';
import { PrismaService } from '../prisma/prisma.service';
import { sessionOwnedByScopePredicate } from '../prisma/customer-scope.predicate';
import { RegisteredToolDefinition, ToolPermissionDeniedReason } from '../tools/tool-registry.types';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { PersistedSideEffectToolContract } from './side-effect-tool-contract.resolver';
import { assertCustomerWorkflowIdentityConsistency } from './customer-workflow-context';

type SideEffectSourceType = 'action_draft' | 'approval_request';

interface ExecuteSideEffectInput {
  requestId: string;
  sessionId: string;
  messageId?: string | null;
  identityContext: RequestIdentityContext;
  customerScope: CustomerScope;
  sourceType: SideEffectSourceType;
  sourceId: string;
  requesterActorId: string;
  approverActorId?: string | null;
  toolName: string;
  resource: string;
  operation: ToolOperation;
  riskLevel: RiskLevel;
  expectedToolContract?: Partial<PersistedSideEffectToolContract>;
  entityId?: string | null;
  idempotencyKey?: string;
  replayOnly?: boolean;
  requiresConfirmation: boolean;
  requiresApproval: boolean;
}

export interface SideEffectExecutionResult {
  toolCallId?: string;
  duplicateSafe: boolean;
  executionStatus: ToolExecutionStatus;
  priorExecutionStatus?: typeof ToolExecutionStatus.executed | typeof ToolExecutionStatus.failed;
  idempotencyStatus: 'executed' | 'duplicate';
  recheck: Record<string, string>;
}

@Injectable()
export class SideEffectExecutionGuardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly permissionPrecheck: ToolPermissionPrecheckService,
    private readonly dataAdapterRegistry: DataAdapterRegistry
  ) {}

  async execute(input: ExecuteSideEffectInput): Promise<SideEffectExecutionResult> {
    const customerScope = input.customerScope;
    assertCustomerWorkflowIdentityConsistency(customerScope, input.identityContext);
    await this.assertCustomerParents(input, customerScope);

    if (!input.idempotencyKey) {
      await this.recordDenied(input, customerScope, 'idempotency_required');
      throw new ConflictException('idempotencyKey is required before side-effect execution.');
    }

    const toolResolution = await this.toolRegistry.resolveToolForCustomer(input.toolName, customerScope);
    if (!toolResolution.resolved) {
      await this.recordDenied(input, customerScope, toolResolution.deniedReason ?? 'tool_not_registered');
      throw new ForbiddenException('Side-effect tool is not executable.');
    }

    const tool = toolResolution.resolved.tool;
    const contractDenial = validateToolContract(input, tool);
    if (contractDenial) {
      await this.recordDenied(input, customerScope, contractDenial, tool);
      throw new ForbiddenException('Side-effect tool contract mismatch.');
    }

    const permission = await this.permissionPrecheck.checkResolvedCustomerTool({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId ?? input.sourceId,
      identityContext: input.identityContext,
      customerScope,
      resolvedTool: toolResolution.resolved
    });
    if (!permission.allowed) {
      await this.recordDenied(input, customerScope, permission.reason ?? 'missing_scope', tool);
      throw new ForbiddenException('Side-effect permission check failed.');
    }

    // A replay is safe only after the caller has passed the same parent, tool,
    // contract, and permission gates as a new execution.
    const duplicateToolCall = await this.prisma.db.toolCall.findFirst({
      where: {
        customerId: customerScope.customerId,
        idempotencyKey: input.idempotencyKey
      }
    });
    if (duplicateToolCall) {
      if (
        duplicateToolCall.customerId !== customerScope.customerId ||
        duplicateToolCall.sessionId !== input.sessionId ||
        duplicateToolCall.messageId !== (input.messageId ?? null) ||
        duplicateToolCall.toolDefinitionId !== tool.id ||
        duplicateToolCall.toolName !== tool.key ||
        duplicateToolCall.toolVersion !== tool.version ||
        !matchesSideEffectSource(duplicateToolCall.inputSummary, input)
      ) {
        throw this.notFound();
      }
      await this.recordSkippedDuplicate(input, customerScope, duplicateToolCall.id);
      return {
        toolCallId: duplicateToolCall.id,
        duplicateSafe: true,
        executionStatus: ToolExecutionStatus.skipped_duplicate,
        priorExecutionStatus: duplicateToolCall.executedAt && duplicateToolCall.status === ToolCallStatus.success && duplicateToolCall.executionStatus === ToolExecutionStatus.executed
          ? ToolExecutionStatus.executed
          : duplicateToolCall.executedAt && duplicateToolCall.status === ToolCallStatus.failed && duplicateToolCall.executionStatus === ToolExecutionStatus.failed
            ? ToolExecutionStatus.failed
            : undefined,
        idempotencyStatus: 'duplicate',
        recheck: buildRecheck('passed', 'passed', 'passed', 'duplicate')
      };
    }

    // A different key must not turn the same workflow source into a second
    // side effect after its first ToolCall was reserved or completed.
    const priorSourceCalls = await this.prisma.db.toolCall.findMany({
      where: {
        customerId: customerScope.customerId,
        sessionId: input.sessionId,
        messageId: input.messageId ?? null
      }
    });
    if (input.replayOnly || priorSourceCalls.some((call) => matchesSideEffectIdentity(call.inputSummary, input))) {
      throw new ConflictException('Action execution identity does not match a retryable ToolCall.');
    }

    const connectorArguments = { entityId: input.entityId };
    const validated = this.toolRegistry.validateNamedOperation(tool, { arguments: connectorArguments });
    if (!validated.valid) {
      await this.recordDenied(input, customerScope, 'schema_invalid', tool);
      throw new ForbiddenException('Side-effect tool arguments are invalid.');
    }
    const host = Object.freeze({
      customerId: input.identityContext.customer.customerId,
      integrationId: input.identityContext.customer.integrationId,
      hostApp: input.identityContext.hostApp.hostApp,
      organizationId: input.identityContext.organization.organizationId,
      actorId: input.identityContext.actor.actorId,
      roles: Object.freeze([...input.identityContext.actor.roles]),
      permissionScopes: Object.freeze([...input.identityContext.actor.permissionScopes]),
      requestId: input.identityContext.requestId
    });
    // Selection is after all authorization/replay gates and before reserving a ToolCall.
    let adapter;
    try {
      adapter = await this.dataAdapterRegistry.select({ host, tool, operation: validated.operation });
    } catch (error) {
      await this.recordDenied(input, customerScope, 'DATA_ADAPTER_UNAVAILABLE', tool);
      throw error;
    }
    const startedAt = Date.now();
    let toolCall;
    try {
      toolCall = await this.prisma.db.toolCall.create({
        data: {
          id: sideEffectReservationId(customerScope.customerId, input.sourceType, input.sourceId),
          customerId: customerScope.customerId,
          requestId: input.requestId,
          sessionId: input.sessionId,
          messageId: input.messageId ?? null,
          toolDefinitionId: tool.id,
          toolName: tool.key,
          toolVersion: tool.version,
          inputSummary: toJsonInput({
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            entityId: input.entityId ?? null
          }),
          permissionResult: toJsonInput({
            requiredPermissionScopeCount: tool.requiredPermissionScopes.length
          }),
          outputSummary: toJsonInput({}),
          status: ToolCallStatus.pending,
          executionStatus: ToolExecutionStatus.in_progress,
          idempotencyKey: input.idempotencyKey,
          durationMs: null,
          errorCode: null,
          executedAt: null
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // The database primary key is the cross-process source reservation.
        // A concurrent winner may still be executing; never invoke the adapter again.
        const existingSource = await this.prisma.db.toolCall.findFirst({ where: {
          customerId: customerScope.customerId,
          id: sideEffectReservationId(customerScope.customerId, input.sourceType, input.sourceId)
        } });
        if (existingSource) throw new ConflictException('Action execution is already reserved.');
        throw this.notFound();
      }
      throw error;
    }
    if (
      toolCall.customerId !== customerScope.customerId ||
      toolCall.sessionId !== input.sessionId ||
      toolCall.messageId !== (input.messageId ?? null)
    ) {
      throw this.notFound();
    }

    let connectorResult;
    try {
      connectorResult = await executeWithinToolTimeout(adapter.execute({
        requestId: input.requestId,
        organizationId: customerScope.organizationId,
        actorId: customerScope.actorId,
        toolKey: tool.key,
        arguments: { ...validated.operation.arguments },
        idempotencyKey: input.idempotencyKey,
        host,
        operation: validated.operation
      }), tool.timeoutMs);
    } catch {
      // A timeout or thrown adapter error does not prove the external action stopped.
      // Keep the existing in-progress row as the durable, non-retryable unknown outcome.
      await this.recordOutcomeUnknown(input, customerScope, tool, toolCall.id, Math.max(1, Date.now() - startedAt));
      return {
        toolCallId: toolCall.id,
        duplicateSafe: false,
        executionStatus: ToolExecutionStatus.in_progress,
        idempotencyStatus: 'executed',
        recheck: buildRecheck('passed', 'passed', 'passed', 'reserved')
      };
    }

    const durationMs = Math.max(1, Date.now() - startedAt);
    if (connectorResult.status !== 'succeeded') {
      const failed = await this.prisma.db.toolCall.update({
        where: { customerId_id: { customerId: customerScope.customerId, id: toolCall.id } },
        data: {
          status: ToolCallStatus.failed,
          executionStatus: ToolExecutionStatus.failed,
          outputSummary: toJsonInput({}),
          errorCode: connectorResult.error?.code ?? connectorResult.status,
          durationMs,
          executedAt: new Date()
        }
      });
      if (failed.customerId !== customerScope.customerId) throw this.notFound();
      await this.recordFailed(input, customerScope, tool, failed.id, connectorResult.error?.code ?? connectorResult.status, durationMs);
      return {
        toolCallId: failed.id,
        duplicateSafe: false,
        executionStatus: failed.executionStatus,
        idempotencyStatus: 'executed',
        recheck: buildRecheck('passed', 'passed', 'passed', 'reserved')
      };
    }

    const completed = await this.prisma.db.toolCall.update({
      where: { customerId_id: { customerId: customerScope.customerId, id: toolCall.id } },
      data: {
        status: ToolCallStatus.success,
        executionStatus: ToolExecutionStatus.executed,
        outputSummary: toJsonInput({
          connectorStatus: connectorResult.status
        }),
        durationMs,
        executedAt: new Date()
      }
    });

    if (completed.customerId !== customerScope.customerId) throw this.notFound();
    await this.recordExecuted(input, customerScope, tool, completed.id, durationMs);

    return {
      toolCallId: completed.id,
      duplicateSafe: false,
      executionStatus: completed.executionStatus,
      idempotencyStatus: 'executed',
      recheck: buildRecheck('passed', 'passed', 'passed', 'reserved')
    };
  }

  private recordExecuted(input: ExecuteSideEffectInput, customerScope: CustomerScope, tool: RegisteredToolDefinition, toolCallId: string, durationMs: number) {
    return this.appendExecutionAudit(input, customerScope, {
      eventType: input.sourceType === 'action_draft' ? 'action_draft_executed' : 'approval_request_executed',
      tool,
      toolCallId,
      durationMs,
      executionStatus: ToolExecutionStatus.executed,
      idempotencyStatus: 'executed'
    });
  }

  private recordFailed(
    input: ExecuteSideEffectInput, customerScope: CustomerScope,
    tool: RegisteredToolDefinition,
    toolCallId: string,
    errorCode: string,
    durationMs: number
  ) {
    return this.appendExecutionAudit(input, customerScope, {
      eventType: input.sourceType === 'action_draft' ? 'action_draft_failed' : 'approval_request_failed',
      tool,
      toolCallId,
      durationMs,
      executionStatus: ToolExecutionStatus.failed,
      deniedReason: errorCode,
      idempotencyStatus: 'executed'
    });
  }

  private recordDenied(input: ExecuteSideEffectInput, customerScope: CustomerScope, deniedReason: ToolPermissionDeniedReason | 'DATA_ADAPTER_UNAVAILABLE', tool?: RegisteredToolDefinition) {
    return this.appendExecutionAudit(input, customerScope, {
      eventType: 'side_effect_execution_denied',
      tool,
      executionStatus: ToolExecutionStatus.not_started,
      deniedReason,
      idempotencyStatus: 'executed'
    });
  }

  private recordOutcomeUnknown(input: ExecuteSideEffectInput, customerScope: CustomerScope, tool: RegisteredToolDefinition, toolCallId: string, durationMs: number) {
    return this.appendExecutionAudit(input, customerScope, {
      eventType: 'side_effect_execution_outcome_unknown',
      tool,
      toolCallId,
      durationMs,
      executionStatus: ToolExecutionStatus.in_progress,
      deniedReason: 'DATA_ADAPTER_OUTCOME_UNKNOWN',
      idempotencyStatus: 'executed'
    });
  }

  private recordSkippedDuplicate(input: ExecuteSideEffectInput, customerScope: CustomerScope, toolCallId: string) {
    return this.appendExecutionAudit(input, customerScope, {
      eventType: 'side_effect_execution_skipped_duplicate',
      toolCallId,
      executionStatus: ToolExecutionStatus.skipped_duplicate,
      idempotencyStatus: 'duplicate'
    });
  }

  private appendExecutionAudit(
    input: ExecuteSideEffectInput, customerScope: CustomerScope,
    event: {
      eventType: string;
      tool?: RegisteredToolDefinition;
      toolCallId?: string;
      durationMs?: number;
      executionStatus: ToolExecutionStatus;
      deniedReason?: string;
      idempotencyStatus: 'executed' | 'duplicate';
    }
  ) {
    return this.auditWriter.appendCustomerToolEvent({
      customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId ?? undefined,
      toolCallId: event.toolCallId,
      eventType: event.eventType,
      riskLevel: input.riskLevel,
      durationMs: event.durationMs,
      metadata: toJsonInput({
        [input.sourceType === 'action_draft' ? 'actionDraftId' : 'approvalRequestId']: input.sourceId,
        toolName: event.tool?.key ?? input.toolName,
        toolVersion: event.tool?.version ?? 'unknown',
        resource: input.resource,
        operation: event.tool?.operation ?? input.operation,
        riskLevel: input.riskLevel,
        requesterActorId: input.requesterActorId,
        approverActorId: input.approverActorId ?? null,
        idempotencyKeyPresent: Boolean(input.idempotencyKey),
        idempotencyStatus: event.idempotencyStatus,
        deniedReason: event.deniedReason,
        executionStatus: event.executionStatus
      })
    });
  }

  private async assertCustomerParents(input: ExecuteSideEffectInput, scope: CustomerScope): Promise<void> {
    const session = await this.prisma.db.assistantSession.findFirst({
      where: sessionOwnedByScopePredicate(scope, input.sessionId)
    });
    if (!session) throw this.notFound();

    if (input.messageId) {
      const message = await this.prisma.db.assistantMessage.findFirst({
        where: { customerId: scope.customerId, id: input.messageId, sessionId: input.sessionId }
      });
      if (!message) throw this.notFound();
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ error: 'NOT_FOUND', message: 'Tool call not found.' });
  }
}

function validateToolContract(input: ExecuteSideEffectInput, tool: RegisteredToolDefinition): ToolPermissionDeniedReason | undefined {
  const expected = input.expectedToolContract;
  if (expected?.toolDefinitionId && expected.toolDefinitionId !== tool.id) {
    return 'tool_contract_mismatch';
  }
  if (expected?.toolName && expected.toolName !== tool.key) {
    return 'tool_contract_mismatch';
  }
  if (expected?.toolVersion && expected.toolVersion !== tool.version) {
    return 'tool_contract_mismatch';
  }
  if (expected?.operation && expected.operation !== tool.operation) {
    return 'tool_contract_mismatch';
  }
  if (expected?.riskLevel && expected.riskLevel !== tool.riskLevel) {
    return 'tool_contract_mismatch';
  }
  if (typeof expected?.hasSideEffect === 'boolean' && expected.hasSideEffect !== tool.hasSideEffect) {
    return 'tool_contract_mismatch';
  }
  if (
    typeof expected?.requiresConfirmation === 'boolean' &&
    expected.requiresConfirmation !== tool.requiresConfirmation
  ) {
    return 'tool_contract_mismatch';
  }
  if (typeof expected?.requiresApproval === 'boolean' && expected.requiresApproval !== tool.requiresApproval) {
    return 'tool_contract_mismatch';
  }

  if (!tool.hasSideEffect) {
    return 'tool_contract_mismatch';
  }
  if (input.requiresConfirmation && !tool.requiresConfirmation) {
    return 'tool_contract_mismatch';
  }
  if (input.requiresApproval && !tool.requiresApproval) {
    return 'tool_contract_mismatch';
  }
  if (tool.operation !== input.operation) {
    return 'tool_contract_mismatch';
  }
  if (tool.riskLevel !== input.riskLevel) {
    return 'tool_contract_mismatch';
  }

  return undefined;
}

function buildRecheck(permission: string, toolContract: string, freshness: string, idempotency: string) {
  return {
    organizationBoundary: 'passed',
    draftStatus: 'passed',
    requestStatus: 'passed',
    freshness,
    permission,
    toolContract,
    idempotency
  };
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function sideEffectReservationId(customerId: string, sourceType: SideEffectSourceType, sourceId: string): string {
  return `side-effect-${createHash('sha256').update(JSON.stringify([customerId, sourceType, sourceId])).digest('hex')}`;
}

function matchesSideEffectSource(summary: unknown, input: ExecuteSideEffectInput): boolean {
  if (!matchesSideEffectIdentity(summary, input)) return false;
  const fields = summary as Record<string, unknown>;
  return fields.entityId === (input.entityId ?? null);
}

function matchesSideEffectIdentity(summary: unknown, input: ExecuteSideEffectInput): boolean {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return false;
  const fields = summary as Record<string, unknown>;
  return fields.sourceType === input.sourceType &&
    fields.sourceId === input.sourceId;
}

async function executeWithinToolTimeout<T>(execution: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 30000) : 1;
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('adapter timeout')), boundedTimeout); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
