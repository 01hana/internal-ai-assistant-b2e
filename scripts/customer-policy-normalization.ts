export type NormalizedKnowledgePolicy = Readonly<{
  visibility: 'CUSTOMER' | 'ORGANIZATION';
  organizationIds: readonly string[];
  requiredPermissionScopes: readonly string[];
}>;

export type NormalizeKnowledgePolicyResult =
  | Readonly<{ ok: true; value: NormalizedKnowledgePolicy }>
  | Readonly<{ ok: false; reason: 'INVALID_KNOWLEDGE_VISIBILITY' | 'INVALID_KNOWLEDGE_POLICY' }>;

/**
 * Produces a new canonical policy value without modifying the approved input.
 * JavaScript lexical sort is the shared staging and rebuildable-seed ordering.
 */
export function normalizeApprovedKnowledgePolicy(input: unknown): NormalizeKnowledgePolicyResult {
  const policy = asRecord(input);
  if (!policy) return invalidPolicy();
  const visibility = policy.visibility;
  if (visibility !== 'CUSTOMER' && visibility !== 'ORGANIZATION') {
    return typeof visibility === 'string' ? invalidVisibility() : invalidPolicy();
  }
  const organizationIds = normalizeCanonicalStringArray(policy.organizationIds);
  const requiredPermissionScopes = normalizeCanonicalStringArray(policy.requiredPermissionScopes);
  if (!organizationIds || !requiredPermissionScopes) return invalidPolicy();
  if (visibility === 'CUSTOMER' && organizationIds.length !== 0) return invalidPolicy();
  if (visibility === 'ORGANIZATION' && organizationIds.length === 0) return invalidPolicy();
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      visibility,
      organizationIds: Object.freeze(organizationIds),
      requiredPermissionScopes: Object.freeze(requiredPermissionScopes)
    })
  });
}

export function normalizeCanonicalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(isNonBlankString)) return undefined;
  return [...new Set(value.map((entry) => entry.trim()))].sort();
}

export function isCanonicalPolicyArray(value: readonly unknown[]): value is readonly string[] {
  const normalized = normalizeCanonicalStringArray(value);
  return normalized !== undefined && value.length === normalized.length && value.every((entry, index) => entry === normalized[index]);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidPolicy(): NormalizeKnowledgePolicyResult {
  return Object.freeze({ ok: false, reason: 'INVALID_KNOWLEDGE_POLICY' });
}

function invalidVisibility(): NormalizeKnowledgePolicyResult {
  return Object.freeze({ ok: false, reason: 'INVALID_KNOWLEDGE_VISIBILITY' });
}
