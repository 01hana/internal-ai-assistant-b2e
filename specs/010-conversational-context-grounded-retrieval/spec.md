# Feature Specification: Feature 010 — Conversational Context & Grounded Retrieval

**Canonical Feature Path**: `specs/010-conversational-context-grounded-retrieval`  
**Created**: 2026-09-16  
**Status**: Planning complete — implementation not started

## Product Intent

Feature 010 turns a current user message plus bounded recent conversation context into a safe, traceable `GroundedContextBundleV1`. It determines whether each requested fact needs prior grounded context, company documents, current system state, both RAG and Tool retrieval, clarification, or an insufficient result.

```text
User Message
  → Bounded Conversation Context
  → Current Semantic Extraction
  → Follow-up Resolution
  → Grounded Retrieval Router
  → CONTEXT_ONLY | RAG | TOOL | HYBRID | CLARIFY | INSUFFICIENT
  → Authorized Retrieval
  → Evidence Normalization
  → Grounded Context Bundle
  → [Feature 011] Grounded LLM Answer Synthesis
```

Feature 010 does not generate the final LLM answer. It does not create a second Tool runtime, select an LLM/vector provider, or grant authority through conversation, documents, prior evidence, retrieval decisions, or model output.

## Canonical Seven-Phase Model

1. **Phase 1 — Baseline, repository inventory, RED fixtures, scope guards**
2. **Phase 2 — Shared contracts and bounded conversation-context foundation**
3. **Phase 3 — Grounded retrieval contracts and routing**
4. **Phase 4 — Semantic follow-up and retrieval re-entry**
5. **Phase 5 — RAG retrieval and document evidence normalization**
6. **Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly**
7. **Phase 7 — Cross-cutting security, compatibility and local backend acceptance**

## Implementation Checkpoints

```text
INTERMEDIATE_RAG_CHECKPOINT=T001–T054
FEATURE010_IMPLEMENTATION_SCOPE=T001–T083
FEATURE010_COMPLETION_GATE=PHASE_7_T083_PASS
FEATURE011_READINESS_GATE=FEATURE010_BACKEND_LOCAL_ACCEPTANCE_PASS
```

Phase 5 is only an intermediate RAG checkpoint. Feature 010 is not complete until Phase 6 supplies Tool retrieval, first-class Hybrid retrieval, prior grounded-context reuse, coverage evaluation, and `GroundedContextBundleV1`, and Phase 7/T083 records backend local acceptance as `PASS`.

## User Scenarios & Testing

### Canonical user stories

1. **US1 — Semantic follow-up and retrieval re-entry**
2. **US2 — Document-only grounded retrieval**
3. **US3 — Tool-only grounded retrieval**
4. **US4 — Hybrid grounded retrieval and coverage**
5. **US5 — Eligible prior grounded-context reuse**

### User Story 1 — Semantic follow-up and retrieval re-entry (Priority: P1)

As an internal user, I want short follow-ups to inherit only compatible omitted meaning so that the system can route my current request without treating prior conversation as authority.

**Independent Test**: After `公司的員工旅遊補助規定是什麼？`, the follow-up `那申請期限呢？` inherits the compatible document topic, replaces the requested aspect, and re-enters RAG routing. `那個呢？` returns `CLARIFY` with no retrieval or ToolCall.

**Acceptance Scenarios**:

1. Explicit current values replace matching prior dimensions; only omitted compatible dimensions are inherited.
2. An explicit incompatible resource or entity is `NEW_TOPIC` and discards inherited topic dimensions.
3. A uniquely compatible dependent follow-up is `INHERIT` or `REPLACE`; contradictory, incomplete, or equally plausible frames are `CLARIFY`.
4. Resolved semantics re-enter the Grounded Retrieval Router. Tool needs then enter generic Tool Discovery; document needs enter canonical RAG retrieval.
5. `上個月呢？` may resolve semantically, but remains `INSUFFICIENT` or a safe clarification while no trusted current capability supports `lastMonth`; it performs zero ToolCalls and does not change Feature 009.

---

