import { Injectable } from '@nestjs/common';
import { LlmInputSanitizerService } from '../permissions/llm-input-sanitizer.service';
import { applyFieldPathMasks } from '../permissions/masking.util';
import { isResultPolicyProjectableForActor } from '../tools/tool-result-policy';
import {
  AdapterResultProjectionResult,
  RegisteredToolDefinition,
  SafeProjectedAdapterResult,
  SafeProjectedScalar,
  ToolResultPolicyResolution
} from '../tools/tool-registry.types';

export interface AdapterResultProjectionInput {
  readonly tool: RegisteredToolDefinition;
  readonly resultPolicy: ToolResultPolicyResolution;
  readonly rawResult: unknown;
  readonly permissionScopes: readonly string[];
  readonly presentationFieldPaths?: readonly string[];
}

const PROJECTION_FAILED: AdapterResultProjectionResult = Object.freeze({
  projected: false,
  errorCode: 'ADAPTER_RESULT_PROJECTION_FAILED'
});

@Injectable()
export class AdapterResultProjectorService {
  constructor(private readonly llmInputSanitizer: LlmInputSanitizerService) {}

  project(input: AdapterResultProjectionInput): AdapterResultProjectionResult {
    try {
      if (!input.resultPolicy.allowed || !validateOutputValue(input.tool.outputSchema, input.rawResult, true)) {
        return PROJECTION_FAILED;
      }

      const rawRecord = input.rawResult as Record<string, unknown>;
      const policy = input.resultPolicy.policy;
      if (!isResultPolicyProjectableForActor(policy, input.permissionScopes)) {
        return PROJECTION_FAILED;
      }
      const projected: Record<string, unknown> = {};
      for (const fieldPath of policy.allowedFieldPaths) {
        if (isDeniedPath(fieldPath, policy.deniedFieldPaths)) continue;
        const schema = schemaAtPath(input.tool.outputSchema, fieldPath);
        const value = valueAtPath(rawRecord, fieldPath);
        if (value === undefined || !isProjectableLeaf(schema, value)) continue;
        setValueAtPath(projected, fieldPath, deepCopy(value));
      }

      const trustedScopes = new Set(input.permissionScopes);
      const masked = applyFieldPathMasks(
        projected,
        policy.permissionMasks
          .filter((mask) => !mask.requiredPermissionScopes.every((scope) => trustedScopes.has(scope)))
          .map(({ fieldPath, action }) => ({ fieldPath, action }))
      );
      const sanitization = this.llmInputSanitizer.sanitize({
        record: masked,
        allowedFieldPaths: policy.allowedFieldPaths.filter((fieldPath) => !isDeniedPath(fieldPath, policy.deniedFieldPaths)),
        limits: policy.limits
      });
      const minimized = sanitization.sanitized as Record<string, unknown>;

      const evidenceProvenance: Record<string, SafeProjectedScalar> = {};
      for (const fieldPath of policy.evidenceSafeProvenanceFields) {
        const value = valueAtPath(minimized, fieldPath);
        if (isSafeProjectedScalar(value)) evidenceProvenance[fieldPath] = value;
      }

      const facts = narrowForPresentation(minimized, input.presentationFieldPaths);
      if (!withinTotalBytes({ facts, evidenceProvenance }, policy.limits.maxTotalBytes)) return PROJECTION_FAILED;
      const fieldPaths = Object.freeze(leafFieldPaths(facts).sort());
      const fieldMetadata: Record<string, { description?: string; unit?: string; period?: string }> = {};
      for (const path of fieldPaths) {
        const schema = schemaAtPath(input.tool.outputSchema, path);
        if (!isRecord(schema)) return PROJECTION_FAILED;
        const description = metadataText(schema.description, 160);
        const unit = metadataText(schema['x-unit'], 48);
        const period = metadataText(schema['x-period'], 160);
        if (description || unit || period) fieldMetadata[path] = { ...(description ? { description } : {}),
          ...(unit ? { unit } : {}), ...(period ? { period } : {}) };
      }
      if (!withinTotalBytes({ facts, evidenceProvenance, fieldMetadata }, policy.limits.maxTotalBytes)) return PROJECTION_FAILED;
      const result: SafeProjectedAdapterResult = Object.freeze({
        kind: 'safe_projected_adapter_result',
        canonicalToolKey: input.tool.key,
        schemaVersion: input.tool.version,
        facts: deepFreeze(facts),
        fieldPaths,
        ...(Object.keys(fieldMetadata).length > 0 ? { fieldMetadata: deepFreeze(fieldMetadata) } : {}),
        evidenceProvenance: deepFreeze(evidenceProvenance)
      });

      return Object.freeze({ projected: true, result });
    } catch {
      return PROJECTION_FAILED;
    }
  }
}

function metadataText(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum || [...value].some((character) => character.charCodeAt(0) < 32)) {
    throw new Error('Invalid field metadata.');
  }
  return value;
}

