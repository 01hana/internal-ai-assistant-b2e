import { readFileSync } from 'node:fs';
import {
  NormalizeKnowledgePolicyResult,
  NormalizedKnowledgePolicy,
  normalizeApprovedKnowledgePolicy
} from './customer-policy-normalization';

export { NormalizeKnowledgePolicyResult, NormalizedKnowledgePolicy, normalizeApprovedKnowledgePolicy } from './customer-policy-normalization';

const RETAINED_RECORD_TYPES = new Set([
  'AssistantSession', 'AssistantMessage', 'AssistantContextState', 'ExecutionPlan', 'AnswerDecision',
  'ClarificationQuestion', 'GroundingCheck', 'QueryUnderstandingResult', 'KnowledgeDocument',
  'KnowledgeChunk', 'RetrievalRun', 'RetrievalCandidate', 'EvidenceRef', 'ToolCall',
  'ApprovalRequest', 'ActionDraft', 'EscalationRequest', 'FeedbackEvent', 'ReviewItem', 'AuditEvent'
]);

const SAFE_REASON_CODES = [
  'AMBIGUOUS_CUSTOMER_MAPPING', 'CROSS_CUSTOMER_RELATION', 'CUSTOMER_ROOT_NOT_FOUND',
  'CUSTOMER_SCOPED_UNIQUENESS_CONFLICT', 'INVALID_CUSTOMER_ID', 'INVALID_KNOWLEDGE_POLICY',
  'INVALID_KNOWLEDGE_VISIBILITY', 'INVALID_MAPPING_APPROVAL', 'INVALID_PREFLIGHT_INPUT',
  'MAPPING_RESOURCE_MISMATCH', 'UNKNOWN_RECORD_TYPE', 'UNMAPPED_CUSTOMER'
] as const;

