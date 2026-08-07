# Feature 002 — Final Pre-Implementation Consistency Analysis

**Scope**: Constitution 2.0.0 and Feature 002 spec/design/plan/tasks. This is a documentation analysis; no production implementation has been performed.

## A. Functional Requirement Matrix

| Requirement | Design section | Plan phase | Implementation / Operational tasks | Test / Verification tasks | Coverage |
| --- | --- | --- | --- | --- | --- |
| FR-001 | Identity Boundary | 1 | T011–T016 | T005–T009, T078 | Covered |
| FR-002 | Verification and error classification | 1 | T012 | T006, T008 | Covered |
| FR-003 | Canonical context | 1 | T013–T014 | T007 | Covered |
| FR-004 | Verification and error classification | 1 | T014 | T007–T008 | Covered |
| FR-005 | Identity Boundary | 1 | T015 | T009 | Covered |
| FR-006 | Verification and error classification | 1, 5 | T014, T055 | T007, T051 | Covered |
| FR-007 | Canonical context | 1 | T013, T016 | T009 | Covered |
| FR-008 | Customer Ownership | 2–3 | T019–T020, T025 | T017, T022 | Covered |
| FR-009 | Repository and Service Boundary | 4 | T038–T041 | T034–T037 | Covered |
| FR-010 | Ownership Matrix | 3–4 | T025, T038–T040 | T022, T037 | Covered |
| FR-011 | Ownership Matrix | 3–8 | T026–T029, T046–T069 | T022–T023, T042–T066 | Covered |
| FR-012 | Repository and Service Boundary | 2–8 | T020, T038–T069 | T018, T034–T066 | Covered |
| FR-013 | Repository and Service Boundary | 4–8 | T038–T069 | T034–T066 | Covered |
| FR-014 | Prisma and PostgreSQL Integrity | 2–3 | T020, T025–T030 | T018, T022–T023 | Covered |
| FR-015 | Prisma and PostgreSQL Integrity | 3, 5–6, 9 | T027, T029–T033, T056 | T023, T052, T070, T072 | Covered |
| FR-016 | RAG access-policy model and validation | 3, 5, 9 | T026, T030–T032, T046, T073–T074 | T024, T043, T070–T072 | Covered |
| FR-017 | RAG and Evidence Isolation | 5 | T047–T049 | T042–T045, T079 | Covered |
| FR-018 | RAG and Evidence Isolation | 3, 5 | T027, T049 | T044–T045 | Covered |
| FR-019 | Tool, Workflow, and Audit Design | 3, 6 | T028, T054 | T050, T053 | Covered |
| FR-020 | Tool, Workflow, and Audit Design | 6 | T055–T057 | T051–T053 | Covered |
| FR-021 | Tool, Workflow, and Audit Design | 3, 7–8 | T029, T061–T069 | T058–T066 | Covered |
| FR-022 | Tool, Workflow, and Audit Design | 6–8 | T057, T063, T069 | T060, T066, T076 | Covered |
| FR-023 | Repository and Service Boundary | 4–8 | T038–T069 | T034–T066, T077–T079 | Covered |
| FR-024 | Explicit Boundaries | 10 | T082 (operational rollout gate only) | T082 | Covered — no Gateway implementation |
| FR-025 | Migration, Seed, Rollout, and Rollback | 3, 9 | T030–T032, T073 | T021, T024, T070, T081 | Covered |
| FR-026 | Migration, Seed, Rollout, and Rollback | 3, 9 | T030–T031, T074–T075 | T024, T071–T072 | Covered |
| FR-027 | Production gate and rollback | 1, 10 | T082 (operational rollout gate only) | T005–T009, T082 | Covered — no Gateway implementation |

## B. User Story Coverage and Checkpoints

| Story | Tests first | Implementation | Negative isolation coverage | Independent checkpoint |
| --- | --- | --- | --- | --- |
| US1 | T034–T037 | T038–T041 | Global IDs, SSE, parents, Customer A/B | Tests pass; identical lower-level identities cannot disclose or mutate another Customer's conversation data. |
| US2 | T042–T045 | T046–T049 | Other Customer and same-Customer organization/visibility/scope policy | Tests pass; only pre-authorized candidates/evidence materialize and invalid/legacy policy returns safe no-evidence. |
| US3 | T050–T053 | T054–T057 | Policy, scopes, retry/result lookup and idempotency | Tests pass; a shared global ToolDefinition cannot create cross-Customer execution or deduplication. |
| US4 | T058–T060 | T061–T063 | Approval/action/escalation reads and transitions | Tests pass; cross-Customer request causes no workflow state change or side effect. |
| US5 | T064–T066 | T067–T069 | IDs, list filters, metadata, audit redaction | Tests pass; feedback/review/audit remain Customer-first and retain no raw token. |
| US6 | T070–T072 | T073–T075 | Unmapped/invalid ownership or policy mapping | Tests pass; invalid/unmapped document cannot retrieve/enforce; approved ownership-and-policy mapping validates before constraints enforce. |

