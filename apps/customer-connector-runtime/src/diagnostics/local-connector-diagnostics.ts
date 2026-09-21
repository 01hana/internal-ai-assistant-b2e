import { Injectable } from '@nestjs/common';

export type RuntimeDiagnosticStage =
  | 'BINDING_ROUTE_RECEIVED'
  | 'BINDING_SERVICE_AUTH_SUCCEEDED'
  | 'BINDING_SERVICE_AUTH_FAILED'
  | 'BINDING_CONTEXT_VALIDATED'
  | 'BINDING_CONTEXT_REJECTED'
  | 'BOOTSTRAP_PROFILE_RESOLVED'
  | 'BOOTSTRAP_PROFILE_FAILED'
  | 'BOOTSTRAP_PROVIDER_RESOLVED'
  | 'BOOTSTRAP_PROVIDER_FAILED'
  | 'CREDENTIAL_CREATE_SUCCEEDED'
  | 'CREDENTIAL_CREATE_FAILED'
  | 'BINDING_MINT_SUCCEEDED'
  | 'BINDING_MINT_FAILED'
  | 'BINDING_RESPONSE_SENT'
  | 'INVOCATION_ROUTE_RECEIVED'
  | 'INVOCATION_SERVICE_AUTH_SUCCEEDED'
  | 'INVOCATION_SERVICE_AUTH_FAILED'
  | 'INVOCATION_CONTEXT_VALIDATED'
  | 'INVOCATION_CONTEXT_REJECTED'
  | 'BINDING_LOOKUP_SUCCEEDED'
  | 'BINDING_LOOKUP_FAILED'
  | 'CREDENTIAL_RESOLUTION_SUCCEEDED'
  | 'CREDENTIAL_RESOLUTION_FAILED'
  | 'MANIFEST_RESOLVED'
  | 'MANIFEST_RESOLUTION_FAILED'
  | 'UPSTREAM_REQUEST_PREPARED'
  | 'UPSTREAM_REQUEST_STARTED'
  | 'UPSTREAM_RESPONSE_RECEIVED'
  | 'UPSTREAM_REQUEST_FAILED'
  | 'UPSTREAM_RESPONSE_SCHEMA_VALIDATED'
  | 'UPSTREAM_RESPONSE_SCHEMA_FAILED'
  | 'RESULT_EXTRACTION_SUCCEEDED'
  | 'RESULT_EXTRACTION_FAILED'
  | 'INVOCATION_RESPONSE_SENT';

export interface RuntimeDiagnosticMetadata {
  readonly internalBindingRequestId?: string;
  readonly requestId?: string;
  readonly customerId?: string;
  readonly integrationId?: string;
  readonly hostApp?: string;
  readonly connectorKey?: string;
  readonly connectorInstanceId?: string;
  readonly operationKey?: string;
  readonly operationVersion?: string;
  readonly httpStatusCategory?: string;
  readonly contentTypeCategory?: string;
  readonly responseByteLength?: number;
  readonly jsonParsingPassed?: boolean;
  readonly responsePointerCount?: number;
  readonly responsePointerResolvedCount?: number;
  readonly responsePointerMissingCount?: number;
  readonly applicationCodePointerConfigured?: boolean;
  readonly applicationCodePointerResolved?: boolean;
  readonly applicationCodeValidationStatus?: 'NOT_CONFIGURED' | 'PASS' | 'MISSING' | 'TYPE_INVALID' | 'REJECTED';
  readonly declaredPointerSchemaCount?: number;
  readonly declaredPointerSchemaValidCount?: number;
  readonly declaredPointerSchemaInvalidCount?: number;
  readonly fullClosedSchemaValidation?: 'PASS' | 'FAIL';
  readonly durationMs?: number;
  readonly failureCategory?: string;
}

export type RuntimeDiagnosticEvent = Readonly<{
  timestamp: string;
  service: 'customer-connector-runtime';
  stage: RuntimeDiagnosticStage;
  result: string;
  internalBindingRequestId?: string;
  requestId?: string;
  customerId?: string;
  integrationId?: string;
  hostApp?: string;
  connectorKey?: string;
  connectorInstanceId?: string;
  operationKey?: string;
  operationVersion?: string;
  httpStatusCategory?: string;
  contentTypeCategory?: string;
  responseByteLength?: number;
  jsonParsingPassed?: boolean;
  responsePointerCount?: number;
  responsePointerResolvedCount?: number;
  responsePointerMissingCount?: number;
  applicationCodePointerConfigured?: boolean;
  applicationCodePointerResolved?: boolean;
  applicationCodeValidationStatus?: 'NOT_CONFIGURED' | 'PASS' | 'MISSING' | 'TYPE_INVALID' | 'REJECTED';
  declaredPointerSchemaCount?: number;
  declaredPointerSchemaValidCount?: number;
  declaredPointerSchemaInvalidCount?: number;
  fullClosedSchemaValidation?: 'PASS' | 'FAIL';
  durationMs?: number;
  failureCategory?: string;
}>;

export type RuntimeDiagnosticWriter = (event: RuntimeDiagnosticEvent) => void;

@Injectable()
export class LocalConnectorDiagnostics {
  readonly enabled: boolean;

