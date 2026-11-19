-- Feature 015: admin handling of review items (last note; handling history lives in UserAuditEvent).
ALTER TABLE "ReviewItem" ADD COLUMN "note" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
