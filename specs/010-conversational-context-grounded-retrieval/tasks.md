# Tasks: Feature 010 — Conversational Context & Grounded Retrieval

**Canonical Feature Path**: `specs/010-conversational-context-grounded-retrieval`  
**Input**: `spec.md`, `design.md`, and `plan.md` in `specs/010-conversational-context-grounded-retrieval/`  
**Implementation Status**: Not started  
**Testing Rule**: For every changed runtime behavior, run the named focused test first and retain authentic RED evidence, then implement and retain GREEN evidence.

## Format

- Every task uses `- [ ] TNNN [P?] [US?] Description with exact path`.
- `[P]` is used only for different-file work whose predecessors are complete.
- Story labels appear only in Phases 4–6 and map to the five stories in `spec.md`.

## Canonical Seven-Phase Model

1. **Phase 1 — Baseline, repository inventory, RED fixtures, scope guards**
2. **Phase 2 — Shared contracts and bounded conversation-context foundation**
3. **Phase 3 — Grounded retrieval contracts and routing**
4. **Phase 4 — Semantic follow-up and retrieval re-entry**
5. **Phase 5 — RAG retrieval and document evidence normalization**
6. **Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly**
7. **Phase 7 — Cross-cutting security, compatibility and local backend acceptance**

## Canonical User Stories

1. **US1 — Semantic follow-up and retrieval re-entry**
2. **US2 — Document-only grounded retrieval**
3. **US3 — Tool-only grounded retrieval**
4. **US4 — Hybrid grounded retrieval and coverage**
5. **US5 — Eligible prior grounded-context reuse**

## Phase 1 — Baseline, repository inventory, RED fixtures, scope guards

- [ ] T001 Record Feature 007/008/009, RAG, Tool, evidence, AnswerDecision/GroundingCheck, SSE, history, and LLM-seam baseline commands/results in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [ ] T002 [P] Add a scope guard proving Feature 009 T126–T142, manifest, Gateway, Identity Bridge, schema, public contracts, and external repositories remain untouched in `test/contract/feature010-scope-boundary.contract.spec.ts`
- [ ] T003 [P] Add RED bounded-context, incomplete-pair, and prohibited-source fixtures in `test/unit/conversation-context-loader.service.spec.ts`
- [ ] T004 [P] Add RED routing-mode, four-need, and one-Tool-need fixtures in `test/unit/grounded-retrieval-router.service.spec.ts`
- [ ] T005 [P] Add RED INHERIT/REPLACE/NEW_TOPIC/CLARIFY fixtures in `test/unit/follow-up-semantic-resolver.service.spec.ts`
- [ ] T006 [P] Add RED document normalization, citation, and prompt-like-content fixtures in `test/unit/grounded-document-evidence.normalizer.spec.ts`
- [ ] T007 [P] Add RED Tool normalization and raw/pre-projection rejection fixtures in `test/unit/grounded-tool-evidence.normalizer.spec.ts`
- [ ] T008 [P] Add RED Hybrid COMPLETE/PARTIAL/INSUFFICIENT fixtures in `test/unit/grounded-context-bundle.service.spec.ts`
- [ ] T009 [P] Add RED prior document/Tool/Hybrid eligibility fixtures in `test/unit/prior-grounded-evidence-eligibility.service.spec.ts`
- [ ] T010 Add RED document-only, Tool-only, Hybrid, follow-up, recall, and call-count scenarios in `test/integration/feature010-grounded-retrieval.spec.ts`

**Checkpoint**: Existing suites pass; T003–T010 fail only for missing Feature 010 behavior; no production file has changed.

---

## Phase 2 — Shared contracts and bounded conversation-context foundation

