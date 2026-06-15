import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueryUnderstandingModule } from '../query-understanding/query-understanding.module';
import { AssistantPlanningService } from './assistant-planning.service';

@Module({
  imports: [PrismaModule, AuditModule, QueryUnderstandingModule],
  providers: [AssistantPlanningService],
  exports: [AssistantPlanningService]
})
export class AssistantModule {}
