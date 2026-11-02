-- Existing sessions retain NULL ownership and are denied by application scope checks.
-- No default or backfill may assign them to a later reader.
ALTER TABLE "AssistantSession" ADD COLUMN "integrationId" TEXT;

ALTER TABLE "AssistantSession"
  ADD CONSTRAINT "AssistantSession_integrationId_nonblank"
  CHECK ("integrationId" IS NULL OR length(btrim("integrationId")) > 0);

CREATE INDEX "AssistantSession_scope_integration_idx"
  ON "AssistantSession"("customerId", "integrationId", "organizationId", "hostApp", "actorId");
