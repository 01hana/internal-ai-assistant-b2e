export type ProductizedConnectorDiagnosticStage =
  | 'TOOL_CONNECTOR_EXECUTION_STARTED'
  | 'CONNECTOR_CONTEXT_PRESENT'
  | 'CONNECTOR_CONTEXT_MISSING'
  | 'CONNECTOR_DEPLOYMENT_RESOLVED'
  | 'CONNECTOR_SERVICE_PROOF_CREATED'
  | 'CONNECTOR_REQUEST_SENT'
  | 'CONNECTOR_RESPONSE_RECEIVED'
  | 'CONNECTOR_RESPONSE_VALIDATED'
  | 'CONNECTOR_EXECUTION_FAILED'
  | 'CONNECTOR_EXECUTION_COMPLETED';

export interface ProductizedConnectorDiagnosticMetadata {
  readonly requestId?: string;
  readonly toolCallId?: string;
  readonly customerId?: string;
  readonly integrationId?: string;
  readonly hostApp?: string;
  readonly connectorKey?: string;
  readonly connectorInstanceId?: string;
  readonly operationKey?: string;
  readonly operationVersion?: string;
  readonly connectorContextStatus?: 'PRESENT' | 'MISSING';
  readonly httpStatusCategory?: string;
  readonly failureCategory?: string;
}

export type ProductizedConnectorDiagnosticEvent = Readonly<{
  timestamp: string;
  service: 'assistant-backend';
  stage: ProductizedConnectorDiagnosticStage;
  result: string;
}> & ProductizedConnectorDiagnosticMetadata;

export type ProductizedConnectorDiagnosticWriter = (event: ProductizedConnectorDiagnosticEvent) => void;

export class LocalProductizedConnectorDiagnostics {
  readonly enabled: boolean;

  constructor(
    environment: Record<string, unknown> = process.env,
    private readonly writer: ProductizedConnectorDiagnosticWriter = defaultWriter
  ) {
    this.enabled = environment.LOCAL_DEVELOPMENT === '1' && environment.LOCAL_CONNECTOR_DIAGNOSTICS === '1';
  }

  emit(stage: ProductizedConnectorDiagnosticStage, result: string, metadata: ProductizedConnectorDiagnosticMetadata = {}): void {
    if (!this.enabled) return;
    this.writer(Object.freeze({
      timestamp: new Date().toISOString(),
      service: 'assistant-backend',
      stage,
      result: safeCategory(result),
      ...(safeId(metadata.requestId) ? { requestId: metadata.requestId } : {}),
      ...(safeId(metadata.toolCallId) ? { toolCallId: metadata.toolCallId } : {}),
      ...(safeId(metadata.customerId) ? { customerId: metadata.customerId } : {}),
      ...(safeId(metadata.integrationId) ? { integrationId: metadata.integrationId } : {}),
      ...(safeId(metadata.hostApp) ? { hostApp: metadata.hostApp } : {}),
      ...(safeId(metadata.connectorKey) ? { connectorKey: metadata.connectorKey } : {}),
      ...(safeId(metadata.connectorInstanceId) ? { connectorInstanceId: metadata.connectorInstanceId } : {}),
      ...(safeId(metadata.operationKey) ? { operationKey: metadata.operationKey } : {}),
      ...(safeId(metadata.operationVersion) ? { operationVersion: metadata.operationVersion } : {}),
      ...(metadata.connectorContextStatus === 'PRESENT' || metadata.connectorContextStatus === 'MISSING'
        ? { connectorContextStatus: metadata.connectorContextStatus } : {}),
      ...(safeOptionalCategory(metadata.httpStatusCategory) ? { httpStatusCategory: metadata.httpStatusCategory } : {}),
      ...(safeOptionalCategory(metadata.failureCategory) ? { failureCategory: metadata.failureCategory } : {})
    }));
  }
}

function defaultWriter(event: ProductizedConnectorDiagnosticEvent): void { console.info(JSON.stringify(event)); }
function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
function safeCategory(value: unknown): string {
  return safeOptionalCategory(value) ? value : 'UNCLASSIFIED';
}
function safeOptionalCategory(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}
