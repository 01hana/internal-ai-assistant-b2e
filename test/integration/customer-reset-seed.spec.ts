import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { CUSTOMER_SCOPE_FIXTURES } from '../support/customer-scope-fixtures';
import { resetConfiguredTestDatabaseSchema, runTestDatabaseInitialization } from '../support/customer-migration-db.helper';

describe('Customer rebuildable reset/migration/seed contract (T070)', () => {
  it('migrates, safely resets, and deterministically seeds explicit Customer A/B ownership and policies', async () => {
    await resetConfiguredTestDatabaseSchema();
    await runTestDatabaseInitialization();
    const first = await snapshotSeed();
    assertSeedInvariants(first);

    await runTestDatabaseInitialization();
    const second = await snapshotSeed();
    expect(second).toEqual(first);
  }, 180_000);
});

type SeedSnapshot = Readonly<{
  customerIds: readonly string[];
  sessions: readonly SessionSnapshot[];
  documents: readonly DocumentSnapshot[];
  chunks: readonly ChunkSnapshot[];
  toolCalls: readonly ToolCallSnapshot[];
}>;

type SessionSnapshot = Readonly<{ id: string; customerId: string; organizationId: string; actorId: string; hostApp: string }>;

type DocumentSnapshot = Readonly<{
  id: string;
  customerId: string;
  sourceKey: string;
  version: string;
  visibility: 'CUSTOMER' | 'ORGANIZATION';
  organizationIds: readonly string[];
  requiredPermissionScopes: readonly string[];
  metadata: unknown;
}>;

type ChunkSnapshot = Readonly<{ id: string; customerId: string; documentId: string; chunkIndex: number }>;
type ToolCallSnapshot = Readonly<{ id: string; customerId: string; idempotencyKey: string | null }>;

async function snapshotSeed(): Promise<SeedSnapshot> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the T070 reset/seed contract.');
  const prisma = createPrismaClient(databaseUrl);
  try {
    const [customers, sessions, documents, chunks, toolCalls] = await Promise.all([
      prisma.customer.findMany({ orderBy: { id: 'asc' } }),
      prisma.assistantSession.findMany({ select: { id: true, customerId: true, organizationId: true, actorId: true, hostApp: true }, orderBy: { id: 'asc' } }),
      prisma.knowledgeDocument.findMany({
        select: { id: true, customerId: true, sourceKey: true, version: true, visibility: true, organizationIds: true, requiredPermissionScopes: true, metadata: true },
        orderBy: [{ customerId: 'asc' }, { sourceKey: 'asc' }, { version: 'asc' }]
      }),
      prisma.knowledgeChunk.findMany({ select: { id: true, customerId: true, documentId: true, chunkIndex: true }, orderBy: [{ customerId: 'asc' }, { documentId: 'asc' }, { chunkIndex: 'asc' }] }),
      prisma.toolCall.findMany({ select: { id: true, customerId: true, idempotencyKey: true }, orderBy: [{ customerId: 'asc' }, { id: 'asc' }] })
    ]);
    return Object.freeze({
      customerIds: customers.map((customer) => customer.id),
      sessions: sessions.map((session) => Object.freeze({ ...session })),
      documents: documents.map((document) => Object.freeze({ ...document })),
      chunks: chunks.map((chunk) => Object.freeze({ ...chunk })),
      toolCalls: toolCalls.map((toolCall) => Object.freeze({ ...toolCall }))
    });
  } finally {
    await prisma.$disconnect();
  }
}

function assertSeedInvariants(snapshot: SeedSnapshot): void {
  const { customerA, customerB, shared } = CUSTOMER_SCOPE_FIXTURES;
  expect(snapshot.customerIds).toEqual([customerA.root.id, customerB.root.id]);
  expect(customerA.root.id).not.toBe(customerB.root.id);

  const documentsById = new Map(snapshot.documents.map((document) => [document.id, document]));
  const sharedA = documentsById.get(customerA.seed.knowledgeDocumentId);
  const sharedB = documentsById.get(customerB.seed.knowledgeDocumentId);
  expect(sharedA).toMatchObject({ customerId: customerA.root.id, sourceKey: shared.sourceKey, version: shared.sourceVersion });
  expect(sharedB).toMatchObject({ customerId: customerB.root.id, sourceKey: shared.sourceKey, version: shared.sourceVersion });

  const sessionA = snapshot.sessions.find((session) => session.id === customerA.seed.sessionId);
  const sessionB = snapshot.sessions.find((session) => session.id === customerB.seed.sessionId);
  expect(sessionA).toEqual({ id: customerA.seed.sessionId, customerId: customerA.root.id, organizationId: shared.organizationId, actorId: shared.actorId, hostApp: shared.hostApp });
  expect(sessionB).toEqual({ id: customerB.seed.sessionId, customerId: customerB.root.id, organizationId: shared.organizationId, actorId: shared.actorId, hostApp: shared.hostApp });

  for (const document of snapshot.documents) {
    expect(snapshot.customerIds).toContain(document.customerId);
    expect(['CUSTOMER', 'ORGANIZATION']).toContain(document.visibility);
    expectNormalized(document.organizationIds);
    expectNormalized(document.requiredPermissionScopes);
    if (document.visibility === 'CUSTOMER') expect(document.organizationIds).toEqual([]);
    else expect(document.organizationIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(document.metadata).toLowerCase()).not.toMatch(/authorization|bearer|token|secret|credential|production.mapping/);
  }

  const documentsByCustomerAndId = new Map(snapshot.documents.map((document) => [`${document.customerId}:${document.id}`, document]));
  const chunkKeys = new Set<string>();
  for (const chunk of snapshot.chunks) {
    const document = documentsByCustomerAndId.get(`${chunk.customerId}:${chunk.documentId}`);
    expect(document).toBeDefined();
    expect(chunkKeys.has(`${chunk.customerId}:${chunk.documentId}:${chunk.chunkIndex}`)).toBe(false);
    chunkKeys.add(`${chunk.customerId}:${chunk.documentId}:${chunk.chunkIndex}`);
  }

  const sharedKeyToolCalls = snapshot.toolCalls.filter((toolCall) => toolCall.idempotencyKey === shared.idempotencyKey);
  expect(sharedKeyToolCalls).toEqual(expect.arrayContaining([
    expect.objectContaining({ customerId: customerA.root.id }),
    expect.objectContaining({ customerId: customerB.root.id })
  ]));
  const perCustomerIdempotency = new Set<string>();
  for (const toolCall of sharedKeyToolCalls) {
    const key = `${toolCall.customerId}:${toolCall.idempotencyKey}`;
    expect(perCustomerIdempotency.has(key)).toBe(false);
    perCustomerIdempotency.add(key);
  }
}

function expectNormalized(values: readonly string[]): void {
  expect(values.every((value) => value === value.trim() && value.length > 0)).toBe(true);
  expect(new Set(values).size).toBe(values.length);
  expect(values).toEqual([...values].sort());
}
