# Feature 002 — Customer Ownership and Knowledge Policy Migration Runbook

**Status**: T030/T031 migration implementation. This document is an operational
contract, not approval to populate production staging tables or run a production
deployment.

**Migrations**:

1. `20260804000000_customer_scope_expand` (Release A / additive expand)
2. `20260804000001_customer_scope_backfill_enforce` (Release B / approved mapping, enforce)

## 1. Migration Paths

### Rebuildable development/test data

```text
reset safe disposable test database → prisma migrate deploy → no seed → verify final schema
```

This path is permitted only for data explicitly declared rebuildable. The eventual seed must create Customer A/B with the same organizationId, actorId, HostApp, sourceKey/version, and idempotency key, then verify that `customerId` is the isolation boundary. Every seeded KnowledgeDocument must explicitly have valid `customerId`, `visibility`, `organizationIds`, and `requiredPermissionScopes`.

### Retained data (two releases required)

```text
Release A: deploy T030 expand only
→ mandatory Customer-owned write freeze and knowledge retrieval freeze
→ load approved Customer roots and record mappings into staging tables
→ validate mapping coverage and policy input
→ Release B: deploy T031 backfill/enforce
```

The current runtime has not yet completed Customer-scoped repository/retrieval
work. Therefore retained data must use maintenance/write/retrieval freeze between
releases; legacy runtime must not be assumed to reject null ownership/policy.
Do not deploy both pending migrations to retained data in one unattended
`prisma migrate deploy` invocation. T031 safely fails when required staging input
is absent or invalid.

The expand phase is additive. Backfill is allowed only from approved mappings.
Validation completes before NOT NULL, Customer-scoped uniqueness, policy
consistency, or Customer-qualified relation enforcement. Invalid or unapproved
records remain deny-by-default and cannot enter retrieval or enforcement.

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

### Staging load contract

Release A creates the following migration-only input tables; neither is a Prisma
model or a Customer administration API.

| Table | Required fields | Notes |
| --- | --- | --- |
| `_CustomerScopeApprovedCustomerRoot` | `customerId`, `mappingSource`, `approvedBy`, `approvedAt` | One approved minimal Customer root. |
| `_CustomerScopeApprovedMapping` | `id`, `recordType`, `recordId`, `customerId`, `mappingSource`, `approvedBy`, `approvedAt` | Multiple candidates are intentionally accepted by staging so T031 can reject ambiguity. |

`KnowledgeDocument` mapping rows additionally supply `visibility`,
`organizationIds`, and `requiredPermissionScopes`. Mapping is loaded through a
controlled operational process. Save the approved source artifact, checksum/hash,
approval metadata, record counts, validation output, and deployment reference in
the controlled evidence store before Release B. Do not commit production customer
IDs or mappings to this repository.

The complete existing-row `recordType` set is: `AssistantSession`,
`AssistantMessage`, `AssistantContextState`, `ExecutionPlan`, `AnswerDecision`,
`ClarificationQuestion`, `GroundingCheck`, `QueryUnderstandingResult`,
`KnowledgeDocument`, `KnowledgeChunk`, `RetrievalRun`, `RetrievalCandidate`,
`EvidenceRef`, `ToolCall`, `ApprovalRequest`, `ActionDraft`, `EscalationRequest`,
`FeedbackEvent`, `ReviewItem`, and `AuditEvent`. Every existing row needs exactly
one mapping; a child never inherits its mapping from a parent.

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

## 6. Expand and enforce checkpoints

### Release A / T030 checkpoint

Before loading mappings, verify with SQL/catalog inspection that all ownership and
KnowledgeDocument policy columns are nullable and have no defaults; legacy bare
foreign keys and global unique indexes remain; Customer-qualified parent keys,
Customer-first/GIN indexes, `NOT VALID` replacement FK constraints, and both
staging tables exist. The expand migration contains no production mapping values.

### Release B / T031 enforcement readiness

T031 rejects, rolls back, and emits only safe reason codes/counts for: blank or
unapproved Customer roots; incomplete approval metadata; unknown record types or
records; zero/multiple mappings; invalid policy; Customer-qualified relation
conflicts; and Customer-scoped uniqueness collisions. It does not read
organization, HostApp, actor, role/scopes, metadata, source key, request ID, or
content as an ownership/policy source.