## C. Success Criteria Coverage

| Criterion | Test / verification tasks |
| --- | --- |
| SC-001 Customer isolation | T034–T037, T042–T045, T050–T053, T058–T066, T077 |
| SC-002 401/403 stop-before-work | T005–T009, T076, T078 |
| SC-003 RAG disclosure prevention | T042–T045, T047–T048, T079 |
| SC-004 scoped idempotency/source/version | T023, T027, T052, T070, T072 |
| SC-005 ownership and policy migration safety | T024, T070–T072, T081 |

## D. Ownership Matrix Coverage

| Classification | Entities | Schema tasks | Access tasks | Test tasks |
| --- | --- | --- | --- | --- |
| Ownership root | Customer; `Customer.id` is canonical customerId | T025 | T019–T020 | T017, T022 |
| Direct conversation | AssistantSession, AssistantMessage | T025 | T038–T041 | T034–T037 |
| Parent-owned | AssistantContextState, ExecutionPlan, AnswerDecision, ClarificationQuestion, GroundingCheck, QueryUnderstandingResult | T025, T030 | T040 | T022, T037 |
| Direct knowledge/retrieval | KnowledgeDocument, KnowledgeChunk, RetrievalRun, RetrievalCandidate, EvidenceRef | T026–T027 | T046–T049 | T023, T042–T045 |
| Direct tool/workflow | ToolCall, ApprovalRequest, ActionDraft, EscalationRequest | T029 | T055–T063 | T050–T060 |
| Direct quality/audit | FeedbackEvent, ReviewItem, AuditEvent | T029 | T067–T069 | T064–T066 |
| Global exception | Existing persisted ToolDefinition; CustomerToolPolicy references stable ToolDefinition ID | T028 | T054 | T050, T053 |
| Multi-parent integrity | session/message/document/chunk/retrieval/tool/workflow links | T025–T030 | T020, T038–T069 | T018, T022–T023 |

## E. RAG Policy and Migration Safety

| Control | Tasks | Required outcome |
| --- | --- | --- |
| Policy persistence and write validation | T026, T046 | Only CUSTOMER/ORGANIZATION; CUSTOMER uses empty allowlist; ORGANIZATION uses non-empty normalized allowlist; scopes normalize and use ALL semantics; HostApp is excluded. |
| Pre-candidate retrieval | T043, T047–T048 | Customer → visibility/organization → ALL scopes occurs in the data layer before candidate selection/ranking. |
| Safe invalid-policy handling | T043, T048, T071 | Legacy/missing/invalid policy is deny-by-default, emits only redacted metric/log data, and leaks no metadata/count/content. |
| Reset/seed | T021, T032, T070, T073, T081 | Each document has explicit valid ownership and policy; fixtures cover valid and invalid policy cases. |
| Expand and explicit backfill | T030–T031, T074 | Add fields first; approved mapping supplies ownership and full policy without inference. |
| Enforce | T031, T072, T074 | Missing/invalid policy blocks retrieval and enforcement; validate policy consistency and relational integrity before constraints. |
| Rollback/forward fix | T075 | Additive rollback before enforcement; forward fix/restore afterwards; never restore header trust or make policy permissive. |

## F. Dependency, Scope, and Constitution Check

- US6 test design starts after Phase 3 schema/fixture foundation; it does not wait for US4 or US5 services. Enforcement verification waits for final schema/migrations and mapping preflight. Phase 10 waits for all selected stories and enforcement verification.
- T082 is solely a Feature 003 compatibility and production-readiness verification gate. It creates no Gateway runtime, signing, registry, onboarding, deployment, SDK, Host proxy, Connector, control-plane, or Customer lifecycle/admin work.
- No `tenantId` terminology or public identity-header fallback appears in Feature 002 requirements/tasks. Customer remains the outermost runtime data boundary; requestId remains tracing/audit-only.
- The Constitution Check passes: protected identity comes only from Gateway internal JWT, Customer-first predicates precede lower-level filters, RAG filters run before candidate materialization, and general Assistant paths have no cross-Customer exception.

No documentation blocker remains for phased implementation. Production rollout remains blocked until Feature 003 formally signs the canonical Customer claims.
