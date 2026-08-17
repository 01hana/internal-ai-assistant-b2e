-- Feature 004 Batch 1: additive upstream verification-profile persistence.
-- Customer and HostApp authority remain exclusively on IntegrationBinding.

CREATE TYPE "RegisteredUpstreamTrustProfileAlgorithm" AS ENUM ('RS256');
CREATE TYPE "RegisteredUpstreamTrustProfileLifecycle" AS ENUM ('draft', 'active', 'disabled', 'replaced');

CREATE TABLE "RegisteredUpstreamTrustProfile" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "expectedIssuer" TEXT NOT NULL,
    "expectedAudience" TEXT NOT NULL,
    "jwksUri" TEXT NOT NULL,
    "algorithm" "RegisteredUpstreamTrustProfileAlgorithm" NOT NULL DEFAULT 'RS256',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "RegisteredUpstreamTrustProfileLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegisteredUpstreamTrustProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RegisteredUpstreamTrustProfile_integrationId_version_key"
  ON "RegisteredUpstreamTrustProfile"("integrationId", "version");
CREATE INDEX "RegisteredUpstreamTrustProfile_expectedIssuer_enabled_idx"
  ON "RegisteredUpstreamTrustProfile"("expectedIssuer", "enabled");
CREATE INDEX "RegisteredUpstreamTrustProfile_integrationId_idx"
  ON "RegisteredUpstreamTrustProfile"("integrationId");
CREATE INDEX "RegisteredUpstreamTrustProfile_lifecycle_enabled_idx"
  ON "RegisteredUpstreamTrustProfile"("lifecycle", "enabled");
CREATE INDEX "RegisteredUpstreamTrustProfile_replacesProfileId_idx"
  ON "RegisteredUpstreamTrustProfile"("replacesProfileId");

ALTER TABLE "RegisteredUpstreamTrustProfile" ADD CONSTRAINT "RegisteredUpstreamTrustProfile_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "IntegrationBinding"("integrationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegisteredUpstreamTrustProfile" ADD CONSTRAINT "RegisteredUpstreamTrustProfile_replacesProfileId_fkey"
  FOREIGN KEY ("replacesProfileId") REFERENCES "RegisteredUpstreamTrustProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
