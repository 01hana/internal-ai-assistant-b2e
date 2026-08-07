import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackEventService } from './feedback-event.service';
import { ReviewItemController } from './review-item.controller';
import { ReviewItemService } from './review-item.service';

@Module({
  imports: [PrismaModule, AuditModule, IdentityModule],
  controllers: [FeedbackController, ReviewItemController],
  providers: [FeedbackEventService, ReviewItemService],
  exports: [FeedbackEventService, ReviewItemService]
})
export class FeedbackModule {}
