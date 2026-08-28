import { Module } from '@nestjs/common';
import { BridgeHealthController } from './bridge-health.controller';
import { BridgeHealthService } from './bridge-health.service';

@Module({
  controllers: [BridgeHealthController],
  providers: [BridgeHealthService]
})
export class BridgeHealthModule {}
