# Design: Feature 010 — Conversational Context & Grounded Retrieval

**Canonical Feature Path**: `specs/010-conversational-context-grounded-retrieval`

## 1. Goals and Architecture Boundary

Feature 010 introduces one bounded orchestration layer over existing conversation, RAG, and Tool capabilities. It produces a safe internal bundle for Feature 011 without becoming an execution authority or a second Tool/RAG architecture.

```text
current user message + bounded guarded context
  → semantic extraction + deterministic follow-up resolution
  → Grounded Retrieval Router
  → bounded plan
      ├─ eligible prior grounded evidence
      ├─ canonical RAG retrieval
      └─ existing Tool discovery/runtime
  → evidence normalization + citation map
  → coverage evaluation
  → GroundedContextBundleV1
```

No new table, migration, public endpoint, SSE event, SDK contract, connector operation, vector provider, LLM invocation, or Feature 009 capability is introduced.

## 2. Canonical Seven-Phase Model

1. **Phase 1 — Baseline, repository inventory, RED fixtures, scope guards**
2. **Phase 2 — Shared contracts and bounded conversation-context foundation**
3. **Phase 3 — Grounded retrieval contracts and routing**
4. **Phase 4 — Semantic follow-up and retrieval re-entry**
5. **Phase 5 — RAG retrieval and document evidence normalization**
6. **Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly**
7. **Phase 7 — Cross-cutting security, compatibility and local backend acceptance**

Implementation checkpoints are fixed as follows:

```text
INTERMEDIATE_RAG_CHECKPOINT=T001–T054
FEATURE010_IMPLEMENTATION_SCOPE=T001–T083
FEATURE010_COMPLETION_GATE=PHASE_7_T083_PASS
FEATURE011_READINESS_GATE=FEATURE010_BACKEND_LOCAL_ACCEPTANCE_PASS
```

Phase 5 is an intermediate RAG checkpoint only; it is not Feature 010 completion.

## 3. Repository Findings

### Canonical user stories

1. **US1 — Semantic follow-up and retrieval re-entry**
2. **US2 — Document-only grounded retrieval**
3. **US3 — Tool-only grounded retrieval**
4. **US4 — Hybrid grounded retrieval and coverage**
5. **US5 — Eligible prior grounded-context reuse**

### Existing RAG/document architecture

- `KnowledgeDocument` and `KnowledgeChunk` are Customer-owned. Documents declare status, visibility, organization IDs, required permission scopes, source key, version, and language.
- `RetrievalService` calls `DeterministicRetrievalProvider`, persists `RetrievalRun` and `RetrievalCandidate`, applies a 0.35 selection threshold, and currently selects at most two candidates by default.
- The provider performs Customer, organization visibility, active/enabled, and permission-scope filtering in the query before candidate materialization. It currently implements deterministic keyword ranking.
- `RetrievalProvider` already defines `retrieve` and `rerank` seams. Prisma includes `RetrievalStrategy.vector/hybrid` and chunk `embeddingRef/vectorId` fields, but no vector/embedding implementation or provider exists. Feature 010 must not claim otherwise or select one.
- `KnowledgeChunkingService` provides deterministic bounded chunk drafts. Seeded documents/chunks and RAG isolation/eval fixtures already exist.
- `EvidenceRefService.attachDocumentChunkEvidence` validates Customer-qualified RetrievalRun/candidate/document/chunk parents and creates bounded document summaries with title, source key, heading, snippet, score, and rank.

### Existing Tool/evidence architecture

- Generic `ToolDiscoveryService` uses trusted current ToolDefinition discovery metadata and Customer policy catalog; discovery returns candidates, not execution authority.
- `AssistantReadonlyRuntimeService` re-resolves the current ToolDefinition, evaluates current Customer policy/permissions, creates a ToolCall, executes the selected adapter/connector, projects the raw result, and returns `SafeProjectedAdapterResult`.
- `EvidenceRefService.attachStructuredRecordEvidence` persists only projected facts and provenance. Raw connector data is transient.
- `GroundedAnswerInput` currently models Tool evidence only. It must remain an authority boundary while the new bundle supplies a broader downstream-generation contract.
- The current read-only runtime executes only the first planned Tool candidate. V1 therefore admits at most one Tool need per turn.

### Existing orchestration, LLM, and presentation

