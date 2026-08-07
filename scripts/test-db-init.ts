import { config as loadEnv } from 'dotenv';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';
import { seedCoreData } from './seed';
import { assertSafeTestDatabaseReset } from './test-db-safety';
import { seedUs1TestFixtures } from './us1-test-fixtures';

loadEnv({ path: '.env.test', override: true });
loadEnv();

async function main() {
  assertSafeTestDatabaseReset(process.env);

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for test database initialization.');
  }

  const prisma = createPrismaClient(databaseUrl);

  try {
    await prisma.$transaction([
      prisma.retrievalCandidate.deleteMany(),
      prisma.retrievalRun.deleteMany(),
      prisma.evidenceRef.deleteMany(),
      prisma.knowledgeChunk.deleteMany(),
      prisma.knowledgeDocument.deleteMany(),
      prisma.auditEvent.deleteMany(),
      prisma.feedbackEvent.deleteMany(),
      prisma.reviewItem.deleteMany(),
      prisma.answerDecision.deleteMany(),
      prisma.clarificationQuestion.deleteMany(),
      prisma.groundingCheck.deleteMany(),
      prisma.queryUnderstandingResult.deleteMany(),
      prisma.toolCall.deleteMany(),
      prisma.toolDefinition.deleteMany(),
      prisma.approvalRequest.deleteMany(),
      prisma.actionDraft.deleteMany(),
      prisma.escalationRequest.deleteMany(),
      prisma.executionPlan.deleteMany(),
      prisma.assistantContextState.deleteMany(),
      prisma.assistantMessage.deleteMany(),
      prisma.assistantSession.deleteMany()
    ]);
  } finally {
    await prisma.$disconnect();
  }

  const seedPrisma = createPrismaClient(databaseUrl);

  try {
    await seedCoreData(seedPrisma);
    await seedUs1TestFixtures(seedPrisma);
  } finally {
    await seedPrisma.$disconnect();
  }
}

void main();
