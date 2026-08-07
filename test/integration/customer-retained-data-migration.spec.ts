import { resolve } from 'node:path';
import { requireTargetModule } from '../support/dynamic-target-module.helper';

type Report = Readonly<{
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
type Evaluate = (input: unknown) => Report;

const APPROVAL = Object.freeze({ mappingSource: 'approved-runbook', approvedBy: 'operations-owner', approvedAt: '2026-08-04T00:00:00.000Z' });
const CUSTOMER_POLICY = Object.freeze({ visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: [] });
const ORGANIZATION_POLICY = Object.freeze({ visibility: 'ORGANIZATION', organizationIds: ['org-shared'], requiredPermissionScopes: ['orders:read'] });
const ROOTS = Object.freeze({ customerRoots: ['customer-a', 'customer-b'] });

describe('Customer retained-data migration rejection contract (T071)', () => {
  it('exposes the real T074 preflight evaluator instead of a test substitute', () => {
    expect(evaluator()).toEqual(expect.any(Function));
  });

  it('rejects unmapped rows despite every prohibited lower-level ownership hint and never mutates input', () => {
    const retained = {
      ...row('KnowledgeDocument', 'customer-a-unmapped-document'),
      organizationId: 'org-shared', hostApp: 'erp', actorId: 'actor-shared',
      metadata: { customerId: 'customer-a', private: 'PRIVATE_METADATA' },
      sourceKey: 'customer-a-source', requestId: 'customer-a-request', parentCustomerId: 'customer-a'
    };
    const input = { ...ROOTS, retainedRows: [retained], approvedMappings: [], relations: [], scopedKeys: [] };
    const before = structuredClone(input);
    const report = evaluator()(input);
    expect(input).toEqual(before);
    expect(report).toMatchObject({ unmappedRows: 1, mappedRows: 0, retrievalBlockedRows: 1, enforceReadiness: false, blockingReasons: ['UNMAPPED_CUSTOMER'] });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_METADATA|customer-a-source|customer-a-request/);
  });

  it('requires each retained child mapping and rejects conflicting policy mappings', () => {
    const report = evaluator()({
      ...ROOTS,
      retainedRows: [
        row('AssistantSession', 'session-mapped'), row('AssistantMessage', 'message-unmapped'),
        row('KnowledgeDocument', 'document-mapped'), row('KnowledgeChunk', 'chunk-unmapped'),
        row('RetrievalRun', 'run-mapped'), row('RetrievalCandidate', 'candidate-unmapped'),
        row('FeedbackEvent', 'feedback-unmapped'), row('AuditEvent', 'audit-unmapped'), row('KnowledgeDocument', 'policy-conflict')
      ],
      approvedMappings: [
        mapping('AssistantSession', 'session-mapped'), mapping('KnowledgeDocument', 'document-mapped', CUSTOMER_POLICY), mapping('RetrievalRun', 'run-mapped'),
        mapping('KnowledgeDocument', 'policy-conflict', CUSTOMER_POLICY), mapping('KnowledgeDocument', 'policy-conflict', ORGANIZATION_POLICY)
      ],
      relations: [], scopedKeys: []
    });
    expect(report).toMatchObject({ unmappedRows: 5, ambiguousRows: 1, retrievalBlockedRows: 1, enforceReadiness: false });
    expect(report.blockingReasons).toEqual(expect.arrayContaining(['UNMAPPED_CUSTOMER', 'AMBIGUOUS_CUSTOMER_MAPPING']));
  });

  it('rejects Customer A/B mappings for the same retained record as ambiguous', () => {
    const report = evaluator()({
      ...ROOTS,
      retainedRows: [row('AssistantSession', 'cross-customer-ambiguous')],
      approvedMappings: [
        mapping('AssistantSession', 'cross-customer-ambiguous', {}, 'customer-a'),
        mapping('AssistantSession', 'cross-customer-ambiguous', {}, 'customer-b')
      ],
      relations: [], scopedKeys: []
    });
    expect(report).toMatchObject({ ambiguousRows: 1, enforceReadiness: false, blockingReasons: ['AMBIGUOUS_CUSTOMER_MAPPING'] });
  });

  it('classifies exact duplicate mapping rows as ambiguous because Release B requires exactly one row', () => {
    const duplicate = mapping('AssistantSession', 'exact-duplicate');
    const report = evaluator()({ ...ROOTS, retainedRows: [row('AssistantSession', 'exact-duplicate')], approvedMappings: [duplicate, duplicate], relations: [], scopedKeys: [] });
    expect(report).toMatchObject({ ambiguousRows: 1, enforceReadiness: false, blockingReasons: ['AMBIGUOUS_CUSTOMER_MAPPING'] });
  });

  it('rejects every extra mapping entry even when the retained row has a valid exact mapping', () => {
    const input = {
      ...ROOTS,
      retainedRows: [row('AssistantSession', 'session-valid')],
      approvedMappings: [
        mapping('AssistantSession', 'session-valid'),
        mapping('AssistantSession', 'session-not-retained'),
        { ...mapping('AssistantSession', 'session-not-retained-type'), recordType: 'NotAnAggregate' },
        null,
        'not-a-mapping',
        [],
        { recordId: 'missing-type' },
        { recordType: 'AssistantSession' },
        { ...mapping('AssistantSession', 'blank-type'), recordType: ' ' },
        { ...mapping('AssistantSession', 'blank-id'), recordId: ' ' },
        { ...mapping('KnowledgeDocument', 'wrong-type'), recordType: 'AssistantSession', recordId: 'session-valid-other-type' }
      ],
      relations: [], scopedKeys: []
    };
    const before = structuredClone(input);
    const report = evaluator()(input);
    expect(input).toEqual(before);
    expect(report).toMatchObject({ mappedRows: 1, invalidCustomerRows: 10, enforceReadiness: false });
    expect(report.blockingReasons).toEqual(expect.arrayContaining(['MAPPING_RESOURCE_MISMATCH', 'UNKNOWN_RECORD_TYPE', 'INVALID_PREFLIGHT_INPUT']));
    expect(JSON.stringify(report)).not.toContain('session-not-retained');
  });

  it('rejects malformed Customer roots instead of filtering them away', () => {
    const report = evaluator()({
      customerRoots: ['customer-a', 'customer-a', ' ', 7],
      retainedRows: [row('AssistantSession', 'session-with-invalid-roots')],
      approvedMappings: [mapping('AssistantSession', 'session-with-invalid-roots')],
      relations: [], scopedKeys: []
    });
    expect(report).toMatchObject({ mappedRows: 1, invalidCustomerRows: 3, enforceReadiness: false, blockingReasons: ['INVALID_PREFLIGHT_INPUT'] });
  });

  it.each([
    ['missing visibility', { organizationIds: [], requiredPermissionScopes: [] }],
    ['unknown visibility', { visibility: 'PRIVATE', organizationIds: [], requiredPermissionScopes: [] }, 'INVALID_KNOWLEDGE_VISIBILITY'],
    ['CUSTOMER with organization IDs', { visibility: 'CUSTOMER', organizationIds: ['org-shared'], requiredPermissionScopes: [] }],
    ['ORGANIZATION without organization IDs', { visibility: 'ORGANIZATION', organizationIds: [], requiredPermissionScopes: [] }],
    ['blank organization ID', { visibility: 'ORGANIZATION', organizationIds: [' '], requiredPermissionScopes: [] }],
    ['blank required scope', { visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: [' '] }],
    ['non-string organization ID', { visibility: 'ORGANIZATION', organizationIds: ['org-shared', 1], requiredPermissionScopes: [] }],
    ['non-string required scope', { visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: ['orders:read', 1] }],
    ['non-array organization IDs', { visibility: 'ORGANIZATION', organizationIds: 'org-shared', requiredPermissionScopes: [] }],
    ['non-array required scopes', { visibility: 'CUSTOMER', organizationIds: [], requiredPermissionScopes: 'orders:read' }]
  ])('blocks invalid KnowledgeDocument policy: %s', (_name, policy, expectedReason = 'INVALID_KNOWLEDGE_POLICY') => {
    const report = evaluator()({ ...ROOTS, retainedRows: [row('KnowledgeDocument', 'invalid-policy')], approvedMappings: [mapping('KnowledgeDocument', 'invalid-policy', policy)], relations: [], scopedKeys: [] });
    expect(report).toMatchObject({ invalidPolicyRows: 1, retrievalBlockedRows: 1, enforceReadiness: false, blockingReasons: [expectedReason] });
  });

  it('accepts preflight-normalized approved policy arrays and preserves Customer ownership semantics', () => {
    const report = evaluator()({
      ...ROOTS,
      retainedRows: [row('KnowledgeDocument', 'approved-a'), row('KnowledgeDocument', 'approved-b'), row('AssistantSession', 'approved-session')],
      approvedMappings: [
        mapping('KnowledgeDocument', 'approved-a', CUSTOMER_POLICY),
        mapping('KnowledgeDocument', 'approved-b', { visibility: 'ORGANIZATION', organizationIds: ['org-a', 'org-b'], requiredPermissionScopes: ['customers:read', 'orders:read'] }),
        mapping('AssistantSession', 'approved-session')
      ],
      relations: [], scopedKeys: []
    });
    expect(report).toMatchObject({ totalRows: 3, mappedRows: 3, enforceReadiness: true, blockingReasons: [] });
  });

  it('normalizes approved whitespace and duplicate policy arrays before declaring the mapping ready', () => {
    const report = evaluator()({
      ...ROOTS,
      retainedRows: [row('KnowledgeDocument', 'normalization-boundary')],
      approvedMappings: [mapping('KnowledgeDocument', 'normalization-boundary', {
        visibility: 'ORGANIZATION',
        organizationIds: [' org-b ', 'org-a', 'org-b'],
        requiredPermissionScopes: [' orders:read ', 'customers:read', 'orders:read']
      })],
      relations: [], scopedKeys: []
    });
    expect(report).toMatchObject({ totalRows: 1, mappedRows: 1, invalidPolicyRows: 0, enforceReadiness: true, blockingReasons: [] });
  });
});

function evaluator(): Evaluate {
  const target = requireTargetModule(
    resolve(__dirname, '../../scripts/customer-ownership-migration-preflight'),
    'T074 expected-red: customer ownership migration preflight evaluator is unavailable.'
  );
  const candidate = target.evaluateCustomerOwnershipMigrationPreflight;
  if (typeof candidate !== 'function') throw new Error('T074 expected-red: evaluateCustomerOwnershipMigrationPreflight export is unavailable.');
  return candidate as Evaluate;
}

function row(recordType: string, recordId: string): Readonly<{ recordType: string; recordId: string }> {
  return Object.freeze({ recordType, recordId });
}

function mapping(recordType: string, recordId: string, policy: Record<string, unknown> = {}, customerId = 'customer-a'): Readonly<Record<string, unknown>> {
  return Object.freeze({ recordType, recordId, customerId, ...APPROVAL, ...policy });
}
