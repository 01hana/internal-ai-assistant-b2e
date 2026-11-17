-- Feature 013: assistant conversation experience (additive only).

-- AlterEnum
ALTER TYPE "ReviewSourceType" ADD VALUE 'unsupported_question';

-- CreateEnum
CREATE TYPE "AssistantExperienceConfigStatus" AS ENUM ('draft', 'active', 'retired');

-- AlterTable
ALTER TABLE "AssistantSession" ADD COLUMN "title" TEXT;

-- CreateTable
CREATE TABLE "AssistantExperienceConfig" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL,
    "status" "AssistantExperienceConfigStatus" NOT NULL DEFAULT 'draft',
    "activeSlot" TEXT,
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantExperienceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantExperienceConfig_activeSlot_key" ON "AssistantExperienceConfig"("activeSlot");

-- CreateIndex
CREATE INDEX "AssistantExperienceConfig_customerId_integrationId_status_idx" ON "AssistantExperienceConfig"("customerId", "integrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantExperienceConfig_scope_version_key" ON "AssistantExperienceConfig"("customerId", "integrationId", "configVersion");

-- AddForeignKey
ALTER TABLE "AssistantExperienceConfig" ADD CONSTRAINT "AssistantExperienceConfig_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