export type PreflightReport = Readonly<{
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

type CountKey = Exclude<keyof PreflightReport, 'totalRows' | 'mappedRows' | 'enforceReadiness' | 'blockingReasons'>;
type Counters = Record<CountKey, number> & { totalRows: number; mappedRows: number };
type Row = Readonly<{ recordType: string; recordId: string }>;
type Mapping = Readonly<Record<string, unknown>>;
type ValidMappingEntry = Readonly<{ mapping: Mapping; targetKey: string }>;
type PreflightInput = Readonly<{
  customerRoots: readonly unknown[];
  retainedRows: readonly unknown[];
  approvedMappings: readonly unknown[];
  relations: readonly unknown[];
  scopedKeys: readonly unknown[];
}>;

/** Pure retained-data validation; it reads no environment and writes no state. */
export function evaluateCustomerOwnershipMigrationPreflight(input: unknown): PreflightReport {
  const parsed = parseInput(input);
  if (!parsed) return report({ invalidCustomerRows: 1 }, new Set(['INVALID_PREFLIGHT_INPUT']));

  const rows = parsed.retainedRows.map(parseRow);
  const counters: Counters = {
    totalRows: rows.length,
    mappedRows: 0,
    unmappedRows: 0,
    ambiguousRows: 0,
    invalidCustomerRows: 0,
    invalidPolicyRows: 0,
    retrievalBlockedRows: 0,
    relationConflicts: 0,
    uniquenessConflicts: 0
  };
  const reasons = new Set<string>();
  const retainedKeys = new Set(rows.filter(isRow).map(rowKey));
  const blockedDocuments = new Set<string>();
  const roots = validateCustomerRoots(parsed.customerRoots, counters, reasons);
  const mappingsByTarget = validateMappingEntries(parsed.approvedMappings, retainedKeys, counters, reasons);

  for (const row of rows) {
    if (!row) {
      counters.invalidCustomerRows += 1;
      reasons.add('INVALID_PREFLIGHT_INPUT');
      continue;
    }
    if (!RETAINED_RECORD_TYPES.has(row.recordType)) {
      counters.invalidCustomerRows += 1;
      reasons.add('UNKNOWN_RECORD_TYPE');
      continue;
    }

    const exactMappings = mappingsByTarget.get(rowKey(row)) ?? [];
    if (exactMappings.length > 1) {
      counters.ambiguousRows += 1;
      reasons.add('AMBIGUOUS_CUSTOMER_MAPPING');
      blockDocument(row, blockedDocuments);
      continue;
    }
    if (exactMappings.length === 0) {
      counters.unmappedRows += 1;
      reasons.add('UNMAPPED_CUSTOMER');
      blockDocument(row, blockedDocuments);
      continue;
    }

    const mapping = exactMappings[0].mapping;
    const mappingOutcome = validateMapping(mapping, row, roots);
    if (mappingOutcome !== undefined) {
      if (mappingOutcome === 'INVALID_KNOWLEDGE_POLICY' || mappingOutcome === 'INVALID_KNOWLEDGE_VISIBILITY') {
        counters.invalidPolicyRows += 1;
      } else {
        counters.invalidCustomerRows += 1;
      }
      reasons.add(mappingOutcome);
      blockDocument(row, blockedDocuments);
      continue;
    }
    counters.mappedRows += 1;
  }

  counters.retrievalBlockedRows = blockedDocuments.size;
  countRelationConflicts(parsed.relations, counters, reasons);
  countScopedKeyConflicts(parsed.scopedKeys, counters, reasons);
  return report(counters, reasons);
}

function parseInput(value: unknown): PreflightInput | undefined {
  const input = asRecord(value);
  if (!input || !Array.isArray(input.customerRoots) || !Array.isArray(input.retainedRows) || !Array.isArray(input.approvedMappings) || !Array.isArray(input.relations) || !Array.isArray(input.scopedKeys)) {
    return undefined;
  }
  return input as PreflightInput;
}

function parseRow(value: unknown): Row | undefined {
  const row = asRecord(value);
  if (!row || !isNonBlankString(row.recordType) || !isNonBlankString(row.recordId)) return undefined;
  return Object.freeze({ recordType: row.recordType, recordId: row.recordId });
}

function validateCustomerRoots(values: readonly unknown[], counters: Counters, reasons: Set<string>): ReadonlySet<string> {
  const roots = new Set<string>();
  for (const value of values) {
    if (!isNonBlankString(value) || roots.has(value)) {
      counters.invalidCustomerRows += 1;
      reasons.add('INVALID_PREFLIGHT_INPUT');
      continue;
    }
    roots.add(value);
  }
  return roots;
}

function validateMappingEntries(
  values: readonly unknown[],
  retainedKeys: ReadonlySet<string>,
  counters: Counters,
  reasons: Set<string>
): ReadonlyMap<string, readonly ValidMappingEntry[]> {
  const mappingsByTarget = new Map<string, ValidMappingEntry[]>();
  for (const value of values) {
    const mapping = asRecord(value);
    if (!mapping || !isNonBlankString(mapping.recordType) || !isNonBlankString(mapping.recordId)) {
      invalidMappingEntry(counters, reasons, 'INVALID_PREFLIGHT_INPUT');
      continue;
    }
    if (!RETAINED_RECORD_TYPES.has(mapping.recordType)) {
      invalidMappingEntry(counters, reasons, 'UNKNOWN_RECORD_TYPE');
      continue;
    }
    const targetKey = `${mapping.recordType}\u0000${mapping.recordId}`;
    if (!retainedKeys.has(targetKey)) {
      invalidMappingEntry(counters, reasons, 'MAPPING_RESOURCE_MISMATCH');
      continue;
    }
    const entry = Object.freeze({ mapping, targetKey });
    const entries = mappingsByTarget.get(targetKey) ?? [];
    entries.push(entry);
    mappingsByTarget.set(targetKey, entries);
  }
  return mappingsByTarget;
}

function invalidMappingEntry(counters: Counters, reasons: Set<string>, reason: 'INVALID_PREFLIGHT_INPUT' | 'UNKNOWN_RECORD_TYPE' | 'MAPPING_RESOURCE_MISMATCH'): void {
  counters.invalidCustomerRows += 1;
  reasons.add(reason);
}

function validateMapping(mapping: Mapping, row: Row, roots: ReadonlySet<string>): string | undefined {
  if (!isNonBlankString(mapping.recordType) || !isNonBlankString(mapping.recordId) || mapping.recordType !== row.recordType || mapping.recordId !== row.recordId) {
    return 'MAPPING_RESOURCE_MISMATCH';
  }
  if (!isNonBlankString(mapping.customerId)) return 'INVALID_CUSTOMER_ID';
  if (!roots.has(mapping.customerId)) return 'CUSTOMER_ROOT_NOT_FOUND';
  if (!isNonBlankString(mapping.mappingSource) || !isNonBlankString(mapping.approvedBy) || !isApprovedTimestamp(mapping.approvedAt)) {
    return 'INVALID_MAPPING_APPROVAL';
  }
  if (row.recordType !== 'KnowledgeDocument') return undefined;
  const policy = normalizeApprovedKnowledgePolicy(mapping);
  return policy.ok ? undefined : policy.reason;
}

function countRelationConflicts(values: readonly unknown[], counters: Counters, reasons: Set<string>): void {
  for (const value of values) {
    const relation = asRecord(value);
    if (!relation || !isNonBlankString(relation.childCustomerId) || !isNonBlankString(relation.parentCustomerId) || relation.childCustomerId !== relation.parentCustomerId) {
      counters.relationConflicts += 1;
      reasons.add('CROSS_CUSTOMER_RELATION');
    }
  }
}

function countScopedKeyConflicts(values: readonly unknown[], counters: Counters, reasons: Set<string>): void {
  const groups = new Map<string, number>();
  for (const value of values) {
    const key = asRecord(value);
    const group = key ? scopedKeyGroup(key) : undefined;
    if (!group) {
      counters.uniquenessConflicts += 1;
      reasons.add('CUSTOMER_SCOPED_UNIQUENESS_CONFLICT');
      continue;
    }
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  for (const count of groups.values()) {
    if (count > 1) {
      counters.uniquenessConflicts += 1;
      reasons.add('CUSTOMER_SCOPED_UNIQUENESS_CONFLICT');
    }
  }
}

function scopedKeyGroup(key: Readonly<Record<string, unknown>>): string | undefined {
  if (!isNonBlankString(key.customerId)) return undefined;
  if (key.kind === 'knowledge-source-version' && isNonBlankString(key.sourceKey) && isNonBlankString(key.version)) {
    return `knowledge\u0000${key.customerId}\u0000${key.sourceKey}\u0000${key.version}`;
  }
  if (key.kind === 'idempotency' && (key.recordType === 'ToolCall' || key.recordType === 'ApprovalRequest' || key.recordType === 'ActionDraft') && isNonBlankString(key.idempotencyKey)) {
    return `idempotency\u0000${key.recordType}\u0000${key.customerId}\u0000${key.idempotencyKey}`;
  }
  return undefined;
}

function report(values: Partial<Counters>, reasons: ReadonlySet<string>): PreflightReport {
  const counters: Counters = {
    totalRows: values.totalRows ?? 0,
    mappedRows: values.mappedRows ?? 0,
    unmappedRows: values.unmappedRows ?? 0,
    ambiguousRows: values.ambiguousRows ?? 0,
    invalidCustomerRows: values.invalidCustomerRows ?? 0,
    invalidPolicyRows: values.invalidPolicyRows ?? 0,
    retrievalBlockedRows: values.retrievalBlockedRows ?? 0,
    relationConflicts: values.relationConflicts ?? 0,
    uniquenessConflicts: values.uniquenessConflicts ?? 0
  };
  const blockingReasons = [...reasons].filter((reason) => (SAFE_REASON_CODES as readonly string[]).includes(reason)).sort();
  const enforceReadiness = counters.unmappedRows === 0 && counters.ambiguousRows === 0 && counters.invalidCustomerRows === 0 && counters.invalidPolicyRows === 0 && counters.retrievalBlockedRows === 0 && counters.relationConflicts === 0 && counters.uniquenessConflicts === 0;
  return Object.freeze({ ...counters, enforceReadiness, blockingReasons: Object.freeze(blockingReasons) });
}

function isApprovedTimestamp(value: unknown): boolean {
  return isNonBlankString(value) && !Number.isNaN(Date.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRow(value: Row | undefined): value is Row {
  return value !== undefined;
}

function rowKey(row: Row): string {
  return `${row.recordType}\u0000${row.recordId}`;
}

function blockDocument(row: Row, blockedDocuments: Set<string>): void {
  if (row.recordType === 'KnowledgeDocument') blockedDocuments.add(rowKey(row));
}

function readCliInput(argumentsList: readonly string[]): string | undefined {
  if (argumentsList.length !== 2 || argumentsList[0] !== '--input' || !isNonBlankString(argumentsList[1])) return undefined;
  return argumentsList[1];
}

function main(): void {
  const inputPath = readCliInput(process.argv.slice(2));
  if (!inputPath) {
    process.stderr.write('Usage: customer-ownership-migration-preflight --input <controlled-json-file>\n');
    process.exitCode = 2;
    return;
  }
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch {
    process.stderr.write('Preflight input could not be read or parsed.\n');
    process.exitCode = 2;
    return;
  }
  const preflight = evaluateCustomerOwnershipMigrationPreflight(input);
  process.stdout.write(`${JSON.stringify(preflight)}\n`);
  if (!preflight.enforceReadiness) {
    process.stderr.write('Preflight blocked by safe validation results.\n');
    process.exitCode = 1;
  }
}

if (require.main === module) main();
