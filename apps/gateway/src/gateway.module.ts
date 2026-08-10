import { Module } from '@nestjs/common';
import { GatewayConfigModule } from './config/gateway-config.module';
import { GatewayHealthModule } from './health/gateway-health.module';
import { JwksModule } from './jwks/jwks.module';

@Module({
  imports: [GatewayConfigModule, GatewayHealthModule, JwksModule]
})
export class GatewayModule {}
