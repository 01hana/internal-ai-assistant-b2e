import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';
import { isCanonicalPolicyArray } from './customer-policy-normalization';
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
      // Delete restrictive children before every parent; this order is the
      // rebuildable-test-data FK graph, not a cascade/truncate workaround.
      prisma.auditEvent.deleteMany(),
      prisma.reviewItem.deleteMany(),
      prisma.feedbackEvent.deleteMany(),
      prisma.approvalRequest.deleteMany(),
      prisma.actionDraft.deleteMany(),
      prisma.escalationRequest.deleteMany(),
      prisma.evidenceRef.deleteMany(),
      prisma.retrievalCandidate.deleteMany(),
      prisma.toolCall.deleteMany(),
      prisma.answerDecision.deleteMany(),
      prisma.clarificationQuestion.deleteMany(),
      prisma.groundingCheck.deleteMany(),
      prisma.queryUnderstandingResult.deleteMany(),
      prisma.executionPlan.deleteMany(),
      prisma.assistantContextState.deleteMany(),
      prisma.retrievalRun.deleteMany(),
      prisma.knowledgeChunk.deleteMany(),
      prisma.knowledgeDocument.deleteMany(),
      prisma.assistantMessage.deleteMany(),
      prisma.assistantSession.deleteMany(),
      prisma.customerToolPolicy.deleteMany(),
      prisma.toolDefinition.deleteMany(),
      prisma.customer.deleteMany()
    ]);
  } finally {
    await prisma.$disconnect();
  }

  const seedPrisma = createPrismaClient(databaseUrl);

  try {
    await seedCoreData(seedPrisma);
    await seedUs1TestFixtures(seedPrisma);
    await assertSeededCustomerScopeInvariants(seedPrisma);
  } finally {
    await seedPrisma.$disconnect();
  }
}

async function assertSeededCustomerScopeInvariants(prisma: PrismaClient): Promise<void> {
  const [customers, documents, chunks, toolCalls] = await Promise.all([
    prisma.customer.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    prisma.knowledgeDocument.findMany({
      select: {
        id: true,
        customerId: true,
        sourceKey: true,
        version: true,
        visibility: true,
        organizationIds: true,
        requiredPermissionScopes: true
      }
    }),
    prisma.knowledgeChunk.findMany({ select: { customerId: true, documentId: true } }),
    prisma.toolCall.findMany({ select: { customerId: true, idempotencyKey: true } })
  ]);

  const customerIds = customers.map((customer) => customer.id);
  if (customerIds.length !== 2 || customerIds[0] !== 'customer-a' || customerIds[1] !== 'customer-b') {
    throw new Error('Seed invariant failed: expected only deterministic Customer A/B roots.');
  }

  const documentKeys = new Set(documents.map((document) => `${document.customerId}:${document.id}`));
  for (const document of documents) {
    if (!customerIds.includes(document.customerId)) throw new Error('Seed invariant failed: KnowledgeDocument has an unknown Customer root.');
    if (!isCanonicalPolicyArray(document.organizationIds) || !isCanonicalPolicyArray(document.requiredPermissionScopes)) {
      throw new Error('Seed invariant failed: KnowledgeDocument policy arrays must be normalized.');
    }
    if (document.visibility === 'CUSTOMER' && document.organizationIds.length !== 0) {
      throw new Error('Seed invariant failed: CUSTOMER KnowledgeDocument policy must not have organization IDs.');
    }
    if (document.visibility === 'ORGANIZATION' && document.organizationIds.length === 0) {
      throw new Error('Seed invariant failed: ORGANIZATION KnowledgeDocument policy requires organization IDs.');
    }
  }
  for (const chunk of chunks) {
    if (!documentKeys.has(`${chunk.customerId}:${chunk.documentId}`)) {
      throw new Error('Seed invariant failed: KnowledgeChunk must reference a same-Customer KnowledgeDocument.');
    }
  }

  const sharedDocuments = documents.filter((document) => document.sourceKey === 'shared-source' && document.version === '1');
  if (!hasBothCustomers(sharedDocuments.map((document) => document.customerId))) {
    throw new Error('Seed invariant failed: Customer A/B shared source/version fixture is missing.');
  }
  const sharedToolCalls = toolCalls.filter((toolCall) => toolCall.idempotencyKey === 'shared-idempotency-key');
  if (!hasBothCustomers(sharedToolCalls.map((toolCall) => toolCall.customerId))) {
    throw new Error('Seed invariant failed: Customer A/B shared idempotency fixture is missing.');
  }
}

function hasBothCustomers(customerIds: readonly string[]): boolean {
  return new Set(customerIds).size === 2 && customerIds.includes('customer-a') && customerIds.includes('customer-b');
}

void main();
