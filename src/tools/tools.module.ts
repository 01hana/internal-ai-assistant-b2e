import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerToolPolicyService } from './customer-tool-policy.service';
import { ToolRegistryService } from './tool-registry.service';
import { ToolDiscoveryService } from './tool-discovery.service';

@Module({
  imports: [PrismaModule],
  providers: [CustomerToolPolicyService, ToolRegistryService, ToolDiscoveryService],
  exports: [ToolRegistryService, CustomerToolPolicyService, ToolDiscoveryService]
})
export class ToolsModule {}
