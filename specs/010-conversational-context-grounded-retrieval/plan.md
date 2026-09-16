# Implementation Plan: Feature 010 — Conversational Context & Grounded Retrieval

**Canonical Feature Path**: `specs/010-conversational-context-grounded-retrieval`  
**Date**: 2026-09-16  
**Status**: Planning only — no implementation task has started

## Summary

Feature 010 will add bounded same-session context, deterministic semantic follow-up, a non-authoritative retrieval router, canonical RAG/Tool/Hybrid execution, evidence normalization, coverage evaluation, and `GroundedContextBundleV1`. Existing document and Tool paths are reused and unified; final LLM answer generation is deferred to Feature 011.

```text
INTERMEDIATE_RAG_CHECKPOINT=T001–T054
FEATURE010_IMPLEMENTATION_SCOPE=T001–T083
FEATURE010_COMPLETION_GATE=PHASE_7_T083_PASS
FEATURE011_READINESS_GATE=FEATURE010_BACKEND_LOCAL_ACCEPTANCE_PASS
```

Phase 5 is an intermediate RAG checkpoint only. Feature 010 completion requires all Phase 6 behavior and the Phase 7/T083 backend acceptance gate.

## Technical Context

**Runtime**: TypeScript 6, Node.js 22+, NestJS 11  
**Persistence**: Existing PostgreSQL/Prisma models and JSON metadata only  
**Testing**: Jest unit, contract, integration, e2e, and eval suites  
**Existing retrieval**: Customer-scoped deterministic keyword provider through `RetrievalService`; no implemented vector/embedding provider  
**Existing Tool path**: Generic discovery → current ToolDefinition/policy/permission → ToolCall → adapter/connector → projection → EvidenceRef  
**Bounds**: Four completed exchanges, four prior EvidenceRefs, four needs, two chunks per document need, one Tool need/ToolCall, 900-second Tool-evidence freshness  
**Public change**: None; bundle is internal and transient  
**Storage change**: None; no migration or new table

## Constitution Check

| Principle | Compliance |
|---|---|
| C1 Maintainable architecture | Conversation, routing, retrieval, normalization, and orchestration responsibilities remain separate services. |
| C2 Test-first/regression | Every changed behavior starts with focused RED coverage; Customer-owned paths include colliding-ID cross-Customer tests. |
| C3 Trusted identity | Context and RAG use canonical Customer scope; Tool execution retains current verified authority. |
| C4 API compatibility | HTTP, SDK, SSE, history, and Tool result contracts remain unchanged. |
| C5 Grounded quality | Every need has evidence or an explicit unsupported/clarify result with provenance and coverage. |
| C6 Auditability | Route, eligibility, lane, coverage, and rejection decisions append bounded safe audit metadata. |
| C7 Human control | Feature is read-only and does not alter confirmation/approval/escalation behavior. |

**Pre-design gate**: PASS.  
**Post-design gate**: PASS. No exception, schema change, or authority waiver is planned.

## Architecture and Ownership

```text
src/assistant/conversation/   # scoped context loader, reconstruction, source guard, follow-up resolver
src/retrieval/                # existing RAG plus retrieval contracts/router/document normalizer
src/assistant/grounding/      # Tool normalization, eligibility, coverage, bundle assembly
src/assistant/message/        # orchestration only
src/query-understanding/      # existing deterministic parsing/decomposition signals
src/tools/                    # existing discovery and current ToolDefinition resolution
src/evidence/                 # existing EvidenceRef attachment/provenance boundary
```

The existing `src/assistant/context/` state service remains for current task/page state; Feature 010 conversation-history work is owned only by `src/assistant/conversation/`.

Memory terminology is strict throughout implementation:

```text
Short-term Conversation Context ≠ Long-term Memory ≠ RAG Knowledge Base
```

Feature 010 adds bounded same-session conversation context only; it adds no cross-session or user-profile memory, memory extraction, autonomous memory writing, or long-term-memory persistence.

## Internal Interface Changes

