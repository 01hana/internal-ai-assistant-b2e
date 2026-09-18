import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { IdentityModule } from '../identity/identity.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueryUnderstandingModule } from '../query-understanding/query-understanding.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ToolsModule } from '../tools/tools.module';
import { HostIntegrationModule } from '../host-integration/host-integration.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { AnswerDecisionService } from './answer/answer-decision.service';
import { ClarificationQuestionService } from './answer/clarification-question.service';
import { EvidenceConflictDetectorService } from './answer/evidence-conflict-detector.service';
import { NoAnswerGateService } from './answer/no-answer-gate.service';
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
import { ConversationAuditService } from './conversation/conversation-audit.service';
import { ConversationContextLoaderService } from './conversation/conversation-context-loader.service';
import { ConversationContextRepository } from './conversation/conversation-context.repository';
import { ConversationSourceGuard } from './conversation/conversation-source-guard';
import { GroundedToolEvidenceNormalizer } from './grounding/grounded-tool-evidence.normalizer';
import { GroundedToolRetrievalService } from './grounding/grounded-tool-retrieval.service';
import { HybridRetrievalCoordinatorService } from './grounding/hybrid-retrieval-coordinator.service';
import { RetrievalCoverageService } from './grounding/retrieval-coverage.service';
import { GroundedContextBundleService } from './grounding/grounded-context-bundle.service';
import { PriorGroundedEvidenceEligibilityService } from './grounding/prior-grounded-evidence-eligibility.service';
import { PriorGroundedContextService } from './grounding/prior-grounded-context.service';
import { GroundedRetrievalAuditService } from './grounding/grounded-retrieval-audit.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    ApprovalsModule,
    QueryUnderstandingModule,
    RetrievalModule,
    IdentityModule,
    EvidenceModule,
    FeedbackModule,
    ToolsModule,
    PermissionsModule,
    HostIntegrationModule,
    ConnectorsModule
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
    ClarificationQuestionService,
    EvidenceConflictDetectorService,
    NoAnswerGateService,
    AssistantReadonlyRuntimeService,
    ToolCallService,
    AssistantSseEventBuilder,
    ConversationContextRepository,
    {
      provide: 'ConversationContextSource',
      useExisting: ConversationContextRepository
    },
    ConversationSourceGuard,
    ConversationContextLoaderService,
    ConversationAuditService,
    GroundedToolEvidenceNormalizer,
    GroundedToolRetrievalService,
    HybridRetrievalCoordinatorService,
    RetrievalCoverageService,
    GroundedContextBundleService,
    PriorGroundedEvidenceEligibilityService,
    PriorGroundedContextService,
    GroundedRetrievalAuditService
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
