# Feature 002 — Customer-Scoped Assistant Core Implementation Plan

**Branch**: `002-customer-scoped-assistant-core`
**Date**: 2026-07-31
**Spec**: [spec.md](./spec.md)
**Design**: [design.md](./design.md)

## Summary

Implement Customer as the outermost security and data-ownership boundary for the shared NestJS Assistant Backend. The implementation replaces header-derived, single-role identity with a Gateway-signed internal JWT canonical context, introduces Customer ownership and Customer-first data access, and protects conversation, knowledge/RAG, tools, workflows, feedback, review, and audit paths. Customer → Organization → HostApp → Actor remains the ownership hierarchy.

This plan intentionally does not create `tasks.md` and does not authorize implementation in this batch.

## Technical Context

| Area | Baseline and target |
| --- | --- |
| Runtime | NestJS 11, TypeScript 6, Prisma 7, PostgreSQL, Jest. |
| Current identity baseline | `IdentityGuard` builds identity from public headers; context has `company`, a single `role`, and non-empty scopes. This must be replaced. |
| Target identity | Gateway internal JWT verified through RS256 Remote JWKS; canonical Customer-aware context; 401 token failures and 403 verified-context failures. |
| Current persistence baseline | Assistant, retrieval, workflow, feedback, review, and audit models lack `customerId`; several global IDs and unique keys are used. |
| Target persistence | Minimal Customer ownership root, Customer-aware ownership/indexes/unique constraints, Customer-qualified relations, and Customer-first repository/service predicates. |
| Knowledge baseline | Active knowledge chunks are globally read before ranking. |
| Target knowledge | Customer → organization → visibility → permission filters complete before candidate selection and ranking. |
| Deployment dependency | Feature 002 uses test JWT fixtures during development. Production activation waits for Feature 003/Gateway to issue `customer_id` and `integration_id`. |

## Constitution Check — Before Design

| Constitution 2.0.0 rule | Plan response | Status |
| --- | --- | --- |
| Customer is outermost data/security boundary | All customer-owned aggregates, CustomerScope, constraints, and A/B isolation tests are scoped by `customerId`. | PASS |
| Trusted internal identity only | Phase 1 verifies Gateway JWT and removes public identity-header trust; requestId remains separate. | PASS |
| Customer-first access | Each domain phase converts reads and writes before lower-level visibility/permission checks. | PASS |
| RAG/tool isolation | Phase 4 filters before candidates; Phase 5 uses CustomerToolPolicy plus permission policy. | PASS |
| Cross-Customer testing | Phase 7 requires two Customers sharing organizationId, actorId, and HostApp. | PASS |
| Customer ownership root | `Customer.id` is the canonical `customerId`; lifecycle and administration remain outside Feature 002. | PASS |

## Project Structure

```text
src/
├── identity/                 # guard, context, validators, token verifier
├── assistant/                # sessions, messages, orchestration, history
├── retrieval/                # documents, chunks, retrieval, evidence, RAG
├── tools/                    # ToolDefinition, calls, side-effect control
├── approvals/                # approval, action draft, escalation workflow
├── feedback/                 # feedback records
├── review/                   # review records
├── audit/                    # audit records and metadata
├── common/                   # request IDs, errors, shared policy utilities
└── prisma/                   # Prisma module/service
prisma/
├── schema.prisma
├── migrations/
└── seed scripts
test/
├── unit/
├── integration/
├── contract/
├── e2e/
└── eval/
specs/002-customer-scoped-assistant-core/
├── spec.md
├── design.md
├── plan.md
└── checklists/requirements.md
```

## Phase 0 — Baseline and Ownership Matrix

Create a traceable inventory before changing runtime behavior:

- map all queries, global-ID lookups, global uniqueness constraints, idempotency paths, and parent-child relations for the aggregates named in the spec;
- map current public-header/single-role identity types, guards, validators, test helpers, and fixtures that require replacement;
- confirm the current global knowledge-chunk retrieval path and all pre-candidate filters it lacks;
- record each existing Feature 001 behavior that must remain under Customer scope.

**Exit gate**: an ownership matrix identifies direct ownership, parent ownership, and Customer-qualified relation requirements for every in-scope aggregate. Constitution Check is re-run before Phase 1.

## Phase 1 — Identity and Error Contract

Implement the trusted identity boundary:

