import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { LlmModule } from '../llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ToolsModule } from '../tools/tools.module';
import { DependencyHealthService } from './dependency-health.service';
import { HealthReadinessController } from './health-readiness.controller';
import { HealthReadinessService } from './health-readiness.service';

@Module({
  imports: [PrismaModule, LlmModule, RetrievalModule, ToolsModule, ConnectorsModule, ApprovalsModule],
  controllers: [HealthReadinessController],
  providers: [DependencyHealthService, HealthReadinessService]
})
export class ObservabilityModule {}
