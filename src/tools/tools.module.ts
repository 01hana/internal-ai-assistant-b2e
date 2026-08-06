import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerToolPolicyService } from './customer-tool-policy.service';
import { ToolRegistryService } from './tool-registry.service';

@Module({
  imports: [PrismaModule],
  providers: [CustomerToolPolicyService, ToolRegistryService],
  exports: [ToolRegistryService, CustomerToolPolicyService]
})
export class ToolsModule {}