- replace header-derived identity with the canonical `RequestIdentityContext` from the design;
- add a Bearer/JWKS verifier abstraction and RS256 Remote JWKS implementation with issuer, audience, clock tolerance, `kid` rotation, and token redaction;
- enforce `401 IDENTITY_TOKEN_INVALID` for missing/malformed/unverifiable token and registered-claim failures; enforce `403 IDENTITY_CONTEXT_INVALID` only after successful verification when canonical claims fail;
- require `customer_id`, `integration_id`, `sub`, `org_id`, `host_app`, `roles`, `permission_scopes`, and `jti`; preserve valid empty authorization arrays while rejecting blank array elements;
- remove all public identity-header fallback/override behavior; keep request ID tracing separate;
- retain health/readiness as non-business endpoints while keeping Assistant APIs guarded.

**Exit gate**: unit and contract coverage proves the mutually exclusive 401/403 contract, token redaction, empty arrays behavior, and header non-authority.

## Phase 2 — Customer Model, Ownership Schema, Migration, and Seed

Introduce the persistence foundation:

- add minimal Customer ownership root where `Customer.id` is the canonical `customerId`, without a self-referencing `customerId` or lifecycle/status behavior;
- add `CustomerToolPolicy`, direct `customerId` ownership, Customer-aware indexes, Customer-scoped unique keys, and Customer-qualified relational integrity according to the ownership matrix;
- scope knowledge `sourceKey + version` and tool idempotency to Customer;
- model document organization applicability and visibility policy so chunks inherit effective access policy;
- implement two migration paths: reset/seed for rebuildable development/test data, and expand → explicit approved mapping/backfill → validation → enforce for retained data;
- create deterministic Customer A/B seeds sharing lower-level identity fields and duplicate Customer-scoped keys.

**Dependencies**: Phase 1 supplies CustomerScope semantics; schema work can begin once the canonical model is fixed.
**Exit gate**: database constraints prevent cross-Customer relations and permit duplicate source/version and idempotency values across Customers only.

## Phase 3 — Conversation and Orchestration Scoping

Convert conversation paths to Customer-first access:

- scope session creation, get/list/update/delete, session visibility, message append/read/history, and SSE orchestration by Customer before organization/HostApp/actor predicates;
- scope direct message ownership and parent-owned context state, plans, answers, clarifications, grounding checks, and query-understanding records through Customer-qualified session/message parents;
- ensure global IDs cannot reveal resource existence across Customers.

**Dependencies**: Phases 1 and 2.
**Can run in parallel with**: Phases 4 and 5 after shared CustomerScope/schema foundations are ready.
**Exit gate**: Customer A cannot access Customer B session, message, history, or orchestration record despite matching organizationId, actorId, and HostApp.

## Phase 4 — Knowledge, Retrieval, RAG, and Evidence Isolation

Apply isolation before candidate materialization:

- scope document/chunk create/read/list/update/delete and knowledge uniqueness by Customer;
- build retrieval predicates in fixed order: Customer → organization applicability → visibility → permission → candidate selection/ranking;
- prevent retrieval of unauthorized candidate content, titles, source keys, metadata, counts, or embedding references;
- persist Customer ownership and qualified relations for retrieval runs, candidates, and evidence references;
- preserve safe no-evidence behavior without signaling hidden data.

**Dependencies**: Phases 1 and 2.
**Can run in parallel with**: Phases 3 and 5 after shared foundations are ready.
**Exit gate**: A/B tests prove cross-Customer isolation and same-Customer organization/visibility/permission negative cases before candidate selection.

## Phase 5 — Tool Policy, Permission, and Idempotency

Separate global product contracts from Customer policy:

- retain global ToolDefinition contract resolution;
- resolve CustomerToolPolicy before tool availability and permission decisions;
- scope tool calls, result lookup, side-effect prechecks, and retries by Customer;
- make idempotency Customer-scoped and preserve safe behavior for equal keys in different Customers;
- avoid any connector binding, instance, credential, or secret implementation.

**Dependencies**: Phases 1 and 2.
**Can run in parallel with**: Phases 3 and 4 after shared foundations are ready.
**Exit gate**: Customer policy and canonical permissions reject unavailable/unauthorized tools without inspecting another Customer's tool-call state.

## Phase 6 — Workflow, Feedback, Review, and Audit Scoping

Scope all remaining customer-owned business records:

- make approval, action draft, escalation list/get/transition/retry/side-effect prechecks Customer-first;
- scope feedback and review read/write/list operations without metadata-only isolation;
- write and query audit with Customer, organization, HostApp, actor, requestId, and relevant session/message/tool/evidence/workflow traceability;
- preserve Customer ownership and audit traceability without defining Customer disable/delete, retention, or administration behavior.

