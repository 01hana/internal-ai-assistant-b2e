import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DefaultTokenizerAdapter } from './default-tokenizer.adapter';
import { QueryUnderstandingRepository } from './query-understanding.repository';
import { QueryUnderstandingService } from './query-understanding.service';
import { RuleBasedQueryUnderstandingPipeline } from './rule-based-query-understanding.pipeline';
import { ToolsModule } from '../tools/tools.module';
import { ConversationSemanticReconstructorService } from '../assistant/conversation/conversation-semantic-reconstructor.service';
import { FollowUpSemanticResolverService } from '../assistant/conversation/follow-up-semantic-resolver.service';

@Module({
  imports: [PrismaModule, AuditModule, ToolsModule],
  providers: [
    QueryUnderstandingRepository,
    QueryUnderstandingService,
    ConversationSemanticReconstructorService,
    FollowUpSemanticResolverService,
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
    ConversationSemanticReconstructorService,
    FollowUpSemanticResolverService,
    RuleBasedQueryUnderstandingPipeline,
    DefaultTokenizerAdapter,
    'QueryUnderstandingPipeline'
  ]
})
export class QueryUnderstandingModule {}