### User Story 2 — Document-only grounded retrieval (Priority: P1)

As an internal user, I want questions about company rules and documents to retrieve only knowledge I may access, with usable provenance for a later grounded answer.

**Independent Test**: `公司的員工旅遊補助規定是什麼？` routes to `RAG`, searches only accessible company documents, selects at most two relevant chunks for the need, creates document EvidenceRefs and citations, returns `COMPLETE` when the need is covered, and performs zero ToolCalls.

**Acceptance Scenarios**:

1. Retrieval applies Customer, organization, and permission filters before candidate materialization and ranking.
2. Selected document evidence contains bounded chunk text, safe title/label, document/chunk identity, version provenance, and citation linkage.
3. Retrieval score is diagnostic ranking metadata, not factual truth.
4. Prompt-like document text remains untrusted evidence data and cannot change routing, permissions, or Tool execution.
5. No sufficient accessible chunk produces `INSUFFICIENT`, not a fabricated completion.

---

### User Story 3 — Tool-only grounded retrieval (Priority: P1)

As an internal user, I want current system-state questions to use the existing authorized Tool path and contribute only released projected evidence to the grounded bundle.

**Independent Test**: `這個月新增幾張工單？` routes to `TOOL`, re-enters generic Tool Discovery, resolves the current ToolDefinition and CustomerToolPolicy, checks current permission, executes one normal ToolCall, projects the result, creates an EvidenceRef, and includes only projected facts and provenance in the bundle.

**Acceptance Scenarios**:

1. The router never chooses an operation or bypasses current Tool authority.
2. A successful ToolCall without successful projection/evidence attachment does not become grounded model context.
3. Raw connector output and pre-projection fields never enter the bundle, audit, SSE, history, or future model context.
4. Blocked, denied, failed, conflicted, or ungrounded tool outcomes produce an unsupported need and no factual evidence.

---

### User Story 4 — Hybrid grounded retrieval and coverage (Priority: P1)

As an internal user, I want a compound question to retrieve current system facts and company policy together so that a later answer can distinguish and cite both sources.

**Independent Test**: `這個月新增多少工單？公司的工單 SOP 規定多久內要處理？` decomposes into one Tool need and one document need, routes to `HYBRID`, executes each lane once through its canonical path, normalizes both evidence kinds, and returns independent citations with `COMPLETE` coverage.

**Acceptance Scenarios**:

1. Hybrid mode is selected explicitly from the bounded plan; it is not fallback trial-and-error.
2. At most four needs are admitted, each document need selects at most two chunks, and V1 admits at most one Tool need/normal ToolCall per turn.
3. More than one distinct Tool need is clarified or marked unsupported; no recursive or multi-tool agent loop begins.
4. If one lane succeeds and the other lacks sufficient evidence, the bundle is `PARTIAL`, preserves successful evidence, and records the unsupported need.
5. If no need is covered, coverage is `INSUFFICIENT`; if user input is required before retrieval, coverage is `CLARIFY`.

---

### User Story 5 — Eligible prior grounded-context reuse (Priority: P2)

As an internal user, I want a recent follow-up to reuse already grounded evidence when it is still scoped, current, and authorized so that unnecessary retrieval is avoided.

**Independent Test**: After grounded document evidence answers the travel-subsidy topic, `你剛剛提到的補助上限是多少？` produces `CONTEXT_ONLY` when eligible prior evidence fully covers the need, without parsing the prior Assistant prose or running a new retrieval.

**Acceptance Scenarios**:

1. Prior document, projected Tool, and Hybrid evidence may be reused only from the same active Customer/session/organization/HostApp/actor scope and bounded window.
2. Document reuse revalidates active document/chunk, current access policy, version provenance, and current permissions.
3. Tool reuse re-resolves the current ToolDefinition and current Customer policy/permission and is no older than 900 seconds.
4. Failed, blocked, denied, `no_answer`, ungrounded, stale, malformed, raw, or prohibited prior outcomes never become factual evidence.
5. If prior evidence is ineligible, the plan performs normal current retrieval when supported or returns `INSUFFICIENT`/`CLARIFY`.

