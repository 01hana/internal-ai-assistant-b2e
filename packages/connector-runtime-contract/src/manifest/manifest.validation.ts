import { isConnectorErrorCode } from '../errors';
import { CONNECTOR_LIMITS_V1, validateBoundedJsonValue } from '../limits';
import type { ConnectorContractParseResult } from '../wire';
import type {
  ArgumentMappingV1,
  ClosedJsonSchemaV1,
  ConnectorOperationManifestEntryV1,
  ConnectorOperationManifestV1,
  DeclarativeExtractionV1,
  ReadRequestProfileV1,
  FixedJsonBodyV1,
  FixedQueryValuesV1,
  NormalizedRelativePath,
  ResponseValidationProfileV1
} from './manifest.types';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const RELATIVE_PATH = /^\/(?!\/)(?!.*[?#\\:])[A-Za-z0-9._~!$&'()*+,;=@%/-]*$/;
const JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)+$/;
const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
const CONVERSIONS = new Set(['string', 'integer', 'number', 'boolean', 'non_negative_integer']);
const RESPONSE_VALIDATION_PROFILES: ReadonlySet<ResponseValidationProfileV1> = new Set(['FULL_CLOSED_SCHEMA_V1', 'DECLARED_POINTERS_V1']);

export function parseConnectorOperationManifestV1(input: unknown): ConnectorContractParseResult<ConnectorOperationManifestV1> {
  if (!isExactObject(input, ['version', 'connectorKey', 'operations']) || input.version !== '1' ||
      !isIdentifier(input.connectorKey) || !Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 100) return failure();
  const operations: ConnectorOperationManifestEntryV1[] = [];
  const identities = new Set<string>();
  for (const candidate of input.operations) {
    const parsed = parseOperation(candidate);
    if (!parsed) return failure();
    const identity = `${parsed.operationKey}\0${parsed.contractVersion}`;
    if (identities.has(identity)) return failure();
    identities.add(identity);
    operations.push(parsed);
  }
  return ok(deepFreeze({ version: '1', connectorKey: input.connectorKey, operations }) as unknown as ConnectorOperationManifestV1);
}

function parseOperation(value: unknown): ConnectorOperationManifestEntryV1 | undefined {
  const keys = ['operationKey', 'contractVersion', 'inputSchema', 'upstreamServiceRef', 'request', 'credentialProfileRef',
    'readOnly', 'response', 'limits', 'errorMap', 'readinessDependency'];
  if (!isExactObject(value, keys) || !isIdentifier(value.operationKey) || typeof value.contractVersion !== 'string' || !SEMVER.test(value.contractVersion) ||
      !isIdentifier(value.upstreamServiceRef) || !isIdentifier(value.credentialProfileRef) || value.readOnly !== true || !isIdentifier(value.readinessDependency)) return undefined;
  const inputSchema = parseSchema(value.inputSchema);
  if (!inputSchema) return undefined;
  const request = parseRequest(value.request, inputSchema);
  const response = parseResponse(value.response);
  const limits = parseLimits(value.limits);
  const errorMap = parseErrorMap(value.errorMap);
  if (!request || !response || !limits || !errorMap) return undefined;
  return deepFreeze({
    operationKey: value.operationKey, contractVersion: value.contractVersion, inputSchema,
    upstreamServiceRef: value.upstreamServiceRef, request, credentialProfileRef: value.credentialProfileRef,
    readOnly: true, response, limits, errorMap, readinessDependency: value.readinessDependency
  });
}

function parseRequest(value: unknown, inputSchema: ClosedJsonSchemaV1): ReadRequestProfileV1 | undefined {
  if (!isPlainJsonObject(value) || typeof value.profile !== 'string' || typeof value.path !== 'string' || !isNormalizedRelativePath(value.path)) return undefined;
  if (value.profile === 'GET_QUERY_V1') {
    if (!isExactObject(value, ['profile', 'path', 'fixedQuery', 'argumentMappings'])) return undefined;
    const fixedQuery = parseFixedQuery(value.fixedQuery);
    if (!fixedQuery) return undefined;
    const mappings = parseMappings(value.argumentMappings, 'query', inputSchema);
    if (!mappings) return undefined;
    return deepFreeze({ profile: 'GET_QUERY_V1', path: value.path as NormalizedRelativePath, fixedQuery, argumentMappings: mappings });
  }
  if (value.profile === 'POST_QUERY_JSON_V1') {
    if (!isExactObject(value, ['profile', 'path', 'fixedBody', 'argumentMappings'])) return undefined;
    const fixedBody = parseFixedBody(value.fixedBody);
    if (!fixedBody) return undefined;
    const mappings = parseMappings(value.argumentMappings, 'body', inputSchema);
    if (!mappings) return undefined;
    return deepFreeze({ profile: 'POST_QUERY_JSON_V1', path: value.path as NormalizedRelativePath, fixedBody, argumentMappings: mappings });
  }
  return undefined;
}

function parseMappings(value: unknown, target: 'query' | 'body', schema: ClosedJsonSchemaV1): readonly ArgumentMappingV1[] | undefined {
  if (!Array.isArray(value) || value.length > 64 || schema.type !== 'object') return undefined;
  const mappings: ArgumentMappingV1[] = [];
  const argumentsSeen = new Set<string>();
  const namesSeen = new Set<string>();
  for (const mapping of value) {
    if (!isExactObject(mapping, ['argument', 'target', 'name', 'scalarType']) || !isIdentifier(mapping.argument) || mapping.target !== target ||
        !isIdentifier(mapping.name) || typeof mapping.scalarType !== 'string' || !SCALAR_TYPES.has(mapping.scalarType) ||
        argumentsSeen.has(mapping.argument) || namesSeen.has(mapping.name)) return undefined;
    const argumentSchema = schema.properties.find((property) => property.name === mapping.argument)?.schema;
    if (!argumentSchema || argumentSchema.type !== mapping.scalarType) return undefined;
    argumentsSeen.add(mapping.argument);
    namesSeen.add(mapping.name);
    mappings.push(mapping as unknown as ArgumentMappingV1);
  }
  return deepFreeze(mappings);
}

function parseResponse(value: unknown): ConnectorOperationManifestEntryV1['response'] | undefined {
  if (!isPlainJsonObject(value) || !hasOnlyKeys(value, ['validationProfile', 'acceptedHttpStatuses', 'acceptedApplicationCodes', 'applicationCodePointer', 'contentType', 'schema', 'extraction']) ||
      !['acceptedHttpStatuses', 'acceptedApplicationCodes', 'contentType', 'schema', 'extraction'].every((key) => key in value) ||
      value.contentType !== 'application/json' || !isIntegerArray(value.acceptedHttpStatuses, 100, 599) ||
      !isIntegerArray(value.acceptedApplicationCodes, 0, 999_999) ||
      value.validationProfile !== undefined && !isResponseValidationProfile(value.validationProfile) ||
      value.applicationCodePointer !== undefined && (typeof value.applicationCodePointer !== 'string' || !JSON_POINTER.test(value.applicationCodePointer))) return undefined;
  const schema = parseSchema(value.schema);
  const extraction = parseExtractions(value.extraction);
  if (!schema || !extraction) return undefined;
  return deepFreeze({
    ...(value.validationProfile === undefined ? {} : { validationProfile: value.validationProfile }),
    acceptedHttpStatuses: value.acceptedHttpStatuses,
    acceptedApplicationCodes: value.acceptedApplicationCodes,
    ...(value.applicationCodePointer === undefined ? {} : { applicationCodePointer: value.applicationCodePointer }),
    contentType: 'application/json', schema, extraction
  });
}

function parseExtractions(value: unknown): readonly DeclarativeExtractionV1[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) return undefined;
  const targets = new Set<string>();
  const result: DeclarativeExtractionV1[] = [];
  for (const item of value) {
    if (!isPlainJsonObject(item) || !isIdentifier(item.targetField) || targets.has(item.targetField)) return undefined;
    if (item.source === undefined || item.source === 'response_pointer') {
      const keys = item.source === undefined ? ['sourcePointer', 'targetField', 'conversion'] : ['source', 'sourcePointer', 'targetField', 'conversion'];
      if (!isExactObject(item, keys) || typeof item.sourcePointer !== 'string' || !JSON_POINTER.test(item.sourcePointer) ||
          typeof item.conversion !== 'string' || !CONVERSIONS.has(item.conversion)) return undefined;
    } else if (item.source === 'operation_key') {
      if (!isExactObject(item, ['source', 'targetField', 'conversion']) || item.conversion !== 'string') return undefined;
    } else if (item.source === 'fixed_query') {
      if (!isExactObject(item, ['source', 'queryName', 'targetField', 'conversion']) || !isIdentifier(item.queryName) || item.conversion !== 'string') return undefined;
    } else {
      return undefined;
    }
    targets.add(item.targetField);
    result.push(item as unknown as DeclarativeExtractionV1);
  }
  return deepFreeze(result);
}