- [ ] T011 Define immutable semantic-frame, provenance, follow-up-decision, safe-turn, and safe-reason types in `src/assistant/conversation/conversation.types.ts`
- [ ] T012 [P] Define context, need, chunk, ToolCall, evidence, freshness, depth, item, string, and byte limits in `src/assistant/conversation/conversation-limits.ts`
- [ ] T013 [P] Implement recursive prohibited-key/value and bounded plain-value guards in `src/assistant/conversation/conversation-source-guard.ts`
- [ ] T014 [P] Implement active Customer/session/organization/HostApp/actor-qualified context reads in `src/assistant/conversation/conversation-context.repository.ts`
- [ ] T015 Implement deterministic newest-first four-exchange/four-evidence selection and incomplete-pair exclusion in `src/assistant/conversation/conversation-context-loader.service.ts`
- [ ] T016 Implement safe semantic-frame reconstruction from QueryUnderstandingResult without Tool/permission authority in `src/assistant/conversation/conversation-semantic-reconstructor.service.ts`
- [ ] T017 [P] Add safe context-loaded/rejected audit helpers in `src/assistant/conversation/conversation-audit.service.ts`
- [ ] T018 Complete nested-prohibited, malformed/cyclic, bounds, ordering, and no-prose-fact unit coverage in `test/unit/conversation-context-loader.service.spec.ts`
- [ ] T019 Add active/closed-session and colliding Customer/session/organization/HostApp/actor isolation coverage in `test/integration/feature010-context-isolation.spec.ts`
- [ ] T020 Register the bounded conversation providers without a controller or public route in `src/assistant/assistant.module.ts`
- [ ] T021 Wire safe prior semantic context into query understanding without prior authority in `src/query-understanding/query-understanding.module.ts`
- [ ] T022 Add contract assertions for four-exchange/four-reference limits and prohibited source categories in `test/contract/feature010-conversation-context.contract.spec.ts`
- [ ] T023 Run T018–T022 and record Phase 2 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Phase 2 supplies bounded guarded context before routing; it performs no factual reuse or retrieval.

---

## Phase 3 — Grounded retrieval contracts and routing

- [ ] T024 Define RetrievalMode, discriminated RetrievalNeed, GroundedRetrievalPlan, RetrievalCoverage, and need-result contracts in `src/retrieval/grounded-retrieval.types.ts`
- [ ] T025 [P] Define GroundedDocumentEvidence, GroundedToolEvidence, GroundedCitation, and GroundedContextBundleV1 with separate safe requestedNeeds and needResults in `src/assistant/grounding/grounded-context-bundle.types.ts`
- [ ] T026 [P] Add exact internal contract tests for all modes, coverage states, discriminants, bundle version, requested-need/result linkage, complete Feature 011 consumer fields, and prohibited authority fields in `test/contract/grounded-context-bundle.contract.spec.ts`
- [ ] T027 Extend existing sentence/subtask decomposition with a deterministic four-need cap in `src/query-understanding/query-task-decomposer.ts`
- [ ] T028 Implement deterministic CONTEXT_ONLY/RAG/TOOL/HYBRID/CLARIFY/INSUFFICIENT mode selection without execution authority in `src/retrieval/grounded-retrieval-router.service.ts`
- [ ] T029 Enforce one Tool need, unsupported overflow, stable need IDs, and no retries/recursion in `src/retrieval/grounded-retrieval-router.service.ts`
- [ ] T030 Add bounded retrieval-plan audit helpers without query/evidence content in `src/retrieval/grounded-retrieval-audit.service.ts`
- [ ] T031 Register router/contracts in the existing retrieval module without adding a provider implementation in `src/retrieval/retrieval.module.ts`
- [ ] T032 Complete table-driven routing, compound-query, overflow, ambiguity, and authority tests in `test/unit/grounded-retrieval-router.service.spec.ts`
- [ ] T033 Run T026/T032 and record Phase 3 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Routing is deterministic and auditable but cannot execute RAG, Tool, connector, or LLM work.

---

## Phase 4 — Semantic follow-up and retrieval re-entry

**Story**: US1 — Semantic follow-up and retrieval re-entry

