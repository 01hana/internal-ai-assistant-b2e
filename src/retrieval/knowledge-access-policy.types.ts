import { BadRequestException } from '@nestjs/common';
import { KnowledgeVisibility } from '../generated/prisma/enums';

const INVALID_KNOWLEDGE_ACCESS_POLICY_MESSAGE = 'Knowledge document access policy is invalid.';

export interface KnowledgeDocumentAccessPolicyInput {
  visibility: unknown;
  organizationIds: unknown;
  requiredPermissionScopes: unknown;
}

export interface KnowledgeDocumentAccessPolicy {
  visibility: KnowledgeVisibility;
  organizationIds: readonly string[];
  requiredPermissionScopes: readonly string[];
}

export interface KnowledgeDocumentOwnershipInput extends KnowledgeDocumentAccessPolicyInput {
  customerId: unknown;
}

export interface CanonicalKnowledgeDocumentOwnership {
  customerId: string;
  policy: KnowledgeDocumentAccessPolicy;
}

export interface KnowledgeChunkParentInput {
  customerId: unknown;
  documentId: unknown;
  documentCustomerId?: unknown;
}

export interface CanonicalKnowledgeChunkParent {
  customerId: string;
  documentId: string;
}

export function normalizeKnowledgeDocumentAccessPolicy(
  input: KnowledgeDocumentAccessPolicyInput
): KnowledgeDocumentAccessPolicy {
  const visibility = normalizeVisibility(input.visibility);
  const organizationIds = normalizeStringArray(input.organizationIds);
  const requiredPermissionScopes = normalizeStringArray(input.requiredPermissionScopes);

  if (visibility === KnowledgeVisibility.CUSTOMER && organizationIds.length !== 0) {
    throw invalidKnowledgeAccessPolicy();
  }

  if (visibility === KnowledgeVisibility.ORGANIZATION && organizationIds.length === 0) {
    throw invalidKnowledgeAccessPolicy();
  }

  return Object.freeze({
    visibility,
    organizationIds: Object.freeze(organizationIds),
    requiredPermissionScopes: Object.freeze(requiredPermissionScopes)
  });
}

export function normalizeKnowledgeDocumentOwnership(
  input: KnowledgeDocumentOwnershipInput
): CanonicalKnowledgeDocumentOwnership {
  return Object.freeze({
    customerId: normalizeCanonicalId(input.customerId),
    policy: normalizeKnowledgeDocumentAccessPolicy(input)
  });
}

export function normalizeKnowledgeChunkParent(input: KnowledgeChunkParentInput): CanonicalKnowledgeChunkParent {
  const customerId = normalizeCanonicalId(input.customerId);
  const documentId = normalizeCanonicalId(input.documentId);

  if (input.documentCustomerId !== undefined && normalizeCanonicalId(input.documentCustomerId) !== customerId) {
    throw invalidKnowledgeAccessPolicy();
  }

  return Object.freeze({ customerId, documentId });
}

export function isValidNormalizedKnowledgeDocumentAccessPolicy(
  input: Pick<KnowledgeDocumentAccessPolicyInput, 'visibility' | 'organizationIds' | 'requiredPermissionScopes'>
): boolean {
  try {
    const normalized = normalizeKnowledgeDocumentAccessPolicy(input);
    return arraysMatchExactly(input.organizationIds, normalized.organizationIds) &&
      arraysMatchExactly(input.requiredPermissionScopes, normalized.requiredPermissionScopes);
  } catch {
    return false;
  }
}

function normalizeVisibility(value: unknown): KnowledgeVisibility {
  if (value === KnowledgeVisibility.CUSTOMER || value === KnowledgeVisibility.ORGANIZATION) {
    return value;
  }

  throw invalidKnowledgeAccessPolicy();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalidKnowledgeAccessPolicy();
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw invalidKnowledgeAccessPolicy();
    }

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw invalidKnowledgeAccessPolicy();
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }

  return normalized;
}

function normalizeCanonicalId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidKnowledgeAccessPolicy();
  }

  return value.trim();
}

function arraysMatchExactly(value: unknown, normalized: readonly string[]): boolean {
  return Array.isArray(value) && value.length === normalized.length && value.every((item, index) => item === normalized[index]);
}

function invalidKnowledgeAccessPolicy(): BadRequestException {
  return new BadRequestException(INVALID_KNOWLEDGE_ACCESS_POLICY_MESSAGE);
}
