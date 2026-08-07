import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MockConnectorModule } from '../connectors/mock/mock-connector.module';
import { IdentityModule } from '../identity/identity.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ToolsModule } from '../tools/tools.module';
import { ActionDraftController } from './action-draft.controller';
import { ActionDraftService } from './action-draft.service';
import { ApprovalRequestController } from './approval-request.controller';
import { ApprovalRequestService } from './approval-request.service';
import { EscalationRequestController } from './escalation-request.controller';
import { EscalationRequestService } from './escalation-request.service';
import { SideEffectExecutionGuardService } from './side-effect-execution-guard.service';
import { SideEffectToolContractResolver } from './side-effect-tool-contract.resolver';

@Module({
  imports: [AuditModule, IdentityModule, PrismaModule, ToolsModule, PermissionsModule, MockConnectorModule],
  controllers: [ActionDraftController, ApprovalRequestController, EscalationRequestController],
  providers: [
    ActionDraftService,
    ApprovalRequestService,
    EscalationRequestService,
    SideEffectExecutionGuardService,
    SideEffectToolContractResolver
  ],
  exports: [ActionDraftService, ApprovalRequestService, EscalationRequestService]
})
export class ApprovalsModule {}