- [ ] T034 [P] [US1] Add explicit-override, omission-only inheritance, incompatible-topic, contradiction, and tied-frame cases in `test/unit/follow-up-semantic-resolver.service.spec.ts`
- [ ] T035 [P] [US1] Add `那申請期限呢？`, `那個呢？`, compatible entity replacement, and `上個月呢？` routing cases in `test/integration/feature010-followup-routing.spec.ts`
- [ ] T036 [P] [US1] Add tests proving prior Tool keys, permissions, RAG scores, and document claims never enter authority inputs in `test/unit/follow-up-retrieval-authority.guard.spec.ts`
- [ ] T037 [US1] Implement INHERIT, REPLACE, NEW_TOPIC, and CLARIFY resolution in `src/assistant/conversation/follow-up-semantic-resolver.service.ts`
- [ ] T038 [US1] Integrate current explicit-frame extraction and bounded prior frames in `src/query-understanding/rule-based-query-understanding.pipeline.ts`
- [ ] T039 [US1] Convert resolved semantics back into non-authoritative routing inputs in `src/retrieval/grounded-retrieval-router.service.ts`
- [ ] T040 [US1] Route document needs to canonical RAG intent and Tool needs to generic discovery signals in `src/assistant/planning/assistant-planning.service.ts`
- [ ] T041 [US1] Persist safe resolution kind/provenance/reason audit metadata in `src/assistant/conversation/conversation-audit.service.ts`
- [ ] T042 [US1] Complete zero-retrieval ambiguity and zero-ToolCall unsupported-last-month integration coverage in `test/integration/feature010-followup-routing.spec.ts`
- [ ] T043 [US1] Run T034–T036/T042 and existing discovery/query-understanding evals; record US1 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Follow-ups re-enter current retrieval routing and inherit no execution authority.

---

## Phase 5 — RAG retrieval and document evidence normalization

**Story**: US2 — Document-only grounded retrieval

- [ ] T044 [P] [US2] Add travel-subsidy and existing SOP document-only RED cases with zero ToolCalls in `test/integration/feature010-document-retrieval.spec.ts`
- [ ] T045 [P] [US2] Add active/versioned provenance, two-chunk cap, citation, malformed metadata, and deterministic ordering cases in `test/unit/grounded-document-evidence.normalizer.spec.ts`
- [ ] T046 [P] [US2] Add prompt-like text, control-character, authority-claim, token, proof, and connector-reference cases in `test/unit/document-evidence-source-guard.spec.ts`
- [ ] T047 [P] [US2] Add colliding-ID Customer/organization/permission pre-filter isolation cases in `test/integration/feature010-rag-isolation.spec.ts`
- [ ] T048 [US2] Extend attached document EvidenceRef safe summaries with document version provenance in `src/evidence/evidence-ref.service.ts`
- [ ] T049 [US2] Implement bounded UNTRUSTED_DOCUMENT_EVIDENCE normalization from selected EvidenceRefs in `src/retrieval/grounded-document-evidence.normalizer.ts`
- [ ] T050 [US2] Implement document source guards that prevent content/metadata from becoming instruction or authority in `src/retrieval/document-evidence-source-guard.ts`
- [ ] T051 [US2] Implement per-need canonical RetrievalService execution with the existing two-candidate limit in `src/retrieval/grounded-document-retrieval.service.ts`
- [ ] T052 [US2] Add stable document citation mapping and safe RAG audit metadata in `src/retrieval/grounded-document-evidence.normalizer.ts`
- [ ] T053 [US2] Preserve existing RetrievalRun/Candidate and no-evidence behavior while returning normalized need results in `src/retrieval/retrieval.service.ts`
- [ ] T054 [US2] Run T044–T047 and existing RAG/document-answer/isolation/eval suites; record US2 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Document-only requests yield authorized normalized evidence/citations with zero ToolCalls and no document-derived authority.

---

## Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly

### US3 — Tool-only grounded retrieval

