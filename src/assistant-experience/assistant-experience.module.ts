import { Module } from '@nestjs/common';
import { CapabilitiesModule } from '../capabilities/capabilities.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AssistantExperienceRepository } from './assistant-experience.repository';
import { AssistantExperienceValidator } from './assistant-experience.validator';

@Module({
  imports: [PrismaModule, CapabilitiesModule],
  providers: [AssistantExperienceRepository, AssistantExperienceValidator],
  exports: [AssistantExperienceRepository, AssistantExperienceValidator]
})
export class AssistantExperienceModule {}
