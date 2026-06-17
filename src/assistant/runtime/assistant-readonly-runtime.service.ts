import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { RiskLevel, ToolOperation } from '../../generated/prisma/enums';
import { MockConnectorAdapter } from '../../connectors/mock/mock-connector.adapter';
import { minimizeForLlmInput } from '../../permissions/masking.util';
import { ToolPermissionPrecheckService } from '../../permissions/tool-permission-precheck.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { getPageEntityRef, getVisibleColumns } from '../page-context/page-context.mapper';
import { AssistantReadonlyRuntimeInput, AssistantReadonlyRuntimeResult } from './runtime.types';

@Injectable()
export class AssistantReadonlyRuntimeService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly mockConnector: MockConnectorAdapter,
    private readonly permissionPrecheck: ToolPermissionPrecheckService
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

      return {
        toolName,
        toolVersion: 'unknown',
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

      return {
        toolName: tool.key,
        toolVersion: tool.version,
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
      return {
        toolName: tool.key,
        toolVersion: tool.version,
        riskLevel: tool.riskLevel,
        entityRef,
        visibleFields,
        sanitizedResult: {},
        deniedReason: permission.reason
      };
    }

    const connectorResult = await this.mockConnector.execute({
      requestId: input.requestId,
      organizationId: input.identityContext.company.organizationId,
      actorId: input.identityContext.actor.actorId,
      toolKey: tool.key,
      arguments: toolInput
    });
    const structuredRecord = connectorResult.status === 'succeeded' ? connectorResult.data : undefined;
    const sanitizedResult = structuredRecord ? minimizeForLlmInput(structuredRecord, visibleFields) : {};

    return {
      toolName: tool.key,
      toolVersion: tool.version,
      riskLevel: tool.riskLevel,
      entityRef,
      visibleFields,
      structuredRecord,
      sanitizedResult
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
