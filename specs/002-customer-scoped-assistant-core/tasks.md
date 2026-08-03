# Tasks: Customer-Scoped Assistant Core

**Input**: [spec.md](./spec.md), [design.md](./design.md), and [plan.md](./plan.md)
**Prerequisites**: Constitution 2.0.0 and the Feature 002 requirements checklist
**Tests**: Required. Tests MUST be written and observed failing before the corresponding implementation begins.
**Scope guard**: No task modifies `apps/gateway/**`, implements Gateway runtime, Connector Framework, SDK auth transport, Customer Host proxy, Customer lifecycle/admin, or platform control plane.

## Format and Statistics

- `[P]` tasks can run in parallel only after their prerequisites are complete and when they modify distinct files.
- `[US#]` maps a task to a Feature 002 user story; shared foundation and verification tasks have no story label.
- **82 total tasks**: Phase counts 4 / 16 / 13 / 8 / 8 / 8 / 6 / 6 / 6 / 7; US1–US6 counts 8 / 8 / 8 / 6 / 6 / 6; shared foundation/verification 40; tests-first authoring 32; verification execution/rollout 7; implementation/operational 43; `[P]` tasks 31.

---

## Phase 1: Setup, Baseline Inventory, and Safety Net

- [ ] T001 Create `specs/002-customer-scoped-assistant-core/implementation-inventory.md` from `src/identity/**`, `src/assistant/**`, `src/retrieval/**`, `src/tools/**`, `src/approvals/**`, `src/feedback/**`, `src/audit/**`, and `prisma/schema.prisma`; record header reads, legacy identity assumptions, bare global-ID queries, global unique keys, idempotency paths, global RAG chunk queries, and follow-up task IDs.
- [ ] T002 Record Feature 001 regression commands and suites in `specs/002-customer-scoped-assistant-core/implementation-inventory.md`, using `package.json`, `README.md`, and `test/{unit,integration,contract,e2e,eval}/**`.
- [ ] T003 [P] Create the retained-data mapping contract and enforcement preflight runbook at `specs/002-customer-scoped-assistant-core/migration-runbook.md`; require approved mappings to an existing Customer root and prohibit inference from organization, HostApp, actor, roles, permission scopes, or metadata.
- [ ] T004 Verify the reset/seed safety workflow from `scripts/test-db-init.ts`, `scripts/test-db-safety.ts`, `scripts/seed.ts`, `package.json`, and `README.md`; record repeatable commands and guards in `implementation-inventory.md`.

---

## Phase 2: Foundational Identity Boundary and CustomerScope

**Purpose**: Establish canonical JWT identity, then derive the only reusable Customer scope before persistence or domain repository work.

### Tests first

- [ ] T005 Add reusable RS256 test-token, JWKS, and canonical Customer identity fixtures in `test/support/internal-identity-jwt.helper.ts`; fixtures include Customer A/B with equal organizationId, actorId, and HostApp.
- [ ] T006 [P] Add missing/malformed Bearer, invalid signature, unknown `kid`, wrong issuer/audience, invalid `iat`/`exp`/`nbf`, and RS256-only tests in `test/unit/internal-identity-token-verifier.spec.ts`; assert `401 IDENTITY_TOKEN_INVALID` before claim mapping.
- [ ] T007 [P] Add verified-token canonical-claim tests in `test/unit/identity-context-validation.spec.ts` for required Customer claims, blank string claims, blank array elements, valid empty `roles`/`permissionScopes`, and `403 IDENTITY_CONTEXT_INVALID`.
- [ ] T008 [P] Add protected-endpoint identity contract tests in `test/contract/assistant-sessions.contract.spec.ts` and `test/contract/assistant-messages-sse.contract.spec.ts` for 401/403 envelopes and JSON rejection before SSE work begins.
- [ ] T009 [P] Add header non-authority, claim/header conflict, requestId separation, and token-redaction tests in `test/integration/missing-identity-context.spec.ts`, `test/unit/logger-redaction.spec.ts`, and `test/unit/observability-metadata.spec.ts`.

### Identity implementation

