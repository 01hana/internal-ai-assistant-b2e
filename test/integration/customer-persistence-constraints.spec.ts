import { assertSafeTestDatabaseReset } from '../../scripts/test-db-safety';
import { createPrismaClient } from '../../src/prisma/prisma-client.factory';
import { CUSTOMER_SCOPE_FIXTURES } from '../support/customer-scope-fixtures';
import { loadPrismaSchemaContract } from '../support/prisma-schema-contract.helper';

const describePersistenceContract =
  process.env.RUN_CUSTOMER_PERSISTENCE_CONTRACT_TESTS === 'true' ? describe : describe.skip;
const describeDbPersistenceContract =
  process.env.RUN_DB_BACKED_CUSTOMER_PERSISTENCE_TESTS === 'true' ? describe : describe.skip;

describePersistenceContract('Customer persistence constraints contract (T023)', () => {
  const schema = loadPrismaSchemaContract();

  it('requires Customer-scoped knowledge source/version uniqueness without altering shared fixture values', () => {
    expect(schema.hasCompoundUnique('KnowledgeDocument', ['customerId', 'sourceKey', 'version'])).toBe(true);
    expect(schema.hasCompoundUnique('KnowledgeDocument', ['sourceKey', 'version'])).toBe(false);
    expect(CUSTOMER_SCOPE_FIXTURES.customerA.root.id).not.toBe(CUSTOMER_SCOPE_FIXTURES.customerB.root.id);
    expect(CUSTOMER_SCOPE_FIXTURES.shared).toMatchObject({ sourceKey: 'shared-source', sourceVersion: '1' });
  });

  it('requires Customer-scoped idempotency uniqueness for every idempotent workflow aggregate', () => {
    const unqualified = ['ToolCall', 'ApprovalRequest', 'ActionDraft'].filter(
      (modelName) => !schema.hasCompoundUnique(modelName, ['customerId', 'idempotencyKey'])
    );
    expect(unqualified).toEqual([]);
    expect(CUSTOMER_SCOPE_FIXTURES.shared.idempotencyKey).toBe('shared-idempotency-key');
  });

  it('requires qualified parent keys before a Customer-owned child can reference a parent', () => {
    const missingQualifiedParents = ['AssistantSession', 'AssistantMessage', 'KnowledgeDocument', 'KnowledgeChunk', 'RetrievalRun', 'ToolCall']
      .filter((modelName) => !schema.hasQualifiedParentKey(modelName));
    expect(missingQualifiedParents).toEqual([]);
  });

  it('preserves global ToolDefinition while requiring CustomerToolPolicy to bind enablement by Customer', () => {
    expect(schema.model('ToolDefinition')?.fields).not.toEqual(expect.arrayContaining(['customerId']));
    expect(schema.model('CustomerToolPolicy')?.fields).toEqual(expect.arrayContaining(['customerId', 'toolDefinitionId']));
    expect(schema.hasCompoundUnique('CustomerToolPolicy', ['customerId', 'toolDefinitionId'])).toBe(true);
  });
});

