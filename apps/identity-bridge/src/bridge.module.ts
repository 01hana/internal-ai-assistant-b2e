import { Module } from '@nestjs/common';
import { ConfigurationModule } from './config/configuration.module';
import { BridgeHealthModule } from './health/bridge-health.module';

@Module({
  imports: [ConfigurationModule, BridgeHealthModule]
})
export class BridgeModule {}
