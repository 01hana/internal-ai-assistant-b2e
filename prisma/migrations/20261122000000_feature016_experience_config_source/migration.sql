-- Feature 016: who wrote each experience configuration version (provisioning file or the admin back-office).
CREATE TYPE "AssistantExperienceConfigSource" AS ENUM ('provisioning', 'admin');

ALTER TABLE "AssistantExperienceConfig"
  ADD COLUMN "source" "AssistantExperienceConfigSource" NOT NULL DEFAULT 'provisioning',
  ADD COLUMN "createdByUserId" TEXT;