function parseLimits(value: unknown): ConnectorOperationManifestEntryV1['limits'] | undefined {
  const keys = ['maxRequestBytes', 'maxResponseBytes', 'maxDepth', 'maxItems', 'maxStringLength', 'timeoutMs'];
  if (!isExactObject(value, keys)) return undefined;
  const bounds: readonly [string, number][] = [
    ['maxRequestBytes', CONNECTOR_LIMITS_V1.invocationRequestBytes], ['maxResponseBytes', CONNECTOR_LIMITS_V1.upstreamResponseBytes],
    ['maxDepth', CONNECTOR_LIMITS_V1.maximumJsonDepth], ['maxItems', CONNECTOR_LIMITS_V1.maximumArrayItems],
    ['maxStringLength', CONNECTOR_LIMITS_V1.maximumStringLength], ['timeoutMs', CONNECTOR_LIMITS_V1.maximumTransportBudgetMs]
  ];
  if (!bounds.every(([key, maximum]) => Number.isInteger(value[key]) && (value[key] as number) >= 1 && (value[key] as number) <= maximum)) return undefined;
  return deepFreeze(value) as unknown as ConnectorOperationManifestEntryV1['limits'];
}

function parseErrorMap(value: unknown): ConnectorOperationManifestEntryV1['errorMap'] | undefined {
  if (!isPlainJsonObject(value) || Object.keys(value).length > 64) return undefined;
  if (!Object.entries(value).every(([key, code]) => isIdentifier(key) && isConnectorErrorCode(code))) return undefined;
  return deepFreeze(Object.entries(value).map(([sourceCode, connectorCode]) => ({ sourceCode, connectorCode }))) as ConnectorOperationManifestEntryV1['errorMap'];
}

