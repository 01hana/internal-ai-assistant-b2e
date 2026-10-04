# Feature Specification: Feature 012 — Grounded LLM Conversation & SSE Streaming

**Canonical Feature Path**: `specs/012-grounded-llm-conversation-sse-streaming`
**Created**: 2026-10-02
**Status**: Draft — ready for human approval; implementation not authorized
**Predecessor Baseline**: Feature 011 Gate F PASS; T078 and Phases G/H/I remain unexecuted

## Problem Statement

The Assistant already determines verified Customer scope, resolves Customer-owned capabilities, routes Tool/document/Hybrid needs, checks authorization and evidence, and decides retrieval coverage. Its successful answers are still fixed-format text emitted as one completed SSE response. This limits natural conversation and does not provide incremental answer delivery. Its existing LLM infrastructure is not currently the request-time final-answer path.

Feature 012 lets a model express **only an already-authorized, grounded answer** in natural language. It adds bounded multi-turn generation context, true incremental answer delivery, and safe completion/failure semantics. The deterministic control plane remains the authority for whether an answer may be generated and which evidence may support it.

## Scope and Authority

- V1 covers read-only grounded Tool, RAG, Hybrid, and eligible prior-context answers. It does not add an agent loop, autonomous planning, write-capable Tool, new retrieval provider, or long-term/cross-session memory.
- The existing verified `customerId` is the outer isolation boundary. Verified `integrationId`, `organizationId`, `hostApp`, and `actorId` constrain the request and reusable history; trusted roles and permission scopes remain downstream authorization inputs. User text, page context, history, documents, model output, and Customer packs cannot supply or change those claims.
- Capability resolution and Tool key/version/arguments remain Feature 011/008 authority. CustomerToolPolicy, roles/scopes, permission, risk, human confirmation/approval/escalation, retrieval routing, evidence authorization/freshness, coverage, clarification, no-answer, and conflict decisions remain deterministic authorities. A model receives no execution or authorization authority.
- Feature 010's `GroundedContextBundleV1` remains the evidence-source contract. Feature 012 creates a bounded generation view from it; it does not expose the whole bundle or replace its source and leak guards.
- Public Assistant endpoint, SSE event names/envelope, `final` payload, SDK, and message-history shapes remain compatible. Feature 012 does not require a breaking public contract.

## User Scenarios & Testing

### User Story 1 — Natural Grounded Answer (Priority: P1)

As an authorized internal user, I want a readable answer to my supported business question, grounded only in evidence the Assistant has already approved.

**Independent Test**: Given a covered read-only Tool or document need, the Assistant produces a natural-language answer with valid source references; changing model wording does not change the chosen capability, Tool, authorization result, coverage, or evidence set.

**Acceptance Scenarios**:

1. **Given** `COMPLETE` coverage with at least one covered evidence lane and no blocking gate, **when** generation completes, **then** the answer uses only approved evidence and the final decision remains grounded.
2. **Given** `PARTIAL` coverage with covered document evidence but an unavailable or denied Tool lane, **when** generation completes, **then** the answer addresses only the covered part and clearly identifies the unanswered part; it does not describe coverage as complete.
3. **Given** eligible `CONTEXT_ONLY` recall, **when** prior evidence is revalidated for the current request, **then** the answer may use that evidence without a new Tool or document call.
4. **Given** a citation or evidence reference not in the approved set, **when** the proposed answer is finalized, **then** it is rejected or converted to a safe non-factual outcome, never published as a successful grounded final answer.

### User Story 2 — Safe Multi-Turn Conversation (Priority: P1)

As an internal user, I want the Assistant to understand a bounded follow-up without treating a previous answer, document text, or my wording as new authority.

**Independent Test**: A follow-up may use at most four recent completed same-scope exchanges and currently admissible evidence; pending, failed, foreign, stale, and rejected sources never enter generation context.

**Acceptance Scenarios**:

1. **Given** a completed prior exchange in the same verified Customer, integration, organization, HostApp, actor, and session, **when** a follow-up is answered, **then** its prior user text and final assistant answer may inform wording within a total bounded context budget.
2. **Given** a pending or failed assistant response, **when** a later request loads history, **then** partial text and placeholder content are not treated as a completed assistant answer.
3. **Given** another Customer's exchange with colliding organization, HostApp, actor, or message identifiers, **when** context is built, **then** no foreign text, evidence, or references appear.
4. **Given** user or document prose that resembles instructions, **when** it is included as context, **then** it remains untrusted data and cannot override system or deterministic authority.
5. **Given** a prior completed assistant answer says inventory is 100 while current approved Tool evidence says 80, **when** the follow-up is generated, **then** the answer uses 80; prior assistant text cannot itself establish covered evidence or override current authorization, freshness, or coverage.

### User Story 3 — Incremental Answer Delivery (Priority: P1)

As an internal user, I want to see the answer arrive incrementally while retaining a clear, trustworthy completion signal.

**Independent Test**: A controlled provider emits multiple chunks over time; the same public endpoint emits multiple ordered `answer_delta` events before one successful `final`, without first generating the whole answer and splitting it locally.