describeDbPersistenceContract('Customer persistence constraints DB contract (T023 future)', () => {
  it('rejects same-Customer knowledge duplicates and permits cross-Customer source/version duplicates', async () => {
    await runDbCase('knowledge-duplicate', async (prisma, ids) => {
      await createRoots(prisma, ids);
      await expect(delegate(prisma, 'knowledgeDocument').create({ data: knowledgeDocument(ids.customerA, ids.documentA) })).resolves.toBeDefined();
      await expect(delegate(prisma, 'knowledgeDocument').create({ data: knowledgeDocument(ids.customerB, ids.documentB) })).resolves.toBeDefined();
      await expectConstraint(delegate(prisma, 'knowledgeDocument').create({ data: knowledgeDocument(ids.customerA, `${ids.documentA}-duplicate`) }), 'unique');
    });
  });

  it.each(['toolCall', 'approvalRequest', 'actionDraft'])('rejects same-Customer %s idempotency and permits cross-Customer reuse', async (model) => {
    await runDbCase(`${model}-idempotency`, async (prisma, ids) => {
      await createRoots(prisma, ids);
      await createSessions(prisma, ids);
      const rows = workflowRows(model, ids);
      await expect(delegate(prisma, model).create({ data: rows(ids.customerA) })).resolves.toBeDefined();
      await expect(delegate(prisma, model).create({ data: rows(ids.customerB) })).resolves.toBeDefined();
      await expectConstraint(delegate(prisma, model).create({ data: rows(ids.customerA, `${model}-duplicate-${ids.namespace}`) }), 'unique');
    });
  });

  it.each([
    ['assistantMessage', 'sessionId'],
    ['knowledgeChunk', 'documentId'],
    ['retrievalCandidate', 'retrievalRunId'],
    ['toolCall', 'sessionId']
  ])('rejects Customer B %s that references Customer A parent', async (child, parentIdField) => {
    await runDbCase(`${child}-cross-customer-relation`, async (prisma, ids) => {
      await createRoots(prisma, ids);
      await createParents(prisma, ids);
      await expectConstraint(delegate(prisma, child).create({ data: crossCustomerChild(child, parentIdField, ids) }), 'relation');
    });
  });
});

type DbDelegate = { create(input: unknown): Promise<unknown> };
type DbClient = {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (transaction: DbClient) => Promise<T>): Promise<T>;
  [key: string]: unknown;
};
type FixtureIds = Readonly<{
  namespace: string;
  customerA: string;
  customerB: string;
  sessionA: string;
  sessionB: string;
  documentA: string;
  documentB: string;
  runA: string;
}>;

class TestTransactionRollback extends Error {}

function delegate(client: DbClient, name: string): DbDelegate { return client[name] as DbDelegate; }
function safeClient(): DbClient {
  assertSafeTestDatabaseReset(process.env);
  return createPrismaClient(process.env.DATABASE_URL!) as unknown as DbClient;
}

async function runDbCase(namespace: string, assertion: (prisma: DbClient, ids: FixtureIds) => Promise<void>) {
  const schema = loadPrismaSchemaContract();
  if (!hasStaticPersistenceContract(schema)) return;
  const prisma = safeClient();
  try {
    await prisma.$transaction(async (transaction) => {
      await assertion(transaction, fixtureIds(namespace));
      throw new TestTransactionRollback();
    });
  } catch (error) {
    if (!(error instanceof TestTransactionRollback)) throw error;
  } finally {
    await prisma.$disconnect();
  }
}

function fixtureIds(namespace: string): FixtureIds {
  return Object.freeze({
    namespace,
    customerA: `customer-a-${namespace}`,
    customerB: `customer-b-${namespace}`,
    sessionA: `session-a-${namespace}`,
    sessionB: `session-b-${namespace}`,
    documentA: `document-a-${namespace}`,
    documentB: `document-b-${namespace}`,
    runA: `run-a-${namespace}`
  });
}

async function createRoots(prisma: DbClient, ids: FixtureIds) {
  await expect(delegate(prisma, 'customer').create({ data: { id: ids.customerA } })).resolves.toBeDefined();
  await expect(delegate(prisma, 'customer').create({ data: { id: ids.customerB } })).resolves.toBeDefined();
}

async function createSessions(prisma: DbClient, ids: FixtureIds) {
  await expect(delegate(prisma, 'assistantSession').create({ data: session(ids.customerA, ids.sessionA) })).resolves.toBeDefined();
  await expect(delegate(prisma, 'assistantSession').create({ data: session(ids.customerB, ids.sessionB) })).resolves.toBeDefined();
}

async function createParents(prisma: DbClient, ids: FixtureIds) {
  await createSessions(prisma, ids);
  await expect(delegate(prisma, 'knowledgeDocument').create({ data: knowledgeDocument(ids.customerA, ids.documentA) })).resolves.toBeDefined();
  await expect(delegate(prisma, 'retrievalRun').create({ data: { id: ids.runA, customerId: ids.customerA, requestId: `request-${ids.namespace}`, query: 'q', strategy: 'keyword', selectedEvidenceRefIds: [] } })).resolves.toBeDefined();
}

