import type { ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';
import type { PreparedManifestOperation } from '../manifest/operation-manifest.registry';
import type { ClosedJsonSchemaV1 } from '@internal-ai-assistant/connector-runtime-contract';
import { validateClosedJsonSchema } from '../manifest/closed-json-schema.validator';

export type ExtractionResult = Readonly<{ ok: true; value: Readonly<Record<string, unknown>> }> |
  Readonly<{ ok: false; code: Extract<ConnectorErrorCode, 'CONNECTOR_RESPONSE_INVALID'> }>;

export class ManifestResponseExtractor {
  extract(raw: unknown, operation: PreparedManifestOperation, invocationArguments: Readonly<Record<string, unknown>>): ExtractionResult {
    if (operation.response.structuredOutputSchema) {
      const value = projectStructured(raw, operation.response.structuredOutputSchema);
      return value && typeof value === 'object' && !Array.isArray(value) &&
        validateClosedJsonSchema(operation.response.structuredOutputSchema, value)
        ? Object.freeze({ ok: true, value: deepFreeze(value as Record<string, unknown>) }) : failure();
    }
    const output: Record<string, string | number | boolean> = {};
    for (const declaration of operation.response.extraction) {
      const derived = declaration.source === 'operation_key' || declaration.source === 'fixed_query';
      if (derived && Object.prototype.hasOwnProperty.call(invocationArguments, declaration.targetField)) return failure();
      const source = declaration.source === 'operation_key'
        ? operation.operationKey
        : declaration.source === 'fixed_query'
          ? operation.request.profile === 'GET_QUERY_V1'
            ? operation.request.query.find((entry) => entry.name === declaration.queryName)?.value
            : undefined
          : pointer(raw, declaration.sourcePointer);
      const converted = convert(source, declaration.conversion);
      if (converted === undefined) return failure();
      if (!derived && Object.prototype.hasOwnProperty.call(invocationArguments, declaration.targetField) && invocationArguments[declaration.targetField] !== converted) return failure();
      output[declaration.targetField] = converted;
    }
    return Object.freeze({ ok: true, value: Object.freeze(output) });
  }
}

function projectStructured(value: unknown, schema: ClosedJsonSchemaV1): unknown {
  if (value === null || schema.type !== 'object' && schema.type !== 'array') return value;
  if (schema.type === 'array') {
    return Array.isArray(value) && value.length <= schema.maxItems
      ? value.map((item) => projectStructured(item, schema.items)) : undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const field of schema.properties) {
    if (Object.prototype.hasOwnProperty.call(source, field.name)) {
      output[field.name] = projectStructured(source[field.name], field.schema);
    } else if (schema.required.includes(field.name)) return undefined;
  }
  return output;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function pointer(value: unknown, path: string): unknown {
  let current = value;
  for (const encoded of path.split('/').slice(1)) {
    if (!current || typeof current !== 'object') return undefined;
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
function convert(value: unknown, conversion: string): string | number | boolean | undefined {
  if (conversion === 'string') return typeof value === 'string' ? value : undefined;
  if (conversion === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (conversion === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  if (conversion === 'integer') return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
function failure(): ExtractionResult { return Object.freeze({ ok: false, code: 'CONNECTOR_RESPONSE_INVALID' }); }
