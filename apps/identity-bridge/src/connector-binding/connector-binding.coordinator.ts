import { randomUUID } from 'node:crypto';
import type { AcceptedIdentity } from '../idx/identity-admission.service';
import { BridgeConfigService } from '../config/bridge-config.service';
import type { ConnectorBindingClient } from './connector-binding.client';
import type { ConnectorBindingServiceAuthSigner } from './connector-binding-service-auth.signer';

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
    private readonly uuid: () => string = randomUUID
  ) {}

  async bootstrap(input: ConnectorBindingBootstrapInput): Promise<ConnectorBindingBootstrapResult> {
    if (!this.config.isValid) return unavailable();
    if (!this.config.configuration.connectorBinding) return Object.freeze({ ok: true });
    try {
      const signed = await this.signer.prepare({ requestId: this.uuid(), ...input });
      if (!signed.ok) return unavailable();
      const exchanged = await this.client.exchange(signed.value);
      if (!exchanged.ok || 'status' in exchanged.value) return unavailable();
      return Object.freeze({
        ok: true,
        connectorContextRef: exchanged.value.connectorContextRef,
        expiresIn: exchanged.value.expiresIn
      });
    } catch {
      return unavailable();
    }
  }
}

function unavailable(): ConnectorBindingBootstrapResult {
  return Object.freeze({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
}