### Edge Cases

- A fifth completed exchange, fifth prior EvidenceRef, or fifth retrieval need is excluded or safely rejected before execution.
- An incomplete user-assistant pair is not conversation context.
- Two equally compatible prior frames remain ambiguous even if one is older.
- A document is archived, disabled, replaced, or permission-revoked after the original turn; it is re-retrieved or rejected.
- A prior Tool permission snapshot says allowed but current permission is denied; reuse is rejected.
- Retrieved content claims to be a system message or to authorize a tool; it remains untrusted document data.
- A Hybrid lane fails after the other succeeds; successful evidence remains traceable and coverage is `PARTIAL`.
- Duplicate evidence from current and prior sources is deterministically deduplicated by EvidenceRef/source provenance.

## Requirements

### Functional Requirements

- **FR-001**: Load at most the newest four completed exchanges and four prior EvidenceRefs from the same active Customer/session/organization/HostApp/actor scope, with deterministic newest-first selection and incomplete-pair exclusion.
- **FR-002**: Build semantic frames from safe QueryUnderstandingResult data and current explicit semantics, never from execution-authority fields.
- **FR-003**: Resolve follow-ups deterministically as `INHERIT`, `REPLACE`, `NEW_TOPIC`, or `CLARIFY`; explicit current values always win.
- **FR-004**: Produce a bounded `GroundedRetrievalPlan` with at most four needs and a mode of `CONTEXT_ONLY`, `RAG`, `TOOL`, `HYBRID`, `CLARIFY`, or `INSUFFICIENT`.
- **FR-005**: The router MUST NOT grant execution authority, construct ToolDefinitions, reuse prior operations, or initiate retries/recursive planning.
- **FR-006**: Document retrieval MUST reuse the canonical RetrievalService/provider seam and apply Customer/organization/permission policy before candidate selection.
- **FR-007**: Each document need MAY select at most two bounded chunks and MUST retain document/chunk/version/source provenance and citation identity.
- **FR-008**: Retrieved text MUST be treated as untrusted evidence data and MUST NOT supply instructions, identity, permissions, or tool authority.
- **FR-009**: Tool retrieval MUST use generic Tool Discovery, current canonical ToolDefinition, current CustomerToolPolicy, Feature 008 permission, normal ToolCall, projection, and EvidenceRef creation.
- **FR-010**: V1 MUST admit at most one Tool need and one normal ToolCall per turn; additional distinct Tool needs require clarification or become unsupported.
- **FR-011**: Hybrid retrieval MUST execute only the explicitly planned bounded lanes and retain independent need results and provenance.
- **FR-012**: Normalize document and Tool evidence into a common immutable `GroundedContextBundleV1` without raw connector responses or pre-projection Tool data.
- **FR-013**: Bundle coverage MUST be `COMPLETE`, `PARTIAL`, `INSUFFICIENT`, or `CLARIFY` based on coverage of every requested need.
- **FR-014**: `PARTIAL` MUST retain successful evidence and explicitly identify unsupported/failed needs without fabricating coverage.
- **FR-015**: `CONTEXT_ONLY` MUST require complete coverage by eligible prior grounded evidence and MUST perform no RAG retrieval or ToolCall.
- **FR-016**: Prior Assistant prose MUST NOT be parsed as factual evidence.
- **FR-017**: Prior document evidence MUST pass current source status/version/access checks; prior Tool evidence MUST pass 900-second freshness and current ToolDefinition/policy/permission checks.
- **FR-018**: Source guards MUST reject tokens, Authorization headers, proofs/JWTs, connector references, credentials, raw responses, pre-projection data, opaque handles, and authority-bearing fields at every context/bundle boundary.
- **FR-019**: Persist only existing EvidenceRef, GroundingCheck, AnswerDecision, and safe JSON metadata/audit records; add no database table or public endpoint.
- **FR-020**: Preserve Assistant HTTP routes, public SDK contract, SSE event names/payload shapes, history shape, and the existing Tool authority boundary.
- **FR-021**: Feature 010 MUST NOT call the LLM answer-generation path; existing AnswerDecision/SSE behavior remains a compatibility sink until Feature 011.
- **FR-022**: Feature 009 manifest/capability and T126–T142 status MUST remain unchanged; `lastMonth` MUST NOT be added.