- [ ] T010 Add the RS256 verification dependency and typed internal-identity configuration in `package.json`, `src/common/config/env.validation.ts`, and `.env.example`; require issuer, audience, and JWKS URI without logging token material.
- [ ] T011 Implement Bearer parsing and verifier abstraction in `src/identity/internal-identity-token-verifier.ts` and `src/identity/identity-token.types.ts`; use `backup/gateway-identity-jwt-prototype:src/identity/internal-identity-token-verifier.ts` only as read-only verifier mechanics reference.
- [ ] T012 Implement Remote JWKS RS256 verification, `kid` rotation, issuer/audience/time validation, and 401 mapping in `src/identity/internal-identity-token-verifier.ts` and `src/identity/identity.errors.ts`; do not copy prototype single-role, non-empty-scope, header-era, or Gateway-runtime assumptions.
- [ ] T013 Replace legacy header-era types with canonical Customer-aware context and request-scoped storage in `src/identity/identity-context.types.ts`, `src/identity/identity-context.accessor.ts`, and `src/identity/identity.module.ts`.
- [ ] T014 Implement post-verification claim validation in `src/identity/identity-context.validator.ts`; require canonical claims and non-blank array elements, allow empty authorization arrays, and map only verified-context failure to `403 IDENTITY_CONTEXT_INVALID`.
- [ ] T015 Refactor `src/identity/identity.guard.ts` and retire identity-header authority in `src/identity/identity-context.extractor.ts`; headers must never create, supplement, override, or fall back for identity.
- [ ] T016 Update canonical-context consumers in `src/assistant/assistant.controller.ts`, `src/permissions/tool-permission-precheck.service.ts`, `src/retrieval/retrieval.service.ts`, and `src/audit/audit-writer.service.ts`; retain `src/common/request-id/**` as tracing-only.

### CustomerScope tests first

- [ ] T017 [P] Add context-to-scope and request-payload non-authority tests in `test/unit/customer-scope.factory.spec.ts`; prove a payload cannot supply or override `customerId`.
- [ ] T018 [P] Add Customer-first predicate contract tests in `test/unit/customer-scope-predicate.spec.ts`; reject predicates that omit Customer scope or begin from a bare global ID.

### CustomerScope implementation

- [ ] T019 Implement `CustomerScope` and a canonical-context factory in `src/identity/customer-scope.types.ts` and `src/identity/customer-scope.factory.ts`; scope is derived only from verified `RequestIdentityContext`.
- [ ] T020 Implement reusable Customer-first repository predicate helpers in `src/prisma/customer-scope.predicate.ts`; expose Customer-qualified ID, list, relation, and unique-key predicates for later domain repositories.

**Checkpoint**: All repository work depends on T019–T020; no Customer boundary may be reconstructed from request payloads or global IDs.

---

## Phase 3: Foundational Customer Persistence

### Tests first

- [ ] T021 Add deterministic Customer A/B fixtures in `test/support/customer-scope-fixtures.ts` and fixture assertions in `test/integration/customer-seed.spec.ts`; share organizationId, actorId, HostApp, sourceKey/version, and idempotency key.
- [ ] T022 [P] Add Customer-root/direct/parent/multi-parent ownership tests in `test/integration/customer-ownership-integrity.spec.ts`; assert `Customer.id` is the sole root identifier and no Customer self-reference exists.
- [ ] T023 [P] Add database uniqueness and Customer-qualified relation tests in `test/integration/customer-persistence-constraints.spec.ts` for same-Customer collision, cross-Customer duplicate source/version and idempotency values, and rejected cross-Customer parent relations.
- [ ] T024 [P] Add retained-data preflight tests in `test/integration/customer-migration-preflight.spec.ts` for unmapped/ambiguous Customer ownership, missing/invalid KnowledgeDocument policy, approved mappings to an existing Customer with valid policy, deny-before-retrieval, and enforcement blocking.

### Schema, migration, and seed implementation

