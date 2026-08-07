import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EvidenceRefService } from './evidence-ref.service';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [EvidenceRefService],
  exports: [EvidenceRefService]
})
export class EvidenceModule {}
