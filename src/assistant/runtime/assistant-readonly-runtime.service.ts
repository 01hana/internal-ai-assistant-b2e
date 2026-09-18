import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RiskLevel, ToolOperation } from '../../generated/prisma/enums';
import { ConnectorExecuteResult } from '../../connectors/connector-adapter.interface';
import { DataAdapterRegistry } from '../../connectors/data-adapter-registry.service';
import { AdapterResultProjectorService } from '../../connectors/adapter-result-projector.service';
import { ToolPermissionPrecheckService } from '../../permissions/tool-permission-precheck.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { RegisteredToolDefinition } from '../../tools/tool-registry.types';
import { getPageEntityRef, getPresentationFieldPaths, getVisibleColumns } from '../page-context/page-context.mapper';
import { PageEntityRef } from '../page-context/page-context.types';
import { AssistantReadonlyRuntimeInput, AssistantReadonlyRuntimeResult } from './runtime.types';
import { ToolCallService } from './tool-call.service';

@Injectable()
export class AssistantReadonlyRuntimeService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly permissionPrecheck: ToolPermissionPrecheckService,
    private readonly toolCallService: ToolCallService,
    private readonly resultProjector: AdapterResultProjectorService,
    private readonly dataAdapterRegistry: DataAdapterRegistry
  ) {}

  async execute(input: AssistantReadonlyRuntimeInput): Promise<AssistantReadonlyRuntimeResult> {
    this.assertExecutionPlanParentConsistency(input);

    const entityRef = getPageEntityRef(input.pageContext);
    const visibleFields = getVisibleColumns(input.pageContext);
    const candidate = firstPlannedCandidate(input.executionPlan.candidateTools);
    const toolName = candidate.key;
    const toolResolution = await this.toolRegistry.resolveToolForCustomer(toolName, input.customerScope);
    const resolvedTool = toolResolution.resolved;

    if (!resolvedTool) {
      await this.permissionPrecheck.recordRuntimeCustomerToolDenied({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        toolName,
        operation: ToolOperation.read,
        deniedReason: toolResolution.deniedReason ?? 'tool_not_registered'
      });
      const { toolCall } = await this.toolCallService.blockToolCall({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        identityContext: input.identityContext,
        toolName,
        toolVersion: 'unknown',
        riskLevel: RiskLevel.high,
        entityId: entityRef.entityId,
        visibleFields,
        deniedReason: toolResolution.deniedReason ?? 'tool_not_registered'
      });

      return {
        toolName,
        toolVersion: 'unknown',
        toolCallId: toolCall.id,
        toolLifecycle: 'blocked',
        riskLevel: RiskLevel.high,
        entityRef,
        visibleFields,
        deniedReason: toolResolution.deniedReason ?? 'tool_not_registered'
      };
    }

    const tool = resolvedTool.tool;

    const permission = await this.permissionPrecheck.checkResolvedCustomerTool({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.responseMessageId,
      identityContext: input.identityContext,
      customerScope: input.customerScope,
      resolvedTool
    });

    if (!permission.allowed) {
      const { toolCall } = await this.toolCallService.blockToolCall({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        identityContext: input.identityContext,
        toolName: tool.key,
        toolVersion: tool.version,
        riskLevel: tool.riskLevel,
        entityId: entityRef.entityId,
        visibleFields,
        deniedReason: permission.reason ?? 'missing_scope'
      });

      return {
        toolName: tool.key,
        toolVersion: tool.version,
        toolCallId: toolCall.id,
        toolLifecycle: 'blocked',
        riskLevel: tool.riskLevel,
        entityRef,
        visibleFields,
        deniedReason: permission.reason
      };
    }

    if (!this.toolRegistry.isExecutableReadOnly(tool)) {
      await this.permissionPrecheck.recordRuntimeCustomerToolDenied({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        toolName: tool.key,
        operation: tool.operation,
        deniedReason: 'operation_denied'
      });
      const { toolCall } = await this.toolCallService.blockToolCall({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        identityContext: input.identityContext,
        toolName: tool.key,
        toolVersion: tool.version,
        riskLevel: tool.riskLevel,
        entityId: entityRef.entityId,
        visibleFields,
        deniedReason: 'operation_denied'
      });
      return {
        toolName: tool.key,
        toolVersion: tool.version,
        toolCallId: toolCall.id,
        toolLifecycle: 'blocked',
        riskLevel: tool.riskLevel,
        entityRef,
        visibleFields,
        deniedReason: 'operation_denied'
      };
    }

    const validation = this.toolRegistry.validateNamedOperation(tool, candidate);
    if (!validation.valid) {
      await this.permissionPrecheck.recordRuntimeCustomerToolDenied({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        toolName: tool.key,
        operation: tool.operation,
        deniedReason: validation.deniedReason,
        schemaErrorReason: validation.schemaErrorReason
      });
      const { toolCall } = await this.toolCallService.blockToolCall({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        identityContext: input.identityContext,
        toolName: tool.key,
        toolVersion: tool.version,
        riskLevel: tool.riskLevel,
        entityId: entityRef.entityId,
        visibleFields,
        deniedReason: validation.deniedReason
      });

      return {
        toolName: tool.key,
        toolVersion: tool.version,
        toolCallId: toolCall.id,
        toolLifecycle: 'blocked',
        riskLevel: tool.riskLevel,
        entityRef,
        visibleFields,
        deniedReason: validation.deniedReason
      };
    }

    const startedAt = Date.now();
    const { toolCall: startedToolCall } = await this.toolCallService.startToolCall({
      customerScope: input.customerScope,
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.responseMessageId,
      identityContext: input.identityContext,
      toolName: tool.key,
      toolVersion: tool.version,
      riskLevel: tool.riskLevel,
      entityId: entityRef.entityId,
      visibleFields,
      safeInputSummary: validation.safeInputSummary
    });
    let selectedAdapter;
    try {
      selectedAdapter = await this.dataAdapterRegistry.select({
        host: input.hostIntegrationContext,
        tool,
        operation: validation.operation
      });
    } catch {
      return this.failStartedToolCall({
        input,
        tool,
        toolCallId: startedToolCall.id,
        entityRef,
        visibleFields,
        connectorStatus: 'failed',
        errorCode: 'DATA_ADAPTER_UNAVAILABLE',
        durationMs: Math.max(1, Date.now() - startedAt)
      });
    }

    let connectorResult: ConnectorExecuteResult;
    try {
      connectorResult = await executeWithTrustedTimeout(
        () => selectedAdapter.execute({
          requestId: input.requestId,
          organizationId: input.hostIntegrationContext.organizationId,
          actorId: input.hostIntegrationContext.actorId,
          toolKey: tool.key,
          arguments: validation.operation.arguments,
          host: input.hostIntegrationContext,
          operation: validation.operation,
          transientConnectorContext: input.transientConnectorContext
        }),
        tool.timeoutMs
      );
    } catch {
      return this.failStartedToolCall({
        input,
        tool,
        toolCallId: startedToolCall.id,
        entityRef,
        visibleFields,
        connectorStatus: 'failed',
        errorCode: 'TOOL_EXECUTION_FAILED',
        durationMs: Math.max(1, Date.now() - startedAt)
      });
    }
    const durationMs = Math.max(1, Date.now() - startedAt);

    if (connectorResult.status !== 'succeeded' || !connectorResult.data) {
      return this.failStartedToolCall({
        input,
        tool,
        toolCallId: startedToolCall.id,
        entityRef,
        visibleFields,
        connectorStatus: connectorResult.status,
        errorCode: toSafeConnectorErrorCode(connectorResult, selectedAdapter.key),
        durationMs
      });
    }

    let projection;
    try {
      projection = this.resultProjector.project({
        tool,
        resultPolicy: this.toolRegistry.resolveResultPolicy(tool),
        rawResult: connectorResult.data,
        permissionScopes: input.hostIntegrationContext.permissionScopes,
        presentationFieldPaths: getPresentationFieldPaths(input.pageContext)
      });
    } catch {
      return this.failStartedToolCall({
        input,
        tool,
        toolCallId: startedToolCall.id,
        entityRef,
        visibleFields,
        connectorStatus: connectorResult.status,
        errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED',
        durationMs
      });
    }
    if (!projection.projected) {
      return this.failStartedToolCall({
        input,
        tool,
        toolCallId: startedToolCall.id,
        entityRef,
        visibleFields,
        connectorStatus: connectorResult.status,
        errorCode: projection.errorCode,
        durationMs
      });
    }
    let completedToolCall;
    try {
      ({ toolCall: completedToolCall } = await this.toolCallService.completeToolCall({
        customerScope: input.customerScope,
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.responseMessageId,
        identityContext: input.identityContext,
        toolCallId: startedToolCall.id,
        toolName: tool.key,
        toolVersion: tool.version,
        riskLevel: tool.riskLevel,
        visibleFields,
        projectedResult: projection.result,
        durationMs
      }));
    } catch {
      return this.failStartedToolCall({
        input,
        tool,
        toolCallId: startedToolCall.id,
        entityRef,
        visibleFields,
        connectorStatus: connectorResult.status,
        errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED',
        durationMs
      });
    }

    return {
      toolName: tool.key,
      toolVersion: tool.version,
      toolCallId: completedToolCall.id,
      toolLifecycle: 'completed',
      riskLevel: tool.riskLevel,
      entityRef,
      visibleFields,
      projectedResult: projection.result,
      connectorStatus: connectorResult.status,
      durationMs
    };
  }

  private async failStartedToolCall(input: {
    readonly input: AssistantReadonlyRuntimeInput;
    readonly tool: RegisteredToolDefinition;
    readonly toolCallId: string;
    readonly entityRef: PageEntityRef;
    readonly visibleFields: string[];
    readonly connectorStatus: ConnectorExecuteResult['status'];
    readonly errorCode: string;
    readonly durationMs: number;
  }): Promise<AssistantReadonlyRuntimeResult> {
    const { toolCall } = await this.toolCallService.failToolCall({
      customerScope: input.input.customerScope,
      requestId: input.input.requestId,
      sessionId: input.input.sessionId,
      messageId: input.input.responseMessageId,
      identityContext: input.input.identityContext,
      toolCallId: input.toolCallId,
      toolName: input.tool.key,
      toolVersion: input.tool.version,
      riskLevel: input.tool.riskLevel,
      errorCode: input.errorCode,
      durationMs: input.durationMs
    });

    return {
      toolName: input.tool.key,
      toolVersion: input.tool.version,
      toolCallId: toolCall.id,
      toolLifecycle: 'failed',
      riskLevel: input.tool.riskLevel,
      entityRef: input.entityRef,
      visibleFields: input.visibleFields,
      connectorStatus: input.connectorStatus,
      connectorErrorCode: input.errorCode,
      durationMs: input.durationMs
    };
  }

  private assertExecutionPlanParentConsistency(input: AssistantReadonlyRuntimeInput): void {
    if (
      input.executionPlan.customerId !== input.customerScope.customerId ||
      input.executionPlan.sessionId !== input.sessionId ||
      input.executionPlan.messageId !== input.sourceMessageId
    ) {
      throw new NotFoundException({
        error: 'NOT_FOUND',
        message: 'Assistant runtime context not found.'
      });
    }
  }
}

