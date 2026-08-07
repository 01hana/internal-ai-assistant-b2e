import { BadRequestException } from '@nestjs/common';
import { KnowledgeVisibility } from '../../src/generated/prisma/enums';
import {
  isValidNormalizedKnowledgeDocumentAccessPolicy,
  normalizeKnowledgeChunkParent,
  normalizeKnowledgeDocumentAccessPolicy,
  normalizeKnowledgeDocumentOwnership
} from '../../src/retrieval/knowledge-access-policy.types';

describe('knowledge document access policy', () => {
  it('normalizes CUSTOMER policy arrays with stable trim and deduplication', () => {
    const policy = normalizeKnowledgeDocumentAccessPolicy({
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: [' orders:read ', 'returns:read', 'orders:read']
    });

    expect(policy).toEqual({
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: ['orders:read', 'returns:read']
    });
  });

  it('normalizes ORGANIZATION allowlists and accepts empty required scopes', () => {
    const policy = normalizeKnowledgeDocumentAccessPolicy({
      visibility: KnowledgeVisibility.ORGANIZATION,
      organizationIds: [' org-a ', 'org-b', 'org-a'],
      requiredPermissionScopes: []
    });

    expect(policy).toEqual({
      visibility: KnowledgeVisibility.ORGANIZATION,
      organizationIds: ['org-a', 'org-b'],
      requiredPermissionScopes: []
    });
  });

  it.each([
    { visibility: 'LEGACY_UNKNOWN', organizationIds: [], requiredPermissionScopes: [] },
    { visibility: KnowledgeVisibility.CUSTOMER, organizationIds: ['org-a'], requiredPermissionScopes: [] },
    { visibility: KnowledgeVisibility.ORGANIZATION, organizationIds: [], requiredPermissionScopes: [] },
    { visibility: KnowledgeVisibility.ORGANIZATION, organizationIds: ['  '], requiredPermissionScopes: [] },
    { visibility: KnowledgeVisibility.CUSTOMER, organizationIds: [], requiredPermissionScopes: ['  '] },
    { visibility: KnowledgeVisibility.CUSTOMER, organizationIds: 'org-a', requiredPermissionScopes: [] },
    { visibility: KnowledgeVisibility.CUSTOMER, organizationIds: [], requiredPermissionScopes: ['orders:read', 1] }
  ])('rejects invalid policy without exposing policy values: %j', (input) => {
    expect(() => normalizeKnowledgeDocumentAccessPolicy(input)).toThrow(BadRequestException);
    expect(() => normalizeKnowledgeDocumentAccessPolicy(input)).toThrow('Knowledge document access policy is invalid.');
  });

  it('requires canonical Customer ownership and Customer-qualified chunk parent ownership', () => {
    expect(normalizeKnowledgeDocumentOwnership({
      customerId: ' customer-a ',
      visibility: KnowledgeVisibility.CUSTOMER,
      organizationIds: [],
      requiredPermissionScopes: []
    })).toEqual(expect.objectContaining({ customerId: 'customer-a' }));

    expect(normalizeKnowledgeChunkParent({
      customerId: 'customer-a',
      documentId: 'document-a',
      documentCustomerId: 'customer-a'
    })).toEqual({ customerId: 'customer-a', documentId: 'document-a' });

    expect(() => normalizeKnowledgeChunkParent({ customerId: 'customer-a', documentId: 'document-a', documentCustomerId: 'customer-b' }))
      .toThrow('Knowledge document access policy is invalid.');
  });

  it('recognizes only already normalized valid persisted policies', () => {
    expect(isValidNormalizedKnowledgeDocumentAccessPolicy({
      visibility: KnowledgeVisibility.ORGANIZATION,
      organizationIds: ['org-a'],
      requiredPermissionScopes: ['orders:read']
    })).toBe(true);
    expect(isValidNormalizedKnowledgeDocumentAccessPolicy({
      visibility: KnowledgeVisibility.ORGANIZATION,
      organizationIds: [' org-a '],
      requiredPermissionScopes: []
    })).toBe(false);
  });
});
