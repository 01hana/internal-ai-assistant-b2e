import { Injectable } from '@nestjs/common';
import type { GroundedCitation, GroundedToolEvidence } from './grounded-context-bundle.types';

const ALLOWED_KEYS = new Set([
  'needId', 'evidenceRefId', 'toolCallId', 'canonicalToolKey', 'status', 'executionStatus',
  'projectionStatus', 'evidenceAttached', 'projectedFacts', 'declaredFieldPaths', 'observedAt'
]);

export class GroundedToolEvidenceNormalizationError extends Error {
  constructor(readonly reasonCode: string) {
    super(`Tool evidence rejected: ${reasonCode}`);
    this.name = 'GroundedToolEvidenceNormalizationError';
  }
}

export interface GroundedToolEvidenceNormalizationInput {
  readonly needId: string;
  readonly evidenceRefId: string;
  readonly toolCallId: string;
  readonly canonicalToolKey: string;
  readonly status: string;
  readonly executionStatus: string;
  readonly projectionStatus: string;
  readonly evidenceAttached: boolean;
  readonly projectedFacts: Readonly<Record<string, unknown>>;
  readonly declaredFieldPaths: readonly string[];
  readonly observedAt: string;
}

@Injectable()
export class GroundedToolEvidenceNormalizer {
  normalize(input: GroundedToolEvidenceNormalizationInput | Record<string, unknown>): GroundedToolEvidence {
    if (!isPlainObject(input) || Object.keys(input).some((key) => !ALLOWED_KEYS.has(key))) {
      throw rejected('PROHIBITED_TOOL_EVIDENCE_FIELD');
    }
    if (input.status !== 'success' || input.executionStatus !== 'executed') {
      throw rejected('TOOLCALL_NOT_SUCCESSFULLY_EXECUTED');
    }
    if (input.projectionStatus !== 'succeeded' || input.evidenceAttached !== true) {
      throw rejected('TOOL_EVIDENCE_NOT_PROJECTED_OR_ATTACHED');
    }
    const needId = text(input.needId, 128);
    const evidenceRefId = text(input.evidenceRefId, 256);
    const toolCallId = text(input.toolCallId, 256);
    const canonicalToolKey = text(input.canonicalToolKey, 256);
    const observedAt = text(input.observedAt, 64);
    if (!needId || !evidenceRefId || !toolCallId || !canonicalToolKey || !observedAt || !Number.isFinite(Date.parse(observedAt))) {
      throw rejected('TOOL_EVIDENCE_PROVENANCE_INVALID');
    }
    if (!isPlainObject(input.projectedFacts) || !Array.isArray(input.declaredFieldPaths) ||
      !input.declaredFieldPaths.every((field) => typeof field === 'string' && field.length > 0 && field.length <= 256)) {
      throw rejected('TOOL_PROJECTION_INVALID');
    }
    const declared = [...new Set(input.declaredFieldPaths)];
    const fields = Object.keys(input.projectedFacts).sort();
    if (declared.length === 0 || fields.length !== declared.length || fields.some((field) => !declared.includes(field))) {
      throw rejected('UNDECLARED_PROJECTED_FIELD');
    }
    const projectedFacts = cloneSafeFacts(input.projectedFacts);
    return deepFreeze({
      kind: 'TOOL', needId, evidenceRefId, toolCallId, canonicalToolKey,
      projectedFacts, fieldPaths: Object.freeze(declared), observedAt
    });
  }

  createCitation(evidence: GroundedToolEvidence): GroundedCitation {
    return deepFreeze({
      citationId: `citation-${evidence.needId}-1`, evidenceRefId: evidence.evidenceRefId,
      needId: evidence.needId, sourceKind: 'TOOL', safeLabel: evidence.canonicalToolKey
    });
  }
}

function cloneSafeFacts(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key) || /token|credential|secret|permission|raw|connector|adapter/i.test(key)) {
      throw rejected('PROHIBITED_PROJECTED_FIELD');
    }
    result[key] = cloneProjectedValue(value[key], 0);
  }
  return deepFreeze(result);
}

function cloneProjectedValue(value: unknown, depth: number): unknown {
  if (depth > 4) throw rejected('INVALID_PROJECTED_VALUE');
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (Array.isArray(value) && value.length <= 100) return Object.freeze(value.map((item) => cloneProjectedValue(item, depth + 1)));
  if (isPlainObject(value) && Object.keys(value).length <= 32) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key) || /token|credential|secret|permission|raw|connector|adapter/i.test(key)) throw rejected('PROHIBITED_PROJECTED_FIELD');
      output[key] = cloneProjectedValue(value[key], depth + 1);
    }
    return Object.freeze(output);
  }
  throw rejected('INVALID_PROJECTED_VALUE');
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value : undefined;
}
function rejected(reason: string) { return new GroundedToolEvidenceNormalizationError(reason); }
function isPlainObject(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