- Add `ConversationSemanticFrame`, provenance, and `FollowUpResolutionDecision`.
- Add `RetrievalMode`, discriminated `RetrievalNeed`, `GroundedRetrievalPlan`, and `RetrievalCoverage`.
- Add `GroundedDocumentEvidence`, `GroundedToolEvidence`, `GroundedCitation`, `GroundedRetrievalNeedResult`, and deeply immutable `GroundedContextBundleV1`.
- Extend document EvidenceRef safe summary metadata with document version/source provenance; no schema change.
- Preserve `GroundedAnswerInput` as the current Tool projection boundary; the bundle becomes the internal Feature 011 handoff, not a public DTO.

## Canonical User Stories

1. **US1 — Semantic follow-up and retrieval re-entry**
2. **US2 — Document-only grounded retrieval**
3. **US3 — Tool-only grounded retrieval**
4. **US4 — Hybrid grounded retrieval and coverage**
5. **US5 — Eligible prior grounded-context reuse**

## Canonical Seven-Phase Model

1. **Phase 1 — Baseline, repository inventory, RED fixtures, scope guards**
2. **Phase 2 — Shared contracts and bounded conversation-context foundation**
3. **Phase 3 — Grounded retrieval contracts and routing**
4. **Phase 4 — Semantic follow-up and retrieval re-entry**
5. **Phase 5 — RAG retrieval and document evidence normalization**
6. **Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly**
7. **Phase 7 — Cross-cutting security, compatibility and local backend acceptance**

## Dependency-Ordered Phases

### Phase 1 — Baseline, repository inventory, RED fixtures, scope guards

**Predecessors**: Accepted Feature 007/008 behavior and Feature 009 local state through T125. Feature 009 T126–T142/live staging are not prerequisites.

**Allowed scope**: Record existing RAG, Tool, evidence, LLM seam, AnswerDecision/GroundingCheck, SSE/history, and public-contract baselines; add RED fixtures for all five stories and boundary guards.

**Non-goals**: No production, schema, manifest, connector, Gateway, Identity Bridge, SDK, external UI, or staging change.

**RED→GREEN**: Existing suites remain green; focused document/tool/hybrid/follow-up/recall/bundle tests fail for the missing Feature 010 behavior.

**Exit gates**:

```text
REPOSITORY_INVENTORY_RECORDED=YES
PREDECESSOR_BASELINE=PASS
FEATURE010_RED_FIXTURES=CAPTURED
FEATURE009_T126_T142_UNCHANGED=YES
PUBLIC_CONTRACT_BASELINE=PASS
```

### Phase 2 — Shared contracts and bounded conversation-context foundation

**Predecessor**: Phase 1.

**Allowed scope**: Internal contracts; limits; recursive source guard; active Customer/session/organization/HostApp/actor-qualified repository; four-exchange/four-evidence selection; semantic reconstruction; safe audit seam; module wiring.

**Non-goals**: No retrieval routing/execution, factual prose parsing, cross-session memory, long-term memory, vector memory, current-authorization reuse, or new persistence.

**RED→GREEN**: Test deterministic newest-first selection, incomplete-pair exclusion, malformed/prohibited input, closed session, colliding IDs, and zero factual extraction from Assistant text.

**Exit gates**:

```text
MAX_COMPLETED_EXCHANGES=4
MAX_PRIOR_EVIDENCE_REFS=4
CONTEXT_SCOPE_ISOLATION=PASS
ASSISTANT_PROSE_FACT_SOURCE=NO
PROHIBITED_CONTEXT_MATERIAL=REJECTED
```

### Phase 3 — Grounded retrieval contracts and routing

**Predecessor**: Phase 2.

**Allowed scope**: Retrieval types; four-need deterministic decomposition; mode selection; coverage contract; routing audit; unsupported/clarify results; module integration without execution authority.

**Non-goals**: No lane execution, Tool selection, permissions, LLM planner, retry, recursion, autonomous loop, new vector provider, or final answer generation.

**RED→GREEN**: Table-driven tests cover CONTEXT_ONLY/RAG/TOOL/HYBRID/CLARIFY/INSUFFICIENT, four-need cap, one-Tool-need cap, compound sentences, unsupported needs, and deterministic reason codes.