- `AssistantMessageService` currently chooses document retrieval before Tool execution when `document_chunk` is required, so a turn cannot perform true RAG + Tool Hybrid retrieval.
- `AnswerDecisionService` and `GroundingCheck` already enforce evidence-backed/no-answer behavior; their deterministic answer text remains compatibility behavior, not Feature 010's product output.
- `LlmExecutionService` and provider interfaces exist, but Assistant message orchestration does not call them for final answers. Feature 010 does not change that.
- SSE already emits stable Tool lifecycle, evidence, `answer_delta`, and `final` events. History maps persisted messages, ToolCalls, and EvidenceRefs through Customer-qualified reads.
- `AssistantContextState` stores only the latest task/entities/IDs. It is insufficient by itself for four-exchange reconstruction; Feature 010 must read safe persisted messages and related records.

## 4. Internal Contracts

### 4.1 Semantic frame and resolution

```ts
type SemanticDimensionSource = 'current_explicit' | 'inherited';

interface SemanticDimension<T extends string = string> {
  value: T;
  source: SemanticDimensionSource;
  sourceMessageId: string;
  confidence: number;
}

interface ConversationSemanticFrame {
  resource?: SemanticDimension;
  intent?: SemanticDimension;
  metricOrAspect?: SemanticDimension;
  timeRange?: SemanticDimension;
  entity?: SemanticDimension & { entityType: string };
  topicKey?: string;
}

type FollowUpResolutionKind = 'INHERIT' | 'REPLACE' | 'NEW_TOPIC' | 'CLARIFY';

interface FollowUpResolutionDecision {
  kind: FollowUpResolutionKind;
  reasonCode: string;
  resolvedFrame?: ConversationSemanticFrame;
  inheritedDimensions: readonly string[];
  replacedDimensions: readonly string[];
}
```

Frames never include a Tool key/version, ToolDefinition ID, permission result, Customer selection, connector/adapter/deployment reference, credential, raw input, or raw result.

### 4.2 Retrieval plan

```ts
type RetrievalMode =
  | 'CONTEXT_ONLY'
  | 'RAG'
  | 'TOOL'
  | 'HYBRID'
  | 'CLARIFY'
  | 'INSUFFICIENT';

type RetrievalNeed =
  | { id: string; kind: 'DOCUMENT'; query: string; topicKey?: string }
  | { id: string; kind: 'TOOL'; frame: ConversationSemanticFrame }
  | { id: string; kind: 'UNSUPPORTED'; reasonCode: string };

interface GroundedRetrievalPlan {
  mode: RetrievalMode;
  needs: readonly RetrievalNeed[];
  resolvedFrame?: ConversationSemanticFrame;
  reasonCode: string;
}
```

The router consumes safe query-understanding output, resolved semantics, and evidence-coverage results. It may classify needs but cannot select an executable operation. Tool needs re-enter discovery; document needs re-enter `RetrievalService`.

Bounds:

```text
MAX_COMPLETED_EXCHANGES=4
MAX_PRIOR_EVIDENCE_REFS=4
MAX_RETRIEVAL_NEEDS=4
MAX_DOCUMENT_CHUNKS_PER_NEED=2
MAX_TOOL_NEEDS_PER_TURN=1
MAX_NORMAL_TOOLCALLS_PER_TURN=1
TOOL_EVIDENCE_DEFAULT_MAX_AGE_SECONDS=900
TOOL_EVIDENCE_HARD_MAX_AGE_SECONDS=900
```

### 4.3 Evidence and bundle

```ts
type RetrievalCoverage = 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT' | 'CLARIFY';

interface GroundedDocumentEvidence {
  kind: 'DOCUMENT';
  evidenceRefId: string;
  needId: string;
  content: string;
  title: string;
  documentId: string;
  chunkId: string;
  documentVersion: string;
  sourceKey: string;
  observedAt: string;
  trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE';
}

interface GroundedToolEvidence {
  kind: 'TOOL';
  evidenceRefId: string;
  needId: string;
  toolCallId: string;
  canonicalToolKey: string;
  projectedFacts: Readonly<Record<string, unknown>>;
  fieldPaths: readonly string[];
  observedAt: string;
}

interface GroundedCitation {
  citationId: string;
  evidenceRefId: string;
  needId: string;
  sourceKind: 'DOCUMENT' | 'TOOL';
  safeLabel: string;
}

interface GroundedRetrievalNeedResult {
  needId: string;
  status: 'COVERED' | 'UNSUPPORTED' | 'FAILED' | 'CLARIFY';
  evidenceRefIds: readonly string[];
  reasonCode?: string;
}

interface GroundedContextBundleV1 {
  version: '1';
  currentRequest: {
    messageId: string;
    normalizedQuestion: string;
    resolvedFrame?: ConversationSemanticFrame;
  };
  conversationContext: { boundedRecentTurns: readonly SafeConversationTurn[] };
  retrieval: {
    mode: RetrievalMode;
    requestedNeeds: readonly RetrievalNeed[];
    needResults: readonly GroundedRetrievalNeedResult[];
    coverage: RetrievalCoverage;
  };
  evidence: readonly (GroundedDocumentEvidence | GroundedToolEvidence)[];
  citations: readonly GroundedCitation[];
  unsupportedNeeds: readonly { needId: string; reasonCode: string }[];
  locale: string;
}
```

