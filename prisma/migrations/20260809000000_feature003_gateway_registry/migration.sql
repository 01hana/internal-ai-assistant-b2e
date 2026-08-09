-- Feature 003 Phase 2: additive Gateway integration registry, public signing
-- key metadata, and safe identity-decision audit persistence. No existing data
-- is rewritten or inferred by this migration.

CREATE TYPE "GatewaySigningKeyStatus" AS ENUM ('new', 'published', 'active', 'retiring', 'retired');

CREATE TABLE "IntegrationBinding" (
    "integrationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "allowedHostApp" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationBinding_pkey" PRIMARY KEY ("integrationId")
);

CREATE TABLE "GatewaySigningKey" (
    "kid" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "keyReference" TEXT NOT NULL,
    "status" "GatewaySigningKeyStatus" NOT NULL DEFAULT 'new',
    "notBefore" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "retireAfter" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewaySigningKey_pkey" PRIMARY KEY ("kid")
);

CREATE TABLE "GatewayIdentityAuditEvent" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "customerId" TEXT,
    "integrationId" TEXT,
    "actorId" TEXT,
    "hostApp" TEXT,
    "jti" TEXT,
    "kid" TEXT,

    CONSTRAINT "GatewayIdentityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IntegrationBinding_customerId_idx" ON "IntegrationBinding"("customerId");
CREATE INDEX "IntegrationBinding_customerId_allowedHostApp_idx" ON "IntegrationBinding"("customerId", "allowedHostApp");
CREATE INDEX "GatewaySigningKey_status_idx" ON "GatewaySigningKey"("status");
CREATE INDEX "GatewayIdentityAuditEvent_requestId_idx" ON "GatewayIdentityAuditEvent"("requestId");
CREATE INDEX "GatewayIdentityAuditEvent_timestamp_idx" ON "GatewayIdentityAuditEvent"("timestamp");
CREATE INDEX "GatewayIdentityAuditEvent_customerId_timestamp_idx" ON "GatewayIdentityAuditEvent"("customerId", "timestamp");
CREATE INDEX "GatewayIdentityAuditEvent_integrationId_timestamp_idx" ON "GatewayIdentityAuditEvent"("integrationId", "timestamp");

CREATE UNIQUE INDEX "GatewaySigningKey_one_active_key" ON "GatewaySigningKey" ((1)) WHERE "status" = 'active';

ALTER TABLE "IntegrationBinding" ADD CONSTRAINT "IntegrationBinding_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GatewayIdentityAuditEvent" ADD CONSTRAINT "GatewayIdentityAuditEvent_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
