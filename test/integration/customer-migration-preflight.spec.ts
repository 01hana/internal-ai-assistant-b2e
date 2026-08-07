import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { requireTargetModule } from '../support/dynamic-target-module.helper';

const describePreflightContract =
  process.env.RUN_CUSTOMER_MIGRATION_PREFLIGHT_CONTRACT_TESTS === 'true' ? describe : describe.skip;

type PreflightReport = Readonly<{
  totalRows: number;
  mappedRows: number;
  unmappedRows: number;
  ambiguousRows: number;
  invalidCustomerRows: number;
  invalidPolicyRows: number;
  retrievalBlockedRows: number;
  relationConflicts: number;
  uniquenessConflicts: number;
  enforceReadiness: boolean;
  blockingReasons: readonly string[];
}>;

type EvaluatePreflight = (input: unknown) => PreflightReport;
type RecordType = 'KnowledgeDocument' | 'AssistantSession' | 'ToolCall' | 'ApprovalRequest' | 'ActionDraft';
type Mapping = Record<string, unknown>;
type InvalidMappingCase = readonly [
  name: string,
  createInvalidMapping: () => Mapping,
  reason: string | readonly string[],
  retainedId: string,
  missingProperty?: 'customerId' | 'mappingSource' | 'approvedBy' | 'approvedAt',
  unmappedRows?: number
];

const APPROVAL = Object.freeze({ mappingSource: 'approved-runbook', approvedBy: 'operations-owner', approvedAt: '2026-08-04T00:00:00.000Z' });
const CUSTOMER_POLICY = Object.freeze({ visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: [] });
const ORGANIZATION_POLICY = Object.freeze({ visibility: 'ORGANIZATION', organizationIds: ['org-shared'], requiredPermissionScopes: ['orders:read'] });
const BASE_INPUT = Object.freeze({ customerRoots: ['customer-a', 'customer-b'] });
const MISSING_MAPPING_FACTORIES = Object.freeze({
  customerId: () => omit(mapping('KnowledgeDocument', 'missing-customer-id', 'customer-a', CUSTOMER_POLICY), 'customerId'),
  mappingSource: () => omit(mapping('KnowledgeDocument', 'missing-mapping-source', 'customer-a', CUSTOMER_POLICY), 'mappingSource'),
  approvedBy: () => omit(mapping('KnowledgeDocument', 'missing-approved-by', 'customer-a', CUSTOMER_POLICY), 'approvedBy'),
  approvedAt: () => omit(mapping('KnowledgeDocument', 'missing-approved-at', 'customer-a', CUSTOMER_POLICY), 'approvedAt')
});
const INVALID_MAPPING_CASES: readonly InvalidMappingCase[] = [
  ['blank customerId', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), customerId: ' ' }), 'INVALID_CUSTOMER_ID', 'invalid-customer'],
  ['blank mappingSource', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), mappingSource: ' ' }), 'INVALID_MAPPING_APPROVAL', 'invalid-customer'],
  ['blank approvedBy', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), approvedBy: ' ' }), 'INVALID_MAPPING_APPROVAL', 'invalid-customer'],
  ['blank approvedAt', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), approvedAt: ' ' }), 'INVALID_MAPPING_APPROVAL', 'invalid-customer'],
  ['missing customerId', MISSING_MAPPING_FACTORIES.customerId, 'INVALID_CUSTOMER_ID', 'missing-customer-id', 'customerId'],
  ['missing mappingSource', MISSING_MAPPING_FACTORIES.mappingSource, 'INVALID_MAPPING_APPROVAL', 'missing-mapping-source', 'mappingSource'],
  ['missing approvedBy', MISSING_MAPPING_FACTORIES.approvedBy, 'INVALID_MAPPING_APPROVAL', 'missing-approved-by', 'approvedBy'],
  ['missing approvedAt', MISSING_MAPPING_FACTORIES.approvedAt, 'INVALID_MAPPING_APPROVAL', 'missing-approved-at', 'approvedAt'],
  ['unknown Customer root', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), customerId: 'customer-missing' }), 'CUSTOMER_ROOT_NOT_FOUND', 'invalid-customer'],
  ['record type mismatch', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), recordType: 'AssistantSession' }), ['MAPPING_RESOURCE_MISMATCH', 'UNMAPPED_CUSTOMER'], 'invalid-customer', undefined, 1],
  ['record ID mismatch', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), recordId: 'different-id' }), ['MAPPING_RESOURCE_MISMATCH', 'UNMAPPED_CUSTOMER'], 'invalid-customer', undefined, 1],
  ['invalid approvedAt value', () => ({ ...mapping('KnowledgeDocument', 'invalid-customer', 'customer-a', CUSTOMER_POLICY), approvedAt: 'not-a-date' }), 'INVALID_MAPPING_APPROVAL', 'invalid-customer']
];

