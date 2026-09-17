import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DeterministicRetrievalProvider } from './deterministic-retrieval.provider';
import { KnowledgeChunkingService } from './knowledge-chunking.service';
import { RetrievalService } from './retrieval.service';
import { GroundedRetrievalAuditService } from './grounded-retrieval-audit.service';
import { GroundedRetrievalRouterService } from './grounded-retrieval-router.service';
import { DocumentEvidenceSourceGuard } from './document-evidence-source-guard';
import { GroundedDocumentEvidenceNormalizer } from './grounded-document-evidence.normalizer';
import { GroundedDocumentRetrievalService } from './grounded-document-retrieval.service';

@Module({
  imports: [PrismaModule, AuditModule, EvidenceModule],
  providers: [
    DeterministicRetrievalProvider,
    GroundedRetrievalAuditService,
    GroundedRetrievalRouterService,
    DocumentEvidenceSourceGuard,
    GroundedDocumentEvidenceNormalizer,
    GroundedDocumentRetrievalService,
    KnowledgeChunkingService,
    RetrievalService
  ],
  exports: [KnowledgeChunkingService, RetrievalService, GroundedRetrievalRouterService, GroundedDocumentRetrievalService]
})
export class RetrievalModule {}