**Acceptance Scenarios**:

1. **Given** an eligible answer, **when** the provider emits successive content chunks, **then** the client receives corresponding ordered `answer_delta` events before the complete result is available.
2. **Given** a Tool answer, **when** Tool execution and evidence attachment succeed, **then** the existing Tool lifecycle and evidence events precede answer deltas, and the successful `final` follows validation and persistence.
3. **Given** a client disconnect before durable completion, provider failure, timeout, empty output, or invalid chunk, **when** generation stops, **then** no successful `final` is emitted and no partial answer becomes authoritative history. A disconnect after durable completion may be recovered from history.
4. **Given** a delta has reached the client, **when** later validation or persistence fails, **then** that provisional display text cannot be recalled, but no successful `final` or completed assistant history is created.

### User Story 4 — Safe Non-Answer and Recovery (Priority: P1)

As an internal user, I want a clear safe response when the Assistant cannot establish a grounded answer, without fabricated claims or duplicate automatic attempts.

**Independent Test**: Clarification, insufficient evidence, conflict, authorization denial, and risk gates produce their existing safe outcomes with zero LLM factual-generation calls; generation failure never masquerades as a successful answer, and Feature 012 audit-only failure after durable completion is separately observable without undoing that answer.

**Acceptance Scenarios**:

1. `CLARIFY`, `INSUFFICIENT`, conflict, invalid grounding, no covered lane, policy/permission denial without independently covered evidence, and risk/approval gates never become factual `answered` decisions through model output.
2. A failed or cancelled generation may use a safe deterministic failure response but cannot reuse unvalidated partial text as a final answer.
3. The generation path makes no automatic second provider attempt after its first attempt starts, including implicit SDK/client retries and attempts before the first delta. Repeated client POSTs are separate turns unless a separately proven idempotency contract applies.
4. A Feature 012 generation/completion audit append failure after deterministic approval, output validation, and atomic answer persistence does not revoke the completed answer or block `final`; it is reported through safe operational telemetry. Fail-closed audit semantics for Features 008–011 remain unchanged.

### Edge Cases

- A `PARTIAL` answer has one covered lane and one unsupported, failed, or denied lane.
- Prior evidence becomes stale or unauthorized between the original answer and the follow-up.
- A prompt-injection phrase appears in user text or an otherwise valid document excerpt.
- The model returns an unknown citation, references a ToolCall not supplied to it, emits no text, exceeds output limits, or fails after some deltas.
- The connection closes before generation, mid-stream, after answer validation, or before the final event is delivered.
- Atomic answer persistence fails before completion, or only the Feature 012 audit append fails after completion; a client repeats the POST.

## Requirements

### Functional Requirements

- **FR-001**: The Assistant MUST determine generation eligibility from the existing deterministic coverage and safety decisions before calling an LLM. Only covered `COMPLETE`, covered `PARTIAL`, and eligible `CONTEXT_ONLY` outcomes may generate.
- **FR-002**: The model MUST NOT select capabilities or Tools, form Tool arguments, decide authorization/risk/coverage, resolve conflicts, or promote an ungrounded outcome to `answered`.
- **FR-003**: Generation context MUST include only bounded, source-labeled current request and approved conversation/evidence material. It MUST enforce an aggregate input budget and deterministic truncation while preserving the current question, outcome, and source-reference integrity.
- **FR-004**: Prior assistant text MUST be a completed final answer from the same verified scope and session. Pending, failed, cancelled, foreign, rejected, or unvalidated partial text MUST be excluded. Admitted prior text is conversational context, never factual evidence authority; only currently approved or current-request-revalidated evidence can support an answer.
- **FR-005**: Document prose and user text MUST remain untrusted data. Tool evidence MUST contain only server-approved projected facts; raw Tool/Connector payloads, credentials, tokens, permission details, and pre-projection fields MUST never enter generation context.
- **FR-006**: The finalizer MUST check output length, allowed structure, citation/reference syntax and allowlist membership, unknown EvidenceRef/ToolCall identities, and prohibited authority/reference patterns. Model output MUST NOT create new evidence or authority or change the server-owned coverage/outcome. These checks do not claim deterministic semantic entailment or require a second model judge; grounded quality is assessed with bounded context, prompt contract, fixtures, and adversarial evals.
- **FR-007**: A `PARTIAL` answer MUST distinguish supported from unsupported parts and MUST retain `PARTIAL` coverage in the underlying decision/audit metadata.
- **FR-008**: The Assistant MUST deliver provider-driven `answer_delta` events before provider completion with existing correlation and ordering fields, then at most one successful `final` only after complete validation and durable completion. Deltas are provisional display output that cannot be recalled and MUST NOT become completed history. It MUST retain compatible public event/history shapes.
- **FR-009**: Provider error, timeout, malformed output, empty output, server cancellation, and pre-commit client disconnect MUST terminate generation safely, without successful `final`, completed history, or automatic replay of released text. A post-commit disconnect MUST NOT undo an already durable result and MUST remain recoverable through history.
- **FR-010**: User messages, generated assistant answers, grounding decisions, provider outcomes, failures, and cancellation MUST remain Customer-scoped and correlated by trusted request/session/message identifiers without logging prompt bodies, secrets, raw tokens, or unauthorized evidence. Every LLM invocation MUST attempt append-only audit persistence through the existing audit storage, including failed or cancelled generation; any append failure MUST produce a bounded safe operational failure signal with `AUDIT_PERSISTED=NO`. For a safely completed read-only answer, the Feature 012 completion audit is attempted after core persistence, and an audit-only append failure MUST NOT undo the answer or block `final`. The signal is not successful append-only audit. The minimum safe signal is required for acceptance; a deferred observability-debt marker cannot replace it. This narrow non-blocking rule does not change predecessor fail-closed audits or define a write-operation audit policy.
- **FR-011**: Existing deterministic clarification, no-answer, permission, conflict, confirmation, approval, and escalation behavior MUST remain available and cannot be bypassed by generation.
- **FR-012**: No public contract, Prisma schema, or Feature 008–011 authority change may be assumed by this feature; a necessary change outside these bounds requires separate human review before implementation.