  constructor(
    environment: Record<string, unknown> = process.env,
    private readonly writer: RuntimeDiagnosticWriter = defaultWriter
  ) {
    this.enabled = environment.LOCAL_CONNECTOR_DIAGNOSTICS === '1' && environment.LOCAL_DEVELOPMENT === '1';
  }

  emit(stage: RuntimeDiagnosticStage, result: string, metadata: RuntimeDiagnosticMetadata = {}): void {
    if (!this.enabled) return;
    const durationMs = boundedDuration(metadata.durationMs);
    this.writer(Object.freeze({
      timestamp: new Date().toISOString(),
      service: 'customer-connector-runtime',
      stage,
      result: safeCategory(result),
      ...(safeId(metadata.internalBindingRequestId) ? { internalBindingRequestId: metadata.internalBindingRequestId } : {}),
      ...(safeId(metadata.requestId) ? { requestId: metadata.requestId } : {}),
      ...(safeId(metadata.customerId) ? { customerId: metadata.customerId } : {}),
      ...(safeId(metadata.integrationId) ? { integrationId: metadata.integrationId } : {}),
      ...(safeId(metadata.hostApp) ? { hostApp: metadata.hostApp } : {}),
      ...(safeId(metadata.connectorKey) ? { connectorKey: metadata.connectorKey } : {}),
      ...(safeId(metadata.connectorInstanceId) ? { connectorInstanceId: metadata.connectorInstanceId } : {}),
      ...(safeId(metadata.operationKey) ? { operationKey: metadata.operationKey } : {}),
      ...(safeId(metadata.operationVersion) ? { operationVersion: metadata.operationVersion } : {}),
      ...(optionalSafeCategory(metadata.httpStatusCategory) ? { httpStatusCategory: metadata.httpStatusCategory } : {}),
      ...(optionalSafeCategory(metadata.contentTypeCategory) ? { contentTypeCategory: metadata.contentTypeCategory } : {}),
      ...(boundedBytes(metadata.responseByteLength) === undefined ? {} : { responseByteLength: boundedBytes(metadata.responseByteLength) }),
      ...(typeof metadata.jsonParsingPassed === 'boolean' ? { jsonParsingPassed: metadata.jsonParsingPassed } : {}),
      ...(boundedPointerCount(metadata.responsePointerCount) === undefined ? {} : { responsePointerCount: boundedPointerCount(metadata.responsePointerCount) }),
      ...(boundedPointerCount(metadata.responsePointerResolvedCount) === undefined ? {} : { responsePointerResolvedCount: boundedPointerCount(metadata.responsePointerResolvedCount) }),
      ...(boundedPointerCount(metadata.responsePointerMissingCount) === undefined ? {} : { responsePointerMissingCount: boundedPointerCount(metadata.responsePointerMissingCount) }),
      ...(typeof metadata.applicationCodePointerConfigured === 'boolean' ? { applicationCodePointerConfigured: metadata.applicationCodePointerConfigured } : {}),
      ...(typeof metadata.applicationCodePointerResolved === 'boolean' ? { applicationCodePointerResolved: metadata.applicationCodePointerResolved } : {}),
      ...(applicationCodeStatus(metadata.applicationCodeValidationStatus) ? { applicationCodeValidationStatus: metadata.applicationCodeValidationStatus } : {}),
      ...(boundedPointerCount(metadata.declaredPointerSchemaCount) === undefined ? {} : { declaredPointerSchemaCount: boundedPointerCount(metadata.declaredPointerSchemaCount) }),
      ...(boundedPointerCount(metadata.declaredPointerSchemaValidCount) === undefined ? {} : { declaredPointerSchemaValidCount: boundedPointerCount(metadata.declaredPointerSchemaValidCount) }),
      ...(boundedPointerCount(metadata.declaredPointerSchemaInvalidCount) === undefined ? {} : { declaredPointerSchemaInvalidCount: boundedPointerCount(metadata.declaredPointerSchemaInvalidCount) }),
      ...(fullSchemaStatus(metadata.fullClosedSchemaValidation) ? { fullClosedSchemaValidation: metadata.fullClosedSchemaValidation } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(optionalSafeCategory(metadata.failureCategory) ? { failureCategory: metadata.failureCategory } : {})
    }));
  }
}

function defaultWriter(event: RuntimeDiagnosticEvent): void { console.info(JSON.stringify(event)); }
function safeId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function safeCategory(value: unknown): string { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'UNCLASSIFIED'; }
function optionalSafeCategory(value: unknown): value is string { return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value); }
function boundedDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(60_000, Math.max(0, Math.round(value))) : undefined;
}
function boundedBytes(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 16_777_216) : undefined;
}
function boundedPointerCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 64) : undefined;
}
function applicationCodeStatus(value: unknown): value is NonNullable<RuntimeDiagnosticMetadata['applicationCodeValidationStatus']> {
  return ['NOT_CONFIGURED', 'PASS', 'MISSING', 'TYPE_INVALID', 'REJECTED'].includes(String(value));
}
function fullSchemaStatus(value: unknown): value is NonNullable<RuntimeDiagnosticMetadata['fullClosedSchemaValidation']> {
  return value === 'PASS' || value === 'FAIL';
}