`requestedNeeds` preserves only the safe semantic or document request descriptors admitted by the bounded router. It contains no resolved Tool operation, ToolDefinition ID, adapter, connector, deployment selector, credential, permission result, or other executable authority. `needResults` records the outcome and evidence linkage for each requested need by stable need ID.

The bundle is transient and deeply immutable. It is handed synchronously to the Feature 011 seam. Without querying execution-authority systems again, a Feature 011 consumer can determine the current question, resolved conversational meaning, retrieval mode, requested needs, coverage, covered and unsupported/failed needs, normalized document and Tool evidence, provenance, citation mapping, and locale. Only version, route/coverage, need IDs, evidence IDs, and safe reason codes may be copied into existing AnswerDecision/GroundingCheck metadata or audit records.

## 5. Bounded Conversation Context

`src/assistant/conversation/` owns the new context repository, loader, semantic reconstructor, source guard, limits, and conversation audit helpers.

The repository first resolves an active session with:

```text
customerId + sessionId + organizationId + hostApp + actorId + status=active
```

It selects newest first, then reconstructs chronologically:

- At most four complete user-assistant exchanges.
- Safe QueryUnderstandingResult semantic fields.
- AnswerDecision and covered GroundingCheck status.
- At most four projected/document EvidenceRefs.
- Source lifecycle identifiers required for Phase 6 eligibility revalidation.

Assistant text may support deixis only. Facts are never extracted from it. Pending/orphan messages, failed/blocked/denied/no-answer outcomes, malformed metadata, and out-of-window records are excluded.

The recursive guard rejects tokens, Authorization values, JWT/proofs, connector context refs, credentials, opaque handles, endpoints, raw responses, pre-projection results, permission snapshots used as authority, and adapter/connector/deployment selectors.

## 6. Routing and Follow-up Rules

Processing is deterministic:

1. Run existing sentence splitting, normalization, time/entity parsing, and Query Understanding.
2. Build the current explicit frame.
3. Resolve against the newest unique compatible prior frame.
4. Decompose at most four sentence/subtask needs.
5. Evaluate whether eligible prior evidence fully covers each need.
6. Choose mode:
   - all needs covered by prior evidence → `CONTEXT_ONLY`;
   - remaining needs all document → `RAG`;
   - exactly one remaining Tool need → `TOOL`;
   - document need(s) plus exactly one Tool need → `HYBRID`;
   - user input required → `CLARIFY`;
   - unsupported/no executable route → `INSUFFICIENT`.

`NEW_TOPIC` discards inherited dimensions. `REPLACE` applies explicit current values and inherits only omissions. `INHERIT` requires one compatible frame. Contradiction, multiple compatible frames, vague deixis, or incomplete required dimensions yields `CLARIFY`.

## 7. RAG Lane and Document Normalization

The RAG lane reuses `RetrievalService`, `RetrievalProvider`, access-policy normalization, persisted RetrievalRun/Candidates, and `EvidenceRefService`.

Feature 010 extends document EvidenceRef summaries with safe `documentVersion` provenance and normalizes selected evidence into `GroundedDocumentEvidence`. Existing rows without required provenance are not reused; they are re-retrieved.

Plain document content is preserved as bounded evidence data with `UNTRUSTED_DOCUMENT_EVIDENCE`. Prompt-like phrases cannot alter the plan, create needs, select tools, or enter instruction fields. Control characters, prohibited structured metadata, or oversized/malformed values reject the item. Score/rank remain diagnostics and do not assert truth.

## 8. Tool Lane

Tool needs follow the existing chain unchanged:

```text
generic Tool Discovery
→ current canonical ToolDefinition
→ current CustomerToolPolicy
→ Feature 008 permission
→ ToolCall
→ DataAdapter / connector
→ projection
→ EvidenceRef
```

Only a successful executed ToolCall with successful projection and attached EvidenceRef can normalize into `GroundedToolEvidence`. The normalizer receives `SafeProjectedAdapterResult`/EvidenceRef data, never the raw connector response. Prior Tool evidence is reauthorized and limited to 900 seconds.

## 9. Hybrid Coordinator and Coverage

The coordinator executes only declared needs; no lane can add another need. V1 admits one Tool need and up to three document needs within the four-need cap. There are no retries, recursion, fallback tool guessing, or arbitrary loops.