**Dependencies**: Phase 3 for conversation parents and Phase 5 for tool-side traces.
**Exit gate**: cross-Customer workflow, feedback, review, and audit access yields safe not-found/authorization outcomes and no token exposure.

## Phase 7 — Verification and Regression

Run the complete verification matrix:

- **unit**: JWT classification, empty authorization arrays, CustomerScope predicates, tool policy/idempotency, parent-child integrity, RAG composition, redaction;
- **integration**: Customer A/B isolation for session/history, knowledge/RAG/evidence, tool, approval/action/escalation, feedback/review/audit;
- **contract**: 401 token failure, 403 verified-context failure, safe cross-Customer result, SSE guard JSON envelope;
- **migration**: deterministic reset/seed, unmapped retained-data rejection, approved mapping success, post-enforcement constraints;
- **e2e/regression**: full assistant flow, permission denied, no-evidence, side-effect retry, organization/HostApp visibility, RAG eval/no-answer behavior.

Every isolation suite uses two Customers with the same organizationId, actorId, and HostApp. It also verifies repeated idempotency keys and knowledge sourceKey/version are legal across Customers but isolated within each Customer.

**Dependencies**: all domain phases.
**Exit gate**: no cross-Customer data or existence disclosure and no regression in scoped Feature 001 behavior.

## Phase 8 — Production Readiness and Rollout Gate

Before production enablement:

- verify production Gateway tokens sign `customer_id`, `integration_id`, and all other canonical claims;
- validate issuer/audience/JWKS deployment configuration and key rotation behavior;
- verify token redaction in logs, errors, audit, observability, and SSE;
- verify public identity headers cannot restore compatibility behavior;
- record Gateway contract compatibility as a production rollout prerequisite without modifying Gateway runtime or deployment.

**Dependencies**: Phase 7 and Feature 003/Gateway delivery.
**Exit gate**: production enablement remains blocked until Feature 003 formally signs canonical Customer claims; no public-header transition mode is permitted. This is a deployment-readiness gate, not a Feature 002 Gateway implementation phase.

## Dependency Order

```text
Phase 0
  └─ Phase 1 ─┬─ Phase 2 ─┬─ Phase 3 ─┐
              │           ├─ Phase 4 ─┼─ Phase 6 ─ Phase 7 ─ Phase 8
              │           └─ Phase 5 ─┘
              └────────────────────────── shared identity foundation
```

Phases 3, 4, and 5 may proceed partially in parallel only after the Phase 1 canonical context and Phase 2 Customer/schema contract are stable. Phase 6 depends on conversation and tool traces. Phase 8 is a deployment gate, not a header-based fallback or Gateway implementation phase. Future tasks generated from this plan must not include Gateway runtime implementation work.

## Migration and Rollback Controls

For rebuildable data, reset and deterministic seed are allowed. For retained data, only explicit approved mapping to an existing Customer ownership root may populate Customer ownership; ambiguous or unmapped rows halt enforcement and require an operational decision. Additive ownership fields can remain on rollback before enforcement. After NOT NULL, unique, and composite integrity enforcement, repair uses forward migration or backup restore; the system must never roll back to untrusted identity headers.

## Prototype Reuse Boundary

The `backup/gateway-identity-jwt-prototype` branch is read-only reference material only. Future implementation may selectively adapt its RS256 Remote JWKS verifier mechanics, Bearer parsing, verifier abstraction, exception shape, and verifier tests. It must not copy its single-role/non-empty-scopes assumptions, header-era types, insufficient claims, or Gateway runtime. No merge or cherry-pick is part of this feature plan.

## Constitution Check — Post-Design

| Check | Result |
| --- | --- |
| Customer terminology only; no `tenantId` | PASS |
| No single-organization deployment assumption | PASS |
| Canonical JWT identity and no public-header fallback | PASS |
| requestId separated from identity | PASS |
| Roles/scopes arrays; empty arrays valid | PASS |
| Customer-first data, RAG pre-candidate filters, tool policy isolation | PASS |
| Two-Customer negative tests with shared lower-level identity values | PASS |
| Control-plane, Connector, SDK, Host proxy, and Gateway runtime excluded | PASS |
| Customer lifecycle, disable/delete, retention, and administration excluded | PASS |

## Complexity Tracking

No constitution violations or complexity exceptions are introduced. Customer ownership is intentionally explicit because shared Backend isolation cannot be safely inferred from organization, HostApp, actor, or application metadata.
