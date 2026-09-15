import { Injectable } from '@nestjs/common';
import { Prisma, ToolDefinition } from '../generated/prisma/client';
import { ToolOperation } from '../generated/prisma/enums';
import { CustomerScope } from '../identity/customer-scope.types';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerToolPolicyService } from './customer-tool-policy.service';
import {
  CustomerToolRegistryResolveResult,
  NamedOperationValidationResult,
  RegisteredToolDefinition,
  ToolJsonSchema,
  ToolRegistryResolveResult,
  ToolResultPermissionMask,
  ToolResultPolicyResolution,
  ToolResultPolicyV1,
  ToolValidationResult
} from './tool-registry.types';

const MAX_ARGUMENT_KEYS = 32;
const MAX_ARGUMENT_DEPTH = 4;
const MAX_ARRAY_ITEMS = 100;
const MAX_ARGUMENT_STRING_LENGTH = 512;
const MAX_ARGUMENT_BYTES = 16 * 1024;
const PROHIBITED_ARGUMENT_KEY = /(sql|url|uri|path|query|command|credential|password|secret|token|connectorcontextref|connectorkey|adapterkey|endpoint)/i;
const PROHIBITED_ARGUMENT_VALUE = /(^|\s)(select|insert|update|delete|drop|alter|create|exec(?:ute)?)\s|https?:\/\/|^(?:\/|\.\.?\/|\?)|\b(?:bearer|basic)\s+|(?:^|\s)(?:curl|wget|bash|sh|powershell)\s/i;
const RESULT_POLICY_KEY = 'x-assistant-result-policy';
const SAFE_FIELD_PATH = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;
const PROHIBITED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

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

  async resolveExactExecutableTool(toolKey: string, version: string): Promise<ToolRegistryResolveResult> {
    const tool = await this.prisma.db.toolDefinition.findUnique({
      where: { name_version: { name: toolKey, version } }
    });

    if (!tool) return { deniedReason: 'tool_not_registered' };
    if (!tool.isActive) return { deniedReason: 'tool_inactive' };
    if (tool.operation !== ToolOperation.read || tool.hasSideEffect) return { deniedReason: 'operation_denied' };
    return { tool: normalizeToolDefinition(tool) };
  }

  async listDiscoverableToolsForCustomer(customerScope: Readonly<Pick<CustomerScope, 'customerId'>>): Promise<RegisteredToolDefinition[]> {
    const tools = await this.prisma.db.toolDefinition.findMany({
      where: { isActive: true, operation: ToolOperation.read, hasSideEffect: false },
      orderBy: [{ name: 'asc' }, { version: 'asc' }]
    });
    const allowed: RegisteredToolDefinition[] = [];
    for (const tool of tools) {
      if (!tool.isActive || tool.operation !== ToolOperation.read || tool.hasSideEffect) continue;
      try {
        const policy = await this.customerToolPolicy.resolve({
          customerId: customerScope.customerId,
          toolDefinitionId: tool.id
        });
        if (policy.allowed) allowed.push(normalizeToolDefinition(tool));
      } catch {
        // Discovery catalog failures are deny-by-default.
      }
    }
    return allowed;
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

  validateNamedOperation(tool: RegisteredToolDefinition, candidate: unknown): NamedOperationValidationResult {
    if (!isRecord(candidate) || !isRecord(candidate.arguments)) {
      return invalidNamedOperation();
    }

    const argumentsValue = candidate.arguments;
    if (!isBoundedSafeArguments(argumentsValue) || !validateSchemaValue(tool.inputSchema, argumentsValue, true)) {
      return invalidNamedOperation();
    }

    const copiedArguments = deepFreezeCopy(argumentsValue) as Readonly<Record<string, unknown>>;
    const argumentKeys = Object.freeze(Object.keys(copiedArguments).sort());
    return {
      valid: true,
      operation: Object.freeze({
        canonicalToolKey: tool.key,
        schemaVersion: tool.version,
        arguments: copiedArguments
      }),
      safeInputSummary: Object.freeze({
        canonicalToolKey: tool.key,
        schemaVersion: tool.version,
        argumentKeys,
        argumentCount: argumentKeys.length
      })
    };
  }

  validateOutput(tool: RegisteredToolDefinition, output: Record<string, unknown>): ToolValidationResult {
    return validateRequiredFields(tool.outputSchema, output);
  }

  resolveResultPolicy(tool: RegisteredToolDefinition): ToolResultPolicyResolution {
    const extension = tool.outputSchema[RESULT_POLICY_KEY];
    if (extension === undefined) {
      return { allowed: false, reason: 'missing_result_policy' };
    }
    if (!isRecord(extension)) {
      return { allowed: false, reason: 'invalid_result_policy' };
    }
    if (extension.version !== '1') {
      return {
        allowed: false,
        reason: typeof extension.version === 'string' ? 'unsupported_result_policy_version' : 'invalid_result_policy'
      };
    }

    const policy = parseResultPolicyV1(tool.outputSchema, extension);
    return policy
      ? { allowed: true, policy }
      : { allowed: false, reason: 'invalid_result_policy' };
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
    timeoutMs: tool.timeoutMs,
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

function invalidNamedOperation(): NamedOperationValidationResult {
  return {
    valid: false,
    deniedReason: 'schema_invalid',
    schemaErrorReason: 'invalid_operation_arguments'
  };
}

function isBoundedSafeArguments(value: Record<string, unknown>): boolean {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_ARGUMENT_BYTES) {
      return false;
    }
  } catch {
    return false;
  }

  const state = { keys: 0, items: 0 };
  return inspectArgumentValue(value, 1, state);
}

