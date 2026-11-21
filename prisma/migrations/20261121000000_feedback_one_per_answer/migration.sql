-- One feedback per answer: a later rating or reason updates it instead of adding another row.

-- The newest feedback of each answer is kept.
CREATE TEMP TABLE "_feedback_keep" AS
SELECT DISTINCT ON ("customerId", "messageId") "customerId", "messageId", "id" AS "keepId"
FROM "FeedbackEvent"
ORDER BY "customerId", "messageId", "createdAt" DESC, "id" DESC;

-- Review items raised by the removed duplicates: still open or in review means a duplicate of the kept one.
UPDATE "ReviewItem" AS r
SET "status" = 'dismissed'::"ReviewItemStatus",
    "resolvedAt" = CURRENT_TIMESTAMP,
    "note" = COALESCE(r."note", '同一則回答的重複回饋（保留最新的回饋）'),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "FeedbackEvent" AS f
JOIN "_feedback_keep" AS k ON k."customerId" = f."customerId" AND k."messageId" = f."messageId"
WHERE r."customerId" = f."customerId"
  AND r."sourceId" = f."id"
  AND f."id" <> k."keepId"
  AND r."sourceType" IN ('negative_feedback'::"ReviewSourceType", 'missing_evidence'::"ReviewSourceType")
  AND r."status" IN ('open'::"ReviewItemStatus", 'in_review'::"ReviewItemStatus");

DELETE FROM "FeedbackEvent" AS f
USING "_feedback_keep" AS k
WHERE f."customerId" = k."customerId" AND f."messageId" = k."messageId" AND f."id" <> k."keepId";

DROP TABLE "_feedback_keep";

ALTER TABLE "FeedbackEvent" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "FeedbackEvent_customerId_messageId_key" ON "FeedbackEvent"("customerId", "messageId");
