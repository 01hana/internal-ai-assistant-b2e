import { Module } from '@nestjs/common';
import { GatewayHealthController } from './gateway-health.controller';
import { GatewayHealthService } from './gateway-health.service';

@Module({
  controllers: [GatewayHealthController],
  providers: [GatewayHealthService]
})
export class GatewayHealthModule {}
