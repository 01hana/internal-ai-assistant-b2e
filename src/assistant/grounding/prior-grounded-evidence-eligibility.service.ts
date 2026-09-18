import { Injectable } from '@nestjs/common';

export const MAX_TOOL_EVIDENCE_AGE_SECONDS = 900;

export interface PriorEvidenceEligibilityResult {
  readonly eligible: boolean;
  readonly kind?: 'DOCUMENT' | 'TOOL';
  readonly evidenceRefId?: string;
  readonly needId?: string;
  readonly maxAgeSeconds?: number;
  readonly reasonCode?: string;
}

@Injectable()
export class PriorGroundedEvidenceEligibilityService {
  evaluate(input: Record<string, any>): PriorEvidenceEligibilityResult {
    const evidence = input.evidence;
    if (!isRecord(evidence) || (evidence.kind !== 'DOCUMENT' && evidence.kind !== 'TOOL')) return denied('EVIDENCE_KIND_INELIGIBLE');
    if (!sameScope(evidence.scope, input.currentScope)) return denied('EVIDENCE_SCOPE_MISMATCH');
    if (evidence.groundingCovered !== true || hasProhibitedMaterial(evidence)) return denied('EVIDENCE_NOT_GROUNDED_OR_SAFE');
    if (evidence.kind === 'DOCUMENT') {
      const document = input.currentDocument;
      if (!text(evidence.documentVersion) || !isRecord(document) || document.active !== true || document.chunkEnabled !== true ||
        document.visible !== true || document.accessible !== true || document.permissionAllowed !== true || document.version !== evidence.documentVersion) {
        return denied('DOCUMENT_CURRENT_ACCESS_OR_VERSION_INVALID');
      }
      return frozen({ eligible: true, kind: 'DOCUMENT', evidenceRefId: evidence.evidenceRefId, needId: evidence.needId });
    }
    const authorization = input.currentAuthorization;
    const age = (Date.parse(input.now ?? '') - Date.parse(evidence.observedAt ?? '')) / 1000;
    if (evidence.status !== 'success' || evidence.executionStatus !== 'executed' || evidence.projectionStatus !== 'succeeded' ||
      evidence.evidenceAttached !== true || !isRecord(evidence.projectedFacts) || !Array.isArray(evidence.declaredFieldPaths) ||
      !Number.isFinite(age) || age < 0 || age > MAX_TOOL_EVIDENCE_AGE_SECONDS || !isRecord(authorization) ||
      authorization.toolDefinitionActive !== true || authorization.policyAllowed !== true || authorization.permissionAllowed !== true) {
      return denied('TOOL_CURRENT_AUTHORITY_OR_FRESHNESS_INVALID');
    }
    return frozen({ eligible: true, kind: 'TOOL', evidenceRefId: evidence.evidenceRefId, needId: evidence.needId, maxAgeSeconds: MAX_TOOL_EVIDENCE_AGE_SECONDS });
  }
}

function sameScope(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  return ['customerId', 'sessionId', 'organizationId', 'hostApp', 'actorId'].every((key) => text(left[key]) && left[key] === right[key]);
}
function hasProhibitedMaterial(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return false;
  if (!value || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) {
    const rejected = value.some((item) => hasProhibitedMaterial(item, seen));
    seen.delete(value);
    return rejected;
  }
  if (!isRecord(value)) return true;
  const rejected = Object.entries(value).some(([key, nested]) =>
    /raw(?:response|connector|output)|pre[-_]?projection|token|credential|secret|password|authorization|permissionSnapshot|proof|jwt/i.test(key) ||
    hasProhibitedMaterial(nested, seen));
  seen.delete(value);
  return rejected;
}
function denied(reasonCode: string): PriorEvidenceEligibilityResult { return frozen({ eligible: false, reasonCode }); }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function frozen<T>(value: T): T { return Object.freeze(value); }
