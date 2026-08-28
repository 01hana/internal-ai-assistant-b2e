import { Module } from '@nestjs/common';
import { BRIDGE_ENVIRONMENT, BridgeConfigService } from './bridge-config.service';

/** Phase 2 configuration parser/provider boundary; runtime consumers receive only BridgeConfigService. */
@Module({ providers: [{ provide: BRIDGE_ENVIRONMENT, useFactory: () => process.env }, BridgeConfigService], exports: [BridgeConfigService] })
export class ConfigurationModule {}