**Exit gates**:

```text
RETRIEVAL_MODES_COMPLETE=YES
MAX_RETRIEVAL_NEEDS=4
MAX_TOOL_NEEDS_PER_TURN=1
RETRIEVAL_ROUTER_EXECUTION_AUTHORITY=NO
AUTONOMOUS_RETRIEVAL_LOOP=NO
```

### Phase 4 — Semantic follow-up and retrieval re-entry

**Predecessors**: Phases 2–3.

**Allowed scope**: INHERIT/REPLACE/NEW_TOPIC/CLARIFY; current explicit-frame extraction; resolved semantics returned to the router; RAG/Tool re-entry; safe follow-up audit metadata.

**Non-goals**: No prior Tool key/permission/connector reuse, prior-document authority, `lastMonth` capability, Feature 009 change, or evidence reuse implementation.

**RED→GREEN**: `那申請期限呢？` re-enters RAG; compatible entity replacement re-enters Tool routing; `那個呢？` clarifies with zero retrieval; `上個月呢？` remains unsupported with zero ToolCalls.

**Exit gates**:

```text
FOLLOWUP_DECISIONS_DETERMINISTIC=YES
EXPLICIT_CURRENT_VALUES_WIN=YES
FOLLOWUP_REENTERS_RETRIEVAL_ROUTING=YES
PREVIOUS_TOOLCALL_EXECUTION_AUTHORITY=NO
LAST_MONTH_TOOLCALL_COUNT=0
```

### Phase 5 — RAG retrieval and document evidence normalization

**Predecessors**: Phases 3–4.

**Allowed scope**: Reuse RetrievalService/provider/persistence/access policy; per-need retrieval; two-chunk cap; document EvidenceRef version provenance; normalization/citations; untrusted-document guard; RAG audits.

**Non-goals**: No second RAG stack, vector/embedding provider selection, score-as-truth, document-derived instruction/permission, Tool execution, or LLM generation.

**RED→GREEN**: Travel-subsidy and existing SOP fixtures route RAG with zero ToolCalls; inaccessible/archived/invalid-policy documents are absent before ranking; prompt-like text cannot alter authority; citations map to Customer-qualified document/chunk EvidenceRefs.

**Exit gates**:

```text
CANONICAL_RAG_REUSED=YES
MAX_DOCUMENT_CHUNKS_PER_NEED=2
DOCUMENT_PROVENANCE_REQUIRED=YES
RAG_DOCUMENT_AUTHORITY=NO
RAG_CROSS_CUSTOMER_ACCESS=NO
VECTOR_PROVIDER_SELECTED=NO
```

### Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly

**Predecessors**: Phases 2–5.

**Allowed scope**: Existing Tool path integration; projected Tool normalization; one-ToolCall coordinator; Hybrid lanes; prior document/tool/hybrid eligibility; current reauthorization; coverage; deduplication/citation map; transient bundle; safe metadata persistence.

**Non-goals**: No raw Tool result, multiple ToolCalls, retry/recursion, bundle public exposure, new table, fixed NLG, numeric comparison, or LLM invocation.

**RED→GREEN**: Tool-only yields one projected Tool evidence item; Hybrid yields both evidence kinds; partial lane failure yields `PARTIAL`; eligible context-only recall makes zero calls; stale/revoked/failed/ungrounded evidence is rejected; bundle is deeply immutable and leak-free.

**Exit gates**:

```text
MAX_NORMAL_TOOLCALLS_PER_TURN=1
TOOL_EXECUTION_USES_CURRENT_AUTHORITY=YES
RAW_CONNECTOR_OUTPUT_IN_GROUNDED_BUNDLE=NO
PRE_PROJECTION_TOOL_DATA_IN_GROUNDED_BUNDLE=NO
HYBRID_RETRIEVAL_SUPPORTED=YES
GROUNDED_CONTEXT_BUNDLE_SAFE_FOR_GENERATION=YES
FEATURE010_FINAL_LLM_GENERATION=NO
```

### Phase 7 — Cross-cutting security, compatibility and local backend acceptance

**Predecessors**: Phases 1–6.