### Key Entities

- **Grounded generation context**: Bounded, trust-labeled projection of the current question, completed conversation, approved evidence, coverage, and allowed references; it is not an execution plan.
- **Generation attempt**: One correlated, abortable request to the existing LLM execution boundary with an outcome of completed, failed, timed out, or cancelled.
- **Validated answer**: Bounded text and only allowlisted source references, eligible for durable finalization without altering the deterministic grounding or coverage decision.
- **Completed conversation exchange**: Same-scope user message plus a durably completed assistant final answer; incomplete or failed attempts are excluded from subsequent generation context.

## Feature 010 Predecessor Amendment

Feature 010's `feature010-no-llm-generation.spec.ts` established zero `generateAnswer()` calls even for covered answers. Feature 012 **explicitly supersedes only that generation-only invariant**. Its replacement is: only deterministic generation-eligible grounded outcomes may call `generateAnswer()` or the same provider's streaming equivalent. Zero model authority over capability resolution, Tool selection/arguments, permission, policy, coverage, clarification, no-answer, and evidence conflict remains permanent. Existing predecessor tests must be classified and amended deliberately during later authorized implementation, not silently broken in this documentation round.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In deterministic Tool, RAG, Hybrid, and context-only fixtures, 100% of successful generated answers cite only approved references and preserve the pre-generation coverage outcome.
- **SC-002**: In tested `CLARIFY`, `INSUFFICIENT`, conflict, no-covered-lane, permission-only-denied, and risk-gated fixtures, factual LLM generation count is zero and no unauthorized Tool/customer request is introduced.
- **SC-003**: In a timed controlled-provider fixture, at least two answer deltas are observable before provider completion, and exactly one successful final follows validation and persistence.
- **SC-004**: In pre-commit failure, timeout, cancellation, malformed-output, and persistence-failure fixtures, successful-final count and completed-history count are both zero; a distinct post-commit transport-loss fixture finds the completed answer through history.
- **SC-005**: A two-Customer isolation suite with colliding organization, HostApp, actor, and source identifiers yields zero cross-Customer generation-context or citation leakage.
- **SC-006**: Generation context never exceeds its documented aggregate budget; the same inputs always select and truncate the same sources in the same order.
- **SC-007**: Existing public SSE and history compatibility suites, plus applicable Feature 008–011 authorization, evidence, coverage, and audit suites, remain green except for the explicitly amended Feature 010 generation-only assertion and the separately documented pre-existing manifest-hash caveat.
- **SC-008**: In a Feature 012 post-commit audit-only failure fixture, the completed answer remains in history, a successful `final` is permitted, and the failure is safely observable; predecessor audit-failure regressions remain fail closed.
- **SC-009**: In generation error/timeout fixtures, the provider request count is one from first attempt through termination, including the SDK/client layer; no automatic retry occurs before or after a delta.

## Assumptions and Non-Goals

- V1 uses the existing LLM/provider/Gateway architecture and a new projection over `GroundedContextBundleV1`; implementation details and numerical budgets belong to `design.md`.
- No automatic model-based intent classification, summarization, memory extraction, cross-session memory, vector conversation memory, model routing, prompt caching, or background generation is included.
- No Agent/ADK loop, autonomous Tool use, write capability, Connector change, or keyword-to-vector RAG migration is included.
- Feature 011 Phase G/H/I, its legacy-semantic retirement, and the existing Feature 010 `5/6` manifest-hash caveat are deferred predecessor work, not silently accepted as complete.
- Constitution C6 (version 3.0.0) requires an append-only audit attempt for every LLM invocation and safe observation of the narrowly scoped post-completion read-only storage failure. The Feature 012 rule follows that distinction; Features 008–011 retain their fail-closed audit gates, and future write-operation policy remains separately governed.
- Human review of this specification, design, and plan precedes task generation; task execution requires separate authorization.

FEATURE012_C6_CONFLICT=RESOLVED
FEATURE012_SPEC_STATUS=READY_FOR_HUMAN_APPROVAL
