import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueryUnderstandingPlaceholderService } from './query-understanding-placeholder.service';
import { QueryUnderstandingRepository } from './query-understanding.repository';
import { QueryUnderstandingService } from './query-understanding.service';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [
    QueryUnderstandingRepository,
    QueryUnderstandingService,
    QueryUnderstandingPlaceholderService,
    {
      provide: 'QueryUnderstandingPipeline',
      useExisting: QueryUnderstandingPlaceholderService
    }
  ],
  exports: [QueryUnderstandingRepository, QueryUnderstandingService, QueryUnderstandingPlaceholderService, 'QueryUnderstandingPipeline']
})
export class QueryUnderstandingModule {}