**Allowed scope**: Full unit/contract/integration/e2e/eval regression; leak scans; audit correlation; public compatibility; all acceptance scenarios; Feature 011 handoff contract validation.

**Non-goals**: No final prose/UX acceptance, external F2E/widget/package edit, SDK protocol change, LLM invocation, staging claim, or Feature 009 release execution.

**RED→GREEN**: Validate document-only, Tool-only, Hybrid, partial, insufficient, clarify, follow-up, context-only recall, colliding-ID isolation, prompt-like content, prohibited sentinels, and unchanged predecessor/public suites.

**Exit gates / Feature 010 Definition of Done**:

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

Compatibility closure also requires:

```text
SSE_EVENT_OR_PAYLOAD_CHANGE=NO
ASSISTANT_HISTORY_SHAPE_CHANGE=NO
FEATURE009_MANIFEST_CHANGED=NO
FEATURE009_T126_T142_EXECUTED=NO
FEATURE009_FINAL_RELEASE_ACCEPTANCE=PENDING
```

## Test Strategy

- **Unit**: context guards/bounds, semantic resolver, need decomposition, router modes, eligibility, normalization, coverage, deduplication, immutability.
- **Contract**: internal bundle shape, unchanged public HTTP/SSE/history, Tool projection boundary, citation/provenance requirements.
- **Integration**: document-only, Tool-only, Hybrid, partial, context-only recall, current revocation, prompt-like content, persistence/audit linkage, call counts.
- **Eval**: paraphrases, compound questions, follow-ups, ambiguity, unsupported ranges, no-answer precision, Customer isolation.
- **Security**: colliding Customer identifiers, pre-filter RAG isolation, prohibited key/value sentinels, no document/router/conversation authority.
- **Regression**: existing Feature 007/008/009, RAG/document-answer, Tool, evidence, permissions, history, SSE, feedback, approval/escalation.

## Rollout and Rollback

Implementation is additive behind internal orchestration. Existing AnswerDecision/SSE behavior remains the compatibility sink until Feature 011. Rollback disables the new router/coordinator and returns to the existing mutually exclusive document/Tool branches; no migration or destructive data rollback is required.

## Successor / Feature 011 Handoff

Feature 011 receives the immutable bundle and owns prompt/model-context assembly, LLM execution, natural answer synthesis, citation placement, claim validation, partial/unsupported wording, token budgets, streaming, and final UX. Feature 010 must never send raw connector data or authority-bearing metadata across this seam.

Feature 011 may be planned separately, but implementation readiness requires:

```text
GROUNDED_CONTEXT_BUNDLE_V1_CONTRACT=COMPLETE
PHASE_6_BEHAVIOR=COMPLETE
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
```

Feature 011 must not redesign conversation scope/isolation, semantic follow-up, retrieval routing, RAG authorization, Tool authority, evidence normalization, source provenance, retrieval coverage semantics, or `GroundedContextBundleV1`.

## Removed or Deferred Scope

- `x-assistant-response-v1`, deterministic `zh-TW` grammar, and descriptor labels.
- Numeric comparisons and missing-value comparison retrieval.
- External F2E/widget/SDK packaging changes for fixed prose.
- Final LLM generation, provider/model selection, and final prose acceptance.

## Alignment Gates

```text
PLAN_TASK_PHASE_ALIGNMENT=YES
FEATURE_TITLE_ALIGNMENT=YES
CANONICAL_FEATURE_PATH=specs/010-conversational-context-grounded-retrieval/
USER_STORY_ALIGNMENT=YES
GROUNDED_CONTEXT_BUNDLE_TERMINOLOGY=ALIGNED
FEATURE011_HANDOFF=DEFINED
NUMERIC_COMPARISON_IN_FEATURE010=NO
DETERMINISTIC_COMPOSER_DELIVERABLE=NO
```

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

## Implementation Readiness

Planning is decision-complete. Implementation may begin only with separate authorization. This planning execution creates only the four Feature 010 Markdown artifacts and does not execute any task.

```text
FEATURE010_SPECIFICATION_READY=YES
FEATURE010_IMPLEMENTATION_STARTED=NO
```
