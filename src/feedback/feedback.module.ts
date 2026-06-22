import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewItemService } from './review-item.service';

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [ReviewItemService],
  exports: [ReviewItemService]
})
export class FeedbackModule {}
