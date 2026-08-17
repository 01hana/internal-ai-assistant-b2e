-- Feature 004 Batch 6A: audit-only identity of the evaluated trust profile.
-- This is deliberately a nullable scalar snapshot, not an authority relation.

ALTER TABLE "GatewayIdentityAuditEvent" ADD COLUMN "profileId" TEXT;