function toSafeConnectorErrorCode(result: ConnectorExecuteResult, adapterKey: string): string {
  if (result.error?.code === 'NOT_FOUND') return result.error.code;
  if (adapterKey === 'mock' && result.error?.code === 'CONNECTOR_UNAVAILABLE') return result.error.code;
  if (result.status === 'permission_denied' || result.status === 'requires_approval') return result.status;
  return 'TOOL_EXECUTION_FAILED';
}

const ADAPTER_EXECUTION_TIMEOUT = Symbol('ADAPTER_EXECUTION_TIMEOUT');

function executeWithTrustedTimeout<T>(execute: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(ADAPTER_EXECUTION_TIMEOUT);
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(ADAPTER_EXECUTION_TIMEOUT);
    }, timeoutMs);

    Promise.resolve()
      .then(execute)
      .then(
        (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
  });
}

function firstPlannedCandidate(candidateTools: Prisma.JsonValue): Record<string, unknown> & { key: string } {
  if (!Array.isArray(candidateTools) || candidateTools.length === 0) {
    return { key: 'mock.general.lookup', arguments: {}, reason: 'missing candidate' };
  }

  const tool = candidateTools[0];
  if (tool && typeof tool === 'object' && 'key' in tool && typeof tool.key === 'string') {
    return tool as Record<string, unknown> & { key: string };
  }

  return { key: 'mock.general.lookup', arguments: {}, reason: 'invalid candidate' };
}