- [ ] T055 [P] [US3] Add current-discovery/policy/permission/one-ToolCall/projected-evidence RED cases in `test/integration/feature010-tool-retrieval.spec.ts`
- [ ] T056 [P] [US3] Add success-without-projection, raw response, undeclared field, blocked, denied, failed, and conflicted cases in `test/unit/grounded-tool-evidence.normalizer.spec.ts`
- [ ] T057 [US3] Implement projected EvidenceRef-only Tool normalization in `src/assistant/grounding/grounded-tool-evidence.normalizer.ts`
- [ ] T058 [US3] Adapt one TOOL need to the existing generic discovery/read-only runtime path in `src/assistant/grounding/grounded-tool-retrieval.service.ts`
- [ ] T059 [US3] Enforce one Tool need/ToolCall and current ToolDefinition/policy/permission checks in `src/assistant/grounding/grounded-tool-retrieval.service.ts`

### US4 — Hybrid grounded retrieval and coverage

- [ ] T060 [P] [US4] Add Tool+RAG COMPLETE, Tool-only PARTIAL, RAG-only PARTIAL, all-failed INSUFFICIENT, and multi-Tool rejection cases in `test/integration/feature010-hybrid-retrieval.spec.ts`
- [ ] T061 [P] [US4] Add exact requested-need/result mapping, coverage, unsupported-need, deterministic merge, deduplication, citation-order, and immutability cases in `test/unit/grounded-context-bundle.service.spec.ts`
- [ ] T062 [US4] Implement bounded declared-lane coordination with no retry/recursion in `src/assistant/grounding/hybrid-retrieval-coordinator.service.ts`
- [ ] T063 [US4] Implement COMPLETE/PARTIAL/INSUFFICIENT/CLARIFY coverage evaluation in `src/assistant/grounding/retrieval-coverage.service.ts`
- [ ] T064 [US4] Implement deterministic evidence merge, deduplication, citation mapping, and deep-freeze assembly in `src/assistant/grounding/grounded-context-bundle.service.ts`

### US5 — Eligible prior grounded-context reuse

- [ ] T065 [P] [US5] Add document active/version/access, Tool 900-second/current-authority, Hybrid item-by-item, and same-scope eligibility cases in `test/unit/prior-grounded-evidence-eligibility.service.spec.ts`
- [ ] T066 [P] [US5] Add zero-call document/Tool/Hybrid CONTEXT_ONLY recall and ineligible re-retrieval cases in `test/integration/feature010-prior-grounded-recall.spec.ts`
- [ ] T067 [US5] Implement document source/version/access and Tool lifecycle/freshness/current-authorization eligibility in `src/assistant/grounding/prior-grounded-evidence-eligibility.service.ts`
- [ ] T068 [US5] Implement CONTEXT_ONLY complete-coverage selection without Assistant-prose parsing in `src/assistant/grounding/prior-grounded-context.service.ts`

### Shared orchestration

- [ ] T069 [US4] Integrate context, router, prior reuse, canonical lanes, coverage, and bundle assembly in `src/assistant/message/assistant-message.service.ts`
- [ ] T070 [US4] Persist only safe bundle version/mode/coverage/need/evidence metadata through existing decision/grounding records in `src/assistant/answer/answer-decision.service.ts`
- [ ] T071 [US4] Register grounding services without adding a public controller or route in `src/assistant/assistant.module.ts`
- [ ] T072 [US4] Preserve existing AnswerDecision text as a compatibility sink and prove LlmExecutionService is not invoked in `test/integration/feature010-no-llm-generation.spec.ts`
- [ ] T073 [US4] Add safe route/lane/reuse/coverage/bundle audit events in `src/assistant/grounding/grounded-retrieval-audit.service.ts`
- [ ] T074 [US4] Run T055–T066/T072 and Tool/evidence/permission regressions; record US3–US5 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Tool-only, Hybrid, partial coverage, and prior reuse produce safe immutable bundles without a second runtime or LLM generation.

---

## Phase 7 — Cross-cutting security, compatibility and local backend acceptance

