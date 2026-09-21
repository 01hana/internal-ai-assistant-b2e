import { randomUUID } from 'node:crypto';
import type { AcceptedIdentity } from '../idx/identity-admission.service';
import { BridgeConfigService } from '../config/bridge-config.service';
import type { ConnectorBindingClient } from './connector-binding.client';
import type { ConnectorBindingServiceAuthSigner } from './connector-binding-service-auth.signer';
import type { LocalConnectorDiagnostics } from '../diagnostics/local-connector-diagnostics';

export type ConnectorBindingBootstrapInput = Readonly<{
  nativeAccessToken: string;
  acceptedIdentity: AcceptedIdentity;
}>;

export type ConnectorBindingBootstrapResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: true; connectorContextRef: string; expiresIn: number }>
  | Readonly<{ ok: false; code: 'CONNECTOR_UNAVAILABLE' }>;

export class ConnectorBindingCoordinator {
  constructor(
    private readonly config: BridgeConfigService,
    private readonly signer: Pick<ConnectorBindingServiceAuthSigner, 'prepare'>,
    private readonly client: Pick<ConnectorBindingClient, 'exchange'>,
    private readonly uuid: () => string = randomUUID,
    private readonly diagnostics?: Pick<LocalConnectorDiagnostics, 'emit'>
  ) {}

  async bootstrap(input: ConnectorBindingBootstrapInput, publicExchangeRequestId?: string): Promise<ConnectorBindingBootstrapResult> {
    if (!this.config.isValid) return unavailable();
    if (!this.config.configuration.connectorBinding) return Object.freeze({ ok: true });
    const internalBindingRequestId = this.uuid();
    const metadata = { publicExchangeRequestId, internalBindingRequestId };
    this.diagnostics?.emit('BINDING_HANDOFF_STARTED', 'STARTED', metadata);
    try {
      const signed = await this.signer.prepare({ requestId: internalBindingRequestId, ...input });
      if (!signed.ok) {
        this.diagnostics?.emit('BINDING_HANDOFF_FAILED', 'FAILED', { ...metadata, failureCategory: signed.code });
        return unavailable();
      }
      this.diagnostics?.emit('BINDING_PROOF_CREATED', 'SUCCEEDED', metadata);
      const exchanged = await this.client.exchange(signed.value, undefined, metadata);
      if (!exchanged.ok) {
        this.diagnostics?.emit('BINDING_HANDOFF_FAILED', 'FAILED', { ...metadata, failureCategory: exchanged.code });
        return unavailable();
      }
      if ('status' in exchanged.value) {
        this.diagnostics?.emit('BINDING_HANDOFF_FAILED', 'FAILED', { ...metadata, failureCategory: exchanged.value.error.code });
        return unavailable();
      }
      return Object.freeze({
        ok: true,
        connectorContextRef: exchanged.value.connectorContextRef,
        expiresIn: exchanged.value.expiresIn
      });
    } catch {
      this.diagnostics?.emit('BINDING_HANDOFF_FAILED', 'FAILED', { ...metadata, failureCategory: 'UNEXPECTED_BINDING_FAILURE' });
      return unavailable();
    }
  }
}

function unavailable(): ConnectorBindingBootstrapResult {
  return Object.freeze({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
}
