-- Feature 002 / T030: additive customer-scope expand migration.
-- This migration intentionally does not infer ownership or access policy, set
-- defaults, remove legacy constraints, or enforce retained data.

BEGIN;

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('CUSTOMER', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerToolPolicy" (
    "customerId" TEXT NOT NULL,
    "toolDefinitionId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "requiredRoles" TEXT[] NOT NULL,
    "requiredPermissionScopes" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerToolPolicy_pkey" PRIMARY KEY ("customerId", "toolDefinitionId")
);

-- Approved retained-data input. These are operational staging tables, not
-- product models. T031 validates and drops them in the same successful release.
CREATE TABLE "_CustomerScopeApprovedCustomerRoot" (
    "customerId" TEXT NOT NULL,
    "mappingSource" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "_CustomerScopeApprovedCustomerRoot_pkey" PRIMARY KEY ("customerId")
);

CREATE TABLE "_CustomerScopeApprovedMapping" (
    "id" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "mappingSource" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "visibility" TEXT,
    "organizationIds" TEXT[],
    "requiredPermissionScopes" TEXT[],
    CONSTRAINT "_CustomerScopeApprovedMapping_pkey" PRIMARY KEY ("id")
);

-- Additive ownership columns. All are nullable until T031 validates approved
-- mappings and performs controlled backfill.
ALTER TABLE "AssistantSession" ADD COLUMN "customerId" TEXT;
ALTER TABLE "AssistantMessage" ADD COLUMN "customerId" TEXT;
ALTER TABLE "AssistantContextState" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ExecutionPlan" ADD COLUMN "customerId" TEXT;
ALTER TABLE "AnswerDecision" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ClarificationQuestion" ADD COLUMN "customerId" TEXT;
ALTER TABLE "GroundingCheck" ADD COLUMN "customerId" TEXT;
ALTER TABLE "QueryUnderstandingResult" ADD COLUMN "customerId" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "customerId" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "customerId" TEXT;
ALTER TABLE "RetrievalRun" ADD COLUMN "customerId" TEXT;
ALTER TABLE "RetrievalCandidate" ADD COLUMN "customerId" TEXT;
ALTER TABLE "EvidenceRef" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ToolCall" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ActionDraft" ADD COLUMN "customerId" TEXT;
ALTER TABLE "EscalationRequest" ADD COLUMN "customerId" TEXT;
ALTER TABLE "FeedbackEvent" ADD COLUMN "customerId" TEXT;
ALTER TABLE "ReviewItem" ADD COLUMN "customerId" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "customerId" TEXT;

-- Additive KnowledgeDocument policy fields; no defaults are allowed.
ALTER TABLE "KnowledgeDocument" ADD COLUMN "visibility" "KnowledgeVisibility";
ALTER TABLE "KnowledgeDocument" ADD COLUMN "organizationIds" TEXT[];
ALTER TABLE "KnowledgeDocument" ADD COLUMN "requiredPermissionScopes" TEXT[];

-- Existing workflow rows have no approved ToolCall relation in this migration.
ALTER TABLE "ApprovalRequest" ADD COLUMN "toolCallId" TEXT;
ALTER TABLE "ActionDraft" ADD COLUMN "toolCallId" TEXT;

-- Composite parent keys required for Customer-qualified relations.
CREATE UNIQUE INDEX "AssistantSession_customerId_id_key" ON "AssistantSession"("customerId", "id");
CREATE UNIQUE INDEX "AssistantMessage_customerId_id_key" ON "AssistantMessage"("customerId", "id");
CREATE UNIQUE INDEX "KnowledgeDocument_customerId_id_key" ON "KnowledgeDocument"("customerId", "id");
CREATE UNIQUE INDEX "KnowledgeChunk_customerId_id_key" ON "KnowledgeChunk"("customerId", "id");
CREATE UNIQUE INDEX "RetrievalRun_customerId_id_key" ON "RetrievalRun"("customerId", "id");
CREATE UNIQUE INDEX "RetrievalCandidate_customerId_id_key" ON "RetrievalCandidate"("customerId", "id");
CREATE UNIQUE INDEX "EvidenceRef_customerId_id_key" ON "EvidenceRef"("customerId", "id");
CREATE UNIQUE INDEX "ToolCall_customerId_id_key" ON "ToolCall"("customerId", "id");
CREATE UNIQUE INDEX "ApprovalRequest_customerId_id_key" ON "ApprovalRequest"("customerId", "id");
CREATE UNIQUE INDEX "ActionDraft_customerId_id_key" ON "ActionDraft"("customerId", "id");
CREATE UNIQUE INDEX "EscalationRequest_customerId_id_key" ON "EscalationRequest"("customerId", "id");
CREATE UNIQUE INDEX "FeedbackEvent_customerId_id_key" ON "FeedbackEvent"("customerId", "id");
CREATE UNIQUE INDEX "ReviewItem_customerId_id_key" ON "ReviewItem"("customerId", "id");
CREATE UNIQUE INDEX "AuditEvent_customerId_id_key" ON "AuditEvent"("customerId", "id");

