import { CONNECTOR_LIMITS_V1, type ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';
import { validateClosedJsonSchema } from '../manifest/closed-json-schema.validator';
import type { PreparedManifestOperation } from '../manifest/operation-manifest.registry';
import { UpstreamResponseCancelledError, type UpstreamWireResponse } from './safe-upstream-http-client';

export type BoundedResponseResult = Readonly<{ ok: true; value: Readonly<Record<string, unknown>> }> |
  Readonly<{ ok: false; code: Extract<ConnectorErrorCode, 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_AUTH_FAILED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_RESPONSE_INVALID' | 'CONNECTOR_TIMEOUT'> }>;

export class BoundedJsonResponse {
  async read(response: UpstreamWireResponse, operation: PreparedManifestOperation, signal: AbortSignal = new AbortController().signal): Promise<BoundedResponseResult> {
    if (signal.aborted) { response.destroy?.(); return failure('CONNECTOR_TIMEOUT'); }
    const encoding = singleHeader(response.headers['content-encoding']);
    const contentType = singleHeader(response.headers['content-type']);
    if (encoding !== undefined && encoding.toLowerCase() !== 'identity') { response.destroy?.(); return failure('CONNECTOR_DESTINATION_REJECTED'); }
    if (!contentType || contentType.split(';', 1)[0]!.trim().toLowerCase() !== 'application/json') { response.destroy?.(); return failure('CONNECTOR_RESPONSE_INVALID'); }
    if (response.statusCode === 401 || response.statusCode === 403) { response.destroy?.(); return failure('CONNECTOR_UPSTREAM_AUTH_FAILED'); }
    if (!operation.response.acceptedHttpStatuses.includes(response.statusCode)) { response.destroy?.(); return failure('CONNECTOR_UPSTREAM_FAILED'); }
    const cap = Math.min(operation.limits.maxResponseBytes, CONNECTOR_LIMITS_V1.upstreamResponseBytes);
    const chunks: Buffer[] = []; let total = 0;
    try {
      for await (const item of response.body) {
        if (signal.aborted) { response.destroy?.(); return failure('CONNECTOR_TIMEOUT'); }
        const chunk = Buffer.from(item); total += chunk.byteLength;
        if (total > cap) { response.destroy?.(); return failure('CONNECTOR_RESPONSE_INVALID'); }
        chunks.push(chunk);
      }
      if (signal.aborted) { response.destroy?.(); return failure('CONNECTOR_TIMEOUT'); }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
      const value: unknown = JSON.parse(text);
      if (!boundedShape(value, operation.limits.maxDepth, operation.limits.maxItems, operation.limits.maxStringLength)) return failure('CONNECTOR_RESPONSE_INVALID');
      if (!plainObject(value)) return failure('CONNECTOR_RESPONSE_INVALID');
      const applicationCode = value.code;
      if (applicationCode !== undefined) {
        if (!Number.isInteger(applicationCode)) return failure('CONNECTOR_RESPONSE_INVALID');
        if (!operation.response.acceptedApplicationCodes.includes(applicationCode as number)) {
          const mapped = operation.errorMap.find((entry) => entry.sourceCode === String(applicationCode))?.connectorCode;
          return failure(mapped === 'CONNECTOR_UPSTREAM_AUTH_FAILED' ? mapped : mapped === 'CONNECTOR_UPSTREAM_FAILED' ? mapped : 'CONNECTOR_RESPONSE_INVALID');
        }
      }
      const schemaValue = applicationCode === undefined || operation.response.schema.type !== 'object' || operation.response.schema.properties.some((property) => property.name === 'code')
        ? value : Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'code'));
      if (!validateClosedJsonSchema(operation.response.schema, schemaValue)) return failure('CONNECTOR_RESPONSE_INVALID');
      return Object.freeze({ ok: true, value: deepFreeze(value) });
    } catch (error) {
      if (signal.aborted || error instanceof UpstreamResponseCancelledError) {
        response.destroy?.();
        return failure('CONNECTOR_TIMEOUT');
      }
      return failure('CONNECTOR_RESPONSE_INVALID');
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
function failure(code: BoundedResponseResult extends infer _ ? 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_AUTH_FAILED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_RESPONSE_INVALID' | 'CONNECTOR_TIMEOUT' : never): BoundedResponseResult { return Object.freeze({ ok: false, code }); }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as object)) deepFreeze(child); } return value; }
