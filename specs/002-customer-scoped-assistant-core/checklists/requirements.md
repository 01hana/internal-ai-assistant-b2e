# Specification Quality Checklist: Customer-Scoped Assistant Core

**Purpose**: Validate completeness, clarity, consistency, scope boundaries, and security acceptance criteria before design.

**Created**: 2026-07-31

**Feature**: [spec.md](../spec.md)

## Constitution and Terminology

- [x] CHK001 Is Customer explicitly the outermost ownership and security boundary, ahead of organization, HostApp, and actor? [Consistency, Spec §Context and Terminology]
- [x] CHK002 Are `Customer` and `customerId` the sole domain terms for this boundary, with no separate tenant identifier introduced? [Terminology, Spec §Context and Terminology]
- [x] CHK003 Are `roles: string[]` and permission scopes distinguished from the Customer boundary? [Clarity, Spec §Context and Terminology; FR-003; FR-006]
- [x] CHK004 Does the specification prohibit general Assistant runtime paths from crossing Customer boundaries? [Constitution alignment, FR-023]

## Identity and Request Context

- [x] CHK005 Are all required internal identity claims specified, including Customer and integration claims, token traceability, validity, and audience/issuer constraints? [Completeness, FR-001–FR-004]
- [x] CHK006 Are token failures and verified-canonical-claim failures mutually exclusive, with `401 IDENTITY_TOKEN_INVALID` and `403 IDENTITY_CONTEXT_INVALID` respectively? [Security, FR-002–FR-004]
- [x] CHK007 Are roles and permission scopes specified as string arrays with non-blank elements while allowing empty arrays to represent no granted authorization? [Clarity, FR-003; FR-006]
- [x] CHK008 Is requestId clearly separated from signed identity claims and restricted to tracing/audit correlation? [Consistency, Spec §Context and Terminology; FR-007]
- [x] CHK009 Does the specification reject public identity-header fallback, supplementation, and override before business work begins? [Security, FR-005]
- [x] CHK010 Are SDK, Customer Host, and Gateway responsibilities defined without assigning canonical identity mapping to SDK or Host? [Boundary clarity, Spec §Internal Assistant Context]

## Ownership and Access Isolation

- [x] CHK011 Are direct Customer-owned records distinguished from parent-owned child records without imposing one mechanical strategy on every record? [Completeness, FR-010–FR-014]
- [x] CHK012 Do requirements prohibit bare global-ID access and require Customer scope before list filters, pagination, parent traversal, and application-side visibility logic? [Security, FR-012–FR-014]
- [x] CHK013 Is the safe negative outcome for cross-Customer resource access explicitly defined? [Acceptance clarity, US1–US5; FR-013]
- [x] CHK014 Are customer-scoped idempotency, source key/version, indexes, and uniqueness requirements defined? [Completeness, FR-015; US2–US4]
- [x] CHK014a Is `Customer.id` the ownership-root identifier without a self-referencing `customerId`, while direct, parent-owned, and multi-parent records use distinct isolation strategies? [Consistency, FR-008; FR-010–FR-014]

## RAG, Tool, Workflow, and Audit Boundaries

- [x] CHK015 Does retrieval apply Customer, organization, visibility, and permission filters before candidate selection, without obtaining unauthorized candidates, metadata, or counts? [Security, US2; FR-016–FR-017]
- [x] CHK015a Are visibility values limited to `CUSTOMER` and `ORGANIZATION`, with empty organizationIds required for `CUSTOMER`, non-empty organizationIds required for `ORGANIZATION`, and HostApp excluded from knowledge visibility? [Policy semantics, FR-016]
- [x] CHK015b Do requiredPermissionScopes use ALL semantics, and do document writes reject invalid policy while legacy/invalid retrieval denies by default without exposing metadata, count, or content? [Security, FR-016–FR-017]
- [x] CHK016 Is CustomerToolPolicy limited to Customer-level enablement and permission policy while connector binding, credentials, and instances remain excluded? [Scope boundary, US3; FR-019]
- [x] CHK017 Do approval, action, escalation, feedback, review, and audit requirements include Customer ownership for reads, lists, transitions, and traceability? [Coverage, US4–US5; FR-021–FR-022]

## Migration and Scenario Coverage

- [x] CHK018 Are rebuildable-data and retained-data migration paths independently defined, with explicit Customer ownership and KnowledgeDocument policy mapping and no automatic inference? [Completeness, US6; FR-025–FR-026]
- [x] CHK019 Does every user story include independent acceptance scenarios, including a cross-Customer negative case where applicable? [Scenario coverage, US1–US6]
- [x] CHK020 Do isolation scenarios require two Customers that deliberately share organization ID, actor ID, and HostApp? [Constitution alignment, US1–US5; SC-001]
- [x] CHK021 Are invalid-token, invalid-claim, empty-authorization-array, conflicting-header, cross-Customer ID, same-Customer visibility/permission, missing-knowledge, tool-policy, and unmapped-backfill edge cases specified? [Edge-case coverage, Spec §Edge Cases]

## Scope and Readiness

- [x] CHK022 Does the specification explicitly exclude Gateway registry/onboarding, Connector Framework/credentials, SDK auth transport, Customer Host proxy, control plane, Customer UI, and Gateway production changes? [Scope, Spec §Explicitly Out of Scope]
- [x] CHK023 Are success criteria measurable and technology-agnostic, including isolation, split identity failures, retrieval authorization, key collision, and migration outcomes? [Measurability, SC-001–SC-005]
- [x] CHK024 Is the Feature 003/Gateway production-claim dependency explicit while test fixtures are permitted and public-header fallback remains prohibited? [Rollout dependency, Clarifications; FR-027; Assumptions]
- [x] CHK025 Are clarified migration, Customer-owner, authorization-array, access-policy, and Gateway-rollout decisions reconciled with the functional requirements? [Traceability, Spec §Clarifications; FR-006; FR-008; FR-016–FR-017; FR-025–FR-027]
- [x] CHK026 Is Customer lifecycle management, disable/delete behavior, retention, and administration explicitly deferred rather than introduced as Feature 002 runtime behavior? [Scope boundary, FR-008; Spec §Explicitly Out of Scope]
- [x] CHK027 Is the production-readiness rollout gate limited to Feature 003 compatibility verification and production blocking, with Gateway runtime implementation explicitly excluded from future tasks? [Scope boundary, FR-027; Plan §Phase 8]

## Notes

All reviewed requirements pass this focused quality check. The current repository's non-empty `permissionScopes` requirement is explicitly recorded as a legacy conflict and is intentionally replaced by the target contract. The specification intentionally does not prescribe classes, repository method names, migration SQL, Prisma schema fields, or Gateway implementation details. No blocking clarification remains.
