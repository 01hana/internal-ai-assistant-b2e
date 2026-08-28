import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { BridgeHealthModule } from './health/bridge-health.module';
import { IdxTransportModule } from './idx/idx-transport.module';

@Module({
  imports: [ConfigurationModule, BridgeHealthModule, IdxTransportModule]
})
export class BridgeModule {}
