import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCustomerMigrationDatabase } from '../support/customer-migration-db.helper';
import { loadPrismaSchemaContract } from '../support/prisma-schema-contract.helper';

const DIRECT_OWNED = [
  'AssistantSession', 'AssistantMessage', 'KnowledgeDocument', 'KnowledgeChunk', 'RetrievalRun', 'RetrievalCandidate',
  'EvidenceRef', 'ToolCall', 'ApprovalRequest', 'ActionDraft', 'EscalationRequest', 'FeedbackEvent', 'ReviewItem', 'AuditEvent'
] as const;
const migrationRoot = resolve(__dirname, '../../prisma/migrations');
const expandSql = readFileSync(resolve(migrationRoot, '20260804000000_customer_scope_expand/migration.sql'), 'utf8');
const enforceSql = readFileSync(resolve(migrationRoot, '20260804000001_customer_scope_backfill_enforce/migration.sql'), 'utf8');
const runbook = readFileSync(resolve(__dirname, '../../specs/002-customer-scoped-assistant-core/migration-runbook.md'), 'utf8');

describe('Customer migration static enforcement contract (T072)', () => {
  const schema = loadPrismaSchemaContract();

  it('requires direct Customer ownership, policy fields, scoped unique keys, and only actual composite relations', () => {
    expect(DIRECT_OWNED.filter((model) => !schema.hasRequiredField(model, 'customerId'))).toEqual([]);
    expect(['customerId', 'visibility', 'organizationIds', 'requiredPermissionScopes'].filter((field) => !schema.hasRequiredField('KnowledgeDocument', field))).toEqual([]);
    expect(schema.hasCompoundUnique('KnowledgeDocument', ['customerId', 'sourceKey', 'version'])).toBe(true);
    expect(['ToolCall', 'ApprovalRequest', 'ActionDraft'].filter((model) => !schema.hasCompoundUnique(model, ['customerId', 'idempotencyKey']))).toEqual([]);
    expect(schema.hasCompoundUnique('CustomerToolPolicy', ['customerId', 'toolDefinitionId'])).toBe(true);
    expect(schema.hasCompoundUnique('ToolDefinition', ['name', 'version'])).toBe(true);
    expect(schema.model('ToolDefinition')?.fields).not.toContain('customerId');
    expect(schema.hasQualifiedRelation('AssistantMessage', 'AssistantSession', ['customerId', 'sessionId'], ['customerId', 'id'])).toBe(true);
    expect(schema.hasQualifiedRelation('KnowledgeChunk', 'KnowledgeDocument', ['customerId', 'documentId'], ['customerId', 'id'])).toBe(true);
    expect(schema.hasQualifiedRelation('RetrievalCandidate', 'RetrievalRun', ['customerId', 'retrievalRunId'], ['customerId', 'id'])).toBe(true);
    expect(schema.hasQualifiedRelation('RetrievalCandidate', 'KnowledgeChunk', ['customerId', 'chunkId'], ['customerId', 'id'])).toBe(true);
    expect(schema.hasQualifiedRelation('EvidenceRef', 'AssistantMessage', ['customerId', 'messageId'], ['customerId', 'id'])).toBe(true);
    expect(schema.hasQualifiedRelation('ToolCall', 'AssistantSession', ['customerId', 'sessionId'], ['customerId', 'id'])).toBe(true);
    expect(schema.hasQualifiedRelation('ToolCall', 'AssistantMessage', ['customerId', 'messageId'], ['customerId', 'id'])).toBe(true);
    expect(schema.hasQualifiedRelation('AuditEvent', 'ToolCall', ['customerId', 'toolCallId'], ['customerId', 'id'])).toBe(true);
  });

  it('keeps Release A additive and requires explicit staged approval before Release B enforcement', () => {
    expect(expandSql).toContain('CREATE TABLE "_CustomerScopeApprovedMapping"');
    expect(expandSql).toContain('CREATE TABLE "_CustomerScopeApprovedCustomerRoot"');
    expect(expandSql).toContain('ADD COLUMN "customerId" TEXT');
    expect(expandSql).not.toMatch(/INSERT INTO "Customer"/);
    expect(expandSql).not.toMatch(/ALTER COLUMN "customerId" SET NOT NULL/);
    expect(enforceSql).toMatch(/^BEGIN;/m);
    expect(enforceSql).toContain('CUSTOMER_SCOPE_UNMAPPED_RECORD');
    expect(enforceSql).toContain('CUSTOMER_SCOPE_AMBIGUOUS_MAPPING');
    expect(enforceSql).toContain('CUSTOMER_SCOPE_INVALID_KNOWLEDGE_POLICY');
    expect(enforceSql).toContain('DROP TABLE "_CustomerScopeApprovedMapping"');
    expect(enforceSql).toMatch(/COMMIT;\s*$/);
  });

  it('keeps rebuildable and retained-data operational paths distinct without restoring unsafe identity authority', () => {
    expect(runbook).toContain('## 1. Migration Paths');
    expect(runbook).toContain('## 2. Approved Mapping Contract');
    expect(runbook).toContain('## 3. Prohibited Inference');
    expect(runbook).toContain('## 4. Preflight and Enforcement Blockers');
    expect(runbook).toContain('## 8. Rollback and Forward Fix');
    expect(runbook).toContain('mappingSource');
    expect(runbook).toContain('approvedBy');
    expect(runbook).toContain('approvedAt');
    expect(runbook).toContain('Missing or invalid policy remains deny-by-default');
    expect(runbook).toContain('never restore public identity-header authority');
    expect(runbook).toMatch(/Do not commit production customer\s+IDs or mappings/);
  });
});

