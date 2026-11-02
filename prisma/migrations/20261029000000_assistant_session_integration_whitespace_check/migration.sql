-- Replace the original space-only check atomically. Existing invalid values
-- make this migration fail without changing data or dropping the old check.
ALTER TABLE "AssistantSession"
  DROP CONSTRAINT "AssistantSession_integrationId_nonblank",
  ADD CONSTRAINT "AssistantSession_integrationId_nonblank"
    CHECK (
      "integrationId" IS NULL
      OR replace("integrationId", U&'\FEFF', '') ~ '[^[:space:]]'
    );
