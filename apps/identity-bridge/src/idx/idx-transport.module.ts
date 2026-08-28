import { Module } from '@nestjs/common';
import { BridgeConfigService } from '../config/bridge-config.service';
import { ConfigurationModule } from '../config/configuration.module';
import { MenuDetailTransport } from './transport/menu-detail.transport';

@Module({
  imports: [ConfigurationModule],
  providers: [{ provide: MenuDetailTransport, useFactory: (config: BridgeConfigService) => new MenuDetailTransport(config), inject: [BridgeConfigService] }],
  exports: [MenuDetailTransport]
})
export class IdxTransportModule {}
