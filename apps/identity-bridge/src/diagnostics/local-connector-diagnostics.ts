import { Global, Module } from '@nestjs/common';

export const BRIDGE_DIAGNOSTIC_WRITER = Symbol('BRIDGE_DIAGNOSTIC_WRITER');

export type BridgeDiagnosticStage =
  | 'EXCHANGE_REQUEST_ACCEPTED'
  | 'MENUDETAIL_REQUEST_STARTED'
  | 'MENUDETAIL_REQUEST_SUCCEEDED'
  | 'MENUDETAIL_REQUEST_FAILED'
  | 'IDENTITY_ADMISSION_SUCCEEDED'
  | 'IDENTITY_ADMISSION_FAILED'
  | 'BINDING_HANDOFF_STARTED'
  | 'BINDING_PROOF_CREATED'
  | 'BINDING_TLS_CONNECTED'
  | 'BINDING_HTTP_RESPONSE_RECEIVED'
  | 'BINDING_RESPONSE_VALIDATED'
  | 'BINDING_HANDOFF_FAILED'
  | 'CANONICAL_TOKEN_ISSUED'
  | 'EXCHANGE_COMPLETED'
  | 'EXCHANGE_FAILED';

export type BridgeDiagnosticEvent = Readonly<{
  timestamp: string;
  service: 'identity-bridge';
  stage: BridgeDiagnosticStage;
  result: string;
  publicExchangeRequestId?: string;
  internalBindingRequestId?: string;
  httpStatusCategory?: string;
  durationMs?: number;
  failureCategory?: string;
}>;

export type BridgeDiagnosticMetadata = Readonly<{
  publicExchangeRequestId?: string;
  internalBindingRequestId?: string;
  httpStatusCategory?: string;
  durationMs?: number;
  failureCategory?: string;
}>;

export type BridgeDiagnosticWriter = (event: BridgeDiagnosticEvent) => void;

export class LocalConnectorDiagnostics {
  readonly enabled: boolean;

  constructor(
    environment: Record<string, unknown> = process.env,
    private readonly writer: BridgeDiagnosticWriter = defaultWriter
  ) {
    this.enabled = environment.LOCAL_CONNECTOR_DIAGNOSTICS === '1' && environment.LOCAL_DEVELOPMENT === '1';
  }

  emit(stage: BridgeDiagnosticStage, result: string, metadata: BridgeDiagnosticMetadata = {}): void {
    if (!this.enabled) return;
    const event: BridgeDiagnosticEvent = Object.freeze({
      timestamp: new Date().toISOString(),
      service: 'identity-bridge',
      stage,
      result: safeCategory(result),
      ...(safeId(metadata.publicExchangeRequestId) ? { publicExchangeRequestId: metadata.publicExchangeRequestId } : {}),
      ...(safeId(metadata.internalBindingRequestId) ? { internalBindingRequestId: metadata.internalBindingRequestId } : {}),
      ...(optionalSafeCategory(metadata.httpStatusCategory) ? { httpStatusCategory: metadata.httpStatusCategory } : {}),
      ...(boundedDuration(metadata.durationMs) === undefined ? {} : { durationMs: boundedDuration(metadata.durationMs) }),
      ...(optionalSafeCategory(metadata.failureCategory) ? { failureCategory: metadata.failureCategory } : {})
    });
    this.writer(event);
  }
}

@Global()
@Module({
  providers: [
    { provide: BRIDGE_DIAGNOSTIC_WRITER, useValue: defaultWriter },
    {
      provide: LocalConnectorDiagnostics,
      useFactory: (writer: BridgeDiagnosticWriter) => new LocalConnectorDiagnostics(process.env, writer),
      inject: [BRIDGE_DIAGNOSTIC_WRITER]
    }
  ],
  exports: [LocalConnectorDiagnostics]
})
export class LocalConnectorDiagnosticsModule {}

function defaultWriter(event: BridgeDiagnosticEvent): void {
  console.info(JSON.stringify(event));
}

function safeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function safeCategory(value: unknown): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : 'UNCLASSIFIED';
}
function optionalSafeCategory(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}

function boundedDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(60_000, Math.max(0, Math.round(value))) : undefined;
}
