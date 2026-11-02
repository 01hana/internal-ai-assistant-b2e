import type { RegisteredToolDefinition, ToolResultPolicyV1 } from '../tools/tool-registry.types';
import { isResultPolicyProjectableForActor } from '../tools/tool-result-policy';

type FieldSummary = Readonly<{ path: string; type: string; description?: string; unit?: string; period?: string;
  itemFields?: readonly Readonly<{ name: string; type: string; description?: string; unit?: string; period?: string }>[] }>;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_FIELDS = 32;
const MAX_BYTES = 2048;

/** Bounded discovery metadata from the same closed schema and field policy used for projection. */
export function approvedOutputSummary(tool: RegisteredToolDefinition, policy: ToolResultPolicyV1,
  permissionScopes: readonly string[], options: Readonly<{ maxDepth?: number; maxFields?: number }> = {}): readonly FieldSummary[] {
  if (!isResultPolicyProjectableForActor(policy, permissionScopes)) return [];
  const fields: FieldSummary[] = [];
  const inspect = (schema: unknown, path: string, depth: number): void => {
    if (depth > Math.min(policy.limits.maxDepth, options.maxDepth ?? 5) ||
      fields.length >= Math.min(MAX_FIELDS, options.maxFields ?? MAX_FIELDS) || !record(schema)) return;
    const type = Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === 'string').join('|') : schema.type;
    if (typeof type !== 'string') return;
    if (path && canDescribe(path, policy, permissionScopes)) {
      const summary: FieldSummary = { path, type,
        ...(safeMetadata(schema.description) ? { description: schema.description } : {}),
        ...(safeMetadata(schema['x-unit']) ? { unit: schema['x-unit'] } : {}),
        ...(safeMetadata(schema['x-period']) ? { period: schema['x-period'] } : {}),
        ...(type === 'array' && record(schema.items) && schema.items.type === 'object' &&
          schema.items.additionalProperties === false && record(schema.items.properties)
          ? { itemFields: Object.entries(schema.items.properties).filter(([name, child]) =>
              FIELD_NAME.test(name) && record(child) && typeof child.type === 'string').slice(0, MAX_FIELDS)
              .map(([name, child]) => ({ name, type: (child as Record<string, unknown>).type as string,
                ...(safeMetadata((child as Record<string, unknown>).description)
                  ? { description: (child as Record<string, unknown>).description as string } : {}),
                ...(safeMetadata((child as Record<string, unknown>)['x-unit'])
                  ? { unit: (child as Record<string, unknown>)['x-unit'] as string } : {}),
                ...(safeMetadata((child as Record<string, unknown>)['x-period'])
                  ? { period: (child as Record<string, unknown>)['x-period'] as string } : {}) })) } : {}) };
      if (Buffer.byteLength(JSON.stringify([...fields, summary]), 'utf8') <= MAX_BYTES) fields.push(summary);
    }
    if (type === 'array' || schema.additionalProperties === true || !record(schema.properties)) return;
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!FIELD_NAME.test(name)) continue;
      inspect(child, path ? `${path}.${name}` : name, depth + 1);
    }
  };
  inspect(tool.outputSchema, '', 0);
  return fields;
}

function canDescribe(path: string, policy: ToolResultPolicyV1, scopes: readonly string[]): boolean {
  const covers = (configured: string) => path === configured || path.startsWith(`${configured}.`);
  if (!policy.allowedFieldPaths.some(covers) || policy.deniedFieldPaths.some(covers)) return false;
  return !policy.permissionMasks.some((mask) => covers(mask.fieldPath) &&
    mask.requiredPermissionScopes.some((scope) => !scopes.includes(scope)));
}

function safeMetadata(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
