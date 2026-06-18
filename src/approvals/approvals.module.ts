import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActionDraftController } from './action-draft.controller';
import { ActionDraftService } from './action-draft.service';
import { ApprovalRequestController } from './approval-request.controller';
import { ApprovalRequestService } from './approval-request.service';

@Module({
  imports: [AuditModule, IdentityModule, PrismaModule],
  controllers: [ActionDraftController, ApprovalRequestController],
  providers: [ActionDraftService, ApprovalRequestService],
  exports: [ActionDraftService, ApprovalRequestService]
})
export class ApprovalsModule {}
