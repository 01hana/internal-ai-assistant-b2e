# Feature 002 — Customer Ownership and Knowledge Policy Migration Runbook

**Status**: T003 planning contract only. This document does not execute a migration, create a Customer, write a mapping, or authorize production data changes.

## 1. Migration Paths

### Rebuildable development/test data

```text
reset test database → apply migration → deterministic seed → verify Customer A/B invariants
```

This path is permitted only for data explicitly declared rebuildable. The eventual seed must create Customer A/B with the same organizationId, actorId, HostApp, sourceKey/version, and idempotency key, then verify that `customerId` is the isolation boundary. Every seeded KnowledgeDocument must explicitly have valid `customerId`, `visibility`, `organizationIds`, and `requiredPermissionScopes`.

### Retained data

```text
expand → approved mapping → controlled backfill → validation → enforce
```

The expand phase is additive. Backfill is allowed only from approved mappings. Validation completes before NOT NULL, Customer-scoped uniqueness, policy consistency, or Customer-qualified relation enforcement. Invalid or unapproved records remain deny-by-default and cannot enter retrieval or enforcement.

## 2. Approved Mapping Contract

Every customer-owned record mapping must provide these fields:

| Field | Requirement |
| --- | --- |
| `recordType` | Existing aggregate/model type, sufficient to select the validated backfill rule. |
| `recordId` | Exact existing record identifier. |
| `customerId` | Existing, approved Customer ownership-root identifier. |
| `mappingSource` | Traceable authoritative source of the approved mapping; not an inferred lower-level identity value. |
| `approvedBy` | Authorized approver identity. |
| `approvedAt` | Approval timestamp. |

Each `KnowledgeDocument` mapping additionally must contain:

| Field | Requirement |
| --- | --- |
| `visibility` | Exactly `CUSTOMER` or `ORGANIZATION`. |
| `organizationIds` | For `CUSTOMER`, empty after normalization. For `ORGANIZATION`, a non-empty normalized allowlist. |
| `requiredPermissionScopes` | Normalized string array. Empty means no additional restriction; non-empty uses ALL semantics. |

The mapping is approved input to a future preflight/backfill process. It is not a schema, an API, or a production mapping template populated with guessed values.

Missing `mappingSource`, `approvedBy`, or `approvedAt` makes a mapping incomplete and blocks enforcement just as a missing `customerId` does.

## 3. Prohibited Inference

No process may derive `customerId` or KnowledgeDocument access policy from any of the following:

- `organizationId`, HostApp, actorId, role/roles, or permissionScopes;
- metadata, message content, document content, sourceKey, requestId, or global-ID pattern;
- an existing session, message, relation, audit record, or tool/workflow record unless it has its own explicit approved mapping.

Unmapped records remain unresolved. They must not be silently assigned to a Customer or reinterpreted as `CUSTOMER`-wide knowledge.

## 4. Preflight and Enforcement Blockers

Enforcement is blocked if any in-scope record has one or more of the following:

- missing `customerId`, a non-existent Customer root, ambiguous mapping, or conflicting mappings;
- missing `mappingSource`, `approvedBy`, or `approvedAt`;
- missing or invalid KnowledgeDocument policy, unknown visibility, `CUSTOMER` with non-empty organizationIds, `ORGANIZATION` with empty organizationIds, or invalid/blank array elements;
- cross-Customer parent/relation conflict;
- Customer-scoped uniqueness collision after proposed backfill;
- a document that cannot be validated as deny-by-default before policy enforcement.

## 5. Required Preflight Output

A future preflight implementation must report, without logging raw tokens or creating fabricated mappings:

| Output | Meaning |
| --- | --- |
| `totalRows` | In-scope rows inspected. |
| `mappedRows` | Rows with a complete approved mapping. |
| `unmappedRows` | Rows without an approved mapping. |
| `ambiguousRows` | Rows with multiple or conflicting candidate mappings. |
| `invalidCustomerRows` | Rows with missing/non-existent customerId or incomplete approval metadata. |
| `invalidPolicyRows` | KnowledgeDocuments with missing or invalid approved policy. |
| `retrievalBlockedRows` | Documents denied from retrieval because ownership or policy is unresolved/invalid. |
| `relationConflicts` | Proposed Customer-qualified relation conflicts. |
| `uniquenessConflicts` | Proposed Customer-scoped key collisions. |
| `enforceReadiness` | `true` only when every blocking count is zero. |
| `blockingReasons` | Safe reason codes/counts for unresolved conditions. |

No production mapping values are included in this runbook. T031/T074 implement the controlled mapping validation and preflight; T070–T075 add the migration coverage.

## 6. Rollback and Forward Fix

Before enforcement, an application rollback may occur while additive Customer ownership and policy data remains in place. Missing or invalid policy remains deny-by-default and must not re-enter retrieval. A rollback must never restore public identity-header authority.

After enforcement, repair uses a forward migration or backup restore. Removing `customerId` or access-policy constraints is not a general rollback mechanism. Customer lifecycle, Customer deletion, and retention behavior are out of Feature 002 scope and are not defined by this runbook.
