import { CONNECTOR_LIMITS_V1, type ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';
import { validateClosedJsonSchema } from '../manifest/closed-json-schema.validator';
import type { PreparedManifestOperation } from '../manifest/operation-manifest.registry';
import { resolveJsonPointerCorridor, schemaAtJsonPointer, valueAtJsonPointer } from '../manifest/json-pointer';
import { UpstreamResponseCancelledError, type UpstreamWireResponse } from './safe-upstream-http-client';
import type { UpstreamDiagnosticContext } from './safe-upstream-http-client';

export type BoundedResponseResult = Readonly<{ ok: true; value: Readonly<Record<string, unknown>> }> |
  Readonly<{ ok: false; code: Extract<ConnectorErrorCode, 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_AUTH_FAILED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_RESPONSE_INVALID' | 'CONNECTOR_TIMEOUT'> }>;

export class BoundedJsonResponse {
  async read(
    response: UpstreamWireResponse,
    operation: PreparedManifestOperation,
    signal: AbortSignal = new AbortController().signal,
    diagnostic?: UpstreamDiagnosticContext
  ): Promise<BoundedResponseResult> {
    const baseMetadata = {
      ...(diagnostic?.metadata ?? {}),
      httpStatusCategory: httpStatusCategory(response.statusCode),
      contentTypeCategory: contentTypeCategory(singleHeader(response.headers['content-type']))
    };
    const schemaFailed = (code: BoundedResponseResult extends infer _ ? 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_AUTH_FAILED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_RESPONSE_INVALID' | 'CONNECTOR_TIMEOUT' : never,
      metadata: Record<string, unknown> = {}): BoundedResponseResult => {
      diagnostic?.diagnostics.emit('UPSTREAM_RESPONSE_SCHEMA_FAILED', 'FAILED', {
        ...baseMetadata, ...metadata, failureCategory: code
      });
      return failure(code);
    };
    if (signal.aborted) { response.destroy?.(); return failure('CONNECTOR_TIMEOUT'); }
    const encoding = singleHeader(response.headers['content-encoding']);
    const contentType = singleHeader(response.headers['content-type']);
    if (encoding !== undefined && encoding.toLowerCase() !== 'identity') { response.destroy?.(); return schemaFailed('CONNECTOR_DESTINATION_REJECTED'); }
    if (!contentType || contentType.split(';', 1)[0]!.trim().toLowerCase() !== 'application/json') { response.destroy?.(); return schemaFailed('CONNECTOR_RESPONSE_INVALID'); }
    if (response.statusCode === 401 || response.statusCode === 403) { response.destroy?.(); return schemaFailed('CONNECTOR_UPSTREAM_AUTH_FAILED'); }
    if (!operation.response.acceptedHttpStatuses.includes(response.statusCode)) { response.destroy?.(); return schemaFailed('CONNECTOR_UPSTREAM_FAILED'); }
    const cap = Math.min(operation.limits.maxResponseBytes, CONNECTOR_LIMITS_V1.upstreamResponseBytes);
    const chunks: Buffer[] = []; let total = 0;
    try {
      for await (const item of response.body) {
        if (signal.aborted) { response.destroy?.(); return failure('CONNECTOR_TIMEOUT'); }
        const chunk = Buffer.from(item); total += chunk.byteLength;
        if (total > cap) { response.destroy?.(); return schemaFailed('CONNECTOR_RESPONSE_INVALID', { responseByteLength: total }); }
        chunks.push(chunk);
      }
      if (signal.aborted) { response.destroy?.(); return failure('CONNECTOR_TIMEOUT'); }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
      const value: unknown = JSON.parse(text);
      if (!boundedShape(value, operation.limits.maxDepth, operation.limits.maxItems, operation.limits.maxStringLength)) {
        return schemaFailed('CONNECTOR_RESPONSE_INVALID', { responseByteLength: total, jsonParsingPassed: true });
      }
      if (!plainObject(value)) return schemaFailed('CONNECTOR_RESPONSE_INVALID', { responseByteLength: total, jsonParsingPassed: true });
      const declaredPointers = operation.response.validationProfile === 'DECLARED_POINTERS_V1';
      const structure = safeStructure(value, operation);
      const applicationCode = applicationCodeValidation(value, operation, declaredPointers);
      const parsedMetadata = {
        responseByteLength: total,
        jsonParsingPassed: true,
        ...structure,
        applicationCodeValidationStatus: applicationCode.status
      };
      if (applicationCode.enforcement === 'MISSING' || applicationCode.enforcement === 'TYPE_INVALID') {
        return schemaFailed('CONNECTOR_RESPONSE_INVALID', parsedMetadata);
      }
      if (applicationCode.enforcement === 'REJECTED') {
        const mapped = operation.errorMap.find((entry) => entry.sourceCode === String(applicationCode.value))?.connectorCode;
        return schemaFailed(mapped === 'CONNECTOR_UPSTREAM_AUTH_FAILED' ? mapped : mapped === 'CONNECTOR_UPSTREAM_FAILED' ? mapped : 'CONNECTOR_RESPONSE_INVALID', parsedMetadata);
      }
      if (declaredPointers) {
        if (!declaredResponsePointersValid(value, operation)) return schemaFailed('CONNECTOR_RESPONSE_INVALID', parsedMetadata);
        diagnostic?.diagnostics.emit('UPSTREAM_RESPONSE_SCHEMA_VALIDATED', 'SUCCEEDED', {
          ...baseMetadata, ...parsedMetadata
        });
        return Object.freeze({ ok: true, value: deepFreeze(value) });
      }
      const schemaValue = operation.response.applicationCodePointer || applicationCode.value === undefined || operation.response.schema.type !== 'object' || operation.response.schema.properties.some((property) => property.name === 'code')
        ? value : Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'code'));
      const fullClosedSchemaValidation: 'PASS' | 'FAIL' = validateClosedJsonSchema(operation.response.schema, schemaValue)
        ? 'PASS'
        : 'FAIL';
      const validatedMetadata = { ...parsedMetadata, fullClosedSchemaValidation };
      if (fullClosedSchemaValidation === 'FAIL') return schemaFailed('CONNECTOR_RESPONSE_INVALID', validatedMetadata);
      diagnostic?.diagnostics.emit('UPSTREAM_RESPONSE_SCHEMA_VALIDATED', 'SUCCEEDED', {
        ...baseMetadata, ...validatedMetadata
      });
      return Object.freeze({ ok: true, value: deepFreeze(value) });
    } catch (error) {
      if (signal.aborted || error instanceof UpstreamResponseCancelledError) {
        response.destroy?.();
        return failure('CONNECTOR_TIMEOUT');
      }
      return schemaFailed('CONNECTOR_RESPONSE_INVALID', { responseByteLength: total, jsonParsingPassed: false });
    }
  }
}