describe('T024 invalid mapping fixture construction', () => {
  it.each(Object.entries(MISSING_MAPPING_FACTORIES))('constructs a mapping without own property %s', (property, factory) => {
    expect(Object.prototype.hasOwnProperty.call(factory(), property)).toBe(false);
  });
});

describePreflightContract('Customer ownership migration preflight contract (T024)', () => {
  it('returns the exact all-valid report for approved CUSTOMER and ORGANIZATION policies', () => {
    const report = evaluate({
      ...BASE_INPUT,
      retainedRows: [row('KnowledgeDocument', 'valid-customer'), row('KnowledgeDocument', 'valid-organization')],
      approvedMappings: [mapping('KnowledgeDocument', 'valid-customer', 'customer-a', CUSTOMER_POLICY), mapping('KnowledgeDocument', 'valid-organization', 'customer-a', ORGANIZATION_POLICY)],
      relations: [], scopedKeys: []
    });
    expect(report).toEqual(validReport(2));
  });

  it('reports an unmapped document and never infers Customer ownership from lower-level values', () => {
    const report = evaluate({
      ...BASE_INPUT,
      retainedRows: [{ ...row('KnowledgeDocument', 'unmapped'), organizationId: 'org-shared', actorId: 'actor-shared', hostApp: 'erp', metadata: { customerId: 'customer-a' }, sourceKey: 'shared-source', requestId: 'request-a' }],
      approvedMappings: [], relations: [], scopedKeys: []
    });
    expectOnlyBlockedBy(report, { totalRows: 1, unmappedRows: 1, retrievalBlockedRows: 1, reason: 'UNMAPPED_CUSTOMER' });
  });

  it('reports conflicting approved mappings as ambiguous', () => {
    const report = evaluate({
      ...BASE_INPUT, retainedRows: [row('AssistantSession', 'ambiguous')],
      approvedMappings: [mapping('AssistantSession', 'ambiguous', 'customer-a'), mapping('AssistantSession', 'ambiguous', 'customer-b')], relations: [], scopedKeys: []
    });
    expectOnlyBlockedBy(report, { totalRows: 1, ambiguousRows: 1, reason: 'AMBIGUOUS_CUSTOMER_MAPPING' });
  });

  it.each(INVALID_MAPPING_CASES)('reports invalid Customer mapping: %s', (...values: unknown[]) => {
    const [_name, createInvalidMapping, reason, retainedId, missingProperty, unmappedRows] = values as unknown as InvalidMappingCase;
    const invalid = createInvalidMapping();
    if (missingProperty) expect(Object.prototype.hasOwnProperty.call(invalid, missingProperty)).toBe(false);
    const report = evaluate({ ...BASE_INPUT, retainedRows: [row('KnowledgeDocument', retainedId)], approvedMappings: [invalid], relations: [], scopedKeys: [] });
    expectOnlyBlockedBy(report, { totalRows: 1, invalidCustomerRows: 1, unmappedRows, retrievalBlockedRows: 1, reason });
  });

  it.each([
    ['unknown visibility', { visibility: 'RESTRICTED', organizationIds: [], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_VISIBILITY'],
    ['CUSTOMER with organization IDs', { visibility: 'CUSTOMER', organizationIds: ['org-shared'], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['ORGANIZATION with empty organization IDs', { visibility: 'ORGANIZATION', organizationIds: [], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['ORGANIZATION missing organizationIds', { visibility: 'ORGANIZATION', requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['blank organization ID', { visibility: 'ORGANIZATION', organizationIds: [' '], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['number organization ID', { visibility: 'ORGANIZATION', organizationIds: ['org-shared', 123], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['null organization ID', { visibility: 'ORGANIZATION', organizationIds: ['org-shared', null], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['non-array organization IDs', { visibility: 'ORGANIZATION', organizationIds: 'org-shared', requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['blank required scope', { visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: [' '] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['non-string required scope', { visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: ['orders:read', 1] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['null required scope', { visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: [null] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['non-array required scopes', { visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: 'orders:read' }, 'INVALID_KNOWLEDGE_POLICY'],
    ['missing visibility', { organizationIds: [], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_POLICY'],
    ['missing required scopes', { visibility: 'CUSTOMER', organizationIds: [] }, 'INVALID_KNOWLEDGE_POLICY']
  ])('reports invalid KnowledgeDocument policy: %s', (_name, policy, reason) => {
    const report = evaluate({ ...BASE_INPUT, retainedRows: [row('KnowledgeDocument', 'invalid-policy')], approvedMappings: [mapping('KnowledgeDocument', 'invalid-policy', 'customer-a', policy)], relations: [], scopedKeys: [] });
    expectOnlyBlockedBy(report, { totalRows: 1, invalidPolicyRows: 1, retrievalBlockedRows: 1, reason });
  });

  it('normalizes and deduplicates valid whitespace policy arrays while retaining ALL-scope policy', () => {
    const report = evaluate({
      ...BASE_INPUT, retainedRows: [row('KnowledgeDocument', 'normalized')],
      approvedMappings: [mapping('KnowledgeDocument', 'normalized', 'customer-a', { visibility: 'ORGANIZATION', organizationIds: [' org-shared ', 'org-shared'], requiredPermissionScopes: [' orders:read ', 'orders:read', 'invoices:read'] })],
      relations: [], scopedKeys: []
    });
    expect(report).toEqual(validReport(1));
  });

  it('accepts same-Customer relations and rejects cross-Customer relations', () => {
    expect(evaluate({ ...BASE_INPUT, retainedRows: [row('AssistantSession', 'parent'), row('AssistantSession', 'child')], approvedMappings: [mapping('AssistantSession', 'parent', 'customer-a'), mapping('AssistantSession', 'child', 'customer-a')], relations: [{ childCustomerId: 'customer-a', parentCustomerId: 'customer-a' }], scopedKeys: [] })).toEqual(validReport(2));
    const report = evaluate({ ...BASE_INPUT, retainedRows: [row('AssistantSession', 'parent'), row('AssistantSession', 'child')], approvedMappings: [mapping('AssistantSession', 'parent', 'customer-a'), mapping('AssistantSession', 'child', 'customer-b')], relations: [{ childCustomerId: 'customer-b', parentCustomerId: 'customer-a' }], scopedKeys: [] });
    expectOnlyBlockedBy(report, { totalRows: 2, mappedRows: 2, relationConflicts: 1, reason: 'CROSS_CUSTOMER_RELATION' });
  });

  it('counts each invalid relation input entry without collapsing distinct relations', () => {
    const report = evaluate({
      ...BASE_INPUT,
      retainedRows: [row('AssistantSession', 'relation-a'), row('AssistantSession', 'relation-b')],
      approvedMappings: [mapping('AssistantSession', 'relation-a'), mapping('AssistantSession', 'relation-b')],
      relations: [
        { childCustomerId: 'customer-b', parentCustomerId: 'customer-a' },
        { childCustomerId: 'customer-b', parentCustomerId: 'customer-a' }
      ],
      scopedKeys: []
    });
    expectOnlyBlockedBy(report, { totalRows: 2, mappedRows: 2, relationConflicts: 2, reason: 'CROSS_CUSTOMER_RELATION' });
  });

  it('accepts cross-Customer knowledge source/version reuse and rejects same-Customer collisions', () => {
    expect(evaluate({ ...BASE_INPUT, retainedRows: [row('KnowledgeDocument', 'knowledge-a'), row('KnowledgeDocument', 'knowledge-b')], approvedMappings: [mapping('KnowledgeDocument', 'knowledge-a', 'customer-a', CUSTOMER_POLICY), mapping('KnowledgeDocument', 'knowledge-b', 'customer-b', CUSTOMER_POLICY)], relations: [], scopedKeys: [knowledgeKey('customer-a'), knowledgeKey('customer-b')] })).toEqual(validReport(2));
    const report = evaluate({ ...BASE_INPUT, retainedRows: [row('KnowledgeDocument', 'knowledge-a'), row('KnowledgeDocument', 'knowledge-b')], approvedMappings: [mapping('KnowledgeDocument', 'knowledge-a', 'customer-a', CUSTOMER_POLICY), mapping('KnowledgeDocument', 'knowledge-b', 'customer-a', CUSTOMER_POLICY)], relations: [], scopedKeys: [knowledgeKey('customer-a'), knowledgeKey('customer-a')] });
    expectOnlyBlockedBy(report, { totalRows: 2, mappedRows: 2, uniquenessConflicts: 1, reason: 'CUSTOMER_SCOPED_UNIQUENESS_CONFLICT' });
  });

  it('counts three equal Customer-scoped keys as one duplicate group', () => {
    const report = evaluate({
      ...BASE_INPUT,
      retainedRows: [row('ToolCall', 'tool-group-a'), row('ToolCall', 'tool-group-b')],
      approvedMappings: [mapping('ToolCall', 'tool-group-a'), mapping('ToolCall', 'tool-group-b')],
      relations: [],
      scopedKeys: [idempotencyKey('ToolCall', 'customer-a'), idempotencyKey('ToolCall', 'customer-a'), idempotencyKey('ToolCall', 'customer-a')]
    });
    expectOnlyBlockedBy(report, { totalRows: 2, mappedRows: 2, uniquenessConflicts: 1, reason: 'CUSTOMER_SCOPED_UNIQUENESS_CONFLICT' });
  });

  it.each(['ToolCall', 'ApprovalRequest', 'ActionDraft'] as const)('rejects same-Customer %s idempotency collisions', (recordType) => {
    const report = evaluate({ ...BASE_INPUT, retainedRows: [row(recordType, `${recordType}-a`), row(recordType, `${recordType}-b`)], approvedMappings: [mapping(recordType, `${recordType}-a`, 'customer-a'), mapping(recordType, `${recordType}-b`, 'customer-a')], relations: [], scopedKeys: [idempotencyKey(recordType, 'customer-a'), idempotencyKey(recordType, 'customer-a')] });
    expectOnlyBlockedBy(report, { totalRows: 2, mappedRows: 2, uniquenessConflicts: 1, reason: 'CUSTOMER_SCOPED_UNIQUENESS_CONFLICT' });
  });

  it.each(['ToolCall', 'ApprovalRequest', 'ActionDraft'] as const)('permits cross-Customer %s idempotency reuse', (recordType) => {
    const report = evaluate({ ...BASE_INPUT, retainedRows: [row(recordType, `${recordType}-a`), row(recordType, `${recordType}-b`)], approvedMappings: [mapping(recordType, `${recordType}-a`, 'customer-a'), mapping(recordType, `${recordType}-b`, 'customer-b')], relations: [], scopedKeys: [idempotencyKey(recordType, 'customer-a'), idempotencyKey(recordType, 'customer-b')] });
    expect(report).toEqual(validReport(2));
  });

  it('rejects every malformed, unknown, or orphan mapping without exposing its contents', () => {
    const sentinel = 'PRIVATE_ORPHAN_MAPPING_7f8';
    const report = evaluate({
      ...BASE_INPUT,
      retainedRows: [row('AssistantSession', 'mapping-valid')],
      approvedMappings: [
        mapping('AssistantSession', 'mapping-valid'),
        mapping('AssistantSession', 'mapping-orphan'),
        { ...mapping('AssistantSession', 'mapping-unknown'), recordType: 'UnknownRecordType' },
        null,
        'invalid',
        [],
        { recordId: 'missing-type' },
        { recordType: 'AssistantSession' },
        { ...mapping('AssistantSession', 'blank-type'), recordType: ' ' },
        { ...mapping('AssistantSession', 'blank-id'), recordId: ' ' },
        { ...mapping('KnowledgeDocument', 'wrong-reference'), recordType: 'AssistantSession', recordId: 'mapping-valid-other' },
        { ...mapping('AssistantSession', 'mapping-orphan-secret'), metadata: { sentinel } }
      ],
      relations: [], scopedKeys: []
    });
    expect(report).toMatchObject({ mappedRows: 1, invalidCustomerRows: 11, enforceReadiness: false });
    expect(report.blockingReasons).toEqual(expect.arrayContaining(['INVALID_PREFLIGHT_INPUT', 'UNKNOWN_RECORD_TYPE', 'MAPPING_RESOURCE_MISMATCH']));
    expect(JSON.stringify(report)).not.toContain(sentinel);
  });

  it('rejects blank, non-string, and duplicate Customer root inputs', () => {
    const report = evaluate({
      customerRoots: ['customer-a', 'customer-a', ' ', 1],
      retainedRows: [row('AssistantSession', 'root-valid')],
      approvedMappings: [mapping('AssistantSession', 'root-valid')],
      relations: [], scopedKeys: []
    });
    expect(report).toMatchObject({ mappedRows: 1, invalidCustomerRows: 3, enforceReadiness: false, blockingReasons: ['INVALID_PREFLIGHT_INPUT'] });
  });

  it('returns only safe report fields and never leaks retained-data sentinels', () => {
    const privateSentinels = ['PRIVATE_CONTENT_7f8', 'PRIVATE_TITLE_7f8', 'PRIVATE_METADATA_7f8', 'Bearer private-jwt-7f8', 'private-source-key-7f8'];
    const report = evaluate({ ...BASE_INPUT, retainedRows: [{ ...row('KnowledgeDocument', 'unsafe'), title: privateSentinels[1], content: privateSentinels[0], metadata: { value: privateSentinels[2] }, sourceKey: privateSentinels[4], authorization: privateSentinels[3] }], approvedMappings: [], relations: [], scopedKeys: [] });
    expect(Object.keys(report).sort()).toEqual(['ambiguousRows', 'blockingReasons', 'enforceReadiness', 'invalidCustomerRows', 'invalidPolicyRows', 'mappedRows', 'relationConflicts', 'retrievalBlockedRows', 'totalRows', 'uniquenessConflicts', 'unmappedRows'].sort());
    privateSentinels.forEach((sentinel) => expect(JSON.stringify(report)).not.toContain(sentinel));
  });

  it('runs the file-only CLI with a safe report and no inline mapping authority', () => {
    const directory = mkdtempSync(join(tmpdir(), 'customer-preflight-'));
    const inputPath = join(directory, 'approved.json');
    try {
      writeFileSync(inputPath, JSON.stringify({
        ...BASE_INPUT,
        retainedRows: [row('KnowledgeDocument', 'cli-approved')],
        approvedMappings: [mapping('KnowledgeDocument', 'cli-approved', 'customer-a', CUSTOMER_POLICY)],
        relations: [], scopedKeys: []
      }));
      const result = runCli(['--input', inputPath]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(validReport(1));
      expect(result.stderr).toBe('');
      expect(runCli(['--customer-id', 'customer-a']).status).toBe(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns a non-zero safe CLI result without exposing rejected input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'customer-preflight-'));
    const inputPath = join(directory, 'blocked.json');
    const sentinel = 'PRIVATE_MAPPING_DETAIL_7f8';
    try {
      writeFileSync(inputPath, JSON.stringify({
        ...BASE_INPUT,
        retainedRows: [{ ...row('KnowledgeDocument', 'cli-blocked'), metadata: { sentinel } }],
        approvedMappings: [], relations: [], scopedKeys: []
      }));
      const result = runCli(['--input', inputPath]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ unmappedRows: 1, blockingReasons: ['UNMAPPED_CUSTOMER'] });
      expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps malformed and orphan CLI mappings in the safe blocked report', () => {
    const directory = mkdtempSync(join(tmpdir(), 'customer-preflight-'));
    const inputPath = join(directory, 'malformed.json');
    const sentinel = 'PRIVATE_CLI_MAPPING_7f8';
    try {
      writeFileSync(inputPath, JSON.stringify({
        ...BASE_INPUT,
        retainedRows: [row('AssistantSession', 'cli-valid')],
        approvedMappings: [mapping('AssistantSession', 'cli-valid'), mapping('AssistantSession', 'cli-orphan', 'customer-a', { metadata: { sentinel } }), null],
        relations: [], scopedKeys: []
      }));
      const result = runCli(['--input', inputPath]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ mappedRows: 1, invalidCustomerRows: 2, enforceReadiness: false });
      expect(`${result.stdout}${result.stderr}`).not.toContain(sentinel);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function evaluate(input: unknown): PreflightReport { return loadEvaluator()(input); }
function row(recordType: RecordType, recordId: string) { return { recordType, recordId }; }
function mapping(recordType: RecordType, recordId: string, customerId = 'customer-a', policy: Record<string, unknown> = {}) { return { recordType, recordId, customerId, ...APPROVAL, ...policy }; }
function omit(value: Mapping, property: string): Mapping { const copy = { ...value }; delete copy[property]; return copy; }
function knowledgeKey(customerId: string) { return { kind: 'knowledge-source-version', customerId, sourceKey: 'shared-source', version: '1' }; }
function idempotencyKey(recordType: 'ToolCall' | 'ApprovalRequest' | 'ActionDraft', customerId: string) { return { kind: 'idempotency', recordType, customerId, idempotencyKey: 'shared-idempotency-key' }; }
function validReport(totalRows: number): PreflightReport { return { totalRows, mappedRows: totalRows, unmappedRows: 0, ambiguousRows: 0, invalidCustomerRows: 0, invalidPolicyRows: 0, retrievalBlockedRows: 0, relationConflicts: 0, uniquenessConflicts: 0, enforceReadiness: true, blockingReasons: [] }; }

function expectOnlyBlockedBy(report: PreflightReport, expected: Readonly<{ totalRows: number; mappedRows?: number; unmappedRows?: number; ambiguousRows?: number; invalidCustomerRows?: number; invalidPolicyRows?: number; retrievalBlockedRows?: number; relationConflicts?: number; uniquenessConflicts?: number; reason: string | readonly string[] }>) {
  const counts = {
    unmappedRows: expected.unmappedRows ?? 0,
    ambiguousRows: expected.ambiguousRows ?? 0,
    invalidCustomerRows: expected.invalidCustomerRows ?? 0,
    invalidPolicyRows: expected.invalidPolicyRows ?? 0,
    retrievalBlockedRows: expected.retrievalBlockedRows ?? 0,
    relationConflicts: expected.relationConflicts ?? 0,
    uniquenessConflicts: expected.uniquenessConflicts ?? 0
  };
  expect(report).toEqual(expect.objectContaining({ totalRows: expected.totalRows, mappedRows: expected.mappedRows ?? 0, ...counts, enforceReadiness: false, blockingReasons: Array.isArray(expected.reason) ? expected.reason : [expected.reason] }));
}

function loadEvaluator(): EvaluatePreflight {
  const target = requireTargetModule(resolve(__dirname, '../../scripts/customer-ownership-migration-preflight'), 'T074 not implemented: customer ownership migration preflight evaluator is unavailable to T024 tests.');
  const evaluate = target.evaluateCustomerOwnershipMigrationPreflight;
  if (typeof evaluate !== 'function') throw new Error('Expected export evaluateCustomerOwnershipMigrationPreflight is unavailable.');
  return evaluate as EvaluatePreflight;
}

function runCli(argumentsList: readonly string[]) {
  return spawnSync(process.execPath, ['-r', 'ts-node/register', 'scripts/customer-ownership-migration-preflight.ts', ...argumentsList], {
    cwd: resolve(__dirname, '../..'),
    encoding: 'utf8',
    env: { ...process.env, TS_NODE_PROJECT: 'tsconfig.scripts.json' }
  });
}