- [ ] T025 Add the minimal Customer root plus direct conversation ownership in `prisma/schema.prisma`; use `Customer.id` as canonical `customerId`, add `customerId` to `AssistantSession` and `AssistantMessage`, and add Customer-aware indexes/qualified parent keys without lifecycle/status fields.
- [ ] T026 Add RAG access-policy persistence in `prisma/schema.prisma`: `KnowledgeDocument.customerId`, a `CUSTOMER`/`ORGANIZATION` visibility enum, `organizationIds`, and `requiredPermissionScopes`; define database-supported policy-consistency strategy and pre-candidate Customer/visibility/organization indexes. Make chunks inherit effective policy only through their document relation and enforce document/chunk Customer integrity.
- [ ] T027 Add Customer ownership and qualified integrity for `RetrievalRun`, `RetrievalCandidate`, and `EvidenceRef` in `prisma/schema.prisma`; make knowledge `sourceKey + version` Customer-scoped and preserve evidence traceability.
- [ ] T028 Preserve the existing persisted global `ToolDefinition` model, seed, and `src/tools/tool-registry.service.ts` contract while adding `CustomerToolPolicy` in `prisma/schema.prisma` with a stable `toolDefinitionId` relation; do not introduce another ToolDefinition store, connector binding, instance, credential, or secretRef.
- [ ] T029 Add Customer-owned ToolCall, workflow, feedback, review, and audit fields/constraints in `prisma/schema.prisma`; make idempotency keys Customer-scoped and enforce Customer-qualified relations.
- [ ] T030 Create additive expand migrations in `prisma/migrations/` for T025–T029, including nullable/additive policy fields, access-policy indexes, and composite/qualified integrity; avoid accidental cascade deletion of Customer-owned history or audit without defining Customer delete policy.
- [ ] T031 Implement explicit approved Customer-ownership and KnowledgeDocument-policy mapping, controlled backfill, validation, and enforce migrations in `prisma/migrations/` and `specs/002-customer-scoped-assistant-core/migration-runbook.md`; block enforcement for missing/invalid policy and never infer mappings from lower-level identity, metadata, or document content.
- [ ] T032 Update `scripts/seed.ts`, `scripts/us1-test-fixtures.ts`, and `test/support/customer-scope-fixtures.ts` for deterministic Customer A/B reset/seed data, including duplicate cross-Customer source/version and idempotency fixtures and explicit valid policy on every seeded KnowledgeDocument.
- [ ] T033 Regenerate Prisma client artifacts from `prisma/schema.prisma` and update typed imports under `src/generated/prisma/**` only through the repository Prisma generation command.

---

## Phase 4: [US1] Customer-Isolated Sessions, Messages, and History

**Independent test**: Customer A/B with equal organizationId, actorId, and HostApp execute every session/message/history/SSE path using signed JWTs.

- [ ] T034 [P] [US1] Add Customer A/B session create/get/list/update/delete and global session-ID safe-not-found cases in `test/contract/customer-session-isolation.contract.spec.ts` and `test/integration/customer-session-isolation.spec.ts`.
- [ ] T035 [P] [US1] Add message append/read/history and global message-ID isolation cases in `test/contract/customer-message-history.contract.spec.ts` and `test/integration/customer-message-history.spec.ts`.
- [ ] T036 [P] [US1] Add SSE guard rejection and Customer A/B orchestration isolation cases in `test/contract/customer-assistant-sse.contract.spec.ts` and `test/integration/customer-sse-isolation.spec.ts`.
- [ ] T037 [P] [US1] Add parent-owned context/planning/answer/clarification/grounding/query-understanding isolation cases in `test/integration/customer-conversation-children.spec.ts` and Feature 001 regression in `test/e2e/app.e2e-spec.ts`.
- [ ] T038 [US1] Apply `CustomerScope` to session create/visibility/get/list/update/delete in `src/assistant/session/assistant-session.service.ts` and `src/assistant/session/assistant-session.types.ts`.
- [ ] T039 [US1] Apply Customer-qualified message persistence/reads in `src/assistant/message/assistant-message.repository.ts`, `src/assistant/message/assistant-message.service.ts`, and `src/assistant/history/assistant-history.service.ts`.
- [ ] T040 [US1] Apply Customer-qualified parent traversal in `src/assistant/context/**`, `src/assistant/planning/**`, `src/assistant/answer/**`, and `src/query-understanding/query-understanding.repository.ts`.
- [ ] T041 [US1] Apply canonical CustomerScope and safe not-found behavior to `src/assistant/assistant.controller.ts`, `src/assistant/runtime/assistant-readonly-runtime.service.ts`, and `src/assistant/sse/**`.

**US1 checkpoint**: Run T034–T037. Mark US1 complete only when Customer A/B with identical lower-level identity values can neither disclose nor mutate each other's session, message, history, SSE, or parent-owned conversation records, while same-Customer paths remain functional.

---

## Phase 5: [US2] Customer-Isolated Knowledge, RAG, and Evidence

**Independent test**: Customer A queries matching sources while Customer B and inaccessible Customer A sources contain the same match.

