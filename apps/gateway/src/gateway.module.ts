import { Module } from '@nestjs/common';
import { GatewayConfigModule } from './config/gateway-config.module';
import { GatewayHealthModule } from './health/gateway-health.module';

@Module({
  imports: [GatewayConfigModule, GatewayHealthModule]
})
export class GatewayModule {}
