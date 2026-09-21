import type {
  BindingBootstrapProfileContract,
  ConnectorBindingBootstrapRequestV1,
  ConnectorBindingBootstrapResponseV1,
  ConnectorBindingTrustedContextV1,
  ConnectorContractParseFailure,
  ConnectorContractParseResult,
  ConnectorInvocationRequestV1,
  ConnectorInvocationResponseV1,
  ConnectorInvocationTrustedContextV1,
  BoundedOperationArguments,
  ValidatedProviderPayload
} from './wire.types';
import { isConnectorErrorCode } from '../errors';
import {
  boundedJsonByteLength,
  CONNECTOR_LIMITS_V1,
  isValidBindingProviderPayloadLimit,
  isValidConnectorTransportBudget,
  validateBoundedJsonValue
} from '../limits';

export const CONNECTOR_INVOCATION_MAX_REQUEST_BYTES = CONNECTOR_LIMITS_V1.invocationRequestBytes;
export const CONNECTOR_BINDING_MAX_REQUEST_BYTES = CONNECTOR_LIMITS_V1.bindingRequestBytes;
export const CONNECTOR_INVOCATION_MAX_RESPONSE_BYTES = CONNECTOR_LIMITS_V1.invocationResponseBytes;
export const CONNECTOR_BINDING_MAX_RESPONSE_BYTES = CONNECTOR_LIMITS_V1.bindingResponseBytes;

