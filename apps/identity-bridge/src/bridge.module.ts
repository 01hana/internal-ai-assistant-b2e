import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { BridgeHealthModule } from './health/bridge-health.module';
import { IdxTransportModule } from './idx/idx-transport.module';
import { JwksModule } from './jwks/jwks.module';
import { ExchangeModule } from './exchange/exchange.module';
import { LocalConnectorDiagnosticsModule } from './diagnostics/local-connector-diagnostics';

@Module({
  imports: [ConfigurationModule, LocalConnectorDiagnosticsModule, BridgeHealthModule, IdxTransportModule, JwksModule, ExchangeModule]
})
export class BridgeModule {}