- [ ] T075 [P] Add unchanged Assistant HTTP/SSE event/payload and history-shape contract assertions in `test/contract/feature010-public-compatibility.contract.spec.ts`
- [ ] T076 [P] Add exact GroundedContextBundleV1 handoff assertions for current request, resolved meaning, mode, requested needs, need results, coverage, evidence, provenance, citations, locale, and prohibited execution-authority material in `test/contract/grounded-context-bundle.contract.spec.ts`
- [ ] T077 [P] Add cross-boundary token/proof/credential/connector/raw/pre-projection/authority sentinel scans in `test/integration/feature010-grounded-bundle-leak.spec.ts`
- [ ] T078 [P] Extend document/Tool/Hybrid/follow-up/ambiguous/unsupported-lastMonth/prior-recall/current-revocation/partial/insufficient/no-LLM routing evals in `test/eval/internal-assistant-core.eval.spec.ts`
- [ ] T079 Run unit, contract, integration, e2e, eval, typecheck, build, and lint commands and record exact results in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [ ] T080 Re-run existing RAG/document-answer, Customer isolation, no-answer, history, SSE, and permission suites and record results in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [ ] T081 Re-run Feature 007 identity/session, Feature 008 Tool/projection/evidence, and Feature 009 local suites in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [ ] T082 Verify Feature 009 manifest/T126–T142, schema, `.specify/feature.json`, AGENTS, external repositories, and staging have no Feature 010 diff in `test/contract/feature010-scope-boundary.contract.spec.ts`
- [ ] T083 Record every Feature 010 Definition of Done gate, backend acceptance, Feature 011 readiness, and planning-freeze state while keeping final prose/Feature 009 release acceptance pending in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Final exit gate**:

```text
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
GROUNDED_CONTEXT_BUNDLE_CONTRACT=PASS
FEATURE010_FINAL_LLM_GENERATION=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
SSE_EVENT_OR_PAYLOAD_CHANGE=NO
ASSISTANT_HISTORY_SHAPE_CHANGE=NO
PRISMA_SCHEMA_CHANGE=NO
PROHIBITED_MATERIAL_LEAK=NO
FEATURE009_MANIFEST_CHANGED=NO
FEATURE009_T126_T142_EXECUTED=NO
FEATURE009_FINAL_RELEASE_ACCEPTANCE=PENDING
```

## Dependencies and Execution Order