### Authority and Safety Invariants

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

### Key Entities

- **ConversationSemanticFrame**: Non-authoritative resource, intent, metric/aspect, time range, entity/topic identity, and per-dimension provenance.
- **GroundedRetrievalPlan**: Bounded deterministic list of needs, route mode, resolved frame, and safe reason code.
- **Grounded Evidence Item**: Document or Tool evidence normalized from an eligible EvidenceRef with source-specific provenance.
- **Grounded Citation**: Stable internal mapping from a citation ID to one EvidenceRef and its safe source identity.
- **GroundedContextBundleV1**: Transient immutable safe-for-generation handoff containing current request, bounded conversation context, plan results, evidence, citations, unsupported needs, locale, and coverage.

## Success Criteria

- **SC-001**: All accepted routing fixtures deterministically select the expected mode and never exceed four needs.
- **SC-002**: Document-only acceptance returns traceable accessible document evidence with zero ToolCalls.
- **SC-003**: Tool-only acceptance executes exactly one current-authorized ToolCall and exposes zero raw/pre-projection fields.
- **SC-004**: Hybrid acceptance includes both evidence kinds and independent citations; partial fixtures report `PARTIAL` with every uncovered need identified.
- **SC-005**: Eligible context-only recall performs zero retrieval calls; all ineligible prior-evidence fixtures are rejected.
- **SC-006**: Cross-Customer, session, organization, HostApp, and actor isolation fixtures leak zero document, Tool, or prior-evidence content.
- **SC-007**: Prohibited-material scans find zero token, proof, connector reference, raw response, or authority field in bundles, audits, history, SSE, or model-facing inputs.
- **SC-008**: Existing Feature 007/008/009 and RAG/document-answer regressions remain green with unchanged public HTTP/SSE/history contracts.

## Feature 010 Definition of Done

Feature 010 is complete only when every gate below has the recorded value shown:

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

## Memory Boundaries

```text
Short-term Conversation Context ≠ Long-term Memory ≠ RAG Knowledge Base
```

Feature 010 uses bounded same-session context only. It adds no cross-session memory, user-profile memory, memory extraction, or long-term memory table. RAG documents remain governed company knowledge, not conversation memory.

## Successor / Feature 011 Handoff

`Feature 011 — Grounded LLM Answer Synthesis` consumes `GroundedContextBundleV1` and owns prompt/model-context assembly, provider/model invocation, natural `zh-TW` generation, citation placement, claim validation, partial/unsupported wording, hallucination controls, token budgets, streamed answer generation, and final Assistant UX acceptance.

Feature 011 may be planned separately, but its implementation must not begin against an incomplete or provisional Feature 010 retrieval contract. Implementation readiness requires all three gates:

```text
GROUNDED_CONTEXT_BUNDLE_V1_CONTRACT=COMPLETE
PHASE_6_BEHAVIOR=COMPLETE
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
```

Feature 011 must not redesign conversation scope or isolation, semantic follow-up, retrieval routing, RAG authorization, Tool authority, evidence normalization, source provenance, retrieval coverage semantics, or `GroundedContextBundleV1`.

## Planning Freeze

```text
FEATURE010_SPECIFICATION_READY=YES
FEATURE010_IMPLEMENTATION_STARTED=NO
```

## Out of Scope

- Deterministic response descriptors or fixed `zh-TW` metric grammar.
- Numeric more/less/equal comparison or missing-value comparison retrieval.
- Final LLM answer generation, prompt policy, provider/model selection, or final prose quality.
- New vector database, embedding provider, database table, public endpoint, SSE event, or SDK contract.
- External F2E/widget/package changes, staging acceptance, Feature 009 changes, autonomous agents, recursive tool planning, or long-term memory.