function inspectArgumentValue(value: unknown, depth: number, state: { keys: number; items: number }): boolean {
  if (depth > MAX_ARGUMENT_DEPTH) {
    return false;
  }
  if (typeof value === 'string') {
    return value.length <= MAX_ARGUMENT_STRING_LENGTH && !PROHIBITED_ARGUMENT_VALUE.test(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value === 'boolean' || value === null) {
    return true;
  }
  if (Array.isArray(value)) {
    state.items += value.length;
    return state.items <= MAX_ARRAY_ITEMS && value.every((entry) => inspectArgumentValue(entry, depth + 1, state));
  }
  if (!isRecord(value)) {
    return false;
  }

  for (const [key, entry] of Object.entries(value)) {
    state.keys += 1;
    if (
      state.keys > MAX_ARGUMENT_KEYS ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
      PROHIBITED_ARGUMENT_KEY.test(key) ||
      !inspectArgumentValue(entry, depth + 1, state)
    ) {
      return false;
    }
  }
  return true;
}

function validateSchemaValue(schema: unknown, value: unknown, root = false): boolean {
  if (!isRecord(schema)) {
    return false;
  }

  const schemaType = schema.type;
  if (schemaType !== undefined && typeof schemaType !== 'string') {
    return false;
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.some((entry) => isJsonEqual(entry, value)))) {
    return false;
  }

  const expectedType = schemaType ?? (root ? 'object' : undefined);
  if (expectedType === 'object') {
    if (!isRecord(value) || !isRecord(schema.properties)) {
      return false;
    }
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every((field) => typeof field === 'string' && Object.prototype.hasOwnProperty.call(value, field))) {
      return false;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
        return false;
      }
      if (!validateSchemaValue(schema.properties[key], entry)) {
        return false;
      }
    }
    return true;
  }
  if (expectedType === 'array') {
    if (!Array.isArray(value) || !isNonNegativeInteger(schema.minItems) || !isNonNegativeInteger(schema.maxItems)) {
      return false;
    }
    if (value.length < schema.minItems || value.length > schema.maxItems || !isRecord(schema.items)) {
      return false;
    }
    return value.every((entry) => validateSchemaValue(schema.items, entry));
  }
  if (expectedType === 'string') {
    if (typeof value !== 'string') return false;
    if (schema.minLength !== undefined && (!isNonNegativeInteger(schema.minLength) || value.length < schema.minLength)) return false;
    if (schema.maxLength !== undefined && (!isNonNegativeInteger(schema.maxLength) || value.length > schema.maxLength)) return false;
    if (schema.pattern !== undefined) {
      if (typeof schema.pattern !== 'string') return false;
      try {
        if (!new RegExp(schema.pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  if (expectedType === 'number' || expectedType === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (expectedType === 'integer' && !Number.isInteger(value))) return false;
    if (schema.minimum !== undefined && (typeof schema.minimum !== 'number' || value < schema.minimum)) return false;
    if (schema.maximum !== undefined && (typeof schema.maximum !== 'number' || value > schema.maximum)) return false;
    return true;
  }
  if (expectedType === 'boolean') return typeof value === 'boolean';
  if (expectedType === 'null') return value === null;
  return false;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isJsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function deepFreezeCopy(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => deepFreezeCopy(entry)));
  }
  if (isRecord(value)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreezeCopy(entry)])));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseResultPolicyV1(outputSchema: ToolJsonSchema, value: Record<string, unknown>): ToolResultPolicyV1 | undefined {
  const allowedFieldPaths = parseUniqueFieldPaths(value.allowedFieldPaths, outputSchema);
  const deniedFieldPaths = parseUniqueFieldPaths(value.deniedFieldPaths, outputSchema, true);
  const evidenceSafeProvenanceFields = parseUniqueFieldPaths(value.evidenceSafeProvenanceFields, outputSchema, true);
  const permissionMasks = parsePermissionMasks(value.permissionMasks, outputSchema);
  const limits = parseResultPolicyLimits(value.limits);

  if (!allowedFieldPaths || allowedFieldPaths.length === 0 || !deniedFieldPaths || !evidenceSafeProvenanceFields || !permissionMasks || !limits) {
    return undefined;
  }
  const allowed = new Set(allowedFieldPaths);
  if (!evidenceSafeProvenanceFields.every((fieldPath) => allowed.has(fieldPath))) {
    return undefined;
  }

  return Object.freeze({
    version: '1',
    allowedFieldPaths,
    deniedFieldPaths,
    permissionMasks,
    limits,
    evidenceSafeProvenanceFields
  });
}

