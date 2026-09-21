import type {
  BoundedOperationArguments,
  ClosedJsonSchemaV1,
  ConnectorOperationManifestEntryV1,
  ConnectorOperationManifestV1
} from '@internal-ai-assistant/connector-runtime-contract';
import { RequestProfileRegistry, type MappedReadRequest } from './request-profile.registry';
import { validateClosedJsonSchema } from './closed-json-schema.validator';
import { jsonPointerSegments, schemaAtJsonPointer } from './json-pointer';

declare const preparedManifestOperationBrand: unique symbol;

export interface PreparedManifestOperation {
  readonly connectorKey: string;
  readonly operationKey: string;
  readonly contractVersion: string;
  readonly upstreamServiceRef: string;
  readonly credentialProfileRef: string;
  readonly request: MappedReadRequest;
  readonly response: ConnectorOperationManifestEntryV1['response'];
  readonly limits: ConnectorOperationManifestEntryV1['limits'];
  readonly errorMap: ConnectorOperationManifestEntryV1['errorMap'];
  readonly readinessDependency: string;
  readonly [preparedManifestOperationBrand]: true;
}

export type OperationPreparationResult =
  | Readonly<{ ok: true; value: PreparedManifestOperation }>
  | Readonly<{ ok: false; code: 'CONNECTOR_OPERATION_UNAVAILABLE' }>;

export class OperationManifestRegistry {
  private readonly entries = new Map<string, Readonly<{ connectorKey: string; operation: ConnectorOperationManifestEntryV1 }>>();
  readonly isValid: boolean;

  constructor(
    manifests: readonly ConnectorOperationManifestV1[],
    private readonly requestProfiles: RequestProfileRegistry = new RequestProfileRegistry()
  ) {
    let valid = manifests.length > 0 && requestProfiles.isValid;
    for (const manifest of manifests) {
      for (const operation of manifest.operations) {
        const identity = operationIdentity(manifest.connectorKey, operation.operationKey, operation.contractVersion);
        if (this.entries.has(identity) || !validOperation(operation, requestProfiles)) {
          valid = false;
          continue;
        }
        this.entries.set(identity, Object.freeze({ connectorKey: manifest.connectorKey, operation }));
      }
    }
    this.isValid = valid;
    if (!valid) this.entries.clear();
  }

  prepare(
    connectorKey: string,
    operationKey: string,
    contractVersion: string,
    rawArguments: BoundedOperationArguments
  ): OperationPreparationResult {
    if (!this.isValid) return failure();
    const selected = this.entries.get(operationIdentity(connectorKey, operationKey, contractVersion));
    if (!selected || selected.operation.readOnly !== true || !plainObject(rawArguments)) return failure();
    const args = rawArguments as Readonly<Record<string, unknown>>;
    if (!validateClosedJsonSchema(selected.operation.inputSchema, args)) return failure();
    const request = this.requestProfiles.map(selected.operation, args);
    if (!request) return failure();
    const operation = selected.operation;
    return Object.freeze({ ok: true, value: deepFreeze({
      connectorKey: selected.connectorKey,
      operationKey: operation.operationKey,
      contractVersion: operation.contractVersion,
      upstreamServiceRef: operation.upstreamServiceRef,
      credentialProfileRef: operation.credentialProfileRef,
      request,
      response: operation.response,
      limits: operation.limits,
      errorMap: operation.errorMap,
      readinessDependency: operation.readinessDependency
    }) as PreparedManifestOperation });
  }

  credentialProfileRefs(): readonly string[] {
    if (!this.isValid) return Object.freeze([]);
    return Object.freeze([...new Set([...this.entries.values()].map((entry) => entry.operation.credentialProfileRef))]);
  }

  upstreamServiceRefs(): readonly string[] {
    if (!this.isValid) return Object.freeze([]);
    return Object.freeze([...new Set([...this.entries.values()].map((entry) => entry.operation.upstreamServiceRef))]);
  }

}