-- Customer-first indexes from the final logical schema. Legacy/global indexes
-- remain until T031 because existing application paths still rely on them.
CREATE INDEX "AssistantSession_customerId_organizationId_hostApp_actorId_idx" ON "AssistantSession"("customerId", "organizationId", "hostApp", "actorId");
CREATE INDEX "AssistantSession_customerId_status_idx" ON "AssistantSession"("customerId", "status");
CREATE INDEX "AssistantSession_customerId_updatedAt_idx" ON "AssistantSession"("customerId", "updatedAt");
CREATE INDEX "AssistantMessage_customerId_sessionId_createdAt_idx" ON "AssistantMessage"("customerId", "sessionId", "createdAt");
CREATE INDEX "AssistantContextState_customerId_sessionId_updatedAt_idx" ON "AssistantContextState"("customerId", "sessionId", "updatedAt");
CREATE INDEX "ExecutionPlan_customerId_sessionId_createdAt_idx" ON "ExecutionPlan"("customerId", "sessionId", "createdAt");
CREATE INDEX "ExecutionPlan_customerId_messageId_idx" ON "ExecutionPlan"("customerId", "messageId");
CREATE INDEX "AnswerDecision_customerId_messageId_status_idx" ON "AnswerDecision"("customerId", "messageId", "status");
CREATE INDEX "ClarificationQuestion_customerId_messageId_status_idx" ON "ClarificationQuestion"("customerId", "messageId", "status");
CREATE INDEX "GroundingCheck_customerId_messageId_covered_idx" ON "GroundingCheck"("customerId", "messageId", "covered");
CREATE INDEX "ToolCall_customerId_requestId_idx" ON "ToolCall"("customerId", "requestId");
CREATE INDEX "ToolCall_customerId_sessionId_createdAt_idx" ON "ToolCall"("customerId", "sessionId", "createdAt");
CREATE INDEX "ToolCall_customerId_messageId_idx" ON "ToolCall"("customerId", "messageId");
CREATE INDEX "ToolCall_customerId_toolDefinitionId_idx" ON "ToolCall"("customerId", "toolDefinitionId");
CREATE INDEX "ToolCall_customerId_toolName_toolVersion_idx" ON "ToolCall"("customerId", "toolName", "toolVersion");
CREATE INDEX "ToolCall_customerId_status_executionStatus_idx" ON "ToolCall"("customerId", "status", "executionStatus");
CREATE INDEX "EvidenceRef_customerId_requestId_idx" ON "EvidenceRef"("customerId", "requestId");
CREATE INDEX "EvidenceRef_customerId_messageId_idx" ON "EvidenceRef"("customerId", "messageId");
CREATE INDEX "EvidenceRef_customerId_sourceType_sourceId_idx" ON "EvidenceRef"("customerId", "sourceType", "sourceId");
CREATE INDEX "EvidenceRef_customerId_toolCallId_idx" ON "EvidenceRef"("customerId", "toolCallId");
CREATE INDEX "EvidenceRef_customerId_documentId_idx" ON "EvidenceRef"("customerId", "documentId");
CREATE INDEX "EvidenceRef_customerId_chunkId_idx" ON "EvidenceRef"("customerId", "chunkId");
CREATE INDEX "AuditEvent_customerId_requestId_idx" ON "AuditEvent"("customerId", "requestId");
CREATE INDEX "AuditEvent_customerId_organizationId_hostApp_actorId_idx" ON "AuditEvent"("customerId", "organizationId", "hostApp", "actorId");
CREATE INDEX "AuditEvent_customerId_sessionId_timestamp_idx" ON "AuditEvent"("customerId", "sessionId", "timestamp");
CREATE INDEX "AuditEvent_customerId_messageId_timestamp_idx" ON "AuditEvent"("customerId", "messageId", "timestamp");
CREATE INDEX "AuditEvent_customerId_toolCallId_timestamp_idx" ON "AuditEvent"("customerId", "toolCallId", "timestamp");
CREATE INDEX "AuditEvent_customerId_eventType_timestamp_idx" ON "AuditEvent"("customerId", "eventType", "timestamp");
CREATE INDEX "FeedbackEvent_customerId_requestId_idx" ON "FeedbackEvent"("customerId", "requestId");
CREATE INDEX "FeedbackEvent_customerId_messageId_rating_idx" ON "FeedbackEvent"("customerId", "messageId", "rating");
CREATE INDEX "ReviewItem_customerId_sourceType_sourceId_idx" ON "ReviewItem"("customerId", "sourceType", "sourceId");
CREATE INDEX "ReviewItem_customerId_status_priority_idx" ON "ReviewItem"("customerId", "status", "priority");
CREATE INDEX "ApprovalRequest_customerId_requestId_idx" ON "ApprovalRequest"("customerId", "requestId");
CREATE INDEX "ApprovalRequest_customerId_sessionId_status_idx" ON "ApprovalRequest"("customerId", "sessionId", "status");
CREATE INDEX "ApprovalRequest_customerId_messageId_idx" ON "ApprovalRequest"("customerId", "messageId");
CREATE INDEX "ApprovalRequest_customerId_toolCallId_idx" ON "ApprovalRequest"("customerId", "toolCallId");
CREATE INDEX "ApprovalRequest_customerId_requesterActorId_status_idx" ON "ApprovalRequest"("customerId", "requesterActorId", "status");
CREATE INDEX "ApprovalRequest_customerId_approverActorId_status_idx" ON "ApprovalRequest"("customerId", "approverActorId", "status");
CREATE INDEX "ActionDraft_customerId_requestId_idx" ON "ActionDraft"("customerId", "requestId");
CREATE INDEX "ActionDraft_customerId_sessionId_status_idx" ON "ActionDraft"("customerId", "sessionId", "status");
CREATE INDEX "ActionDraft_customerId_messageId_idx" ON "ActionDraft"("customerId", "messageId");
CREATE INDEX "ActionDraft_customerId_toolCallId_idx" ON "ActionDraft"("customerId", "toolCallId");
CREATE INDEX "ActionDraft_customerId_actorId_status_idx" ON "ActionDraft"("customerId", "actorId", "status");
CREATE INDEX "EscalationRequest_customerId_requestId_idx" ON "EscalationRequest"("customerId", "requestId");
CREATE INDEX "EscalationRequest_customerId_sessionId_status_idx" ON "EscalationRequest"("customerId", "sessionId", "status");
CREATE INDEX "EscalationRequest_customerId_messageId_idx" ON "EscalationRequest"("customerId", "messageId");
CREATE INDEX "EscalationRequest_customerId_ownerType_status_idx" ON "EscalationRequest"("customerId", "ownerType", "status");
CREATE INDEX "KnowledgeDocument_customerId_status_sourceType_idx" ON "KnowledgeDocument"("customerId", "status", "sourceType");
CREATE INDEX "KnowledgeDocument_customerId_visibility_status_idx" ON "KnowledgeDocument"("customerId", "visibility", "status");
CREATE INDEX "KnowledgeDocument_organizationIds_idx" ON "KnowledgeDocument" USING GIN ("organizationIds");
CREATE INDEX "KnowledgeDocument_requiredPermissionScopes_idx" ON "KnowledgeDocument" USING GIN ("requiredPermissionScopes");
CREATE INDEX "KnowledgeChunk_customerId_enabled_documentId_idx" ON "KnowledgeChunk"("customerId", "enabled", "documentId");
CREATE INDEX "RetrievalRun_customerId_requestId_idx" ON "RetrievalRun"("customerId", "requestId");
CREATE INDEX "RetrievalRun_customerId_messageId_idx" ON "RetrievalRun"("customerId", "messageId");
CREATE INDEX "RetrievalRun_customerId_strategy_createdAt_idx" ON "RetrievalRun"("customerId", "strategy", "createdAt");
CREATE INDEX "RetrievalCandidate_customerId_retrievalRunId_rank_idx" ON "RetrievalCandidate"("customerId", "retrievalRunId", "rank");
CREATE INDEX "RetrievalCandidate_customerId_chunkId_idx" ON "RetrievalCandidate"("customerId", "chunkId");
CREATE INDEX "RetrievalCandidate_customerId_selected_idx" ON "RetrievalCandidate"("customerId", "selected");
CREATE INDEX "CustomerToolPolicy_customerId_enabled_idx" ON "CustomerToolPolicy"("customerId", "enabled");
CREATE INDEX "CustomerToolPolicy_toolDefinitionId_idx" ON "CustomerToolPolicy"("toolDefinitionId");
CREATE INDEX "_CustomerScopeApprovedMapping_recordType_recordId_idx" ON "_CustomerScopeApprovedMapping"("recordType", "recordId");
CREATE INDEX "_CustomerScopeApprovedMapping_customerId_idx" ON "_CustomerScopeApprovedMapping"("customerId");