const FAILURE: ConnectorContractParseFailure = Object.freeze({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' });
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTRACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const CONNECTOR_REFERENCE = /^ccr_[A-Za-z0-9_-]{1,128}$/;

export function parseConnectorInvocationRequestV1(bytes: Uint8Array): ConnectorContractParseResult<ConnectorInvocationRequestV1> {
  const value = parseJsonBytes(bytes, CONNECTOR_INVOCATION_MAX_REQUEST_BYTES);
  if (!isExactObject(value, ['version', 'requestId', 'remainingBudgetMs', 'trustedContext', 'operation', 'connectorContextRef'])) return FAILURE;
  const context = parseInvocationContext(value.trustedContext);
  const operation = value.operation;
  if (
    value.version !== '1' || !isIdentifier(value.requestId) || !isValidConnectorTransportBudget(value.remainingBudgetMs) ||
    !context || !isExactObject(operation, ['key', 'version', 'arguments']) || !isIdentifier(operation.key) ||
    typeof operation.version !== 'string' || !CONTRACT_VERSION.test(operation.version) || !isBoundedJsonObject(operation.arguments) ||
    typeof value.connectorContextRef !== 'string' || !CONNECTOR_REFERENCE.test(value.connectorContextRef)
  ) return FAILURE;

  return success(deepFreeze({
    version: '1', requestId: value.requestId, remainingBudgetMs: value.remainingBudgetMs,
    trustedContext: context,
    operation: { key: operation.key, version: operation.version, arguments: operation.arguments as BoundedOperationArguments },
    connectorContextRef: value.connectorContextRef
  }) as ConnectorInvocationRequestV1);
}

export function parseConnectorBindingBootstrapRequestV1<TProfileKey extends string, TPayload>(
  bytes: Uint8Array,
  profile: BindingBootstrapProfileContract<TProfileKey, TPayload>
): ConnectorContractParseResult<ConnectorBindingBootstrapRequestV1<TProfileKey, TPayload>> {
  const value = parseJsonBytes(bytes, CONNECTOR_BINDING_MAX_REQUEST_BYTES);
  if (!isExactObject(value, ['version', 'requestId', 'bootstrapProfileKey', 'trustedContext', 'providerPayload'])) return FAILURE;
  const context = parseBindingContext(value.trustedContext);
  if (value.version !== '1' || !isIdentifier(value.requestId) || value.bootstrapProfileKey !== profile.profileKey || !context) return FAILURE;
  if (!isValidBindingProviderPayloadLimit(profile.maxProviderPayloadBytes)) return FAILURE;
  if (!validateProviderPayloadStructure(value.providerPayload) || boundedJsonByteLength(value.providerPayload) > profile.maxProviderPayloadBytes) return FAILURE;
  try {
    const payload = profile.parseProviderPayload(value.providerPayload);
    if (!payload.ok) return FAILURE;
    return success(deepFreeze({
      version: '1', requestId: value.requestId, bootstrapProfileKey: profile.profileKey,
      trustedContext: context, providerPayload: payload.value as ValidatedProviderPayload<TProfileKey, TPayload>
    }) as ConnectorBindingBootstrapRequestV1<TProfileKey, TPayload>);
  } catch {
    return FAILURE;
  }
}

export function parseConnectorInvocationResponseV1(bytes: Uint8Array, expectedRequestId: string): ConnectorContractParseResult<ConnectorInvocationResponseV1> {
  const value = parseJsonBytes(bytes, CONNECTOR_INVOCATION_MAX_RESPONSE_BYTES);
  if (!isIdentifier(expectedRequestId) || !isPlainObject(value) || value.version !== '1' || value.requestId !== expectedRequestId) return FAILURE;
  if (value.status === 'succeeded' && isExactObject(value, ['version', 'requestId', 'status', 'result']) && isBoundedJsonObject(value.result)) {
    return success(deepFreeze(value) as unknown as ConnectorInvocationResponseV1);
  }
  if (isFailureEnvelope(value)) return success(deepFreeze(value) as unknown as ConnectorInvocationResponseV1);
  return FAILURE;
}

export function parseConnectorBindingBootstrapResponseV1(bytes: Uint8Array, expectedRequestId: string): ConnectorContractParseResult<ConnectorBindingBootstrapResponseV1> {
  const value = parseJsonBytes(bytes, CONNECTOR_BINDING_MAX_RESPONSE_BYTES);
  if (!isIdentifier(expectedRequestId) || !isPlainObject(value) || value.version !== '1' || value.requestId !== expectedRequestId) return FAILURE;
  if (
    isExactObject(value, ['version', 'requestId', 'connectorContextRef', 'expiresIn']) &&
    typeof value.connectorContextRef === 'string' && CONNECTOR_REFERENCE.test(value.connectorContextRef) &&
    isIntegerInRange(value.expiresIn, 1, 120)
  ) return success(deepFreeze(value) as unknown as ConnectorBindingBootstrapResponseV1);
  if (isFailureEnvelope(value)) return success(deepFreeze(value) as unknown as ConnectorBindingBootstrapResponseV1);
  return FAILURE;
}

function parseInvocationContext(value: unknown): ConnectorInvocationTrustedContextV1 | undefined {
  const keys = ['customerId', 'integrationId', 'hostApp', 'organizationId', 'actorId', 'connectorKey', 'connectorInstanceId'];
  if (!isExactObject(value, keys) || !keys.every((key) => isIdentifier(value[key]))) return undefined;
  return deepFreeze(value) as unknown as ConnectorInvocationTrustedContextV1;
}

function parseBindingContext(value: unknown): ConnectorBindingTrustedContextV1 | undefined {
  if (!isPlainObject(value)) return undefined;
  const required = ['customerId', 'integrationId', 'hostApp', 'connectorInstanceId'];
  const optional = ['organizationId', 'actorId'];
  if (!hasOnlyKeys(value, [...required, ...optional]) || !required.every((key) => isIdentifier(value[key]))) return undefined;
  if (!optional.every((key) => value[key] === undefined || isIdentifier(value[key]))) return undefined;
  return deepFreeze(value) as unknown as ConnectorBindingTrustedContextV1;
}

function isFailureEnvelope(value: { readonly [key: string]: unknown }): boolean {
  return isExactObject(value, ['version', 'requestId', 'status', 'error']) && value.status === 'failed' &&
    isExactObject(value.error, ['code']) && isConnectorErrorCode(value.error.code);
}

function parseJsonBytes(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > maximum) return undefined;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: { readonly [key: string]: unknown }, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isExactObject(value: unknown, keys: readonly string[]): value is { readonly [key: string]: unknown } {
  return isPlainObject(value) && Object.keys(value).length === keys.length && hasOnlyKeys(value, keys) && keys.every((key) => key in value);
}

function isBoundedJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return isPlainObject(value) && validateBoundedJsonValue(value);
}

function validateProviderPayloadStructure(value: unknown, depth = 0): boolean {
  if (depth > CONNECTOR_LIMITS_V1.maximumJsonDepth) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= CONNECTOR_LIMITS_V1.maximumArrayItems &&
      value.every((item) => validateProviderPayloadStructure(item, depth + 1));
  }
  if (!isPlainObject(value) || Object.keys(value).length > CONNECTOR_LIMITS_V1.maximumObjectKeys) return false;
  return Object.entries(value).every(([key, item]) => key.length > 0 && key.length <= 128 &&
    validateProviderPayloadStructure(item, depth + 1));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

function success<T>(value: T): ConnectorContractParseResult<T> {
  return Object.freeze({ ok: true as const, value });
}