function session(customerId: string, id: string) {
  return { id, customerId, hostApp: 'erp', organizationId: 'org-shared', actorId: 'actor-shared' };
}

function knowledgeDocument(customerId: string, id: string) {
  return {
    id, customerId, title: 'fixture', sourceType: 'manual', sourceKey: CUSTOMER_SCOPE_FIXTURES.shared.sourceKey,
    version: CUSTOMER_SCOPE_FIXTURES.shared.sourceVersion, language: 'zh-TW', status: 'active', visibility: 'CUSTOMER',
    organizationIds: [], requiredPermissionScopes: []
  };
}

function workflowRows(model: string, ids: FixtureIds) {
  return (customerId: string, id = `${model}-${customerId}`) => ({
    id, customerId, requestId: `request-${ids.namespace}`, sessionId: customerId === ids.customerA ? ids.sessionA : ids.sessionB,
    idempotencyKey: CUSTOMER_SCOPE_FIXTURES.shared.idempotencyKey,
    ...(model === 'toolCall'
      ? { toolName: 'tool', toolVersion: '1', status: 'pending', executionStatus: 'not_started' }
      : model === 'approvalRequest'
        ? { requesterActorId: 'actor-shared', riskLevel: 'low', status: 'pending', actionSummary: {}, payloadSummary: {}, evidenceRefIds: [], auditEventIds: [] }
        : { actorId: 'actor-shared', toolName: 'tool', resource: 'orders', operation: 'read', riskLevel: 'low', payloadSummary: {}, preview: {}, status: 'draft' })
  });
}

function crossCustomerChild(child: string, parentIdField: string, ids: FixtureIds) {
  return {
    id: `${child}-b-${ids.namespace}`, customerId: ids.customerB,
    [parentIdField]: child === 'knowledgeChunk' ? ids.documentA : child === 'retrievalCandidate' ? ids.runA : ids.sessionA,
    ...(child === 'assistantMessage'
      ? { requestId: `request-${ids.namespace}`, role: 'user', content: 'x' }
      : child === 'knowledgeChunk'
        ? { chunkIndex: 0, content: 'x', tokenCount: 1 }
        : child === 'retrievalCandidate'
          ? { sourceId: 'x', sourceType: 'document_chunk', score: 1, rank: 1 }
          : { requestId: `request-${ids.namespace}`, toolName: 't', toolVersion: '1', status: 'pending', executionStatus: 'not_started' })
  };
}

async function expectConstraint(operation: Promise<unknown>, category: 'unique' | 'relation') {
  try {
    await operation;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    expect(category === 'unique' ? ['P2002'] : ['P2003', 'P2014']).toContain(code);
    return;
  }
  throw new Error(`Expected database constraint rejection (${category}).`);
}

function hasStaticPersistenceContract(schema: ReturnType<typeof loadPrismaSchemaContract>): boolean {
  return Boolean(
    schema.model('Customer') &&
    schema.hasCompoundUnique('KnowledgeDocument', ['customerId', 'sourceKey', 'version']) &&
    ['ToolCall', 'ApprovalRequest', 'ActionDraft'].every((modelName) => schema.hasCompoundUnique(modelName, ['customerId', 'idempotencyKey'])) &&
    schema.hasQualifiedRelation('AssistantMessage', 'AssistantSession', ['customerId', 'sessionId'], ['customerId', 'id']) &&
    schema.hasQualifiedRelation('KnowledgeChunk', 'KnowledgeDocument', ['customerId', 'documentId'], ['customerId', 'id']) &&
    schema.hasQualifiedRelation('RetrievalCandidate', 'RetrievalRun', ['customerId', 'retrievalRunId'], ['customerId', 'id']) &&
    schema.hasQualifiedRelation('ToolCall', 'AssistantSession', ['customerId', 'sessionId'], ['customerId', 'id'])
  );
}