-- New Customer and Customer-qualified integrity. NOT VALID permits retained
-- rows to remain null during the Release A maintenance window.
ALTER TABLE "CustomerToolPolicy" ADD CONSTRAINT "CustomerToolPolicy_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerToolPolicy" ADD CONSTRAINT "CustomerToolPolicy_toolDefinitionId_fkey" FOREIGN KEY ("toolDefinitionId") REFERENCES "ToolDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantSession" ADD CONSTRAINT "AssistantSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RetrievalRun" ADD CONSTRAINT "RetrievalRun_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RetrievalCandidate" ADD CONSTRAINT "RetrievalCandidate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EscalationRequest" ADD CONSTRAINT "EscalationRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AssistantContextState" ADD CONSTRAINT "AssistantContextState_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AnswerDecision" ADD CONSTRAINT "AnswerDecision_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ClarificationQuestion" ADD CONSTRAINT "ClarificationQuestion_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "GroundingCheck" ADD CONSTRAINT "GroundingCheck_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "QueryUnderstandingResult" ADD CONSTRAINT "QueryUnderstandingResult_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_customerId_documentId_fkey" FOREIGN KEY ("customerId", "documentId") REFERENCES "KnowledgeDocument"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RetrievalRun" ADD CONSTRAINT "RetrievalRun_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RetrievalCandidate" ADD CONSTRAINT "RetrievalCandidate_customerId_retrievalRunId_fkey" FOREIGN KEY ("customerId", "retrievalRunId") REFERENCES "RetrievalRun"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "RetrievalCandidate" ADD CONSTRAINT "RetrievalCandidate_customerId_chunkId_fkey" FOREIGN KEY ("customerId", "chunkId") REFERENCES "KnowledgeChunk"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_customerId_toolCallId_fkey" FOREIGN KEY ("customerId", "toolCallId") REFERENCES "ToolCall"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_customerId_documentId_fkey" FOREIGN KEY ("customerId", "documentId") REFERENCES "KnowledgeDocument"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EvidenceRef" ADD CONSTRAINT "EvidenceRef_customerId_chunkId_fkey" FOREIGN KEY ("customerId", "chunkId") REFERENCES "KnowledgeChunk"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ToolCall" ADD CONSTRAINT "ToolCall_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_customerId_toolCallId_fkey" FOREIGN KEY ("customerId", "toolCallId") REFERENCES "ToolCall"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ActionDraft" ADD CONSTRAINT "ActionDraft_customerId_toolCallId_fkey" FOREIGN KEY ("customerId", "toolCallId") REFERENCES "ToolCall"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EscalationRequest" ADD CONSTRAINT "EscalationRequest_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EscalationRequest" ADD CONSTRAINT "EscalationRequest_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT "FeedbackEvent_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_customerId_sessionId_fkey" FOREIGN KEY ("customerId", "sessionId") REFERENCES "AssistantSession"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_customerId_messageId_fkey" FOREIGN KEY ("customerId", "messageId") REFERENCES "AssistantMessage"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_customerId_toolCallId_fkey" FOREIGN KEY ("customerId", "toolCallId") REFERENCES "ToolCall"("customerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

COMMIT;
