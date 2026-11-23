import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { AssistantExperienceRepository } from '../../assistant-experience/assistant-experience.repository';
import { AssistantExperienceValidator } from '../../assistant-experience/assistant-experience.validator';
import { CapabilityBindingResolverService } from '../../capabilities/capability-binding-resolver.service';
import { CapabilityCatalogRegistry } from '../../capabilities/capability-catalog.registry';
import { CAPABILITY_PACK_FILE_ACCESS, CapabilityPackLoader, NODE_CAPABILITY_PACK_FILE_ACCESS } from '../../capabilities/capability-pack.loader';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerToolPolicyService } from '../../tools/customer-tool-policy.service';
import { ToolRegistryService } from '../../tools/tool-registry.service';
import { AdminConfigModule } from '../config/admin-config.module';
import { AdminSettings } from '../config/admin-settings';

/** Loads the same Capability Packs as Core when the admin API starts; an invalid pack fails startup (fail closed). */
@Injectable()
class AdminCapabilityPackInitializer implements OnApplicationBootstrap {
  constructor(private readonly settings: AdminSettings, private readonly loader: CapabilityPackLoader) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.loader.loadAndInstall(this.settings.capabilityPackPathsJson);
  }
}

/**
 * Feature 016: what the admin API needs to validate experience configurations, and nothing more. It lists the
 * providers instead of importing Core's CapabilitiesModule / AssistantExperienceModule, which bring semantic
 * resolution and the Assistant runtime (architecture test: only the listed Core files may load).
 */
@Module({
  imports: [AdminConfigModule, PrismaModule],
  providers: [
    AdminCapabilityPackInitializer,
    AssistantExperienceRepository,
    AssistantExperienceValidator,
    CapabilityBindingResolverService,
    CapabilityCatalogRegistry,
    CapabilityPackLoader,
    CustomerToolPolicyService,
    ToolRegistryService,
    { provide: CAPABILITY_PACK_FILE_ACCESS, useValue: NODE_CAPABILITY_PACK_FILE_ACCESS }
  ],
  exports: [AssistantExperienceRepository, AssistantExperienceValidator, CapabilityCatalogRegistry]
})
export class ExperienceValidationModule {}
