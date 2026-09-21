import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { BridgeConfigService } from '../config/bridge-config.service';
import { BridgeHealthModule } from '../health/bridge-health.module';
import { BridgeReadinessRegistry } from '../health/readiness.service';
import { ConnectorBindingClient } from './connector-binding.client';
import { ConnectorBindingCoordinator } from './connector-binding.coordinator';
import { ConnectorBindingServiceAuthSigner } from './connector-binding-service-auth.signer';
import { LocalConnectorDiagnostics, LocalConnectorDiagnosticsModule } from '../diagnostics/local-connector-diagnostics';

@Injectable()
export class ConnectorBindingReadinessInitializer implements OnModuleInit {
  constructor(
    private readonly config: BridgeConfigService,
    private readonly readiness: BridgeReadinessRegistry,
    private readonly signer: ConnectorBindingServiceAuthSigner,
    private readonly client: ConnectorBindingClient
  ) {}

  async onModuleInit(): Promise<void> {
    this.readiness.setReady('connectorBinding', false);
    if (!this.config.isValid) return;
    if (!this.config.configuration.connectorBinding) {
      this.readiness.setReady('connectorBinding', true);
      return;
    }
    if (await this.signer.validate() && await this.client.validate()) this.readiness.setReady('connectorBinding', true);
  }
}

@Module({
  imports: [ConfigurationModule, BridgeHealthModule, LocalConnectorDiagnosticsModule],
  providers: [
    { provide: ConnectorBindingServiceAuthSigner, useFactory: (config: BridgeConfigService) => new ConnectorBindingServiceAuthSigner(config), inject: [BridgeConfigService] },
    {
      provide: ConnectorBindingClient,
      useFactory: (config: BridgeConfigService, diagnostics: LocalConnectorDiagnostics) => new ConnectorBindingClient(config, {}, diagnostics),
      inject: [BridgeConfigService, LocalConnectorDiagnostics]
    },
    {
      provide: ConnectorBindingCoordinator,
      useFactory: (config: BridgeConfigService, signer: ConnectorBindingServiceAuthSigner, client: ConnectorBindingClient,
        diagnostics: LocalConnectorDiagnostics) => new ConnectorBindingCoordinator(config, signer, client, undefined, diagnostics),
      inject: [BridgeConfigService, ConnectorBindingServiceAuthSigner, ConnectorBindingClient, LocalConnectorDiagnostics]
    },
    ConnectorBindingReadinessInitializer
  ],
  exports: [ConnectorBindingCoordinator]
})
export class ConnectorBindingModule {}