Need results determine coverage:

- all requested needs `COVERED` → `COMPLETE`;
- at least one covered and at least one unsupported/failed → `PARTIAL`;
- none covered → `INSUFFICIENT`;
- any blocking ambiguity before retrieval → `CLARIFY`.

Evidence is deduplicated deterministically by EvidenceRef ID and source provenance. Citation IDs are assigned in stable need order, then source order. Each citation points to exactly one EvidenceRef.

## 10. Prior Grounded-Context Eligibility

All candidates require same active scope, selected completed exchange, prior `answered` decision, covered GroundingCheck with zero unsupported claims, and bundle-safe source data.

Document evidence additionally requires the document/chunk to remain active/enabled, current visibility and permission to allow access, and version provenance to match. Tool evidence additionally requires a successful executed source ToolCall, current canonical ToolDefinition, current Customer policy/permission, compatible topic, and age not exceeding 900 seconds. Hybrid reuse evaluates each item independently; complete coverage is required for `CONTEXT_ONLY`.

## 11. Orchestration, Persistence, and Compatibility

`AssistantMessageService` becomes a coordinator, not a source of domain policy:

```text
persist user/pending assistant message
→ load guarded context
→ understand + resolve
→ build retrieval plan
→ revalidate prior evidence
→ execute zero or bounded canonical lanes
→ normalize + assemble bundle
→ existing AnswerDecision/GroundingCheck compatibility sink
→ existing persistence/SSE/history
```

The public bundle is not added to SSE/history. Existing document-only and Tool-only answer behavior remains regression-compatible until Feature 011 replaces synthesis. Hybrid acceptance concerns the internal bundle and evidence linkage, not final prose quality.

Safe audit events cover context loading, follow-up resolution, retrieval routing, prior-evidence eligibility, lane completion/rejection, coverage, and bundle assembly. Audit records contain counts, IDs, mode, coverage, reason codes, and duration—not document text, projected values, secrets, or raw responses.

## 12. Failure Matrix

| Condition | Result |
|---|---|
| Cross-Customer/session/organization/HostApp/actor context | Not found; no disclosure |
| Ambiguous dependent reference | `CLARIFY`; no retrieval |
| More than four needs | `CLARIFY` or unsupported overflow; no silent truncation execution |
| More than one Tool need | `CLARIFY`/`INSUFFICIENT`; no ToolCall |
| Document permission/source invalid | Need unsupported; no candidate leakage |
| Prompt-like document content | Evidence data only; no authority/instruction effect |
| Tool denied/failed/unprojected | Need unsupported/failed; no factual evidence |
| One Hybrid lane fails | `PARTIAL`; keep only eligible successful evidence |
| No lane covers a need | `INSUFFICIENT` |
| Prohibited source material | Reject item and audit safe reason |

## 13. Successor / Feature 011 Handoff

Feature 011 consumes only `GroundedContextBundleV1` and owns model-context assembly, system/generation policy, LLM invocation, natural `zh-TW` synthesis, citation placement, claim verification, partial/unsupported wording, token budget, streaming, and final UX acceptance.

Feature 011 may be planned separately, but implementation readiness requires:

```text
GROUNDED_CONTEXT_BUNDLE_V1_CONTRACT=COMPLETE
PHASE_6_BEHAVIOR=COMPLETE
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
```

Feature 010 does not call `LlmExecutionService`. Feature 011 must preserve conversation scope/isolation, semantic follow-up, retrieval routing, RAG authorization, Tool authority, evidence normalization, source provenance, coverage semantics, and the bundle contract; it cannot reinterpret any bundle field as execution authority.

## 14. Memory Boundaries

```text
Short-term Conversation Context ≠ Long-term Memory ≠ RAG Knowledge Base
```

Feature 010 implements only bounded same-session conversation context. It introduces no cross-session or user-profile memory, memory extraction, autonomous memory writing, or long-term-memory persistence. The RAG knowledge base remains governed Customer-scoped document evidence.

## 15. Feature 010 Definition of Done

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

## 16. Compatibility and Authority Decisions

```text
PRISMA_SCHEMA_CHANGE=NO
NEW_PUBLIC_ENDPOINT=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
SDK_PUBLIC_CONTRACT_CHANGE=NO
SSE_EVENT_OR_PAYLOAD_CHANGE=NO
ASSISTANT_HISTORY_SHAPE_CHANGE=NO
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
```

## 17. Planning Freeze

```text
FEATURE010_SPECIFICATION_READY=YES
FEATURE010_IMPLEMENTATION_STARTED=NO
```
