import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { IdentityModule } from '../identity/identity.module';
import { MockConnectorModule } from '../connectors/mock/mock-connector.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueryUnderstandingModule } from '../query-understanding/query-understanding.module';
import { ToolsModule } from '../tools/tools.module';
import { AnswerDecisionService } from './answer/answer-decision.service';
import { AssistantController } from './assistant.controller';
import { AssistantContextStateService } from './context/assistant-context-state.service';
import { AssistantHistoryAccessService } from './history/assistant-history-access.service';
import { AssistantHistorySanitizer } from './history/assistant-history.sanitizer';
import { AssistantHistoryService } from './history/assistant-history.service';
import { AssistantMessageRepository } from './message/assistant-message.repository';
import { AssistantMessageService } from './message/assistant-message.service';
import { AssistantPlanningService } from './planning/assistant-planning.service';
import { AssistantReadonlyRuntimeService } from './runtime/assistant-readonly-runtime.service';
import { ToolCallService } from './runtime/tool-call.service';
import { AssistantSessionService } from './session/assistant-session.service';
import { AssistantSseEventBuilder } from './sse/assistant-sse-event.builder';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    ApprovalsModule,
    QueryUnderstandingModule,
    IdentityModule,
    EvidenceModule,
    ToolsModule,
    MockConnectorModule,
    PermissionsModule
  ],
  controllers: [AssistantController],
  providers: [
    AssistantPlanningService,
    AssistantSessionService,
    AssistantMessageRepository,
    AssistantMessageService,
    AssistantHistoryAccessService,
    AssistantHistorySanitizer,
    AssistantHistoryService,
    AssistantContextStateService,
    AnswerDecisionService,
    AssistantReadonlyRuntimeService,
    ToolCallService,
    AssistantSseEventBuilder
  ],
  exports: [
    AssistantPlanningService,
    AssistantSessionService,
    AssistantMessageService,
    AssistantHistoryService,
    AssistantContextStateService,
    AnswerDecisionService
  ]
})
export class AssistantModule {}