- [ ] T042 [P] [US2] Add Customer A/B matching-knowledge, no-evidence disclosure, and repeated sourceKey/version tests in `test/integration/customer-knowledge-isolation.spec.ts`.
- [ ] T043 [P] [US2] Add same-Customer pre-candidate policy tests in `test/integration/customer-rag-permission-isolation.spec.ts`: `CUSTOMER` with empty allowlist works across Organizations; `ORGANIZATION` requires canonical organization membership; required scopes use ALL semantics; empty scopes add no restriction; HostApp does not affect visibility; invalid/legacy policy denies by default without metadata/count/content leakage.
- [ ] T044 [P] [US2] Add retrieval run/candidate/evidence Customer-qualified relation tests in `test/integration/customer-retrieval-evidence-integrity.spec.ts`.
- [ ] T045 [P] [US2] Add RAG no-answer/evidence regression cases in `test/eval/customer-rag-isolation.eval.spec.ts` and `test/integration/rag-sop-field-explanation.spec.ts`.
- [ ] T046 [US2] Implement document access-policy types, write/update validation, trim/dedup normalization, and document/chunk mapping in `src/retrieval/knowledge-access-policy.types.ts` and `src/retrieval/knowledge-chunking.service.ts`; reject unknown visibility, invalid types/elements, CUSTOMER with organizationIds, and ORGANIZATION without organizationIds through the validation error contract.
- [ ] T047 [US2] Refactor `src/retrieval/deterministic-retrieval.provider.ts` and `src/retrieval/retrieval-provider.interface.ts` to apply Customer → visibility/organization → requiredPermissionScopes ALL → candidate selection → ranking as data-layer predicates; HostApp is excluded and no unauthorized candidate metadata may materialize.
- [ ] T048 [US2] Apply CustomerScope to retrieval-run/candidate persistence and safe no-evidence behavior in `src/retrieval/retrieval.service.ts`; invalid/legacy policy is deny-by-default and emits only redacted internal metric/log data.
- [ ] T049 [US2] Apply Customer-qualified evidence creation/read paths in `src/evidence/evidence-ref.service.ts` and `src/assistant/history/assistant-history.mapper.ts`.

**US2 checkpoint**: Run T042–T045. Mark US2 complete only when retrieval materializes candidates and evidence exclusively after Customer and approved policy filters, exposes no unauthorized metadata/count/content, and returns safe no-evidence for invalid, legacy, or inaccessible knowledge.

---

## Phase 6: [US3] Customer Tool Policy, Permission, and Idempotency

**Independent test**: Customer A/B configure different policies for the same persisted ToolDefinition and reuse one idempotency key.

- [ ] T050 [P] [US3] Add persisted global ToolDefinition versus CustomerToolPolicy enablement/disablement tests in `test/integration/customer-tool-policy.spec.ts`.
- [ ] T051 [P] [US3] Add empty authorization-array, denied-before-connector, Customer audit, and header-conflict tool tests in `test/integration/customer-tool-permission.spec.ts`.
- [ ] T052 [P] [US3] Add Customer-scoped idempotency/retry/result-lookup/non-disclosure tests in `test/integration/customer-tool-idempotency.spec.ts` and `test/unit/side-effect-idempotency.spec.ts`.
- [ ] T053 [P] [US3] Add CustomerToolPolicy/permission composition tests in `test/unit/customer-tool-policy.spec.ts` and `test/unit/tool-permission-precheck.service.spec.ts`.
- [ ] T054 [US3] Implement CustomerToolPolicy resolution against existing persisted ToolDefinition IDs in `src/tools/tool-registry.service.ts`, `src/tools/tool-registry.types.ts`, and new `src/tools/customer-tool-policy.service.ts`.
- [ ] T055 [US3] Apply CustomerScope, canonical roles/scopes, and Customer policy before execution in `src/permissions/tool-permission-precheck.service.ts` and `src/assistant/runtime/tool-call.service.ts`; denied work stops before connector/side effect.
- [ ] T056 [US3] Apply CustomerScope to ToolCall persistence, result lookup, retry, and idempotency in `src/assistant/runtime/tool-call.service.ts` and `src/approvals/side-effect-execution-guard.service.ts`.
- [ ] T057 [US3] Write Customer-scoped tool denial/execution audit through `src/audit/audit-writer.service.ts` and preserve redaction in `src/common/logger/redaction.util.ts`.

**US3 checkpoint**: Run T050–T053. Mark US3 complete only when global ToolDefinition remains shared, CustomerToolPolicy and canonical scopes are evaluated before side effects, and Customer-scoped retries cannot disclose or deduplicate another Customer's ToolCall.

---

## Phase 7: [US4] Approval, Action Draft, and Escalation Isolation

