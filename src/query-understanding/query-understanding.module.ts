import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DefaultTokenizerAdapter } from './default-tokenizer.adapter';
import { QueryUnderstandingRepository } from './query-understanding.repository';
import { QueryUnderstandingService } from './query-understanding.service';
import { RuleBasedQueryUnderstandingPipeline } from './rule-based-query-understanding.pipeline';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [
    QueryUnderstandingRepository,
    QueryUnderstandingService,
    DefaultTokenizerAdapter,
    {
      provide: 'TokenizerAdapter',
      useExisting: DefaultTokenizerAdapter
    },
    RuleBasedQueryUnderstandingPipeline,
    {
      provide: 'QueryUnderstandingPipeline',
      useExisting: RuleBasedQueryUnderstandingPipeline
    }
  ],
  exports: [
    QueryUnderstandingRepository,
    QueryUnderstandingService,
    RuleBasedQueryUnderstandingPipeline,
    DefaultTokenizerAdapter,
    'QueryUnderstandingPipeline'
  ]
})
export class QueryUnderstandingModule {}