describe('Customer migration release/enforcement contract (T072)', () => {
  it('rolls back Release B on missing approval mapping without fabricated ownership or partial enforcement', async () => {
    const database = await createCustomerMigrationDatabase('release-b-rollback');
    try {
      await database.applyThroughReleaseA();
      await database.execute(legacySession('legacy-session'));
      await expect(database.applyReleaseB()).rejects.toThrow('Customer migration test command failed: psql');
      expect(await database.scalar('SELECT COALESCE("customerId", \'NULL\') FROM "AssistantSession" WHERE "id" = \'legacy-session\';')).toBe('NULL');
      expect(await database.scalar("SELECT to_regclass('public.\"_CustomerScopeApprovedMapping\"') IS NOT NULL;")).toBe('t');
      expect(await database.scalar('SELECT count(*) FROM "Customer";')).toBe('0');
      expect(await database.scalar("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'AssistantSession' AND column_name = 'customerId';")).toBe('YES');
    } finally {
      await database.dispose();
    }
  }, 60_000);

  it('backfills only explicit approved mappings, then enforces Customer-scoped unique, composite relation, and policy constraints', async () => {
    const database = await createCustomerMigrationDatabase('release-b-enforcement');
    try {
      await database.applyThroughReleaseA();
      await database.execute(`${legacySession('legacy-session-a')}
${legacyDocument('legacy-document-a', 'legacy-source-a')}
${legacyDocument('legacy-document-organization', 'legacy-source-organization')}
INSERT INTO "_CustomerScopeApprovedCustomerRoot" ("customerId", "mappingSource", "approvedBy", "approvedAt") VALUES ('customer-a', 'test-approved', 'owner', '2026-08-04T00:00:00.000Z');
${approvedMapping('map-session-a', 'AssistantSession', 'legacy-session-a', 'customer-a')}
${approvedMapping('map-document-a', 'KnowledgeDocument', 'legacy-document-a', 'customer-a', "'CUSTOMER', ARRAY[]::TEXT[], ARRAY[]::TEXT[]")}
${approvedMapping('map-document-organization', 'KnowledgeDocument', 'legacy-document-organization', 'customer-a', "'ORGANIZATION', ARRAY['org-a', 'org-b']::TEXT[], ARRAY['customers:read', 'orders:read']::TEXT[]")}`);
      await database.applyReleaseB();
      expect(await database.scalar('SELECT "customerId" FROM "AssistantSession" WHERE "id" = \'legacy-session-a\';')).toBe('customer-a');
      expect(await database.scalar('SELECT "customerId" || \':\' || "visibility"::TEXT FROM "KnowledgeDocument" WHERE "id" = \'legacy-document-a\';')).toBe('customer-a:CUSTOMER');
      expect(await database.scalar("SELECT array_to_string(\"organizationIds\", ',') || ':' || array_to_string(\"requiredPermissionScopes\", ',') FROM \"KnowledgeDocument\" WHERE \"id\" = 'legacy-document-organization';")).toBe('org-a,org-b:customers:read,orders:read');
      expect(Number(await database.scalar(`SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'customerId' AND is_nullable = 'NO' AND table_name IN (${DIRECT_OWNED.map((model) => `'${model}'`).join(', ')});`))).toBe(DIRECT_OWNED.length);
      expect(Number(await database.scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'KnowledgeDocument' AND column_name IN ('customerId', 'visibility', 'organizationIds', 'requiredPermissionScopes') AND is_nullable = 'NO';"))).toBe(4);

      await database.execute(`${insertCustomer('customer-b')}
${finalSession('customer-b', 'session-b')}
${finalDocument('customer-a', 'document-a-shared', 'shared-source', '1')}
${finalDocument('customer-b', 'document-b', 'shared-source', '1')}
${finalChunk('customer-a', 'chunk-a', 'legacy-document-a')}
${finalChunk('customer-b', 'chunk-b', 'document-b')}
${finalToolCall('customer-a', 'tool-a', 'legacy-session-a', 'shared-idempotency-key')}
${finalToolCall('customer-b', 'tool-b', 'session-b', 'shared-idempotency-key')}
${finalApproval('customer-a', 'approval-a', 'legacy-session-a', 'shared-idempotency-key')}
${finalApproval('customer-b', 'approval-b', 'session-b', 'shared-idempotency-key')}
${finalActionDraft('customer-a', 'draft-a', 'legacy-session-a', 'shared-idempotency-key')}
${finalActionDraft('customer-b', 'draft-b', 'session-b', 'shared-idempotency-key')}
INSERT INTO "RetrievalRun" ("id", "customerId", "requestId", "query", "strategy", "selectedEvidenceRefIds") VALUES ('run-b', 'customer-b', 'request-b', 'query', 'keyword', ARRAY[]::TEXT[]);
INSERT INTO "RetrievalCandidate" ("id", "customerId", "retrievalRunId", "chunkId", "sourceId", "sourceType", "score", "rank") VALUES ('candidate-b', 'customer-b', 'run-b', 'chunk-b', 'chunk-b', 'document_chunk', 1, 1);`);

      await expect(database.execute(finalDocument('customer-a', 'document-a-duplicate', 'shared-source', '1'))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalToolCall('customer-a', 'tool-a-duplicate', 'legacy-session-a', 'shared-idempotency-key'))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalApproval('customer-a', 'approval-a-duplicate', 'legacy-session-a', 'shared-idempotency-key'))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalActionDraft('customer-a', 'draft-a-duplicate', 'legacy-session-a', 'shared-idempotency-key'))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute("INSERT INTO \"AssistantSession\" (\"id\", \"hostApp\", \"organizationId\", \"actorId\", \"status\", \"createdAt\", \"updatedAt\") VALUES ('session-null-customer', 'erp', 'org-shared', 'actor-shared', 'active', NOW(), NOW());")).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute("INSERT INTO \"KnowledgeDocument\" (\"id\", \"customerId\", \"title\", \"sourceType\", \"sourceKey\", \"version\", \"language\", \"status\", \"visibility\", \"organizationIds\", \"requiredPermissionScopes\", \"updatedAt\") VALUES ('document-null-policy', 'customer-b', 'Fixture', 'manual', 'null-policy', '1', 'en', 'active', NULL, ARRAY[]::TEXT[], ARRAY[]::TEXT[], NOW());")).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute("INSERT INTO \"AssistantMessage\" (\"id\", \"customerId\", \"sessionId\", \"requestId\", \"role\", \"content\") VALUES ('message-cross', 'customer-b', 'legacy-session-a', 'request', 'user', 'x');")).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute("INSERT INTO \"KnowledgeChunk\" (\"id\", \"customerId\", \"documentId\", \"chunkIndex\", \"content\", \"tokenCount\", \"updatedAt\") VALUES ('chunk-cross', 'customer-b', 'legacy-document-a', 0, 'x', 1, NOW());")).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute("INSERT INTO \"ToolCall\" (\"id\", \"customerId\", \"requestId\", \"sessionId\", \"toolName\", \"toolVersion\", \"status\", \"executionStatus\") VALUES ('tool-cross', 'customer-b', 'request', 'legacy-session-a', 'tool', '1', 'pending', 'not_started');")).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute("INSERT INTO \"RetrievalCandidate\" (\"id\", \"customerId\", \"retrievalRunId\", \"chunkId\", \"sourceId\", \"sourceType\", \"score\", \"rank\") VALUES ('candidate-cross', 'customer-b', 'run-b', 'chunk-a', 'chunk-a', 'document_chunk', 1, 2);")).rejects.toThrow('Customer migration test command failed: psql');
      expect(await database.scalar("SELECT count(*) FROM \"RetrievalCandidate\" WHERE \"id\" = 'candidate-cross';")).toBe('0');
      await expect(database.execute(finalDocumentWithPolicy('customer-b', 'policy-invalid-customer', 'CUSTOMER', "ARRAY['org-shared']::TEXT[]"))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalDocumentWithPolicy('customer-b', 'policy-invalid-organization', 'ORGANIZATION', 'ARRAY[]::TEXT[]'))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalDocumentWithPolicy('customer-b', 'policy-invalid-blank', 'ORGANIZATION', "ARRAY[' ']::TEXT[]"))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalDocumentWithPolicy('customer-b', 'policy-invalid-untrimmed', 'ORGANIZATION', "ARRAY[' org-a ']::TEXT[]"))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalDocumentWithPolicy('customer-b', 'policy-invalid-duplicate', 'ORGANIZATION', "ARRAY['org-a', 'org-a']::TEXT[]"))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalDocumentWithPolicy('customer-b', 'policy-invalid-scope-blank', 'ORGANIZATION', "ARRAY['org-a']::TEXT[]", 'policy-scope', '1', "ARRAY[' ']::TEXT[]"))).rejects.toThrow('Customer migration test command failed: psql');
      await expect(database.execute(finalDocumentWithPolicy('customer-b', 'policy-invalid-scope-duplicate', 'ORGANIZATION', "ARRAY['org-a']::TEXT[]", 'policy-scope', '2', "ARRAY['orders:read', 'orders:read']::TEXT[]"))).rejects.toThrow('Customer migration test command failed: psql');

      await database.execute(finalDocumentWithPolicy('customer-b', 'forward-fixed-document', 'ORGANIZATION', "ARRAY['org-shared']::TEXT[]"));
      expect(await database.scalar("SELECT \"visibility\"::TEXT || ':' || array_to_string(\"organizationIds\", ',') FROM \"KnowledgeDocument\" WHERE \"id\" = 'forward-fixed-document';")).toBe('ORGANIZATION:org-shared');
    } finally {
      await database.dispose();
    }
  }, 90_000);
});