Knowledge policy must be explicit. `CUSTOMER` requires `organizationIds = []`;
`ORGANIZATION` requires a non-empty normalized allowlist. Both arrays are
non-null, trimmed, non-blank, and deduplicated. Empty `requiredPermissionScopes`
is valid; a non-empty array has ALL semantics. HostApp is not a knowledge
visibility dimension.

After mapping/backfill validation, T031 sets final NOT NULL columns, validates
Customer and composite FK constraints, creates Customer-scoped business unique
indexes, then drops only the exact legacy constraints confirmed from
`20260615044944_init`. The global `ToolDefinition` relations remain. Database-only
normalized-array/policy CHECK constraints and helper function are intentional
integrity beyond Prisma schema expression.

T031 explicitly wraps its PostgreSQL SQL statements in `BEGIN`/`COMMIT`.
Prisma Migrate does not supply the atomicity guarantee on behalf of this custom
migration. Every validation, backfill, constraint transition, legacy cleanup,
and staging cleanup occurs within that explicit transaction. Any raised exception
aborts it, preserving the Release A staging state. T030 and T031 are independent
release boundaries and never share a transaction. Only a successful Release B
drops the staging tables.

### Parent-first retained backfill

T030's `NOT VALID` Customer-qualified foreign keys remain enforced for rows
updated during T031. T031 therefore updates every parent before a child that
references it. In particular, `ToolCall` is backfilled before `EvidenceRef`, so
an existing non-null `EvidenceRef.toolCallId` resolves through
`("customerId", "toolCallId") → "ToolCall"("customerId", "id")` throughout
the controlled backfill. The pre-backfill approved-mapping relation validation
remains the first line of defense for cross-Customer input; parent-first updates
then allow valid mappings to satisfy the enforced composite FK without deferring
or disabling it.

The retained-data smoke path must include `AssistantSession → AssistantMessage
→ ToolCall` and an `EvidenceRef` with a non-null `toolCallId`, one approved
Customer root, and exactly one complete approved mapping for each record. It
must verify the final Customer-qualified EvidenceRef-to-ToolCall relation. A
second run with the ToolCall and EvidenceRef mapped to different Customers must
fail before any backfill with `CUSTOMER_SCOPE_RELATION_CONFLICT count=n`, leave
both `customerId` values null, and retain both staging tables.

## 7. Safe verification procedure

Every database command must run in one shell context with `NODE_ENV=test`,
`ALLOW_TEST_DB_RESET=true`, and a `DATABASE_URL` whose database name is exactly
`assistant_test` or ends in `_test`. Call `assertSafeTestDatabaseReset(process.env)`
before any connection, reset, SQL execution, or migration command. Never use
`assistant_dev`, a shared development database, or production-like URL.

Verification uses no seed and has three paths:

1. **Fresh rebuildable**: apply all migrations with `prisma migrate deploy` to an
   empty safe database; verify final constraints/indexes and that staging tables
   are absent.
2. **Synthetic retained valid**: apply baseline/T030 through a temporary migration
   directory, add synthetic rows and explicit approved staging input, apply T031,
   then verify backfill, final integrity, scoped keys, and legacy cleanup.
3. **Synthetic retained invalid**: test unmapped/ambiguous/unknown-root/incomplete
   approval/invalid-policy/relation/uniqueness inputs. T031 must rollback with no
   partial `customerId` data or partial constraints and no row content disclosure.

For convergence, use Prisma 7.8 `migrate diff --from-migrations ...
--to-config-datasource --exit-code`; the database-only policy helper/CHECK
constraints are intentional documented drift, while all Prisma-expressible objects
must converge.

## 8. Rollback and Forward Fix

Before enforcement, an application rollback may occur while additive Customer ownership and policy data remains in place. Missing or invalid policy remains deny-by-default and must not re-enter retrieval. A rollback must never restore public identity-header authority.

After enforcement, repair uses a forward migration or backup restore. Removing `customerId` or access-policy constraints is not a general rollback mechanism. Customer lifecycle, Customer deletion, and retention behavior are out of Feature 002 scope and are not defined by this runbook.

Feature 003 remains the production enablement gate for Gateway-signed canonical
Customer claims. No rollback or rollout step may restore public identity-header
authority.
