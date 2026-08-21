-- Feature 005 Phase 1: additive managed identity-exchange persistence.
-- Feature 004 remains the sole Customer and HostApp admission authority.

CREATE TYPE "ManagedExchangeLifecycle" AS ENUM ('draft', 'active', 'disabled', 'replaced');
CREATE TYPE "ManagedIdentityProviderType" AS ENUM ('delegated_http', 'idx_delegated');
CREATE TYPE "ManagedHttpMethod" AS ENUM ('POST');
CREATE TYPE "ManagedCredentialPlacement" AS ENUM ('authorization_bearer');
CREATE TYPE "ManagedOrganizationMode" AS ENUM ('verified', 'fixed_single_organization');
CREATE TYPE "ManagedPermissionMode" AS ENUM ('allow_empty', 'required');
CREATE TYPE "ManagedSigningKeyStatus" AS ENUM ('new', 'published', 'active', 'retiring', 'retired');
CREATE TYPE "ManagedExchangeAuditOutcome" AS ENUM ('success', 'denied', 'unavailable');

CREATE TABLE "ManagedIdentityProviderInstance" (
    "id" TEXT NOT NULL,
    "providerType" "ManagedIdentityProviderType" NOT NULL,
    "endpointUri" TEXT NOT NULL,
    "httpMethod" "ManagedHttpMethod" NOT NULL,
    "credentialPlacement" "ManagedCredentialPlacement" NOT NULL,
    "timeoutMilliseconds" INTEGER NOT NULL,
    "responseContractVersion" TEXT NOT NULL,
    "contractConfig" JSONB NOT NULL,
    "declaredAnchorKinds" TEXT[] NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ManagedExchangeLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesProviderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedIdentityProviderInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedIntegrationExchangeConfig" (
    "id" TEXT NOT NULL,
    "publicSelector" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "providerInstanceId" TEXT NOT NULL,
    "canonicalHostApp" TEXT NOT NULL,
    "organizationMode" "ManagedOrganizationMode" NOT NULL,
    "fixedOrganizationId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ManagedExchangeLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesConfigId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedIntegrationExchangeConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedIntegrationAdmissionPolicy" (
    "id" TEXT NOT NULL,
    "integrationConfigId" TEXT NOT NULL,
    "anchorRequirements" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ManagedExchangeLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesPolicyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedIntegrationAdmissionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedPermissionSourceInstance" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "endpointUri" TEXT,
    "providerInstanceId" TEXT,
    "serviceCredentialReference" TEXT,
    "adapterContractReference" TEXT NOT NULL,
    "contractConfig" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ManagedExchangeLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedPermissionSourceInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedPermissionPolicy" (
    "id" TEXT NOT NULL,
    "integrationConfigId" TEXT NOT NULL,
    "mode" "ManagedPermissionMode" NOT NULL,
    "permissionSourceInstanceId" TEXT,
    "normalizerType" TEXT,
    "projectionContractVersion" TEXT,
    "projectionContract" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ManagedExchangeLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesPolicyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedPermissionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedUpstreamIssuer" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "expectedAudience" TEXT NOT NULL,
    "publicJwksUri" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ManagedExchangeLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesIssuerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedUpstreamIssuer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedUpstreamSigningKey" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "keyReference" TEXT NOT NULL,
    "status" "ManagedSigningKeyStatus" NOT NULL DEFAULT 'new',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lifecycle" "ManagedExchangeLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL,
    "replacesKeyId" TEXT,
    "notBefore" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "retireAfter" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManagedUpstreamSigningKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManagedExchangeAuditEvent" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,
    "integrationId" TEXT,
    "integrationConfigId" TEXT,
    "providerType" "ManagedIdentityProviderType",
    "providerInstanceId" TEXT,
    "outcome" "ManagedExchangeAuditOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "admissionResult" TEXT,
    "permissionResult" TEXT,
    "issuanceResult" TEXT,
    "jti" TEXT,
    "kid" TEXT,
    "latencyCategory" TEXT,
    CONSTRAINT "ManagedExchangeAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManagedIntegrationExchangeConfig_publicSelector_key" ON "ManagedIntegrationExchangeConfig"("publicSelector");
CREATE UNIQUE INDEX "ManagedIntegrationExchangeConfig_integrationId_version_key" ON "ManagedIntegrationExchangeConfig"("integrationId", "version");
CREATE UNIQUE INDEX "ManagedIntegrationAdmissionPolicy_integrationConfigId_version_key" ON "ManagedIntegrationAdmissionPolicy"("integrationConfigId", "version");
CREATE UNIQUE INDEX "ManagedPermissionPolicy_integrationConfigId_version_key" ON "ManagedPermissionPolicy"("integrationConfigId", "version");
CREATE UNIQUE INDEX "ManagedUpstreamIssuer_issuer_version_key" ON "ManagedUpstreamIssuer"("issuer", "version");
CREATE UNIQUE INDEX "ManagedUpstreamSigningKey_kid_key" ON "ManagedUpstreamSigningKey"("kid");
CREATE UNIQUE INDEX "ManagedUpstreamSigningKey_issuerId_version_key" ON "ManagedUpstreamSigningKey"("issuerId", "version");

CREATE INDEX "ManagedIdentityProviderInstance_providerType_enabled_lifecycle_idx" ON "ManagedIdentityProviderInstance"("providerType", "enabled", "lifecycle");
CREATE INDEX "ManagedIdentityProviderInstance_replacesProviderId_idx" ON "ManagedIdentityProviderInstance"("replacesProviderId");
CREATE INDEX "ManagedIntegrationExchangeConfig_integrationId_idx" ON "ManagedIntegrationExchangeConfig"("integrationId");
CREATE INDEX "ManagedIntegrationExchangeConfig_providerInstanceId_idx" ON "ManagedIntegrationExchangeConfig"("providerInstanceId");
CREATE INDEX "ManagedIntegrationExchangeConfig_enabled_lifecycle_idx" ON "ManagedIntegrationExchangeConfig"("enabled", "lifecycle");
CREATE INDEX "ManagedIntegrationExchangeConfig_replacesConfigId_idx" ON "ManagedIntegrationExchangeConfig"("replacesConfigId");
CREATE INDEX "ManagedIntegrationAdmissionPolicy_integrationConfigId_enabled_lifecycle_idx" ON "ManagedIntegrationAdmissionPolicy"("integrationConfigId", "enabled", "lifecycle");
CREATE INDEX "ManagedIntegrationAdmissionPolicy_replacesPolicyId_idx" ON "ManagedIntegrationAdmissionPolicy"("replacesPolicyId");
CREATE INDEX "ManagedPermissionSourceInstance_sourceType_enabled_lifecycle_idx" ON "ManagedPermissionSourceInstance"("sourceType", "enabled", "lifecycle");
CREATE INDEX "ManagedPermissionSourceInstance_replacesSourceId_idx" ON "ManagedPermissionSourceInstance"("replacesSourceId");
CREATE INDEX "ManagedPermissionPolicy_integrationConfigId_enabled_lifecycle_idx" ON "ManagedPermissionPolicy"("integrationConfigId", "enabled", "lifecycle");
CREATE INDEX "ManagedPermissionPolicy_permissionSourceInstanceId_idx" ON "ManagedPermissionPolicy"("permissionSourceInstanceId");
CREATE INDEX "ManagedPermissionPolicy_replacesPolicyId_idx" ON "ManagedPermissionPolicy"("replacesPolicyId");
CREATE INDEX "ManagedUpstreamIssuer_enabled_lifecycle_idx" ON "ManagedUpstreamIssuer"("enabled", "lifecycle");
CREATE INDEX "ManagedUpstreamIssuer_replacesIssuerId_idx" ON "ManagedUpstreamIssuer"("replacesIssuerId");
CREATE INDEX "ManagedUpstreamSigningKey_issuerId_status_enabled_lifecycle_idx" ON "ManagedUpstreamSigningKey"("issuerId", "status", "enabled", "lifecycle");
CREATE INDEX "ManagedUpstreamSigningKey_replacesKeyId_idx" ON "ManagedUpstreamSigningKey"("replacesKeyId");
CREATE INDEX "ManagedExchangeAuditEvent_requestId_idx" ON "ManagedExchangeAuditEvent"("requestId");
CREATE INDEX "ManagedExchangeAuditEvent_timestamp_idx" ON "ManagedExchangeAuditEvent"("timestamp");
CREATE INDEX "ManagedExchangeAuditEvent_integrationId_timestamp_idx" ON "ManagedExchangeAuditEvent"("integrationId", "timestamp");
CREATE INDEX "ManagedExchangeAuditEvent_integrationConfigId_timestamp_idx" ON "ManagedExchangeAuditEvent"("integrationConfigId", "timestamp");

-- Prisma cannot express partial unique indexes. These constrain committed active authority only.
CREATE UNIQUE INDEX "ManagedIntegrationExchangeConfig_one_active_integration"
  ON "ManagedIntegrationExchangeConfig"("integrationId")
  WHERE "enabled" = true AND "lifecycle" = 'active';
CREATE UNIQUE INDEX "ManagedIntegrationAdmissionPolicy_one_active_config"
  ON "ManagedIntegrationAdmissionPolicy"("integrationConfigId")
  WHERE "enabled" = true AND "lifecycle" = 'active';
CREATE UNIQUE INDEX "ManagedPermissionPolicy_one_active_config"
  ON "ManagedPermissionPolicy"("integrationConfigId")
  WHERE "enabled" = true AND "lifecycle" = 'active';
CREATE UNIQUE INDEX "ManagedUpstreamSigningKey_one_active_issuer"
  ON "ManagedUpstreamSigningKey"("issuerId")
  WHERE "enabled" = true AND "lifecycle" = 'active' AND "status" = 'active';
CREATE UNIQUE INDEX "ManagedUpstreamIssuer_v1_one_active"
  ON "ManagedUpstreamIssuer"((1))
  WHERE "enabled" = true AND "lifecycle" = 'active';

ALTER TABLE "ManagedIdentityProviderInstance" ADD CONSTRAINT "ManagedIdentityProviderInstance_replacesProviderId_fkey"
  FOREIGN KEY ("replacesProviderId") REFERENCES "ManagedIdentityProviderInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedIntegrationExchangeConfig" ADD CONSTRAINT "ManagedIntegrationExchangeConfig_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "IntegrationBinding"("integrationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedIntegrationExchangeConfig" ADD CONSTRAINT "ManagedIntegrationExchangeConfig_providerInstanceId_fkey"
  FOREIGN KEY ("providerInstanceId") REFERENCES "ManagedIdentityProviderInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedIntegrationExchangeConfig" ADD CONSTRAINT "ManagedIntegrationExchangeConfig_replacesConfigId_fkey"
  FOREIGN KEY ("replacesConfigId") REFERENCES "ManagedIntegrationExchangeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedIntegrationAdmissionPolicy" ADD CONSTRAINT "ManagedIntegrationAdmissionPolicy_integrationConfigId_fkey"
  FOREIGN KEY ("integrationConfigId") REFERENCES "ManagedIntegrationExchangeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedIntegrationAdmissionPolicy" ADD CONSTRAINT "ManagedIntegrationAdmissionPolicy_replacesPolicyId_fkey"
  FOREIGN KEY ("replacesPolicyId") REFERENCES "ManagedIntegrationAdmissionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedPermissionSourceInstance" ADD CONSTRAINT "ManagedPermissionSourceInstance_providerInstanceId_fkey"
  FOREIGN KEY ("providerInstanceId") REFERENCES "ManagedIdentityProviderInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedPermissionSourceInstance" ADD CONSTRAINT "ManagedPermissionSourceInstance_replacesSourceId_fkey"
  FOREIGN KEY ("replacesSourceId") REFERENCES "ManagedPermissionSourceInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedPermissionPolicy" ADD CONSTRAINT "ManagedPermissionPolicy_integrationConfigId_fkey"
  FOREIGN KEY ("integrationConfigId") REFERENCES "ManagedIntegrationExchangeConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedPermissionPolicy" ADD CONSTRAINT "ManagedPermissionPolicy_permissionSourceInstanceId_fkey"
  FOREIGN KEY ("permissionSourceInstanceId") REFERENCES "ManagedPermissionSourceInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedPermissionPolicy" ADD CONSTRAINT "ManagedPermissionPolicy_replacesPolicyId_fkey"
  FOREIGN KEY ("replacesPolicyId") REFERENCES "ManagedPermissionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedUpstreamIssuer" ADD CONSTRAINT "ManagedUpstreamIssuer_replacesIssuerId_fkey"
  FOREIGN KEY ("replacesIssuerId") REFERENCES "ManagedUpstreamIssuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedUpstreamSigningKey" ADD CONSTRAINT "ManagedUpstreamSigningKey_issuerId_fkey"
  FOREIGN KEY ("issuerId") REFERENCES "ManagedUpstreamIssuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManagedUpstreamSigningKey" ADD CONSTRAINT "ManagedUpstreamSigningKey_replacesKeyId_fkey"
  FOREIGN KEY ("replacesKeyId") REFERENCES "ManagedUpstreamSigningKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