- [ ] T058 [P] [US4] Add approval Customer A/B create/list/get/approve/reject isolation tests in `test/integration/customer-approval-isolation.spec.ts` and `test/contract/approval-requests.contract.spec.ts`.
- [ ] T059 [P] [US4] Add action-draft confirm/cancel/expire/retry and side-effect precheck isolation tests in `test/integration/customer-action-draft-isolation.spec.ts` and `test/contract/action-drafts.contract.spec.ts`.
- [ ] T060 [P] [US4] Add escalation read/resolve isolation and workflow-audit tests in `test/integration/customer-escalation-isolation.spec.ts` and `test/contract/escalation-requests.contract.spec.ts`.
- [ ] T061 [US4] Apply CustomerScope to approval queries, transitions, idempotency, and qualified parent checks in `src/approvals/approval-request.service.ts` and `src/approvals/approval-request.controller.ts`.
- [ ] T062 [US4] Apply CustomerScope to action-draft queries, transitions, and side-effect checks in `src/approvals/action-draft.service.ts`, `src/approvals/action-draft.controller.ts`, and `src/approvals/side-effect-execution-guard.service.ts`.
- [ ] T063 [US4] Apply CustomerScope to escalation queries/transitions in `src/approvals/escalation-request.service.ts` and `src/approvals/escalation-request.controller.ts`; write Customer-scoped workflow audit through `src/audit/audit-writer.service.ts`.

**US4 checkpoint**: Run T058–T060. Mark US4 complete only when all Customer A/B approval, action-draft, and escalation reads, lists, transitions, retries, and side-effect prechecks are Customer-first and cross-Customer attempts make no state change.

---

## Phase 8: [US5] Feedback, Review, and Audit Isolation

- [ ] T064 [P] [US5] Add Customer feedback create/read/message-link isolation tests in `test/integration/customer-feedback-isolation.spec.ts` and `test/contract/feedback.contract.spec.ts`.
- [ ] T065 [P] [US5] Add Customer review list/get/transition and status/sourceType non-disclosure tests in `test/integration/customer-review-isolation.spec.ts` and `test/contract/review-items.contract.spec.ts`.
- [ ] T066 [P] [US5] Add Customer audit write/query traceability, metadata non-authority, and raw-token exclusion tests in `test/integration/customer-audit-isolation.spec.ts`, `test/unit/logger-redaction.spec.ts`, and `test/unit/observability-metadata.spec.ts`.
- [ ] T067 [US5] Apply CustomerScope to feedback message/evidence lookup and persistence in `src/feedback/feedback-event.service.ts`, `src/feedback/feedback.controller.ts`, and `src/feedback/feedback.dto.ts`.
- [ ] T068 [US5] Apply CustomerScope to review list/get/decision queries in `src/feedback/review-item.service.ts` and `src/feedback/review-item.controller.ts`; metadata cannot be the isolation filter.
- [ ] T069 [US5] Apply CustomerScope to audit event writes/reads in `src/audit/audit-writer.service.ts` and `src/audit/audit-writer.interface.ts`, retaining traceability without raw tokens.

**US5 checkpoint**: Run T064–T066. Mark US5 complete only when feedback, review, and audit records remain Customer-first for direct IDs and list filters, preserve required traceability, and never use metadata or raw tokens as an authority/isolation mechanism.

---

## Phase 9: [US6] Migration Verification and Operational Safety

- [ ] T070 [P] [US6] Add reset/seed Customer A/B migration-path tests in `test/integration/customer-reset-seed.spec.ts` using `scripts/test-db-init.ts` and `scripts/seed.ts`; assert every seeded KnowledgeDocument has explicit valid customerId and access policy.
- [ ] T071 [P] [US6] Add unmapped/ambiguous Customer ownership and missing/invalid KnowledgeDocument-policy mapping rejection tests in `test/integration/customer-retained-data-migration.spec.ts`; such documents cannot enter retrieval or enforcement.
- [ ] T072 [P] [US6] Add approved ownership-and-policy mapping, NOT NULL policy fields, visibility/allowlist consistency, normalized arrays, Customer-scoped unique, composite-integrity, rollback, and forward-fix tests in `test/integration/customer-migration-enforcement.spec.ts`.
- [ ] T073 [US6] Implement reset/seed workflow assertions in `scripts/test-db-init.ts`, `scripts/seed.ts`, and `test/support/customer-scope-fixtures.ts`, including explicit valid KnowledgeDocument access policy fixtures.
- [ ] T074 [US6] Implement retained-data ownership-and-policy mapping validation and enforcement preflight in `scripts/customer-ownership-migration-preflight.ts` and document invocation/approval in `specs/002-customer-scoped-assistant-core/migration-runbook.md`; no policy inference is permitted.
- [ ] T075 [US6] Document pre-enforcement rollback and post-enforcement forward-fix/restore in `specs/002-customer-scoped-assistant-core/migration-runbook.md`; invalid/legacy policy remains deny-by-default and public identity headers are never re-enabled.

