-- Feature 013: users can delete a session from their history (additive only).
-- A deleted session is hidden from the user everywhere; its messages and audit trail are retained.

-- AlterEnum
ALTER TYPE "AssistantSessionStatus" ADD VALUE 'deleted';
