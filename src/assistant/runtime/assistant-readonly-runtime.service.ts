import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RiskLevel, ToolOperation } from '../../generated/prisma/enums';
import { MockConnectorAdapter } from '../../connectors/mock/mock-connector.adapter';
import { LlmInputSanitizerService } from '../../permissions/llm-input-sanitizer.service';
import { ToolPermissionPrecheckService } from '../../permissions/tool-permission-precheck.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { getPageEntityRef, getVisibleColumns } from '../page-context/page-context.mapper';
import { AssistantReadonlyRuntimeInput, AssistantReadonlyRuntimeResult } from './runtime.types';
import { ToolCallService } from './tool-call.service';

@Injectable()
export class AssistantReadonlyRuntimeService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly mockConnector: MockConnectorAdapter,
    private readonly permissionPrecheck: ToolPermissionPrecheckService,
    private readonly toolCallService: ToolCallService,
    private readonly llmInputSanitizer: LlmInputSanitizerService
  ) {}

  async execute(input: AssistantReadonlyRuntimeInput): Promise<AssistantReadonlyRuntimeResult> {
    const entityRef = getPageEntityRef(input.pageContext);
    const visibleFields = getVisibleColumns(input.pageContext);
    const toolName = firstToolName(input.executionPlan.candidateTools);
    const toolResolution = await this.toolRegistry.resolveExecutableTool(toolName);
    const tool = toolResolution.tool;

    if (!tool) {
      await this.permissionPrecheck.recordDenied({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        identityContext: input.identityContext,
        toolName,
        operation: ToolOperation.read,
        deniedReason: toolResolution.deniedReason ?? 'tool_not_registered'
      });
      const { toolCall } = await this.toolCallService.blockToolCall({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
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
        sanitizedResult: {},
        deniedReason: toolResolution.deniedReason ?? 'tool_not_registered'
      };
    }

    const toolInput = {
      entityId: entityRef.entityId
    };
    const validation = this.toolRegistry.validateInput(tool, toolInput);
    if (!validation.valid) {
      await this.permissionPrecheck.recordDenied({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        identityContext: input.identityContext,
        toolName: tool.key,
        operation: tool.operation,
        deniedReason: validation.deniedReason,
        schemaErrorReason: validation.schemaErrorReason
      });
      const { toolCall } = await this.toolCallService.blockToolCall({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
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
        sanitizedResult: {},
        deniedReason: validation.deniedReason
      };
    }

    const permission = await this.permissionPrecheck.check({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      identityContext: input.identityContext,
      toolName: tool.key,
      operation: tool.operation,
      requiredPermissionScopes: tool.requiredPermissionScopes
    });

    if (!permission.allowed) {
      const { toolCall } = await this.toolCallService.blockToolCall({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
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
        sanitizedResult: {},
        deniedReason: permission.reason
      };
    }

    const startedAt = Date.now();
    const { toolCall: startedToolCall } = await this.toolCallService.startToolCall({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      identityContext: input.identityContext,
      toolName: tool.key,
      toolVersion: tool.version,
      riskLevel: tool.riskLevel,
      entityId: entityRef.entityId,
      visibleFields
    });
    const connectorResult = await this.mockConnector.execute({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      actorId: input.identityContext.actor.actorId,
      toolKey: tool.key,
      arguments: toolInput
    });
    const durationMs = Math.max(1, Date.now() - startedAt);

    if (connectorResult.status !== 'succeeded' || !connectorResult.data) {
      const { toolCall } = await this.toolCallService.failToolCall({
        requestId: input.requestId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        identityContext: input.identityContext,
        toolCallId: startedToolCall.id,
        toolName: tool.key,
        toolVersion: tool.version,
        riskLevel: tool.riskLevel,
        errorCode: connectorResult.error?.code ?? connectorResult.status,
        durationMs
      });

      return {
        toolName: tool.key,
        toolVersion: tool.version,
        toolCallId: toolCall.id,
        toolLifecycle: 'failed',
        riskLevel: tool.riskLevel,
        entityRef,
        visibleFields,
        sanitizedResult: {},
        connectorStatus: connectorResult.status,
        connectorErrorCode: connectorResult.error?.code,
        durationMs
      };
    }

    const sanitization = this.llmInputSanitizer.sanitize({
      record: connectorResult.data,
      visibleFields
    });
    const sanitizedResult = sanitization.sanitized;
    const { toolCall } = await this.toolCallService.completeToolCall({
      requestId: input.requestId,
      sessionId: input.sessionId,
      messageId: input.messageId,
      identityContext: input.identityContext,
      toolCallId: startedToolCall.id,
      toolName: tool.key,
      toolVersion: tool.version,
      riskLevel: tool.riskLevel,
      visibleFields,
      sanitizedResult,
      durationMs
    });

    return {
      toolName: tool.key,
      toolVersion: tool.version,
      toolCallId: toolCall.id,
      toolLifecycle: 'completed',
      riskLevel: tool.riskLevel,
      entityRef,
      visibleFields,
      sanitizedResult,
      connectorStatus: connectorResult.status,
      durationMs
    };
  }
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
