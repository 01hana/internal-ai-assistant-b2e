import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { CUSTOMER_SCOPE_FIXTURES } from '../support/customer-scope-fixtures';
import { resetConfiguredTestDatabaseSchema, runTestDatabaseInitialization } from '../support/customer-migration-db.helper';
import { parseToolDiscoveryMetadataV1 } from '../../src/tools/tool-discovery.service';
import { ToolOperation } from '../../src/generated/prisma/enums';

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
  toolDefinitions: readonly ToolDefinitionSnapshot[];
  toolPolicies: readonly ToolPolicySnapshot[];
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
type ToolDefinitionSnapshot = Readonly<{ name: string; version: string; operation: ToolOperation; isActive: boolean; hasSideEffect: boolean; inputSchema: unknown }>;
type ToolPolicySnapshot = Readonly<{ customerId: string; toolKey: string; enabled: boolean }>;

async function snapshotSeed(): Promise<SeedSnapshot> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the T070 reset/seed contract.');
  const prisma = createPrismaClient(databaseUrl);
  try {
    const [customers, sessions, documents, chunks, toolCalls, toolDefinitions, toolPolicies] = await Promise.all([
      prisma.customer.findMany({ orderBy: { id: 'asc' } }),
      prisma.assistantSession.findMany({ select: { id: true, customerId: true, organizationId: true, actorId: true, hostApp: true }, orderBy: { id: 'asc' } }),
      prisma.knowledgeDocument.findMany({
        select: { id: true, customerId: true, sourceKey: true, version: true, visibility: true, organizationIds: true, requiredPermissionScopes: true, metadata: true },
        orderBy: [{ customerId: 'asc' }, { sourceKey: 'asc' }, { version: 'asc' }]
      }),
      prisma.knowledgeChunk.findMany({ select: { id: true, customerId: true, documentId: true, chunkIndex: true }, orderBy: [{ customerId: 'asc' }, { documentId: 'asc' }, { chunkIndex: 'asc' }] }),
      prisma.toolCall.findMany({ select: { id: true, customerId: true, idempotencyKey: true }, orderBy: [{ customerId: 'asc' }, { id: 'asc' }] }),
      prisma.toolDefinition.findMany({ select: { id: true, name: true, version: true, operation: true, isActive: true, hasSideEffect: true, inputSchema: true }, orderBy: { name: 'asc' } }),
      prisma.customerToolPolicy.findMany({ select: { customerId: true, toolDefinitionId: true, enabled: true }, orderBy: [{ customerId: 'asc' }, { toolDefinitionId: 'asc' }] })
    ]);
    return Object.freeze({
      customerIds: customers.map((customer) => customer.id),
      sessions: sessions.map((session) => Object.freeze({ ...session })),
      documents: documents.map((document) => Object.freeze({ ...document })),
      chunks: chunks.map((chunk) => Object.freeze({ ...chunk })),
      toolCalls: toolCalls.map((toolCall) => Object.freeze({ ...toolCall })),
      toolDefinitions: toolDefinitions.map(({ id: _id, ...tool }) => Object.freeze(tool)),
      toolPolicies: toolPolicies.map((policy) => {
        const tool = toolDefinitions.find((definition) => definition.id === policy.toolDefinitionId);
        if (!tool) throw new Error('Seeded CustomerToolPolicy refers to an unknown ToolDefinition.');
        return Object.freeze({ customerId: policy.customerId, toolKey: `${tool.name}@${tool.version}`, enabled: policy.enabled });
      }).sort((left, right) => left.customerId.localeCompare(right.customerId) || left.toolKey.localeCompare(right.toolKey))
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

  const mockDefinitions = snapshot.toolDefinitions.filter((tool) => tool.name.startsWith('mock.'));
  expect(mockDefinitions).toHaveLength(6);
  for (const definition of mockDefinitions) {
    expect(parseToolDiscoveryMetadataV1(definition.inputSchema)).toEqual(expect.objectContaining({ version: '1', locale: 'zh-TW' }));
  }
  const referenceDefinition = snapshot.toolDefinitions.find((tool) => tool.name === 'work-orders.monthly-new-count');
  expect(referenceDefinition).toMatchObject({
    version: '1.0.0', operation: ToolOperation.read, isActive: true, hasSideEffect: false
  });
  expect(parseToolDiscoveryMetadataV1(referenceDefinition!.inputSchema)).toEqual(expect.objectContaining({
    resourceConcepts: ['workOrder'], metricConcepts: ['newCount', 'count'], timeRangeConcepts: ['this_month']
  }));
  expect(snapshot.toolPolicies).toContainEqual({
    customerId: 'customer-a', toolKey: 'work-orders.monthly-new-count@1.0.0', enabled: true
  });
  const enabledCustomerBReadTools = snapshot.toolDefinitions
    .filter((tool) => tool.isActive && tool.operation === ToolOperation.read && !tool.hasSideEffect)
    .filter((tool) => snapshot.toolPolicies.some((policy) => policy.customerId === 'customer-b' && policy.toolKey === `${tool.name}@${tool.version}` && policy.enabled))
    .map((tool) => tool.name);
  expect(enabledCustomerBReadTools).toEqual(['inventory.stock-on-hand']);
}

function expectNormalized(values: readonly string[]): void {
  expect(values.every((value) => value === value.trim() && value.length > 0)).toBe(true);
  expect(new Set(values).size).toBe(values.length);
  expect(values).toEqual([...values].sort());
}