function validOperation(operation: ConnectorOperationManifestEntryV1, profiles: RequestProfileRegistry): boolean {
  if (operation.readOnly !== true || operation.inputSchema.type !== 'object' || !profiles.supports(operation.request.profile)) return false;
  const schemaNames = new Set(operation.inputSchema.properties.map((property) => property.name));
  const mappedArguments = new Set(operation.request.argumentMappings.map((mapping) => mapping.argument));
  if (schemaNames.size !== mappedArguments.size || [...schemaNames].some((name) => !mappedArguments.has(name))) return false;
  const fixedNames = new Set((operation.request.profile === 'GET_QUERY_V1'
    ? operation.request.fixedQuery : operation.request.fixedBody).map((entry) => entry.name));
  return operation.request.argumentMappings.every((mapping) => !fixedNames.has(mapping.name)) && validResponse(operation);
}

function validResponse(operation: ConnectorOperationManifestEntryV1): boolean {
  const declaredPointers = operation.response.validationProfile === 'DECLARED_POINTERS_V1';
  if (declaredPointers && !operation.response.applicationCodePointer) return false;
  if (operation.response.applicationCodePointer) {
    const applicationCode = schemaAtJsonPointer(operation.response.schema, operation.response.applicationCodePointer);
    if (!applicationCode || applicationCode.type !== 'integer' || applicationCode.nullable === true) return false;
  }
  const extractionsValid = operation.response.extraction.every((extraction) => {
    if (extraction.source === 'operation_key') return extraction.conversion === 'string';
    if (extraction.source === 'fixed_query') {
      return extraction.conversion === 'string' && operation.request.profile === 'GET_QUERY_V1' &&
        operation.request.fixedQuery.some((entry) => entry.name === extraction.queryName);
    }
    const source = schemaAtJsonPointer(operation.response.schema, extraction.sourcePointer);
    if (!source || declaredPointers && 'nullable' in source && source.nullable === true) return false;
    if (extraction.conversion === 'string') return source.type === 'string';
    if (extraction.conversion === 'boolean') return source.type === 'boolean';
    if (extraction.conversion === 'number') return source.type === 'number' || source.type === 'integer';
    if (extraction.conversion === 'integer') return source.type === 'integer';
    return source.type === 'integer' && source.minimum !== undefined && source.minimum >= 0;
  });
  if (!extractionsValid || !declaredPointers) return extractionsValid;
  const pointers = [
    operation.response.applicationCodePointer!,
    ...operation.response.extraction.flatMap((extraction) =>
      extraction.source === 'operation_key' || extraction.source === 'fixed_query' ? [] : [extraction.sourcePointer])
  ];
  return schemaExactlyMatchesPointerTree(operation.response.schema, pointers);
}

interface PointerTree { terminal: boolean; readonly children: Map<string, PointerTree> }

function schemaExactlyMatchesPointerTree(schema: ClosedJsonSchemaV1, pointers: readonly string[]): boolean {
  const root: PointerTree = { terminal: false, children: new Map() };
  for (const pointer of new Set(pointers)) {
    let node = root;
    for (const segment of jsonPointerSegments(pointer)) {
      let child = node.children.get(segment);
      if (!child) {
        child = { terminal: false, children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.terminal = true;
  }
  return schemaMatchesPointerTreeNode(schema, root);
}

function schemaMatchesPointerTreeNode(schema: ClosedJsonSchemaV1, node: PointerTree): boolean {
  if (node.terminal) return node.children.size === 0;
  if (schema.type === 'object') {
    const required = new Set(schema.required);
    if (schema.properties.length !== node.children.size || required.size !== node.children.size) return false;
    return schema.properties.every((property) => {
      const child = node.children.get(property.name);
      return required.has(property.name) && child !== undefined && schemaMatchesPointerTreeNode(property.schema, child);
    });
  }
  if (schema.type === 'array') {
    return node.children.size > 0 && [...node.children.entries()].every(([segment, child]) =>
      /^(?:0|[1-9][0-9]*)$/.test(segment) && schemaMatchesPointerTreeNode(schema.items, child));
  }
  return false;
}

function plainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function operationIdentity(connector: string, operation: string, version: string): string {
  return `${connector}\0${operation}\0${version}`;
}
function failure(): OperationPreparationResult {
  return Object.freeze({ ok: false, code: 'CONNECTOR_OPERATION_UNAVAILABLE' });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