function legacySession(id: string): string {
  return `INSERT INTO "AssistantSession" ("id", "hostApp", "organizationId", "actorId", "status", "createdAt", "updatedAt") VALUES ('${id}', 'erp', 'org-shared', 'actor-shared', 'active', NOW(), NOW());`;
}

function legacyDocument(id: string, sourceKey = 'legacy-source'): string {
  return `INSERT INTO "KnowledgeDocument" ("id", "title", "sourceType", "sourceKey", "version", "language", "status", "updatedAt") VALUES ('${id}', 'Legacy document', 'manual', '${sourceKey}', '1', 'en', 'active', NOW());`;
}

function approvedMapping(id: string, recordType: string, recordId: string, customerId: string, policy = 'NULL, NULL, NULL'): string {
  return `INSERT INTO "_CustomerScopeApprovedMapping" ("id", "recordType", "recordId", "customerId", "mappingSource", "approvedBy", "approvedAt", "visibility", "organizationIds", "requiredPermissionScopes") VALUES ('${id}', '${recordType}', '${recordId}', '${customerId}', 'test-approved', 'owner', '2026-08-04T00:00:00.000Z', ${policy});`;
}

function insertCustomer(id: string): string { return `INSERT INTO "Customer" ("id") VALUES ('${id}');`; }
function finalSession(customerId: string, id: string): string { return `INSERT INTO "AssistantSession" ("id", "customerId", "hostApp", "organizationId", "actorId", "status", "createdAt", "updatedAt") VALUES ('${id}', '${customerId}', 'erp', 'org-shared', 'actor-shared', 'active', NOW(), NOW());`; }
function finalDocument(customerId: string, id: string, sourceKey: string, version: string): string { return finalDocumentWithPolicy(customerId, id, 'CUSTOMER', 'ARRAY[]::TEXT[]', sourceKey, version); }
function finalDocumentWithPolicy(customerId: string, id: string, visibility: 'CUSTOMER' | 'ORGANIZATION', organizationIds: string, sourceKey = 'policy-source', version = '1', requiredPermissionScopes = 'ARRAY[]::TEXT[]'): string {
  return `INSERT INTO "KnowledgeDocument" ("id", "customerId", "title", "sourceType", "sourceKey", "version", "language", "status", "visibility", "organizationIds", "requiredPermissionScopes", "updatedAt") VALUES ('${id}', '${customerId}', 'Fixture', 'manual', '${sourceKey}', '${version}', 'en', 'active', '${visibility}', ${organizationIds}, ${requiredPermissionScopes}, NOW());`;
}
function finalChunk(customerId: string, id: string, documentId: string): string { return `INSERT INTO "KnowledgeChunk" ("id", "customerId", "documentId", "chunkIndex", "content", "tokenCount", "updatedAt") VALUES ('${id}', '${customerId}', '${documentId}', 0, 'fixture', 1, NOW());`; }
function finalToolCall(customerId: string, id: string, sessionId: string, idempotencyKey: string): string { return `INSERT INTO "ToolCall" ("id", "customerId", "requestId", "sessionId", "toolName", "toolVersion", "status", "executionStatus", "idempotencyKey") VALUES ('${id}', '${customerId}', 'request-${id}', '${sessionId}', 'tool', '1', 'pending', 'not_started', '${idempotencyKey}');`; }
function finalApproval(customerId: string, id: string, sessionId: string, idempotencyKey: string): string { return `INSERT INTO "ApprovalRequest" ("id", "customerId", "requestId", "sessionId", "requesterActorId", "riskLevel", "status", "actionSummary", "payloadSummary", "evidenceRefIds", "auditEventIds", "idempotencyKey") VALUES ('${id}', '${customerId}', 'request-${id}', '${sessionId}', 'actor-shared', 'low', 'pending', '{}'::jsonb, '{}'::jsonb, ARRAY[]::TEXT[], ARRAY[]::TEXT[], '${idempotencyKey}');`; }
function finalActionDraft(customerId: string, id: string, sessionId: string, idempotencyKey: string): string { return `INSERT INTO "ActionDraft" ("id", "customerId", "requestId", "sessionId", "actorId", "toolName", "resource", "operation", "riskLevel", "payloadSummary", "preview", "status", "idempotencyKey") VALUES ('${id}', '${customerId}', 'request-${id}', '${sessionId}', 'actor-shared', 'tool', 'orders', 'read', 'low', '{}'::jsonb, '{}'::jsonb, 'draft', '${idempotencyKey}');`; }
