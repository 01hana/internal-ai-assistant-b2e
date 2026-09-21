import type { BoundedJsonScalar } from '../limits';
import type { ConnectorErrorCode } from '../errors';

export type ClosedJsonSchemaV1 =
  | Readonly<{ type: 'object'; properties: readonly ClosedJsonSchemaPropertyV1[]; required: readonly string[]; additionalProperties: false }>
  | Readonly<{ type: 'string'; minLength?: number; maxLength?: number; nullable?: true }>
  | Readonly<{ type: 'integer' | 'number'; minimum?: number; maximum?: number; nullable?: true }>
  | Readonly<{ type: 'boolean'; nullable?: true }>
  | Readonly<{ type: 'array'; items: ClosedJsonSchemaV1; maxItems: number }>;

export interface ClosedJsonSchemaPropertyV1 { readonly name: string; readonly schema: ClosedJsonSchemaV1 }

export type ArgumentScalarTypeV1 = 'string' | 'integer' | 'number' | 'boolean';
export interface ArgumentMappingV1 {
  readonly argument: string;
  readonly target: 'query' | 'body';
  readonly name: string;
  readonly scalarType: ArgumentScalarTypeV1;
}

export interface GetQueryRequestProfileV1 {
  readonly profile: 'GET_QUERY_V1';
  readonly path: NormalizedRelativePath;
  readonly fixedQuery: FixedQueryValuesV1;
  readonly argumentMappings: readonly ArgumentMappingV1[];
}

export interface PostQueryJsonRequestProfileV1 {
  readonly profile: 'POST_QUERY_JSON_V1';
  readonly path: NormalizedRelativePath;
  readonly fixedBody: FixedJsonBodyV1;
  readonly argumentMappings: readonly ArgumentMappingV1[];
}

export type ReadRequestProfileV1 = GetQueryRequestProfileV1 | PostQueryJsonRequestProfileV1;
declare const normalizedRelativePath: unique symbol;
declare const fixedQueryValues: unique symbol;
declare const fixedJsonBody: unique symbol;
declare const parsedManifest: unique symbol;
export type NormalizedRelativePath = string & { readonly [normalizedRelativePath]: true };
export interface FixedQueryEntryV1 { readonly name: string; readonly value: string }
export interface FixedJsonBodyEntryV1 { readonly name: string; readonly value: BoundedJsonScalar }
export type FixedQueryValuesV1 = readonly FixedQueryEntryV1[] & { readonly [fixedQueryValues]: true };
export type FixedJsonBodyV1 = readonly FixedJsonBodyEntryV1[] & { readonly [fixedJsonBody]: true };
export type JsonPointerConversionV1 = 'string' | 'integer' | 'number' | 'boolean' | 'non_negative_integer';
export interface JsonPointerExtractionV1 {
  readonly source?: 'response_pointer';
  readonly sourcePointer: string;
  readonly targetField: string;
  readonly conversion: JsonPointerConversionV1;
}
export interface OperationKeyExtractionV1 {
  readonly source: 'operation_key';
  readonly targetField: string;
  readonly conversion: 'string';
}
export interface FixedQueryExtractionV1 {
  readonly source: 'fixed_query';
  readonly queryName: string;
  readonly targetField: string;
  readonly conversion: 'string';
}
export type DeclarativeExtractionV1 = JsonPointerExtractionV1 | OperationKeyExtractionV1 | FixedQueryExtractionV1;
export type ResponseValidationProfileV1 = 'FULL_CLOSED_SCHEMA_V1' | 'DECLARED_POINTERS_V1';

export interface ConnectorOperationManifestEntryV1 {
  readonly operationKey: string;
  readonly contractVersion: string;
  readonly inputSchema: ClosedJsonSchemaV1;
  readonly upstreamServiceRef: string;
  readonly request: ReadRequestProfileV1;
  readonly credentialProfileRef: string;
  readonly readOnly: true;
  readonly response: Readonly<{
    readonly validationProfile?: ResponseValidationProfileV1;
    acceptedHttpStatuses: readonly number[];
    acceptedApplicationCodes: readonly number[];
    applicationCodePointer?: string;
    contentType: 'application/json';
    schema: ClosedJsonSchemaV1;
    extraction: readonly DeclarativeExtractionV1[];
  }>;
  readonly limits: Readonly<{
    maxRequestBytes: number;
    maxResponseBytes: number;
    maxDepth: number;
    maxItems: number;
    maxStringLength: number;
    timeoutMs: number;
  }>;
  readonly errorMap: readonly ConnectorErrorMappingV1[];
  readonly readinessDependency: string;
}

export interface ConnectorOperationManifestV1 {
  readonly version: '1';
  readonly connectorKey: string;
  readonly operations: readonly ConnectorOperationManifestEntryV1[];
  readonly [parsedManifest]: true;
}
export interface ConnectorErrorMappingV1 { readonly sourceCode: string; readonly connectorCode: ConnectorErrorCode }

declare const opaqueCredentialHandle: unique symbol;
declare const boundedProviderMetadata: unique symbol;
declare const executionCredentialMaterial: unique symbol;

export type OpaqueCredentialHandle = string & { readonly [opaqueCredentialHandle]: true };
export type BoundedProviderMetadata = object & { readonly [boundedProviderMetadata]: true };
export type ExecutionScopedCredentialMaterial = object & { readonly [executionCredentialMaterial]: true };

export interface BindingBootstrapProviderDescriptorV1 {
  readonly key: string;
  readonly serviceProfileKey: string;
}
export interface CredentialProviderDescriptorV1 { readonly key: string }
export interface CredentialApplicationStrategyDescriptorV1 { readonly key: string; readonly credentialKind: string }
export interface CredentialProfileV1 {
  readonly credentialProfileRef: string;
  readonly credentialProviderKey: string;
  readonly applicationStrategyKey: string;
  readonly credentialKind: string;
}
