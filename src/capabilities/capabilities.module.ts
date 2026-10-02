import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { EnvironmentVariables } from '../common/config/env.validation';
import { ToolsModule } from '../tools/tools.module';
import { AuditModule } from '../audit/audit.module';
import { CapabilityCatalogRegistry } from './capability-catalog.registry';
import { CapabilityBindingResolverService } from './capability-binding-resolver.service';
import { CapabilityParameterResolverService } from './capability-parameter-resolver.service';
import { CapabilitySemanticResolverService } from './capability-semantic-resolver.service';
import { CapabilityResolutionService } from './capability-resolution.service';
import { CapabilityResolutionAuditService } from './capability-resolution-audit.service';
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
  imports: [ConfigModule, ToolsModule, AuditModule],
  providers: [
    CapabilityCatalogRegistry,
    CapabilityBindingResolverService,
    CapabilityParameterResolverService,
    CapabilitySemanticResolverService,
    CapabilityResolutionAuditService,
    { provide: 'CapabilityResolutionAuditPort', useExisting: CapabilityResolutionAuditService },
    CapabilityResolutionService,
    CapabilityPackLoader,
    CapabilityPackBootstrapInitializer,
    { provide: CAPABILITY_PACK_FILE_ACCESS, useValue: NODE_CAPABILITY_PACK_FILE_ACCESS }
  ],
  exports: [CapabilityCatalogRegistry, CapabilityBindingResolverService, CapabilityParameterResolverService, CapabilitySemanticResolverService, CapabilityResolutionService]
})
export class CapabilitiesModule {}