```text
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

| Story | Primary phase | Depends on | Independent acceptance |
|---|---:|---|---|
| US1 | 4 | Phases 2–3 | Follow-up re-enters routing; ambiguous/unsupported turns execute nothing |
| US2 | 5 | US1 routing + Phase 3 | Accessible document evidence/citations, zero ToolCalls |
| US3 | 6 | Phases 2–4 | One current-authorized ToolCall yields projected Tool evidence |
| US4 | 6 | US2 + US3 | Hybrid bundle reports COMPLETE/PARTIAL/INSUFFICIENT exactly |
| US5 | 6 | US2 + US3 + Phase 2 context | Eligible prior grounded evidence yields CONTEXT_ONLY with zero calls |

## Accepted Authority Invariants

```text
CONVERSATION_CONTEXT_OPERATION_AUTHORITY=NO
CONVERSATION_CONTEXT_PERMISSION_AUTHORITY=NO
RETRIEVAL_ROUTER_EXECUTION_AUTHORITY=NO
RAG_DOCUMENT_AUTHORITY=NO
RAG_CROSS_CUSTOMER_ACCESS=NO
TOOL_EXECUTION_USES_CURRENT_AUTHORITY=YES
FOLLOWUP_REENTERS_RETRIEVAL_ROUTING=YES
RAW_CONNECTOR_OUTPUT_IN_GROUNDED_BUNDLE=NO
PRE_PROJECTION_TOOL_DATA_IN_GROUNDED_BUNDLE=NO
DOCUMENT_PROVENANCE_REQUIRED=YES
TOOL_EVIDENCE_PROVENANCE_REQUIRED=YES
HYBRID_RETRIEVAL_SUPPORTED=YES
AUTONOMOUS_RETRIEVAL_LOOP=NO
ASSISTANT_PROSE_FACT_SOURCE=NO
GROUNDED_CONTEXT_BUNDLE_SAFE_FOR_GENERATION=YES
FEATURE010_FINAL_LLM_GENERATION=NO
FEATURE009_MANIFEST_CHANGED=NO
FEATURE009_T126_T142_EXECUTED=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
```

## Parallel Opportunities

- T002–T009 may run in parallel after T001.
- T012–T014/T017 may run in parallel before T015–T023 converge.
- T025–T027 may run in parallel before router implementation.
- T034–T036 may run in parallel before T037–T043.
- T044–T047 may run in parallel before RAG implementation.
- T055–T056, T060–T061, and T065–T066 are parallel RED groups after Phase 5; implementations converge at T069.
- T075–T078 may run in parallel before final suite execution.

## Implementation Strategy

```text
Intermediate RAG checkpoint: T001–T054
Feature 010 implementation scope: T001–T083
Feature 010 completion gate: Phase 7 / T083 PASS
Feature 011 readiness gate: Feature 010 backend local acceptance PASS
```

Phase 5 is only the intermediate RAG checkpoint. Phase 6 is mandatory for Tool normalization/integration, first-class Hybrid retrieval, retrieval coverage, prior grounded-context reuse, and `GroundedContextBundleV1`; Phase 7 is mandatory for Feature 010 backend acceptance and Feature 011 handoff validation. No task authorizes Feature 011 implementation, external UI work, Feature 009 staging, or final release acceptance.

Memory terminology is fixed: Short-term Conversation Context ≠ Long-term Memory ≠ RAG Knowledge Base. Feature 010 adds only bounded same-session context and no cross-session/user-profile memory, memory extraction, autonomous memory writing, or long-term-memory persistence.

## Feature 011 Handoff Boundary

Feature 010 tasks stop after producing and validating `GroundedContextBundleV1`. `Feature 011 — Grounded LLM Answer Synthesis` will own model-context assembly, system/generation policy, LLM invocation, natural answer generation, citation placement, claim validation, partial/unsupported wording, hallucination controls, token budgets, streaming, and final UX. No task in this file implements or invokes that successor behavior.

Feature 011 may be planned separately, but implementation readiness requires:

```text
GROUNDED_CONTEXT_BUNDLE_V1_CONTRACT=COMPLETE
PHASE_6_BEHAVIOR=COMPLETE
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
```

Feature 011 must not redesign conversation scope/isolation, semantic follow-up, retrieval routing, RAG authorization, Tool authority, evidence normalization, source provenance, retrieval coverage semantics, or `GroundedContextBundleV1`.

## Feature 010 Definition of Done

```text
BOUNDED_CONVERSATION_CONTEXT=PASS
SEMANTIC_FOLLOWUP=PASS
GROUNDED_RETRIEVAL_ROUTING=PASS
DOCUMENT_RAG_RETRIEVAL=PASS
TOOL_RETRIEVAL=PASS
HYBRID_RETRIEVAL=PASS
PRIOR_GROUNDED_CONTEXT_REUSE=PASS
RETRIEVAL_COVERAGE=PASS
GROUNDED_CONTEXT_BUNDLE_V1=PASS
CROSS_CUSTOMER_ISOLATION=PASS
PROHIBITED_MATERIAL_LEAK=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
FEATURE010_FINAL_LLM_GENERATION=NO
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
```

## Planning Freeze

```text
FEATURE010_SPECIFICATION_READY=YES
FEATURE010_IMPLEMENTATION_STARTED=NO
```

## Task Summary

- Total tasks: 83
- Phase 1: 10
- Phase 2: 13
- Phase 3: 10
- US1 / Phase 4: 10
- US2 / Phase 5: 11
- Phase 6: 20 (`US3`: 5, `US4`: 11, `US5`: 4)
- Phase 7: 9
- Intermediate RAG checkpoint: T001–T054
- Feature 010 implementation scope: T001–T083
- Feature 010 completion gate: Phase 7 / T083 PASS
- Feature 011 readiness gate: Feature 010 backend local acceptance PASS
- All task IDs are sequential with no gaps; every task has a checkbox, exact path, valid optional `[P]`, and story labels only where applicable.