function parseSchema(value: unknown, depth = 0): ClosedJsonSchemaV1 | undefined {
  if (!isPlainJsonObject(value) || depth > CONNECTOR_LIMITS_V1.maximumJsonDepth || typeof value.type !== 'string') return undefined;
  if (value.type === 'object') {
    if (!isExactObject(value, ['type', 'properties', 'required', 'additionalProperties']) || value.additionalProperties !== false ||
        !isPlainJsonObject(value.properties) || Object.keys(value.properties).length > CONNECTOR_LIMITS_V1.maximumObjectKeys ||
        !Array.isArray(value.required) || !value.required.every(isIdentifier) || new Set(value.required).size !== value.required.length) return undefined;
    const properties: { name: string; schema: ClosedJsonSchemaV1 }[] = [];
    for (const [key, schema] of Object.entries(value.properties)) {
      if (!isIdentifier(key)) return undefined;
      const parsed = parseSchema(schema, depth + 1);
      if (!parsed) return undefined;
      properties.push({ name: key, schema: parsed });
    }
    if (!value.required.every((key) => properties.some((property) => property.name === key))) return undefined;
    return deepFreeze({ type: 'object', properties, required: value.required, additionalProperties: false });
  }
  if (value.type === 'string') {
    if (!hasOnlyKeys(value, ['type', 'minLength', 'maxLength', 'nullable']) || !validOptionalNullable(value.nullable) || !validOptionalInteger(value.minLength, 0, CONNECTOR_LIMITS_V1.maximumStringLength) ||
        !validOptionalInteger(value.maxLength, 1, CONNECTOR_LIMITS_V1.maximumStringLength) ||
        typeof value.minLength === 'number' && typeof value.maxLength === 'number' && value.minLength > value.maxLength) return undefined;
    return deepFreeze(value) as unknown as ClosedJsonSchemaV1;
  }
  if (value.type === 'integer' || value.type === 'number') {
    if (!hasOnlyKeys(value, ['type', 'minimum', 'maximum', 'nullable']) || !validOptionalNullable(value.nullable) || !validOptionalNumber(value.minimum) || !validOptionalNumber(value.maximum) ||
        typeof value.minimum === 'number' && typeof value.maximum === 'number' && value.minimum > value.maximum) return undefined;
    return deepFreeze(value) as unknown as ClosedJsonSchemaV1;
  }
  if (value.type === 'boolean') return hasOnlyKeys(value, ['type', 'nullable']) && validOptionalNullable(value.nullable) ? deepFreeze(value) as unknown as ClosedJsonSchemaV1 : undefined;
  if (value.type === 'array') {
    if (!isExactObject(value, ['type', 'items', 'maxItems']) || !Number.isInteger(value.maxItems) || (value.maxItems as number) < 1 ||
        (value.maxItems as number) > CONNECTOR_LIMITS_V1.maximumArrayItems) return undefined;
    const items = parseSchema(value.items, depth + 1);
    return items ? deepFreeze({ type: 'array', items, maxItems: value.maxItems as number }) : undefined;
  }
  return undefined;
}