function validateOutputValue(schema: unknown, value: unknown, root = false): boolean {
  if (!isRecord(schema)) return false;
  const expectedTypes = parseSchemaTypes(schema.type, root);
  if (!expectedTypes) return false;
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.some((entry) => jsonEqual(entry, value)))) {
    return false;
  }

  return expectedTypes.some((expectedType) => validateOutputType(schema, value, expectedType));
}

function validateOutputType(schema: Record<string, unknown>, value: unknown, expectedType: string): boolean {
  if (expectedType === 'object') {
    if (!isRecord(value) || !isRecord(schema.properties)) return false;
    const properties = schema.properties;
    if (Object.keys(properties).some((key) => !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(key))) return false;
    const required = schema.required === undefined ? [] : schema.required;
    if (!Array.isArray(required) || !required.every((field) => typeof field === 'string' && Object.prototype.hasOwnProperty.call(value, field))) {
      return false;
    }
    return Object.entries(value).every(
      ([key, nested]) => Object.prototype.hasOwnProperty.call(properties, key) && validateOutputValue(properties[key], nested)
    );
  }
  if (expectedType === 'array') {
    if (!Array.isArray(value) || !isRecord(schema.items)) return false;
    if (schema.minItems !== undefined && (!isNonNegativeInteger(schema.minItems) || value.length < schema.minItems)) return false;
    if (schema.maxItems !== undefined && (!isNonNegativeInteger(schema.maxItems) || value.length > schema.maxItems)) return false;
    return value.every((entry) => validateOutputValue(schema.items, entry));
  }
  if (expectedType === 'string') {
    if (typeof value !== 'string') return false;
    if (schema.minLength !== undefined && (!isNonNegativeInteger(schema.minLength) || value.length < schema.minLength)) return false;
    if (schema.maxLength !== undefined && (!isNonNegativeInteger(schema.maxLength) || value.length > schema.maxLength)) return false;
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

function isProjectableLeaf(schema: unknown, value: unknown): boolean {
  if (!isRecord(schema)) return false;
  const expectedTypes = parseSchemaTypes(schema.type, false);
  if (!expectedTypes) return false;
  if (isRecord(value)) return expectedTypes.includes('object') && validateOutputValue(schema, value);
  if (Array.isArray(value)) {
    if (!expectedTypes.includes('array') || !isRecord(schema.items)) return false;
    return validateOutputValue(schema, value);
  }
  return isSafeProjectedScalar(value) && expectedTypes.some((type) => valueMatchesType(value, type));
}

function schemaAtPath(schema: unknown, fieldPath: string): unknown {
  let current = schema;
  for (const segment of fieldPath.split('.')) {
    if (!isRecord(current) || !isRecord(current.properties)) return undefined;
    current = current.properties[segment];
  }
  return current;
}

function valueAtPath(record: Record<string, unknown>, fieldPath: string): unknown {
  let current: unknown = record;
  for (const segment of fieldPath.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function setValueAtPath(record: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const segments = fieldPath.split('.');
  let current = record;
  for (const segment of segments.slice(0, -1)) {
    const nested = current[segment];
    if (!isRecord(nested)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

function narrowForPresentation(record: Record<string, unknown>, requested?: readonly string[]): Record<string, unknown> {
  if (!requested || requested.length === 0) return deepCopy(record) as Record<string, unknown>;
  const narrowed: Record<string, unknown> = {};
  for (const fieldPath of requested) {
    const value = valueAtPath(record, fieldPath);
    if (value !== undefined) setValueAtPath(narrowed, fieldPath, deepCopy(value));
  }
  return narrowed;
}

function isDeniedPath(fieldPath: string, deniedPaths: readonly string[]): boolean {
  return deniedPaths.some((denied) => fieldPath === denied || fieldPath.startsWith(`${denied}.`));
}

function leafFieldPaths(value: unknown, parent = ''): string[] {
  if (!isRecord(value)) return parent ? [parent] : [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const fieldPath = parent ? `${parent}.${key}` : key;
    return isRecord(nested) ? leafFieldPaths(nested, fieldPath) : [fieldPath];
  });
}

function isSafeProjectedScalar(value: unknown): value is SafeProjectedScalar {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function deepCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => deepCopy(entry));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, deepCopy(nested)]));
  return value;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (isRecord(value)) {
    Object.values(value).forEach((nested) => deepFreeze(nested));
    return Object.freeze(value) as T;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const SUPPORTED_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function parseSchemaTypes(value: unknown, root: boolean): readonly string[] | undefined {
  const types = value === undefined && root ? ['object'] : typeof value === 'string' ? [value] : value;
  if (
    !Array.isArray(types) ||
    types.length === 0 ||
    !types.every((type): type is string => typeof type === 'string' && SUPPORTED_SCHEMA_TYPES.has(type)) ||
    new Set(types).size !== types.length
  ) {
    return undefined;
  }
  return types;
}

function valueMatchesType(value: SafeProjectedScalar, type: string): boolean {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return type === 'null' && value === null;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function withinTotalBytes(value: unknown, maxTotalBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxTotalBytes;
  } catch {
    return false;
  }
}
