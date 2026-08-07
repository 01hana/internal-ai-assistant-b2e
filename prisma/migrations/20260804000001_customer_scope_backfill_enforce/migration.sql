-- Feature 002 / T031: approved mapping, controlled backfill, and enforcement.
-- This migration explicitly owns its PostgreSQL transaction. Do not run it on
-- retained data until Release A has been deployed, writes/retrieval have been
-- frozen, and staging input loaded.

BEGIN;

-- Database-only integrity: Prisma cannot express normalized-array policy checks.
CREATE FUNCTION "_customer_scope_is_normalized_text_array"("values" TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT
    "values" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM unnest("values") AS value
      WHERE value IS NULL OR btrim(value) = '' OR value <> btrim(value)
    )
    AND cardinality("values") = (
      SELECT count(DISTINCT value)::INTEGER
      FROM unnest("values") AS value
    );
$$;

-- Materialize the exact retained rows. This prevents parent traversal or any
-- lower-level identity value from becoming an implicit ownership mapping.
CREATE TEMP TABLE "_customer_scope_expected_records" ON COMMIT DROP AS
SELECT 'AssistantSession'::TEXT AS "recordType", "id" AS "recordId" FROM "AssistantSession"
UNION ALL SELECT 'AssistantMessage', "id" FROM "AssistantMessage"
UNION ALL SELECT 'AssistantContextState', "id" FROM "AssistantContextState"
UNION ALL SELECT 'ExecutionPlan', "id" FROM "ExecutionPlan"
UNION ALL SELECT 'AnswerDecision', "id" FROM "AnswerDecision"
UNION ALL SELECT 'ClarificationQuestion', "id" FROM "ClarificationQuestion"
UNION ALL SELECT 'GroundingCheck', "id" FROM "GroundingCheck"
UNION ALL SELECT 'QueryUnderstandingResult', "id" FROM "QueryUnderstandingResult"
UNION ALL SELECT 'KnowledgeDocument', "id" FROM "KnowledgeDocument"
UNION ALL SELECT 'KnowledgeChunk', "id" FROM "KnowledgeChunk"
UNION ALL SELECT 'RetrievalRun', "id" FROM "RetrievalRun"
UNION ALL SELECT 'RetrievalCandidate', "id" FROM "RetrievalCandidate"
UNION ALL SELECT 'EvidenceRef', "id" FROM "EvidenceRef"
UNION ALL SELECT 'ToolCall', "id" FROM "ToolCall"
UNION ALL SELECT 'ApprovalRequest', "id" FROM "ApprovalRequest"
UNION ALL SELECT 'ActionDraft', "id" FROM "ActionDraft"
UNION ALL SELECT 'EscalationRequest', "id" FROM "EscalationRequest"
UNION ALL SELECT 'FeedbackEvent', "id" FROM "FeedbackEvent"
UNION ALL SELECT 'ReviewItem', "id" FROM "ReviewItem"
UNION ALL SELECT 'AuditEvent', "id" FROM "AuditEvent";

DO $$
DECLARE
  violation_count BIGINT;
