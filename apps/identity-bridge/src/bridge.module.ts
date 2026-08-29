import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { BridgeHealthModule } from './health/bridge-health.module';
import { IdxTransportModule } from './idx/idx-transport.module';
import { JwksModule } from './jwks/jwks.module';

@Module({
  imports: [ConfigurationModule, BridgeHealthModule, IdxTransportModule, JwksModule]
})
export class BridgeModule {}
