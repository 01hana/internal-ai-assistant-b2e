import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../config/configuration.module';
import { BridgeHealthController } from './bridge-health.controller';
import { BridgeHealthService } from './bridge-health.service';
import { BridgeReadinessRegistry, BridgeReadinessService } from './readiness.service';

@Module({
  imports: [ConfigurationModule], controllers: [BridgeHealthController], providers: [BridgeHealthService, BridgeReadinessRegistry, BridgeReadinessService]
})
export class BridgeHealthModule {}
