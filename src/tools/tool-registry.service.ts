import { Injectable } from '@nestjs/common';
import { Prisma, ToolDefinition } from '../generated/prisma/client';
import { ToolOperation } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { RegisteredToolDefinition, ToolJsonSchema, ToolRegistryResolveResult, ToolValidationResult } from './tool-registry.types';

@Injectable()
export class ToolRegistryService {
  constructor(private readonly prisma: PrismaService) {}

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

  async resolveExecutableTool(toolKey: string): Promise<ToolRegistryResolveResult> {
    const tool = await this.prisma.db.toolDefinition.findFirst({
      where: {
        name: toolKey
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

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

  validateInput(tool: RegisteredToolDefinition, input: Record<string, unknown>): ToolValidationResult {
    return validateRequiredStringFields(tool.inputSchema, input);
  }

  validateOutput(tool: RegisteredToolDefinition, output: Record<string, unknown>): ToolValidationResult {
    return validateRequiredFields(tool.outputSchema, output);
  }
}

function normalizeToolDefinition(tool: ToolDefinition): RegisteredToolDefinition {
  return {
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
    outputSchema: normalizeJsonSchema(tool.outputSchema)
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
