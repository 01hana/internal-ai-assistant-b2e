-- CreateEnum
CREATE TYPE "AssistantSessionStatus" AS ENUM ('active', 'closed', 'expired');

-- CreateEnum
CREATE TYPE "AssistantMessageRole" AS ENUM ('user', 'assistant', 'system', 'tool');

-- CreateEnum
CREATE TYPE "AnswerDecisionStatus" AS ENUM ('answered', 'clarification_required', 'no_answer', 'permission_denied', 'tool_failed', 'approval_required', 'confirmation_required', 'escalation_required');

-- CreateEnum
CREATE TYPE "AssistantTaskState" AS ENUM ('idle', 'planning', 'waiting_clarification', 'waiting_confirmation', 'waiting_approval', 'waiting_escalation', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "ExecutionDecision" AS ENUM ('continue', 'clarify', 'no_answer', 'permission_denied', 'tool_failed', 'approval_required', 'confirmation_required', 'escalation_required');

-- CreateEnum
CREATE TYPE "ToolOperation" AS ENUM ('read', 'create', 'update', 'delete', 'export', 'approve', 'other');

-- CreateEnum
CREATE TYPE "ToolCallStatus" AS ENUM ('pending', 'success', 'failed', 'blocked');

-- CreateEnum
CREATE TYPE "ToolExecutionStatus" AS ENUM ('not_started', 'in_progress', 'executed', 'skipped_duplicate', 'failed');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('tool_result', 'structured_record', 'document_chunk', 'approval_decision');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "ActionDraftStatus" AS ENUM ('draft', 'waiting_confirmation', 'confirmed', 'executed', 'cancelled', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "EscalationReason" AS ENUM ('permission_gap', 'data_owner_required', 'policy_required', 'tool_failure', 'evidence_conflict', 'other');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('open', 'resolved', 'cancelled');

-- CreateEnum
CREATE TYPE "EscalationOwnerType" AS ENUM ('data_owner', 'system_admin', 'approver', 'product_ops');

-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('positive', 'negative', 'neutral');

-- CreateEnum
CREATE TYPE "ReviewSourceType" AS ENUM ('failed_query', 'no_answer', 'tool_failure', 'negative_feedback', 'missing_evidence', 'bad_tool_routing', 'permission_mapping_issue');

-- CreateEnum
CREATE TYPE "ReviewItemStatus" AS ENUM ('open', 'in_review', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "ReviewPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('manual', 'sop', 'policy', 'field_guide', 'faq', 'uploaded_file', 'other');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "RetrievalStrategy" AS ENUM ('keyword', 'vector', 'hybrid');

-- CreateEnum
CREATE TYPE "NoAnswerReason" AS ENUM ('no_evidence', 'low_confidence', 'ambiguous_query', 'permission_denied', 'tool_failure', 'evidence_conflict', 'unsupported_scope', 'missing_page_context');

-- CreateEnum
CREATE TYPE "ClarificationQuestionStatus" AS ENUM ('pending', 'answered', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "AssistantSession" (
    "id" TEXT NOT NULL,
    "hostApp" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" "AssistantSessionStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "AssistantSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "role" "AssistantMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "answerDecision" "AnswerDecisionStatus",
    "pageContext" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantContextState" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "currentTask" TEXT,
    "currentModule" TEXT,
    "currentPage" JSONB,
    "currentEntityType" TEXT,
    "currentEntityId" TEXT,
    "lastIntent" TEXT,
    "lastEntities" JSONB,
    "lastToolCallIds" TEXT[],
    "lastEvidenceRefIds" TEXT[],
    "pendingClarification" JSONB,
    "pendingApprovalRequestId" TEXT,
    "taskState" "AssistantTaskState" NOT NULL DEFAULT 'idle',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantContextState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPlan" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "taskType" TEXT NOT NULL,
    "requiredEvidence" JSONB NOT NULL,
    "candidateTools" JSONB NOT NULL,
    "permissionChecks" JSONB NOT NULL,
    "riskAssessment" "RiskLevel" NOT NULL,
    "clarificationNeeds" JSONB,
    "expectedAnswerShape" JSONB,
    "requiresMultiStepToolUse" BOOLEAN NOT NULL DEFAULT false,
    "decision" "ExecutionDecision" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnswerDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" "AnswerDecisionStatus" NOT NULL,
    "noAnswerReason" "NoAnswerReason",
    "clarificationQuestionId" TEXT,
    "groundingCheckId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnswerDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClarificationQuestion" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "reason" TEXT,
    "status" "ClarificationQuestionStatus" NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ClarificationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroundingCheck" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "covered" BOOLEAN NOT NULL,
    "checkedClaimCount" INTEGER NOT NULL DEFAULT 0,
    "unsupportedClaimCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceRefIds" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroundingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "operation" "ToolOperation" NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "requiredPermissions" TEXT[],
    "riskLevel" "RiskLevel" NOT NULL,
    "hasSideEffect" BOOLEAN NOT NULL DEFAULT false,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "connectorKey" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "auditBehavior" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "toolDefinitionId" TEXT,
    "toolName" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "inputSummary" JSONB,
    "permissionResult" JSONB,
    "outputSummary" JSONB,
    "status" "ToolCallStatus" NOT NULL DEFAULT 'pending',
    "executionStatus" "ToolExecutionStatus" NOT NULL DEFAULT 'not_started',
    "idempotencyKey" TEXT,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "ToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRef" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "messageId" TEXT,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "toolCallId" TEXT,
    "documentId" TEXT,
    "chunkId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "fieldPaths" TEXT[],
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "permissionSnapshot" JSONB,
    "summary" JSONB,

    CONSTRAINT "EvidenceRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "hostApp" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "sessionId" TEXT,
    "messageId" TEXT,
    "eventType" TEXT NOT NULL,
    "decision" "AnswerDecisionStatus",
    "toolCallId" TEXT,
    "riskLevel" "RiskLevel",
    "permissionResult" JSONB,
    "evidenceRefIds" TEXT[],
    "durationMs" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "reason" TEXT,
    "comment" TEXT,
    "intent" TEXT,
    "toolCallIds" TEXT[],
    "evidenceRefIds" TEXT[],
    "answerDecision" "AnswerDecisionStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "sourceType" "ReviewSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "ReviewItemStatus" NOT NULL DEFAULT 'open',
    "priority" "ReviewPriority" NOT NULL DEFAULT 'medium',
    "summary" TEXT NOT NULL,
    "suggestedImprovement" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "requesterActorId" TEXT NOT NULL,
    "approverActorId" TEXT,
    "riskLevel" "RiskLevel" NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'pending',
    "actionSummary" JSONB NOT NULL,
    "payloadSummary" JSONB NOT NULL,
    "evidenceRefIds" TEXT[],
    "decisionReason" TEXT,
    "idempotencyKey" TEXT,
    "auditEventIds" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionDraft" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "actorId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "operation" "ToolOperation" NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "payloadSummary" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "status" "ActionDraftStatus" NOT NULL DEFAULT 'draft',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ActionDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT,
    "reason" "EscalationReason" NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'open',
    "ownerType" "EscalationOwnerType" NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "EscalationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryUnderstandingResult" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sentences" JSONB NOT NULL,
    "tokens" JSONB NOT NULL,
    "phrases" JSONB NOT NULL,
    "normalizedTerms" JSONB NOT NULL,
    "timeRanges" JSONB,
    "resolvedReferences" JSONB,
    "entityCandidates" JSONB NOT NULL,
    "subTasks" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "clarificationNeeds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryUnderstandingResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'draft',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "metadata" JSONB,
    "embeddingRef" TEXT,
    "vectorId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetrievalRun" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "messageId" TEXT,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT,
    "filters" JSONB,
    "strategy" "RetrievalStrategy" NOT NULL,
    "selectedEvidenceRefIds" TEXT[],
    "noAnswerReason" "NoAnswerReason",
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetrievalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetrievalCandidate" (
    "id" TEXT NOT NULL,
    "retrievalRunId" TEXT NOT NULL,
    "chunkId" TEXT,
    "sourceId" TEXT NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,

    CONSTRAINT "RetrievalCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantSession_organizationId_hostApp_actorId_idx" ON "AssistantSession"("organizationId", "hostApp", "actorId");

-- CreateIndex
CREATE INDEX "AssistantSession_status_updatedAt_idx" ON "AssistantSession"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_sessionId_createdAt_idx" ON "AssistantMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantMessage_requestId_idx" ON "AssistantMessage"("requestId");

-- CreateIndex
CREATE INDEX "AssistantMessage_answerDecision_idx" ON "AssistantMessage"("answerDecision");

-- CreateIndex
CREATE INDEX "AssistantContextState_sessionId_updatedAt_idx" ON "AssistantContextState"("sessionId", "updatedAt");

-- CreateIndex
CREATE INDEX "AssistantContextState_taskState_idx" ON "AssistantContextState"("taskState");

-- CreateIndex
CREATE INDEX "ExecutionPlan_sessionId_createdAt_idx" ON "ExecutionPlan"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ExecutionPlan_messageId_idx" ON "ExecutionPlan"("messageId");

-- CreateIndex
CREATE INDEX "ExecutionPlan_riskAssessment_decision_idx" ON "ExecutionPlan"("riskAssessment", "decision");

-- CreateIndex
CREATE INDEX "AnswerDecision_requestId_idx" ON "AnswerDecision"("requestId");

-- CreateIndex
CREATE INDEX "AnswerDecision_messageId_status_idx" ON "AnswerDecision"("messageId", "status");

-- CreateIndex
CREATE INDEX "ClarificationQuestion_requestId_idx" ON "ClarificationQuestion"("requestId");

-- CreateIndex
CREATE INDEX "ClarificationQuestion_messageId_status_idx" ON "ClarificationQuestion"("messageId", "status");

-- CreateIndex
CREATE INDEX "GroundingCheck_requestId_idx" ON "GroundingCheck"("requestId");

-- CreateIndex
CREATE INDEX "GroundingCheck_messageId_covered_idx" ON "GroundingCheck"("messageId", "covered");

-- CreateIndex
CREATE INDEX "ToolDefinition_connectorKey_isActive_idx" ON "ToolDefinition"("connectorKey", "isActive");

-- CreateIndex
CREATE INDEX "ToolDefinition_riskLevel_hasSideEffect_idx" ON "ToolDefinition"("riskLevel", "hasSideEffect");

-- CreateIndex
CREATE UNIQUE INDEX "ToolDefinition_name_version_key" ON "ToolDefinition"("name", "version");

-- CreateIndex
CREATE INDEX "ToolCall_requestId_idx" ON "ToolCall"("requestId");

-- CreateIndex
CREATE INDEX "ToolCall_sessionId_createdAt_idx" ON "ToolCall"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_messageId_idx" ON "ToolCall"("messageId");

-- CreateIndex
CREATE INDEX "ToolCall_toolName_toolVersion_idx" ON "ToolCall"("toolName", "toolVersion");

-- CreateIndex
CREATE INDEX "ToolCall_status_executionStatus_idx" ON "ToolCall"("status", "executionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ToolCall_idempotencyKey_key" ON "ToolCall"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EvidenceRef_requestId_idx" ON "EvidenceRef"("requestId");

-- CreateIndex
CREATE INDEX "EvidenceRef_messageId_idx" ON "EvidenceRef"("messageId");

-- CreateIndex
CREATE INDEX "EvidenceRef_sourceType_sourceId_idx" ON "EvidenceRef"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "EvidenceRef_toolCallId_idx" ON "EvidenceRef"("toolCallId");

-- CreateIndex
CREATE INDEX "EvidenceRef_documentId_idx" ON "EvidenceRef"("documentId");

-- CreateIndex
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_hostApp_actorId_idx" ON "AuditEvent"("organizationId", "hostApp", "actorId");

-- CreateIndex
CREATE INDEX "AuditEvent_sessionId_timestamp_idx" ON "AuditEvent"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_timestamp_idx" ON "AuditEvent"("eventType", "timestamp");

-- CreateIndex
CREATE INDEX "FeedbackEvent_requestId_idx" ON "FeedbackEvent"("requestId");

-- CreateIndex
CREATE INDEX "FeedbackEvent_messageId_rating_idx" ON "FeedbackEvent"("messageId", "rating");

-- CreateIndex
CREATE INDEX "ReviewItem_sourceType_sourceId_idx" ON "ReviewItem"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ReviewItem_status_priority_idx" ON "ReviewItem"("status", "priority");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestId_idx" ON "ApprovalRequest"("requestId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_sessionId_status_idx" ON "ApprovalRequest"("sessionId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requesterActorId_status_idx" ON "ApprovalRequest"("requesterActorId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_approverActorId_status_idx" ON "ApprovalRequest"("approverActorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_idempotencyKey_key" ON "ApprovalRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActionDraft_requestId_idx" ON "ActionDraft"("requestId");

-- CreateIndex
CREATE INDEX "ActionDraft_sessionId_status_idx" ON "ActionDraft"("sessionId", "status");

-- CreateIndex
CREATE INDEX "ActionDraft_actorId_status_idx" ON "ActionDraft"("actorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ActionDraft_idempotencyKey_key" ON "ActionDraft"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EscalationRequest_requestId_idx" ON "EscalationRequest"("requestId");

-- CreateIndex
CREATE INDEX "EscalationRequest_sessionId_status_idx" ON "EscalationRequest"("sessionId", "status");

-- CreateIndex
CREATE INDEX "EscalationRequest_ownerType_status_idx" ON "EscalationRequest"("ownerType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QueryUnderstandingResult_messageId_key" ON "QueryUnderstandingResult"("messageId");

-- CreateIndex
CREATE INDEX "QueryUnderstandingResult_requestId_idx" ON "QueryUnderstandingResult"("requestId");

-- CreateIndex
CREATE INDEX "QueryUnderstandingResult_confidence_idx" ON "QueryUnderstandingResult"("confidence");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_status_sourceType_idx" ON "KnowledgeDocument"("status", "sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDocument_sourceKey_version_key" ON "KnowledgeDocument"("sourceKey", "version");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_enabled_documentId_idx" ON "KnowledgeChunk"("enabled", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_documentId_chunkIndex_key" ON "KnowledgeChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "RetrievalRun_requestId_idx" ON "RetrievalRun"("requestId");

-- CreateIndex
CREATE INDEX "RetrievalRun_messageId_idx" ON "RetrievalRun"("messageId");

-- CreateIndex
CREATE INDEX "RetrievalRun_strategy_createdAt_idx" ON "RetrievalRun"("strategy", "createdAt");

-- CreateIndex
CREATE INDEX "RetrievalCandidate_retrievalRunId_rank_idx" ON "RetrievalCandidate"("retrievalRunId", "rank");

-- CreateIndex
CREATE INDEX "RetrievalCandidate_selected_idx" ON "RetrievalCandidate"("selected");

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantContextState" ADD CONSTRAINT "AssistantContextState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerDecision" ADD CONSTRAINT "AnswerDecision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerDecision" ADD CONSTRAINT "AnswerDecision_clarificationQuestionId_fkey" FOREIGN KEY ("clarificationQuestionId") REFERENCES "ClarificationQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerDecision" ADD CONSTRAINT "AnswerDecision_groundingCheckId_fkey" FOREIGN KEY ("groundingCheckId") REFERENCES "GroundingCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClarificationQuestion" ADD CONSTRAINT "ClarificationQuestion_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroundingCheck" ADD CONSTRAINT "GroundingCheck_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_toolDefinitionId_fkey" FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_toolCallId_fkey" FOREIGN KEY ("toolCallId") REFERENCES "ToolCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_toolCallId_fkey" FOREIGN KEY ("toolCallId") REFERENCES "ToolCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRequest" ADD CONSTRAINT "EscalationRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistantSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationRequest" ADD CONSTRAINT "EscalationRequest_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryUnderstandingResult" ADD CONSTRAINT "QueryUnderstandingResult_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalRun" ADD CONSTRAINT "RetrievalRun_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalCandidate" ADD CONSTRAINT "RetrievalCandidate_retrievalRunId_fkey" FOREIGN KEY ("retrievalRunId") REFERENCES "RetrievalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalCandidate" ADD CONSTRAINT "RetrievalCandidate_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