**US6 checkpoint**: Run T070–T072. Mark US6 complete only when rebuildable data explicitly seeds valid ownership and policy, retained invalid/unmapped ownership or policy blocks retrieval and enforcement, and approved ownership-and-policy mappings pass validation before constraints enforce.

---

## Phase 10: Cross-Cutting Verification and Production Readiness Gate

- [ ] T076 Run and repair focused unit suites with `npm run test:unit` for identity, CustomerScope, RAG filters, tool policy, parent-child integrity, and redaction.
- [ ] T077 Run and repair Customer A/B integration suites in `test/integration/customer-*.spec.ts` with `npm run test:integration`.
- [ ] T078 Run and repair API/SSE contract suites in `test/contract/customer-*.spec.ts` with `npm run test:contract`; verify guard rejection stops business work.
- [ ] T079 Run end-to-end/eval regression in `test/e2e/app.e2e-spec.ts` and `test/eval/customer-rag-isolation.eval.spec.ts` with `npm run test:e2e` and `npm run test:eval`.
- [ ] T080 Run `npm run typecheck`, `npm run lint`, and `npm run prisma:generate`; validate `prisma/schema.prisma` and `prisma/migrations/**` after schema changes.
- [ ] T081 Run `npm run test:db:init` and `npm run prisma:seed`; confirm Customer A/B invariants and no production mapping assumptions.
- [ ] T082 Create `specs/002-customer-scoped-assistant-core/production-readiness.md` to verify Feature 003 signed canonical claims, issuer/audience/JWKS/key rotation, token redaction, and no header fallback; production rollout remains blocked without any Gateway runtime/deployment/registry/onboarding/Host-proxy work.

---

## Dependencies and Parallelism

```text
Phase 1 → Phase 2 (identity → CustomerScope) → Phase 3
                                             ├─ US1
                                             ├─ US2
                                             ├─ US3
                                             ├─ US4 → US5
                                             └─ US6 migration-test design
Final schema/migrations + US6 mapping work → US6 enforcement verification
All selected user stories and enforcement verification → Phase 10
```

- T005 precedes T006–T009. T016 precedes T017–T020. T019–T020 precede every Customer persistence and domain repository task.
- T021 precedes T022–T024 because they consume shared Customer fixtures.
- US6 test design (T070–T072) may begin once Phase 3 schema foundation and its fixtures are available; it does not wait for US4 or US5 service implementation. T072 enforcement assertions wait for the final schema/migrations and T074 preflight work.
- Test tasks within a phase marked `[P]` modify separate test files after their shared prerequisite exists.
- Schema/migration tasks T025–T033 are sequential because they share `prisma/schema.prisma`, migrations, seeds, and generated artifacts.

## Requirement Traceability Summary

| Specification coverage | Implementation tasks | Test/verification tasks |
| --- | --- | --- |
| FR-001–FR-007; SC-002 | T010–T016 | T005–T009, T076, T078 |
| FR-008, FR-010–FR-015; SC-004–SC-005 | T019–T033, T073–T075 | T017–T018, T021–T024, T070–T072, T080–T081 |
| US1; FR-009, FR-012–FR-014; SC-001 | T038–T041 | T034–T037 |
| US2; FR-016–FR-018; SC-003 | T026–T027, T046–T049 | T042–T045, T079 |
| US3; FR-019–FR-020 | T054–T057 | T050–T053 |
| US4; FR-021 | T061–T063 | T058–T060 |
| US5; FR-021–FR-022 | T067–T069 | T064–T066 |
| US6; FR-025–FR-026; SC-005 | T030–T032, T073–T075 | T024, T070–T072, T081 |
| FR-023–FR-024, FR-027 | T082 (operational rollout gate only) | T076–T082 |

## Completion Checks

- All task IDs are continuous and every user story has tests before implementation.
- No `[P]` task shares a core output path or requires an uncreated fixture.
- No task introduces public identity fallback, cross-Customer runtime access, Customer lifecycle behavior, Connector credentials/bindings, or Gateway runtime work.
