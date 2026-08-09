import { Module } from '@nestjs/common';
import { GatewayConfigService, validateGatewayEnvironment } from './gateway-config.service';

@Module({
  providers: [
    {
      provide: GatewayConfigService,
      useFactory: () => new GatewayConfigService(validateGatewayEnvironment(process.env))
    }
  ],
  exports: [GatewayConfigService]
})
export class GatewayConfigModule {}