function parseFixedQuery(value: unknown): FixedQueryValuesV1 | undefined {
  if (!isPlainJsonObject(value) || Object.keys(value).length > 64 || !Object.entries(value).every(([key, item]) => isIdentifier(key) && typeof item === 'string' && item.length <= 1_024)) return undefined;
  return deepFreeze(Object.entries(value).map(([name, item]) => ({ name, value: item as string }))) as unknown as FixedQueryValuesV1;
}
function parseFixedBody(value: unknown): FixedJsonBodyV1 | undefined {
  if (!isPlainJsonObject(value) || Object.keys(value).length > 64 || !Object.entries(value).every(([key, item]) => isIdentifier(key) &&
    (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item))) || !validateBoundedJsonValue(value)) return undefined;
  return deepFreeze(Object.entries(value).map(([name, item]) => ({ name, value: item as import('../limits').BoundedJsonScalar }))) as unknown as FixedJsonBodyV1;
}
function isIntegerArray(value: unknown, minimum: number, maximum: number): value is readonly number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 64 && new Set(value).size === value.length &&
    value.every((item) => Number.isInteger(item) && item >= minimum && item <= maximum);
}
function validOptionalInteger(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}
function validOptionalNumber(value: unknown): boolean { return value === undefined || typeof value === 'number' && Number.isFinite(value); }
function validOptionalNullable(value: unknown): boolean { return value === undefined || value === true; }
function isResponseValidationProfile(value: unknown): value is ResponseValidationProfileV1 {
  return typeof value === 'string' && RESPONSE_VALIDATION_PROFILES.has(value as ResponseValidationProfileV1);
}
function isNormalizedRelativePath(value: string): boolean {
  if (!RELATIVE_PATH.test(value) || value.includes('//') || /%(?:2f|5c)/i.test(value)) return false;
  try {
    return value.split('/').slice(1).every((segment) => {
      const decoded = decodeURIComponent(segment);
      return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\');
    });
  } catch {
    return false;
  }
}
function isIdentifier(value: unknown): value is string { return typeof value === 'string' && IDENTIFIER.test(value); }
function isPlainJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasOnlyKeys(value: { readonly [key: string]: unknown }, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
function isExactObject(value: unknown, keys: readonly string[]): value is { readonly [key: string]: unknown } {
  return isPlainJsonObject(value) && Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
function failure(): Readonly<{ ok: false; code: 'CONNECTOR_REQUEST_INVALID' }> { return Object.freeze({ ok: false, code: 'CONNECTOR_REQUEST_INVALID' }); }
function ok<T>(value: T): ConnectorContractParseResult<T> { return Object.freeze({ ok: true, value }); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
