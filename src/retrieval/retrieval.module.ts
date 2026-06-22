import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DeterministicRetrievalProvider } from './deterministic-retrieval.provider';
import { KnowledgeChunkingService } from './knowledge-chunking.service';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [DeterministicRetrievalProvider, KnowledgeChunkingService, RetrievalService],
  exports: [KnowledgeChunkingService, RetrievalService]
})
export class RetrievalModule {}