function boundedShape(value: unknown, maxDepth: number, maxItems: number, maxString: number, depth = 0): boolean {
  if (depth > maxDepth) return false;
  if (typeof value === 'string') return value.length <= maxString;
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return true;
  if (Array.isArray(value)) return value.length <= maxItems && value.every((item) => boundedShape(item, maxDepth, maxItems, maxString, depth + 1));
  if (!plainObject(value)) return false;
  const entries = Object.entries(value); return entries.length <= 64 && entries.every(([key, item]) => key.length <= maxString && boundedShape(item, maxDepth, maxItems, maxString, depth + 1));
}
function plainObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function singleHeader(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function httpStatusCategory(status: number): string {
  if (status >= 200 && status < 300) return 'HTTP_2XX';
  if (status >= 400 && status < 500) return 'HTTP_4XX';
  if (status >= 500 && status < 600) return 'HTTP_5XX';
  return 'HTTP_OTHER';
}
function contentTypeCategory(value: string | undefined): string {
  if (!value) return 'CONTENT_TYPE_MISSING';
  return value.split(';', 1)[0]!.trim().toLowerCase() === 'application/json'
    ? 'APPLICATION_JSON'
    : 'CONTENT_TYPE_OTHER';
}
function safeStructure(value: unknown, operation: PreparedManifestOperation): Readonly<{
  responsePointerCount: number;
  responsePointerResolvedCount: number;
  responsePointerMissingCount: number;
  applicationCodePointerConfigured: boolean;
  applicationCodePointerResolved: boolean;
  declaredPointerSchemaCount: number;
  declaredPointerSchemaValidCount: number;
  declaredPointerSchemaInvalidCount: number;
}> {
  const responsePointers = [...new Set(operation.response.extraction
    .flatMap((entry) => 'sourcePointer' in entry &&
      (entry.source === undefined || entry.source === 'response_pointer') ? [entry.sourcePointer] : []))].slice(0, 64);
  const responsePointerCount = Math.min(responsePointers.length, 64);
  let responsePointerResolvedCount = 0;
  let declaredPointerSchemaValidCount = 0;
  let declaredPointerSchemaInvalidCount = 0;
  for (const path of responsePointers) {
    const pointerValue = valueAtJsonPointer(value, path);
    if (pointerValue === undefined) continue;
    responsePointerResolvedCount += 1;
    const pointerSchema = schemaAtJsonPointer(operation.response.schema, path);
    const corridor = operation.response.validationProfile === 'DECLARED_POINTERS_V1'
      ? resolveJsonPointerCorridor(operation.response.schema, value, path)
      : undefined;
    if (pointerSchema && validateClosedJsonSchema(pointerSchema, pointerValue) &&
      (operation.response.validationProfile !== 'DECLARED_POINTERS_V1' || corridor !== undefined)) declaredPointerSchemaValidCount += 1;
    else declaredPointerSchemaInvalidCount += 1;
  }
  const applicationCodePointerConfigured = operation.response.applicationCodePointer !== undefined;
  return Object.freeze({
    responsePointerCount,
    responsePointerResolvedCount,
    responsePointerMissingCount: responsePointerCount - responsePointerResolvedCount,
    applicationCodePointerConfigured,
    applicationCodePointerResolved: applicationCodePointerConfigured &&
      valueAtJsonPointer(value, operation.response.applicationCodePointer!) !== undefined,
    declaredPointerSchemaCount: responsePointerResolvedCount,
    declaredPointerSchemaValidCount,
    declaredPointerSchemaInvalidCount
  });
}
type ApplicationCodeValidation = Readonly<{
  status: 'NOT_CONFIGURED' | 'PASS' | 'MISSING' | 'TYPE_INVALID' | 'REJECTED';
  enforcement: 'PASS' | 'MISSING' | 'TYPE_INVALID' | 'REJECTED';
  value?: number;
}>;
function applicationCodeValidation(
  value: unknown,
  operation: PreparedManifestOperation,
  declaredPointers: boolean
): ApplicationCodeValidation {
  if (!operation.response.applicationCodePointer) {
    const legacyCode = plainObject(value) ? value.code : undefined;
    if (legacyCode === undefined) return Object.freeze({ status: 'NOT_CONFIGURED', enforcement: 'PASS' });
    if (!Number.isInteger(legacyCode)) return Object.freeze({ status: 'NOT_CONFIGURED', enforcement: 'TYPE_INVALID' });
    return Object.freeze({
      status: 'NOT_CONFIGURED',
      enforcement: operation.response.acceptedApplicationCodes.includes(legacyCode as number) ? 'PASS' : 'REJECTED',
      value: legacyCode as number
    });
  }
  const applicationCode = valueAtJsonPointer(value, operation.response.applicationCodePointer);
  if (applicationCode === undefined) return Object.freeze({ status: 'MISSING', enforcement: 'MISSING' });
  if (!Number.isInteger(applicationCode)) return Object.freeze({ status: 'TYPE_INVALID', enforcement: 'TYPE_INVALID' });
  if (declaredPointers) {
    const corridor = resolveJsonPointerCorridor(operation.response.schema, value, operation.response.applicationCodePointer);
    if (!corridor || !validateClosedJsonSchema(corridor.schema, corridor.value)) {
      return Object.freeze({ status: 'TYPE_INVALID', enforcement: 'TYPE_INVALID' });
    }
  }
  const enforcement = operation.response.acceptedApplicationCodes.includes(applicationCode as number) ? 'PASS' : 'REJECTED';
  return Object.freeze({
    status: enforcement,
    enforcement,
    value: applicationCode as number
  });
}
function declaredResponsePointersValid(value: unknown, operation: PreparedManifestOperation): boolean {
  const pointers = new Set(operation.response.extraction.flatMap((entry) =>
    entry.source === 'operation_key' || entry.source === 'fixed_query' ? [] : [entry.sourcePointer]));
  return [...pointers].every((pointer) => {
    const corridor = resolveJsonPointerCorridor(operation.response.schema, value, pointer);
    return corridor !== undefined && validateClosedJsonSchema(corridor.schema, corridor.value);
  });
}
function failure(code: BoundedResponseResult extends infer _ ? 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_AUTH_FAILED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_RESPONSE_INVALID' | 'CONNECTOR_TIMEOUT' : never): BoundedResponseResult { return Object.freeze({ ok: false, code }); }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as object)) deepFreeze(child); } return value; }