function parseUniqueFieldPaths(
  value: unknown,
  outputSchema: ToolJsonSchema,
  allowEmpty = false
): readonly string[] | undefined {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    return undefined;
  }
  if (!value.every((entry): entry is string => typeof entry === 'string' && isDeclaredSafeFieldPath(entry, outputSchema))) {
    return undefined;
  }
  if (new Set(value).size !== value.length) {
    return undefined;
  }
  return Object.freeze([...value]);
}

function isDeclaredSafeFieldPath(fieldPath: string, outputSchema: ToolJsonSchema): boolean {
  if (!SAFE_FIELD_PATH.test(fieldPath) || fieldPath.split('.').some((segment) => PROHIBITED_PATH_SEGMENTS.has(segment))) {
    return false;
  }

  let schema: unknown = outputSchema;
  for (const segment of fieldPath.split('.')) {
    if (!isRecord(schema) || !isRecord(schema.properties) || !Object.prototype.hasOwnProperty.call(schema.properties, segment)) {
      return false;
    }
    schema = schema.properties[segment];
  }
  return true;
}

function parsePermissionMasks(value: unknown, outputSchema: ToolJsonSchema): readonly ToolResultPermissionMask[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const masks: ToolResultPermissionMask[] = [];
  const paths = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.fieldPath !== 'string' ||
      !isDeclaredSafeFieldPath(entry.fieldPath, outputSchema) ||
      paths.has(entry.fieldPath) ||
      (entry.action !== 'omit' && entry.action !== 'redact') ||
      !Array.isArray(entry.requiredPermissionScopes) ||
      !entry.requiredPermissionScopes.every((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0) ||
      new Set(entry.requiredPermissionScopes).size !== entry.requiredPermissionScopes.length
    ) {
      return undefined;
    }
    paths.add(entry.fieldPath);
    masks.push(
      Object.freeze({
        fieldPath: entry.fieldPath,
        requiredPermissionScopes: Object.freeze([...entry.requiredPermissionScopes]),
        action: entry.action
      })
    );
  }
  return Object.freeze(masks);
}

function parseResultPolicyLimits(value: unknown): ToolResultPolicyV1['limits'] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const limits = {
    maxDepth: value.maxDepth,
    maxItems: value.maxItems,
    maxStringLength: value.maxStringLength,
    maxTotalBytes: value.maxTotalBytes
  };
  if (
    !isPositiveIntegerAtMost(limits.maxDepth, MAX_ARGUMENT_DEPTH) ||
    !isPositiveIntegerAtMost(limits.maxItems, MAX_ARRAY_ITEMS) ||
    !isPositiveIntegerAtMost(limits.maxStringLength, MAX_ARGUMENT_STRING_LENGTH) ||
    !isPositiveIntegerAtMost(limits.maxTotalBytes, MAX_ARGUMENT_BYTES)
  ) {
    return undefined;
  }
  return Object.freeze(limits) as ToolResultPolicyV1['limits'];
}

function isPositiveIntegerAtMost(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum;
}
