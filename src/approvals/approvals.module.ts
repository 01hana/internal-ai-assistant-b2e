import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ActionDraftController } from './action-draft.controller';
import { ActionDraftService } from './action-draft.service';

@Module({
  imports: [AuditModule, IdentityModule, PrismaModule],
  controllers: [ActionDraftController],
  providers: [ActionDraftService],
  exports: [ActionDraftService]
})
export class ApprovalsModule {}
