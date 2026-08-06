import { Injectable } from '@nestjs/common';
import { Prisma, ToolDefinition } from '../generated/prisma/client';
import { ToolOperation } from '../generated/prisma/enums';
import { CustomerScope } from '../identity/customer-scope.types';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerToolPolicyService } from './customer-tool-policy.service';
import { CustomerToolRegistryResolveResult, RegisteredToolDefinition, ToolJsonSchema, ToolRegistryResolveResult, ToolValidationResult } from './tool-registry.types';

@Injectable()
export class ToolRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerToolPolicy: CustomerToolPolicyService
  ) {}

  async listTools(): Promise<RegisteredToolDefinition[]> {
    const tools = await this.prisma.db.toolDefinition.findMany({
      orderBy: [{ name: 'asc' }, { version: 'asc' }]
    });

    return tools.map((tool) => normalizeToolDefinition(tool));
  }

  async getExecutableTool(toolKey: string): Promise<RegisteredToolDefinition | undefined> {
    const result = await this.resolveExecutableTool(toolKey);
    return result.tool;
  }

  async resolveRegisteredTool(toolKey: string): Promise<ToolRegistryResolveResult> {
    const tool = await this.findLatestTool(toolKey);

    if (!tool) {
      return { deniedReason: 'tool_not_registered' };
    }

    if (!tool.isActive) {
      return { deniedReason: 'tool_inactive' };
    }

    return {
      tool: normalizeToolDefinition(tool)
    };
  }

  async resolveExecutableTool(toolKey: string): Promise<ToolRegistryResolveResult> {
    const tool = await this.findLatestTool(toolKey);

    if (!tool) {
      return { deniedReason: 'tool_not_registered' };
    }

    if (!tool.isActive) {
      return { deniedReason: 'tool_inactive' };
    }

    if (tool.operation !== ToolOperation.read || tool.hasSideEffect) {
      return { deniedReason: 'operation_denied' };
    }

    return {
      tool: normalizeToolDefinition(tool)
    };
  }

  async resolveToolForCustomer(toolKey: string, customerScope: CustomerScope): Promise<CustomerToolRegistryResolveResult> {
    const global = await this.resolveRegisteredTool(toolKey);
    if (!global.tool) {
      return { deniedReason: global.deniedReason };
    }

    const policy = await this.customerToolPolicy.resolve({
      customerId: customerScope.customerId,
      toolDefinitionId: global.tool.id
    });
    if (!policy.allowed) {
      return { deniedReason: 'customer_policy_denied' };
    }

    return {
      resolved: {
        tool: global.tool,
        requiredRoles: Object.freeze([...policy.policy.requiredRoles]),
        requiredPermissionScopes: Object.freeze([...policy.policy.requiredPermissionScopes])
      }
    };
  }

  isExecutableReadOnly(tool: RegisteredToolDefinition): boolean {
    return tool.operation === ToolOperation.read && !tool.hasSideEffect;
  }

  private findLatestTool(toolKey: string) {
    return this.prisma.db.toolDefinition.findFirst({
      where: {
        name: toolKey
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
  }

  validateInput(tool: RegisteredToolDefinition, input: Record<string, unknown>): ToolValidationResult {
    return validateRequiredStringFields(tool.inputSchema, input);
  }

  validateOutput(tool: RegisteredToolDefinition, output: Record<string, unknown>): ToolValidationResult {
    return validateRequiredFields(tool.outputSchema, output);
  }
}

function normalizeToolDefinition(tool: ToolDefinition): RegisteredToolDefinition {
  return {
    id: tool.id,
    key: tool.name,
    name: tool.name,
    version: tool.version,
    description: tool.description,
    operation: tool.operation,
    riskLevel: tool.riskLevel,
    active: tool.isActive,
    connectorKey: tool.connectorKey,
    requiredPermissionScopes: [...tool.requiredPermissions],
    inputSchema: normalizeJsonSchema(tool.inputSchema),
    outputSchema: normalizeJsonSchema(tool.outputSchema),
    hasSideEffect: tool.hasSideEffect,
    requiresConfirmation: tool.requiresConfirmation,
    requiresApproval: tool.requiresApproval
  };
}

function normalizeJsonSchema(schema: Prisma.JsonValue): ToolJsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { required: [] };
  }

  const value = schema as Record<string, unknown>;
  return {
    ...value,
    required: Array.isArray(value.required) ? value.required.filter((field): field is string => typeof field === 'string') : []
  };
}

function validateRequiredStringFields(schema: ToolJsonSchema, value: Record<string, unknown>): ToolValidationResult {
  const missingField = schema.required.find((field) => typeof value[field] !== 'string' || String(value[field]).trim().length === 0);

  if (missingField) {
    return {
      valid: false,
      deniedReason: 'schema_invalid',
      schemaErrorReason: `missing_required_${missingField}`
    };
  }

  return { valid: true };
}

function validateRequiredFields(schema: ToolJsonSchema, value: Record<string, unknown>): ToolValidationResult {
  const missingField = schema.required.find((field) => value[field] === undefined || value[field] === null);

  if (missingField) {
    return {
      valid: false,
      deniedReason: 'schema_invalid',
      schemaErrorReason: `missing_required_${missingField}`
    };
  }

  return { valid: true };
}