BEGIN
  -- Root approvals are required even if a Customer with the same id exists.
  SELECT count(*) INTO violation_count FROM (
    SELECT 1 FROM "_CustomerScopeApprovedCustomerRoot"
    WHERE btrim("customerId") = '' OR btrim("mappingSource") = '' OR btrim("approvedBy") = ''
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_INVALID_ROOT_APPROVAL count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1 FROM "_CustomerScopeApprovedMapping"
    WHERE btrim("recordType") = '' OR btrim("recordId") = '' OR btrim("customerId") = ''
       OR btrim("mappingSource") = '' OR btrim("approvedBy") = ''
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_INVALID_MAPPING_APPROVAL count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1 FROM "_CustomerScopeApprovedMapping"
    WHERE "recordType" NOT IN (
      'AssistantSession', 'AssistantMessage', 'AssistantContextState', 'ExecutionPlan',
      'AnswerDecision', 'ClarificationQuestion', 'GroundingCheck', 'QueryUnderstandingResult',
      'KnowledgeDocument', 'KnowledgeChunk', 'RetrievalRun', 'RetrievalCandidate', 'EvidenceRef',
      'ToolCall', 'ApprovalRequest', 'ActionDraft', 'EscalationRequest', 'FeedbackEvent',
      'ReviewItem', 'AuditEvent'
    )
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_UNKNOWN_RECORD_TYPE count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1
    FROM "_CustomerScopeApprovedMapping" AS mapping
    LEFT JOIN "_CustomerScopeApprovedCustomerRoot" AS root
      ON root."customerId" = mapping."customerId"
    WHERE root."customerId" IS NULL
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_UNAPPROVED_CUSTOMER_ROOT count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1
    FROM "_CustomerScopeApprovedMapping" AS mapping
    LEFT JOIN "_customer_scope_expected_records" AS expected
      ON expected."recordType" = mapping."recordType" AND expected."recordId" = mapping."recordId"
    WHERE expected."recordId" IS NULL
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_MAPPING_UNKNOWN_RECORD count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1
    FROM "_CustomerScopeApprovedMapping"
    GROUP BY "recordType", "recordId"
    HAVING count(*) <> 1
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_AMBIGUOUS_MAPPING count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1
    FROM "_customer_scope_expected_records" AS expected
    LEFT JOIN "_CustomerScopeApprovedMapping" AS mapping
      ON mapping."recordType" = expected."recordType" AND mapping."recordId" = expected."recordId"
    WHERE mapping."id" IS NULL
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_UNMAPPED_RECORD count=%', violation_count;
  END IF;

  -- Policy is explicit only for KnowledgeDocument. Empty scopes are valid;
  -- non-empty scopes are interpreted as ALL by the retrieval implementation.
  SELECT count(*) INTO violation_count FROM (
    SELECT 1
    FROM "_CustomerScopeApprovedMapping"
    WHERE "recordType" = 'KnowledgeDocument'
      AND (
        "visibility" IS NULL
        OR "organizationIds" IS NULL
        OR "requiredPermissionScopes" IS NULL
        OR "visibility" NOT IN ('CUSTOMER', 'ORGANIZATION')
        OR NOT "_customer_scope_is_normalized_text_array"("organizationIds")
        OR NOT "_customer_scope_is_normalized_text_array"("requiredPermissionScopes")
        OR ("visibility" = 'CUSTOMER' AND cardinality("organizationIds") <> 0)
        OR ("visibility" = 'ORGANIZATION' AND cardinality("organizationIds") = 0)
      )
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_INVALID_KNOWLEDGE_POLICY count=%', violation_count;
  END IF;

  -- Validate mapped parent/child ownership before any UPDATE. NOT VALID foreign
  -- keys still enforce changed rows, so this preserves the safe reason-code
  -- contract instead of leaking a PostgreSQL FK detail during controlled backfill.
  SELECT count(*) INTO violation_count FROM (
    SELECT 1 FROM "AssistantMessage" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'AssistantMessage' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "AssistantContextState" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'AssistantContextState' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ExecutionPlan" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ExecutionPlan' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ExecutionPlan" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ExecutionPlan' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "AnswerDecision" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'AnswerDecision' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ClarificationQuestion" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ClarificationQuestion' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "GroundingCheck" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'GroundingCheck' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "QueryUnderstandingResult" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'QueryUnderstandingResult' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "KnowledgeChunk" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'KnowledgeChunk' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'KnowledgeDocument' AND pm."recordId" = c."documentId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "RetrievalRun" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'RetrievalRun' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "RetrievalCandidate" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'RetrievalCandidate' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'RetrievalRun' AND pm."recordId" = c."retrievalRunId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "RetrievalCandidate" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'RetrievalCandidate' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'KnowledgeChunk' AND pm."recordId" = c."chunkId" WHERE c."chunkId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "EvidenceRef" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'EvidenceRef' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "EvidenceRef" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'EvidenceRef' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'ToolCall' AND pm."recordId" = c."toolCallId" WHERE c."toolCallId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "EvidenceRef" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'EvidenceRef' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'KnowledgeDocument' AND pm."recordId" = c."documentId" WHERE c."documentId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "EvidenceRef" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'EvidenceRef' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'KnowledgeChunk' AND pm."recordId" = c."chunkId" WHERE c."chunkId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ToolCall" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ToolCall' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ToolCall" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ToolCall' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ApprovalRequest" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ApprovalRequest' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ApprovalRequest" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ApprovalRequest' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ApprovalRequest" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ApprovalRequest' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'ToolCall' AND pm."recordId" = c."toolCallId" WHERE c."toolCallId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ActionDraft" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ActionDraft' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ActionDraft" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ActionDraft' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "ActionDraft" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'ActionDraft' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'ToolCall' AND pm."recordId" = c."toolCallId" WHERE c."toolCallId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "EscalationRequest" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'EscalationRequest' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "EscalationRequest" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'EscalationRequest' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "FeedbackEvent" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'FeedbackEvent' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "AuditEvent" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'AuditEvent' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantSession' AND pm."recordId" = c."sessionId" WHERE c."sessionId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "AuditEvent" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'AuditEvent' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'AssistantMessage' AND pm."recordId" = c."messageId" WHERE c."messageId" IS NOT NULL AND cm."customerId" <> pm."customerId"
    UNION ALL SELECT 1 FROM "AuditEvent" c JOIN "_CustomerScopeApprovedMapping" cm ON cm."recordType" = 'AuditEvent' AND cm."recordId" = c."id" JOIN "_CustomerScopeApprovedMapping" pm ON pm."recordType" = 'ToolCall' AND pm."recordId" = c."toolCallId" WHERE c."toolCallId" IS NOT NULL AND cm."customerId" <> pm."customerId"
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_RELATION_CONFLICT count=%', violation_count;
  END IF;
END $$;

-- Register only roots supplied through approved staging input. No record mapping
-- may manufacture a Customer root.
INSERT INTO "Customer" ("id")
SELECT "customerId" FROM "_CustomerScopeApprovedCustomerRoot"
ON CONFLICT ("id") DO NOTHING;

-- Controlled backfill: every update joins only an explicit recordType/recordId
-- mapping. ApprovalRequest/ActionDraft.toolCallId stays NULL for retained rows.
UPDATE "AssistantSession" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'AssistantSession' AND mapping."recordId" = record."id";
UPDATE "AssistantMessage" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'AssistantMessage' AND mapping."recordId" = record."id";
UPDATE "AssistantContextState" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'AssistantContextState' AND mapping."recordId" = record."id";
UPDATE "ExecutionPlan" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'ExecutionPlan' AND mapping."recordId" = record."id";
UPDATE "AnswerDecision" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'AnswerDecision' AND mapping."recordId" = record."id";
UPDATE "ClarificationQuestion" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'ClarificationQuestion' AND mapping."recordId" = record."id";
UPDATE "GroundingCheck" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'GroundingCheck' AND mapping."recordId" = record."id";
UPDATE "QueryUnderstandingResult" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'QueryUnderstandingResult' AND mapping."recordId" = record."id";
UPDATE "KnowledgeDocument" AS record
SET "customerId" = mapping."customerId", "visibility" = mapping."visibility"::"KnowledgeVisibility",
    "organizationIds" = mapping."organizationIds", "requiredPermissionScopes" = mapping."requiredPermissionScopes"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'KnowledgeDocument' AND mapping."recordId" = record."id";
UPDATE "KnowledgeChunk" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'KnowledgeChunk' AND mapping."recordId" = record."id";
UPDATE "RetrievalRun" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'RetrievalRun' AND mapping."recordId" = record."id";
UPDATE "RetrievalCandidate" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'RetrievalCandidate' AND mapping."recordId" = record."id";
-- ToolCall is a parent of EvidenceRef through a NOT VALID composite FK. PostgreSQL
-- still enforces that FK for these UPDATEd rows, so parent ownership is backfilled first.
UPDATE "ToolCall" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'ToolCall' AND mapping."recordId" = record."id";
UPDATE "EvidenceRef" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'EvidenceRef' AND mapping."recordId" = record."id";
UPDATE "ApprovalRequest" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'ApprovalRequest' AND mapping."recordId" = record."id";
UPDATE "ActionDraft" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'ActionDraft' AND mapping."recordId" = record."id";
UPDATE "EscalationRequest" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'EscalationRequest' AND mapping."recordId" = record."id";
UPDATE "FeedbackEvent" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'FeedbackEvent' AND mapping."recordId" = record."id";
UPDATE "ReviewItem" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'ReviewItem' AND mapping."recordId" = record."id";
UPDATE "AuditEvent" AS record SET "customerId" = mapping."customerId"
FROM "_CustomerScopeApprovedMapping" AS mapping WHERE mapping."recordType" = 'AuditEvent' AND mapping."recordId" = record."id";

-- Backfill validation before enforcing constraints. The relation checks are
-- Customer-qualified and cover only non-null optional parent IDs.
DO $$
DECLARE
  violation_count BIGINT;
BEGIN
  SELECT count(*) INTO violation_count FROM (
    SELECT 1 FROM "AssistantSession" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "AssistantMessage" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "AssistantContextState" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "ExecutionPlan" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "AnswerDecision" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "ClarificationQuestion" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "GroundingCheck" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "QueryUnderstandingResult" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "KnowledgeDocument" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "KnowledgeChunk" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "RetrievalRun" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "RetrievalCandidate" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "EvidenceRef" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "ToolCall" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "ApprovalRequest" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "ActionDraft" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "EscalationRequest" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "FeedbackEvent" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "ReviewItem" WHERE "customerId" IS NULL OR btrim("customerId") = ''
    UNION ALL SELECT 1 FROM "AuditEvent" WHERE "customerId" IS NULL OR btrim("customerId") = ''
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_INVALID_CUSTOMER_BACKFILL count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1 FROM "AssistantMessage" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "AssistantContextState" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "ExecutionPlan" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "ExecutionPlan" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "AnswerDecision" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "ClarificationQuestion" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "GroundingCheck" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "QueryUnderstandingResult" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "KnowledgeChunk" c LEFT JOIN "KnowledgeDocument" p ON p."id" = c."documentId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "RetrievalRun" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "RetrievalCandidate" c LEFT JOIN "RetrievalRun" p ON p."id" = c."retrievalRunId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "RetrievalCandidate" c LEFT JOIN "KnowledgeChunk" p ON p."id" = c."chunkId" AND p."customerId" = c."customerId" WHERE c."chunkId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "EvidenceRef" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "EvidenceRef" c LEFT JOIN "ToolCall" p ON p."id" = c."toolCallId" AND p."customerId" = c."customerId" WHERE c."toolCallId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "EvidenceRef" c LEFT JOIN "KnowledgeDocument" p ON p."id" = c."documentId" AND p."customerId" = c."customerId" WHERE c."documentId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "EvidenceRef" c LEFT JOIN "KnowledgeChunk" p ON p."id" = c."chunkId" AND p."customerId" = c."customerId" WHERE c."chunkId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "ToolCall" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "ToolCall" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "ApprovalRequest" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "ApprovalRequest" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "ApprovalRequest" c LEFT JOIN "ToolCall" p ON p."id" = c."toolCallId" AND p."customerId" = c."customerId" WHERE c."toolCallId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "ActionDraft" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "ActionDraft" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "ActionDraft" c LEFT JOIN "ToolCall" p ON p."id" = c."toolCallId" AND p."customerId" = c."customerId" WHERE c."toolCallId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "EscalationRequest" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "EscalationRequest" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "FeedbackEvent" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE p."id" IS NULL
    UNION ALL SELECT 1 FROM "AuditEvent" c LEFT JOIN "AssistantSession" p ON p."id" = c."sessionId" AND p."customerId" = c."customerId" WHERE c."sessionId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "AuditEvent" c LEFT JOIN "AssistantMessage" p ON p."id" = c."messageId" AND p."customerId" = c."customerId" WHERE c."messageId" IS NOT NULL AND p."id" IS NULL
    UNION ALL SELECT 1 FROM "AuditEvent" c LEFT JOIN "ToolCall" p ON p."id" = c."toolCallId" AND p."customerId" = c."customerId" WHERE c."toolCallId" IS NOT NULL AND p."id" IS NULL
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_RELATION_CONFLICT count=%', violation_count;
  END IF;

  SELECT count(*) INTO violation_count FROM (
    SELECT 1 FROM "KnowledgeDocument" GROUP BY "customerId", "sourceKey", "version" HAVING count(*) > 1
    UNION ALL SELECT 1 FROM "KnowledgeChunk" GROUP BY "customerId", "documentId", "chunkIndex" HAVING count(*) > 1
    UNION ALL SELECT 1 FROM "QueryUnderstandingResult" GROUP BY "customerId", "messageId" HAVING count(*) > 1
    UNION ALL SELECT 1 FROM "ToolCall" WHERE "idempotencyKey" IS NOT NULL GROUP BY "customerId", "idempotencyKey" HAVING count(*) > 1
    UNION ALL SELECT 1 FROM "ApprovalRequest" WHERE "idempotencyKey" IS NOT NULL GROUP BY "customerId", "idempotencyKey" HAVING count(*) > 1
    UNION ALL SELECT 1 FROM "ActionDraft" WHERE "idempotencyKey" IS NOT NULL GROUP BY "customerId", "idempotencyKey" HAVING count(*) > 1
  ) AS violations;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'CUSTOMER_SCOPE_SCOPED_UNIQUENESS_CONFLICT count=%', violation_count;
  END IF;
END $$;

-- Final policy constraints are intentionally database-only integrity.
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_visibility_organizationIds_check"
  CHECK (("visibility" = 'CUSTOMER' AND cardinality("organizationIds") = 0) OR ("visibility" = 'ORGANIZATION' AND cardinality("organizationIds") > 0)) NOT VALID;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_organizationIds_normalized_check"
  CHECK ("_customer_scope_is_normalized_text_array"("organizationIds")) NOT VALID;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_requiredPermissionScopes_normalized_check"
  CHECK ("_customer_scope_is_normalized_text_array"("requiredPermissionScopes")) NOT VALID;

ALTER TABLE "AssistantSession" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "AssistantMessage" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "AssistantContextState" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "ExecutionPlan" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "AnswerDecision" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "ClarificationQuestion" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "GroundingCheck" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "QueryUnderstandingResult" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "visibility" SET NOT NULL;
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "organizationIds" SET NOT NULL;
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "requiredPermissionScopes" SET NOT NULL;
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "RetrievalRun" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "RetrievalCandidate" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "EvidenceRef" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "ToolCall" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "ApprovalRequest" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "ActionDraft" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "EscalationRequest" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "FeedbackEvent" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "ReviewItem" ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "AuditEvent" ALTER COLUMN "customerId" SET NOT NULL;

ALTER TABLE "KnowledgeDocument" VALIDATE CONSTRAINT "KnowledgeDocument_visibility_organizationIds_check";
ALTER TABLE "KnowledgeDocument" VALIDATE CONSTRAINT "KnowledgeDocument_organizationIds_normalized_check";
ALTER TABLE "KnowledgeDocument" VALIDATE CONSTRAINT "KnowledgeDocument_requiredPermissionScopes_normalized_check";

ALTER TABLE "AssistantSession" VALIDATE CONSTRAINT "AssistantSession_customerId_fkey";
ALTER TABLE "AssistantMessage" VALIDATE CONSTRAINT "AssistantMessage_customerId_fkey";
ALTER TABLE "KnowledgeDocument" VALIDATE CONSTRAINT "KnowledgeDocument_customerId_fkey";
ALTER TABLE "KnowledgeChunk" VALIDATE CONSTRAINT "KnowledgeChunk_customerId_fkey";
ALTER TABLE "RetrievalRun" VALIDATE CONSTRAINT "RetrievalRun_customerId_fkey";
ALTER TABLE "RetrievalCandidate" VALIDATE CONSTRAINT "RetrievalCandidate_customerId_fkey";
ALTER TABLE "EvidenceRef" VALIDATE CONSTRAINT "EvidenceRef_customerId_fkey";
ALTER TABLE "ToolCall" VALIDATE CONSTRAINT "ToolCall_customerId_fkey";
ALTER TABLE "ApprovalRequest" VALIDATE CONSTRAINT "ApprovalRequest_customerId_fkey";
ALTER TABLE "ActionDraft" VALIDATE CONSTRAINT "ActionDraft_customerId_fkey";
ALTER TABLE "EscalationRequest" VALIDATE CONSTRAINT "EscalationRequest_customerId_fkey";
ALTER TABLE "FeedbackEvent" VALIDATE CONSTRAINT "FeedbackEvent_customerId_fkey";
ALTER TABLE "ReviewItem" VALIDATE CONSTRAINT "ReviewItem_customerId_fkey";
ALTER TABLE "AuditEvent" VALIDATE CONSTRAINT "AuditEvent_customerId_fkey";
ALTER TABLE "AssistantMessage" VALIDATE CONSTRAINT "AssistantMessage_customerId_sessionId_fkey";
ALTER TABLE "AssistantContextState" VALIDATE CONSTRAINT "AssistantContextState_customerId_sessionId_fkey";
ALTER TABLE "ExecutionPlan" VALIDATE CONSTRAINT "ExecutionPlan_customerId_sessionId_fkey";
ALTER TABLE "ExecutionPlan" VALIDATE CONSTRAINT "ExecutionPlan_customerId_messageId_fkey";
ALTER TABLE "AnswerDecision" VALIDATE CONSTRAINT "AnswerDecision_customerId_messageId_fkey";
ALTER TABLE "ClarificationQuestion" VALIDATE CONSTRAINT "ClarificationQuestion_customerId_messageId_fkey";
ALTER TABLE "GroundingCheck" VALIDATE CONSTRAINT "GroundingCheck_customerId_messageId_fkey";
ALTER TABLE "QueryUnderstandingResult" VALIDATE CONSTRAINT "QueryUnderstandingResult_customerId_messageId_fkey";
ALTER TABLE "KnowledgeChunk" VALIDATE CONSTRAINT "KnowledgeChunk_customerId_documentId_fkey";
ALTER TABLE "RetrievalRun" VALIDATE CONSTRAINT "RetrievalRun_customerId_messageId_fkey";
ALTER TABLE "RetrievalCandidate" VALIDATE CONSTRAINT "RetrievalCandidate_customerId_retrievalRunId_fkey";
ALTER TABLE "RetrievalCandidate" VALIDATE CONSTRAINT "RetrievalCandidate_customerId_chunkId_fkey";
ALTER TABLE "EvidenceRef" VALIDATE CONSTRAINT "EvidenceRef_customerId_messageId_fkey";
ALTER TABLE "EvidenceRef" VALIDATE CONSTRAINT "EvidenceRef_customerId_toolCallId_fkey";
ALTER TABLE "EvidenceRef" VALIDATE CONSTRAINT "EvidenceRef_customerId_documentId_fkey";
ALTER TABLE "EvidenceRef" VALIDATE CONSTRAINT "EvidenceRef_customerId_chunkId_fkey";
ALTER TABLE "ToolCall" VALIDATE CONSTRAINT "ToolCall_customerId_sessionId_fkey";
ALTER TABLE "ToolCall" VALIDATE CONSTRAINT "ToolCall_customerId_messageId_fkey";
ALTER TABLE "ApprovalRequest" VALIDATE CONSTRAINT "ApprovalRequest_customerId_sessionId_fkey";
ALTER TABLE "ApprovalRequest" VALIDATE CONSTRAINT "ApprovalRequest_customerId_messageId_fkey";
ALTER TABLE "ApprovalRequest" VALIDATE CONSTRAINT "ApprovalRequest_customerId_toolCallId_fkey";
ALTER TABLE "ActionDraft" VALIDATE CONSTRAINT "ActionDraft_customerId_sessionId_fkey";
ALTER TABLE "ActionDraft" VALIDATE CONSTRAINT "ActionDraft_customerId_messageId_fkey";
ALTER TABLE "ActionDraft" VALIDATE CONSTRAINT "ActionDraft_customerId_toolCallId_fkey";
ALTER TABLE "EscalationRequest" VALIDATE CONSTRAINT "EscalationRequest_customerId_sessionId_fkey";
ALTER TABLE "EscalationRequest" VALIDATE CONSTRAINT "EscalationRequest_customerId_messageId_fkey";
ALTER TABLE "FeedbackEvent" VALIDATE CONSTRAINT "FeedbackEvent_customerId_messageId_fkey";
ALTER TABLE "AuditEvent" VALIDATE CONSTRAINT "AuditEvent_customerId_sessionId_fkey";
ALTER TABLE "AuditEvent" VALIDATE CONSTRAINT "AuditEvent_customerId_messageId_fkey";
ALTER TABLE "AuditEvent" VALIDATE CONSTRAINT "AuditEvent_customerId_toolCallId_fkey";

CREATE UNIQUE INDEX "KnowledgeDocument_customerId_sourceKey_version_key" ON "KnowledgeDocument"("customerId", "sourceKey", "version");
CREATE UNIQUE INDEX "KnowledgeChunk_customerId_documentId_chunkIndex_key" ON "KnowledgeChunk"("customerId", "documentId", "chunkIndex");
CREATE UNIQUE INDEX "QueryUnderstandingResult_customerId_messageId_key" ON "QueryUnderstandingResult"("customerId", "messageId");
CREATE UNIQUE INDEX "ToolCall_customerId_idempotencyKey_key" ON "ToolCall"("customerId", "idempotencyKey");
CREATE UNIQUE INDEX "ApprovalRequest_customerId_idempotencyKey_key" ON "ApprovalRequest"("customerId", "idempotencyKey");
CREATE UNIQUE INDEX "ActionDraft_customerId_idempotencyKey_key" ON "ActionDraft"("customerId", "idempotencyKey");

-- These names are confirmed from 20260615044944_init/migration.sql. They are
-- dropped only after all replacement constraints and indexes are validated.
DROP INDEX "KnowledgeDocument_sourceKey_version_key";
DROP INDEX "KnowledgeChunk_documentId_chunkIndex_key";
DROP INDEX "QueryUnderstandingResult_messageId_key";
DROP INDEX "ToolCall_idempotencyKey_key";
DROP INDEX "ApprovalRequest_idempotencyKey_key";
DROP INDEX "ActionDraft_idempotencyKey_key";

ALTER TABLE "AssistantMessage" DROP CONSTRAINT "AssistantMessage_sessionId_fkey";
ALTER TABLE "AssistantContextState" DROP CONSTRAINT "AssistantContextState_sessionId_fkey";
ALTER TABLE "ExecutionPlan" DROP CONSTRAINT "ExecutionPlan_sessionId_fkey";
ALTER TABLE "ExecutionPlan" DROP CONSTRAINT "ExecutionPlan_messageId_fkey";
ALTER TABLE "AnswerDecision" DROP CONSTRAINT "AnswerDecision_messageId_fkey";
ALTER TABLE "ClarificationQuestion" DROP CONSTRAINT "ClarificationQuestion_messageId_fkey";
ALTER TABLE "GroundingCheck" DROP CONSTRAINT "GroundingCheck_messageId_fkey";
ALTER TABLE "ToolCall" DROP CONSTRAINT "ToolCall_sessionId_fkey";
ALTER TABLE "ToolCall" DROP CONSTRAINT "ToolCall_messageId_fkey";
ALTER TABLE "EvidenceRef" DROP CONSTRAINT "EvidenceRef_messageId_fkey";
ALTER TABLE "EvidenceRef" DROP CONSTRAINT "EvidenceRef_toolCallId_fkey";
ALTER TABLE "EvidenceRef" DROP CONSTRAINT "EvidenceRef_documentId_fkey";
ALTER TABLE "EvidenceRef" DROP CONSTRAINT "EvidenceRef_chunkId_fkey";
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_sessionId_fkey";
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_messageId_fkey";
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_toolCallId_fkey";
ALTER TABLE "FeedbackEvent" DROP CONSTRAINT "FeedbackEvent_messageId_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_sessionId_fkey";
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_messageId_fkey";
ALTER TABLE "ActionDraft" DROP CONSTRAINT "ActionDraft_sessionId_fkey";
ALTER TABLE "ActionDraft" DROP CONSTRAINT "ActionDraft_messageId_fkey";
ALTER TABLE "EscalationRequest" DROP CONSTRAINT "EscalationRequest_sessionId_fkey";
ALTER TABLE "EscalationRequest" DROP CONSTRAINT "EscalationRequest_messageId_fkey";
ALTER TABLE "QueryUnderstandingResult" DROP CONSTRAINT "QueryUnderstandingResult_messageId_fkey";
ALTER TABLE "KnowledgeChunk" DROP CONSTRAINT "KnowledgeChunk_documentId_fkey";
ALTER TABLE "RetrievalRun" DROP CONSTRAINT "RetrievalRun_messageId_fkey";
ALTER TABLE "RetrievalCandidate" DROP CONSTRAINT "RetrievalCandidate_retrievalRunId_fkey";
ALTER TABLE "RetrievalCandidate" DROP CONSTRAINT "RetrievalCandidate_chunkId_fkey";

DROP TABLE "_CustomerScopeApprovedMapping";
DROP TABLE "_CustomerScopeApprovedCustomerRoot";

COMMIT;
