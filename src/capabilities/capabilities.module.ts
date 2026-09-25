import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { EnvironmentVariables } from '../common/config/env.validation';
import { ToolsModule } from '../tools/tools.module';
import { CapabilityCatalogRegistry } from './capability-catalog.registry';
import {
  CAPABILITY_PACK_FILE_ACCESS,
  CapabilityPackLoader,
  NODE_CAPABILITY_PACK_FILE_ACCESS
} from './capability-pack.loader';

@Injectable()
class CapabilityPackBootstrapInitializer implements OnApplicationBootstrap {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly loader: CapabilityPackLoader
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.loader.loadAndInstall(this.config.get('ASSISTANT_CAPABILITY_PACK_PATHS_JSON', { infer: true }));
  }
}

@Module({
  imports: [ConfigModule, ToolsModule],
  providers: [
    CapabilityCatalogRegistry,
    CapabilityPackLoader,
    CapabilityPackBootstrapInitializer,
    { provide: CAPABILITY_PACK_FILE_ACCESS, useValue: NODE_CAPABILITY_PACK_FILE_ACCESS }
  ],
  exports: [CapabilityCatalogRegistry]
})
export class CapabilitiesModule {}
