import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditWriterService } from './audit-writer.service';

@Module({
  imports: [PrismaModule],
  providers: [AuditWriterService],
  exports: [AuditWriterService]
})
export class AuditModule {}
