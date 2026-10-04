# Tasks: Feature 012 — Grounded LLM Conversation & SSE Streaming

**Input**: Human-approved `spec.md`, `design.md`, and `plan.md` in this directory; Constitution 3.0.0 is authoritative.
**Status**: Task generation only. Every task is unchecked; implementation and Phase A require separate human authorization.
**Baseline**: Feature 011 Gate F is complete. Feature 011 T078 and Phases G/H/I remain unexecuted. Feature 010 scope-boundary has the separately known `5/6` Shinmone manifest-hash caveat.

## Format, dependencies, and stop rule

- Checklist entries use `- [ ] TNNN [US?]` with continuous IDs. `[US1]`–`[US4]` refer to the four P1 stories in `spec.md`; shared contracts and Gate tasks have no story label. No `[P]` marker is used because the six approved phases have ordered authority, persistence, and transport dependencies.
- Execute Phase A → B → C → D → E → F. Within each phase, record authentic focused RED evidence before the corresponding minimal GREEN implementation, then focused regressions and that phase's Gate. A previously correct behavior is recorded as existing GREEN, not broken to manufacture RED. A failed Gate leaves its task and all later tasks unchecked.
- Gate C is an intentional non-streaming implementation checkpoint, not final acceptance. Gate D extends the same LLM/provider path; there is no second generation authority or fallback.
- STOP and seek human review if implementation requires a Prisma migration, breaking public HTTP/SSE/SDK/history or `GroundedContextBundleV1` change, Feature 008–011 authority change, Gateway redesign, second LLM/provider architecture, Agent loop, write-capable Tool, long-term memory, automatic summarization, semantic LLM judge, Feature 011 G/H/I, or Feature 009 T126–T142. Do not hide one of these inside another task.
- Git branch management is human-owned. Do not inspect/manage branches, stage, commit, or push as part of these tasks. No real Customer business endpoint or live Tool invocation is needed for acceptance.

## Phase A — Contracts and predecessor amendment

**Goal**: Lock eligibility, internal contracts, and the exact Feature 010 generation-only amendment before wiring a model into the request path.
**Independent test**: Closed eligibility and public-compatibility contracts pass while the production Assistant still makes zero generation calls.

- [ ] T001 [US1] Add RED eligibility cases for covered `COMPLETE`, covered `PARTIAL`, and revalidated `CONTEXT_ONLY`, plus blocked `CLARIFY`, `INSUFFICIENT`, conflict, invalid grounding, no covered lane, risk/approval/confirmation/escalation, and permission-only denial in new `test/unit/feature012-generation-eligibility.spec.ts`; each case must assert a server-owned decision and zero model authority.
- [ ] T002 [US4] Classify and lock predecessor assertions in `test/integration/feature010-no-llm-generation.spec.ts`: identify the covered-path zero-`generateAnswer` assertion for Phase C amendment, and add passing guards for permanent zero `classifyIntent`, zero `summarize`, zero model Tool/capability/permission/coverage authority, and zero factual generation for blocked outcomes; do not change the current request path in Phase A.
- [ ] T003 [US1] Add RED closed-shape and trust-class cases for eligibility, `GroundedGenerationContextV1`, attempt/result, streaming chunk, terminal metadata, and safe failure reasons in new `test/contract/feature012-generation-internal.contract.spec.ts`; reject model-controlled Tool authority, permission/policy snapshots, and raw Connector/Tool payloads.
- [ ] T004 [US1] Define minimal readonly internal generation contracts in new `src/assistant/generation/grounded-generation.types.ts` until T003 passes; defer the provider interface extension to Phase D, keep these contracts internal, and leave `GroundedContextBundleV1` unchanged.
- [ ] T005 [US1] Implement a pure deterministic eligibility gate in new `src/assistant/generation/generation-eligibility.service.ts` until T001 passes; require at least one covered evidence need and preserve the existing no-answer, conflict, risk, and approval decisions without invoking an LLM.
- [ ] T006 [US4] Add contract assertions in `test/contract/feature010-public-compatibility.contract.spec.ts`, `test/contract/grounded-context-bundle.contract.spec.ts`, and new `test/contract/feature012-public-compatibility.contract.spec.ts` that the endpoint, SSE names/envelope/final shape, history shape, and `GroundedContextBundleV1` do not change; these must pass without request-path generation wiring.
- [ ] T007 [US1] Add RED `PARTIAL` and citation-allowlist eligibility fixtures to `test/unit/feature012-generation-eligibility.spec.ts`; prove a denied/unavailable Tool lane with independently covered Document evidence stays eligible only for its covered portion, whereas permission-only denial remains blocked.
- [ ] T008 Run the Phase A focused unit/contract suites and root typecheck, then record `FEATURE012_GATE_A=PASS` and the precise Feature 010 assertion amendment in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md`; STOP unless contracts are closed, public/bundle shapes unchanged, and production request behavior unchanged.

## Phase B — Bounded conversation generation context

**Prerequisite**: Gate A.
**Goal**: Project currently approved evidence and up to four completed same-scope exchanges into a generation-only, trust-labeled context.
**Independent test**: Identical inputs produce byte-for-byte stable bounded output, no foreign/incomplete source enters, and no LLM is called.

- [ ] T009 [US2] Add RED same-scope and collision fixtures in new `test/unit/feature012-generation-context-projector.spec.ts` for verified Customer, session, integration compatibility, organization, HostApp, and actor; foreign text and references must be absent even when other IDs collide.
- [ ] T010 [US2] Add RED completed-answer source tests in `test/unit/feature012-generation-context-projector.spec.ts` and `test/unit/conversation-context-loader.service.spec.ts`; exclude `Pending answer.`, failed, cancelled, rejected, partial-stream, and non-final assistant text while admitting only durably completed final answers.
- [ ] T011 [US2] Add RED bound/order cases in `test/unit/feature012-generation-context-projector.spec.ts` for at most four exchanges, 16 KiB aggregate UTF-8, conservative at-least-one-token-per-byte estimation, 2/4/6/3/1 KiB source allocations, stable evidence selection, chronological presentation, and Unicode-safe truncation; missing required metadata/evidence must fail closed.
- [ ] T012 [US2] Implement the separate projector in new `src/assistant/generation/generation-context-projector.service.ts`, consuming `src/assistant/conversation/conversation-context-loader.service.ts` and `src/assistant/grounding/grounded-context-bundle.service.ts` without turning either into a prompt builder; satisfy T009–T011 with closed trust labels and no whole-bundle serialization.
- [ ] T013 [US2] Add RED prior-reference freshness/authorization and source-guard tests in `test/unit/feature012-generation-context-projector.spec.ts`; only current-request-revalidated EvidenceRefs and source-guarded user/document/final text may enter, never raw Tool or Connector results.
- [ ] T014 [US2] Reuse `src/assistant/grounding/prior-grounded-evidence-eligibility.service.ts` and `src/assistant/conversation/conversation-source-guard.ts` from the projector until T013 passes; prior assistant wording remains conversation context, not an evidence, coverage, permission, capability, or freshness input.
- [ ] T015 [US2] Add a two-Customer integration fixture in new `test/integration/feature012-generation-context-isolation.spec.ts` with colliding organization, HostApp, actor, and source IDs; assert zero cross-Customer text, citation, or EvidenceRef leakage and zero model calls.
- [ ] T016 [US2] Add the prior-answer-100/current-approved-evidence-80 regression to new `test/eval/feature012-grounded-conversation.eval.spec.ts`; assert the projection privileges 80 and cannot promote prior text into covered evidence, then retain the same fixture for the generated-answer Gate F test.
- [ ] T017 Run the Phase B projector/isolation/eval fixtures and applicable Feature 010 context/prior-evidence contracts, then record `FEATURE012_GATE_B=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md`; STOP unless projection is deterministic, bounded, same-scope, and model-free.

## Phase C — Non-streaming grounded-generation checkpoint

**Prerequisite**: Gate B.
**Goal**: Safely generate and durably finalize one eligible answer through the existing LLM/provider path before adding streaming.
**Independent test**: A covered request reaches the existing provider once, yields only allowlisted references and a durable answer, while blocked requests make zero factual model calls.

- [ ] T018 [US1] Add RED Tool, RAG, Hybrid `COMPLETE`/`PARTIAL`, and eligible `CONTEXT_ONLY` request-path cases in new `test/integration/feature012-grounded-generation.spec.ts`; assert deterministic capability, Tool, permission, evidence, and coverage decisions are unchanged before any model call.
- [ ] T019 [US4] Add RED blocked-outcome cases in `test/integration/feature012-grounded-generation.spec.ts` for clarification, insufficient evidence, conflict, invalid bundle, no covered lane, risk/approval, and permission-only denial; assert zero factual `generateAnswer`, `classifyIntent`, and `summarize` calls.
- [ ] T020 [US1] Add RED prompt/projection tests in new `test/unit/feature012-grounded-prompt.spec.ts`; verify the model receives only `GroundedGenerationContextV1`, bounded source-labeled data and allowlisted references, never `JSON.stringify(GroundedContextBundleV1)`, raw Tool/Connector payloads, credentials, or model-controlled authority.
- [ ] T021 [US1] Implement the server-owned prompt projection in new `src/assistant/generation/grounded-generation-prompt.service.ts` until T020 passes; preserve user/document text as delimited untrusted data and prior assistant text as non-evidence context.
- [ ] T022 [US1] Add RED finalizer cases in new `test/unit/feature012-answer-finalizer.spec.ts` for 4 KiB output, 1,024 configured output tokens, allowed structure, citation syntax/allowlist, unknown EvidenceRef/ToolCall IDs, prohibited authority/reference patterns, empty output, non-stop terminal reason, unchanged coverage, and required `PARTIAL` disclosure.
- [ ] T023 [US1] Implement a single server-owned finalization gate in new `src/assistant/generation/grounded-answer-finalizer.service.ts` until T022 passes; validate structure and reference identity without semantic entailment, a claim extractor, or a second LLM judge.
- [ ] T024 [US4] Add RED audit tests in `test/unit/llm-observability.service.spec.ts` and new `test/unit/feature012-generation-audit.spec.ts` for an append-only attempt on every invocation, bounded trusted correlation/outcome metadata, no prompt/output/body logging, and post-commit append success, throw, or never-settling append under a server-owned deadline; throw/deadline expiry must emit `AUDIT_PERSISTED=NO` without revoking a safely completed read-only answer, while predecessor fail-closed behavior remains unchanged.
- [ ] T025 [US4] Extend the single Feature 012 LLM audit path `src/llm/llm-observability.service.ts` → existing `src/audit/audit-writer.service.ts`, using `src/common/logger/structured-logger.service.ts` only for safe failure signaling, until T024 passes; reuse an existing suitable audit timeout/deadline mechanism if present and prove it by test, otherwise enforce one server-owned bounded audit-attempt wait in this path. An append throw or deadline expiry emits a fixed bounded `AUDIT_PERSISTED=NO` signal; no queue, outbox, background retry, second audit service, duplicate persistence owner, or telemetry-as-success is permitted.
- [ ] T026 [US1] Add RED transaction/final-event tests in `test/unit/assistant-message.repository.spec.ts` and `test/unit/assistant-message.service.spec.ts`; successful `GroundingCheck` + `AnswerDecision` + final message content must commit together before `final`, whereas core commit failure yields no successful final or completed history.
- [ ] T027 [US1] Implement scoped core finalization using existing transaction interfaces in `src/assistant/message/assistant-message.repository.ts` and `src/assistant/answer/answer-decision.service.ts` until T026 passes; if current schema cannot reliably distinguish completion, STOP with `PRISMA_SCHEMA_DECISION_REQUIRED` rather than adding a migration or weakening history checks.
- [ ] T028 [US1] Wire one non-streaming generation orchestration seam through `src/assistant/assistant.module.ts`, `src/assistant/message/assistant-message.service.ts`, and existing `src/llm/llm-execution.service.ts`; call `generateAnswer` only after eligibility/projector success, validate before T027 commit, then attempt Feature 012 completion audit through T025's single path with its bounded wait before the current single-delta/final shape. After a safe read-only core commit, audit success records persistence, while append throw or deadline expiry signals `AUDIT_PERSISTED=NO` and cannot solely block successful `final`.
- [ ] T029 [US4] Amend only the covered-path zero-generation assertion in `test/integration/feature010-no-llm-generation.spec.ts` to exactly one eligible generation attempt; keep zero `classifyIntent`/`summarize` authority and every blocked-outcome/no-Tool-authority assertion passing.
- [ ] T030 [US1] Run focused Tool/RAG/Hybrid generation, finalizer, audit, persistence, predecessor, citation, and adversarial prompt/eval suites plus typecheck; record `FEATURE012_GATE_C=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` only if the existing provider path, safe core commit, and narrow C6 post-commit rule pass. This is not final streaming acceptance.

## Phase D — True provider and SSE streaming

**Prerequisite**: Gate C.
**Goal**: Replace the checkpoint's completed-text delivery with provider-native provisional chunks through the existing Backend SSE and Gateway forwarding path.
**Independent test**: A controlled provider causes at least two client-observable deltas before provider completion, then at most one successful post-commit final.

- [ ] T031 [US3] Add RED typed-stream tests in `test/unit/provider-interface-shape.spec.ts` and `test/unit/llm-execution.service.spec.ts` for async chunks, AbortSignal, deadline, byte/token caps, terminal metadata, and normalized safe failures through the existing provider selector.
- [ ] T032 [US3] Add RED OpenAI-native stream tests in `test/unit/openai-provider-shell.spec.ts` for real incremental SDK events, one request on error/timeout even before the first delta, `maxRetries: 0`, abort propagation, and no complete-answer string splitting.
- [ ] T033 [US3] Extend `src/llm/llm-provider.interface.ts`, `src/llm/llm-execution.service.ts`, and `src/llm/openai/openai.provider.ts` to satisfy T031–T032 using the existing client and provider selection; prohibit generation auto-retry at Assistant, wrapper, provider, and SDK layers from the first attempt.
- [ ] T034 [US3] Add RED Backend event-timing/order tests in `test/unit/assistant-message.service.spec.ts` and `test/contract/assistant-messages-sse.contract.spec.ts`; real Tool/evidence events precede provider-driven provisional `answer_delta`, at least two deltas precede provider completion, and successful `final` follows full validation and durable commit.
- [ ] T035 [US3] Introduce a bounded ordered event-producing generation seam in `src/assistant/message/assistant-message.service.ts` and keep `src/assistant/assistant.controller.ts` transport-only; stream each accepted provider chunk immediately while privately accumulating for final validation, without a broad Assistant service refactor or persisting deltas.
- [ ] T036 [US3] Add RED cancellation/error tests in `test/contract/assistant-messages-sse.contract.spec.ts` for HTTP close → Backend abort → `LlmExecutionService` → provider, malformed chunk, provider error, and safe post-stream error event; no failed path may emit a successful `final` or raw exception text.
- [ ] T037 [US3] Propagate request abort and server-owned timeout/output limits through `src/assistant/assistant.controller.ts`, `src/assistant/message/assistant-message.service.ts`, and `src/llm/llm-execution.service.ts` until T036 passes; do not create a second streaming service or public event schema.
- [ ] T038 [US3] Run focused transparency/cancellation tests in `apps/gateway/test/operations/gateway-assistant.controller.spec.ts` and `test/contract/customer-assistant-sse.contract.spec.ts`; if existing `apps/gateway/src/operations/gateway-assistant.controller.ts` cannot forward incremental chunks and cancellation unchanged, STOP with `GATEWAY_STREAMING_AMENDMENT_REQUIRED` instead of redesigning Gateway.
- [ ] T039 [US3] Run provider, Backend SSE, Gateway forwarding, public envelope, no-retry, and typecheck/build focused checks; record `FEATURE012_GATE_D=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` only if ≥2 deltas precede completion, abort reaches the provider, and at most one successful post-commit final exists.

## Phase E — Failure, cancellation, and persistence

**Prerequisite**: Gate D.
**Goal**: Make incomplete generation non-authoritative and safely handle every pre-/post-commit failure boundary.
**Independent test**: Pre-commit failures have no successful final/reusable history; post-commit transport loss is recoverable; all invocations attempt audit and append failures are safely observable.

- [ ] T040 [US4] Add RED failure matrix in new `test/integration/feature012-stream-failure-recovery.spec.ts` for disconnect before/during generation, provider error/timeout, malformed/empty/oversized output, and core transaction failure; assert zero successful final and zero completed reusable history before commit.
- [ ] T041 [US4] Add RED post-commit/pre-final disconnect case in `test/integration/feature012-stream-failure-recovery.spec.ts` and `test/integration/customer-message-history.spec.ts`; the committed answer must remain retrievable through the existing history shape even when SSE `final` was not delivered.
- [ ] T042 [US2] Add RED pending/history-source tests in `test/unit/conversation-context-loader.service.spec.ts`, `test/unit/assistant-history-access.service.spec.ts`, and `test/contract/assistant-message-history.contract.spec.ts`; placeholders and incomplete/failed/cancelled partial output must be excluded from next-turn answer context and completed public history without changing response shape.
- [ ] T043 [US2] Tighten scoped completion predicates in `src/assistant/conversation/conversation-context.repository.ts` and `src/assistant/history/assistant-history-access.service.ts` until T042 passes; require both a completed decision and non-placeholder final text, preserving Feature 010 prior-evidence eligibility.
- [ ] T044 [US4] Add RED audit-outcome tests in `test/unit/feature012-generation-audit.spec.ts` and `test/integration/feature012-stream-failure-recovery.spec.ts`; successful, failed, timed-out, and cancelled generation each attempts append-only audit through the same owner, and both append throw and never-settling append past the server-owned deadline emit only bounded request/session/message/event/reason metadata with `AUDIT_PERSISTED=NO`, without a second persistence attempt or unhandled late rejection.
- [ ] T045 [US4] Complete terminal-outcome audit handling only through `src/llm/llm-observability.service.ts` → existing `src/audit/audit-writer.service.ts`, coordinated by `src/assistant/message/assistant-message.service.ts`, until T044 passes; different event types may share this owner, but Phase C success and Phase E failure/cancellation must not create competing audit subsystems. Only a post-core-commit Feature 012 read-only audit-only throw or bounded-wait expiry permits successful `final`; Feature 008–011 fail-closed gates and future write-capable flows do not inherit this policy.
- [ ] T046 [US3] Add RED abort-race tests in `test/integration/feature012-stream-failure-recovery.spec.ts` for disconnect before commit, after validation/before commit, and after durable commit/before final; no provisional delta becomes completed history and no SSE/DB atomicity claim is made.
- [ ] T047 [US3] Resolve the abort/commit ordering in `src/assistant/message/assistant-message.service.ts` and `src/assistant/message/assistant-message.repository.ts` until T040–T041 and T046 pass; before commit abort safely terminates, after commit history remains authoritative, and no automatic retry/replay occurs.
- [ ] T048 [US4] Add one-request-on-timeout/error and repeated-POST-as-new-turn cases in `test/unit/openai-provider-shell.spec.ts` and `test/integration/feature012-stream-failure-recovery.spec.ts`; do not infer exactly-once idempotency from the non-unique `requestId`.
- [ ] T049 Run failure/cancellation/history, audit-signal, no-retry, predecessor-audit, public-history, typecheck, and focused build checks; record `FEATURE012_GATE_E=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` only if a never-settling append is bounded, append throw/deadline expiry emits the minimum safe C6 signal, a safely committed read-only answer can still reach `final`, one existing LLM audit append owner remains, and all pre-/post-commit invariants pass. If the existing schema/transaction cannot safely distinguish complete from incomplete, STOP with `PRISMA_SCHEMA_DECISION_REQUIRED` and do not add a migration.

## Phase F — End-to-end and compatibility acceptance

**Prerequisite**: Gate E.
**Goal**: Prove grounded conversation and genuine streaming across all authorized read-only lanes without changing predecessor authorities or public contracts.
**Independent test**: The fixed acceptance matrix and applicable Feature 008–011 regressions pass, with only the separately documented Feature 010 manifest-hash caveat.

- [ ] T050 [US1] Add fixed Tool/RAG/Hybrid `COMPLETE`, `PARTIAL`, and `CONTEXT_ONLY` generated-answer cases in new `test/integration/feature012-acceptance.spec.ts`; assert only approved references, unchanged server coverage, covered-only `PARTIAL` wording, no new Tool/Customer request, and unchanged Feature 011 scoped capability/Tool authority.
- [ ] T051 [US2] Add follow-up and two-Customer collision cases in `test/integration/feature012-acceptance.spec.ts` and `test/eval/feature012-grounded-conversation.eval.spec.ts`; current approved inventory 80 must defeat prior assistant text 100, and no foreign text/evidence/citation enters generation.
- [ ] T052 [US4] Add blocked-case matrix in `test/integration/feature012-acceptance.spec.ts` for `CLARIFY`, `INSUFFICIENT`, conflict, invalid grounding, policy/permission-only denial, risk/approval, prompt injection, and unknown citations; factual generation count is zero for blocked decisions and model text never creates authority.
- [ ] T053 [US3] Add timed Backend→Gateway→client SSE acceptance in `test/contract/feature012-public-compatibility.contract.spec.ts` and `apps/gateway/test/operations/gateway-assistant.controller.spec.ts`; ≥2 provider-driven deltas must arrive before completion, Tool/evidence ordering and one post-commit final hold, and public endpoint/event/history shapes remain unchanged.
- [ ] T054 [US4] Add audit-only-failure, provider timeout/error, cancellation, post-commit transport loss, and SDK no-retry acceptance to `test/integration/feature012-acceptance.spec.ts`; distinguish safe telemetry from persisted audit, recover the committed answer through history, and keep predecessor audits fail closed.
- [ ] T055 Run applicable Feature 008 Tool/policy/permission/projection/EvidenceRef, Feature 009 transport/isolation excluding T126–T142, Feature 010 context/coverage/history/prior evidence/public contracts, Feature 011 Gate F scoped capability, and existing LLM suites; record exact commands/results and the known Feature 010 `5/6` manifest caveat separately in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` without calling it full repository acceptance.
- [ ] T056 Run the full Feature 012 unit/integration/contract/eval matrix, root typecheck, Backend and Gateway builds, changed-file lint, and `git diff --check`; inspect production paths for no second provider/LLM service, no Gateway redesign, no public/bundle/Prisma change, and no unauthorized real endpoint/Tool call, recording evidence in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md`.
- [ ] T057 Verify every Phase A–F Gate and hard stop against Constitution 3.0.0, then record `FEATURE012_GATE_F=PASS` and the reserved final markers below in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` only if T050–T056 are GREEN; otherwise leave Gate F and later state unchecked for human review.

## Story coverage and execution strategy

| Story | Direct task coverage | Independent acceptance |
| --- | --- | --- |
| US1 natural grounded answer | T001, T003–T005, T007, T018, T020–T023, T026–T028, T030, T050 | Covered Tool/document/Hybrid answers use only approved references and preserve control-plane decisions. |
| US2 safe multi-turn conversation | T009–T016, T042–T043, T051 | Four-or-fewer complete same-scope exchanges; current evidence wins; no foreign or incomplete context. |
| US3 incremental answer delivery | T031–T038, T046–T047, T053 | Provider-driven deltas arrive before completion, cancel propagates, final follows durable validation. |
| US4 safe non-answer/recovery | T002, T019, T024–T025, T029, T040–T041, T044–T045, T048, T052, T054 | Blocked outcomes do not factually generate; failures do not create completed answers; all LLM invocations attempt audit. |

Phase A–B establish contracts and projection; Phase C is the first grounded-answer implementation checkpoint; Phases D–E make its streaming and completion safe; Phase F is final feature acceptance. No phase is implicitly authorized by task generation. The only parallel opportunities are isolated test-fixture authoring after the preceding Gate; core authority, transaction, provider, and transport tasks remain sequential.

## Reserved Gate F markers — not current results

Set these values **only after T057 passes**, never merely because `tasks.md` exists:

```text
FEATURE012_GATE_F=PASS
FEATURE012_TRUE_STREAMING=YES
FEATURE012_PROVIDER_DRIVEN_DELTAS=YES
FEATURE012_LLM_TOOL_AUTHORITY=NO
FEATURE012_LLM_COVERAGE_AUTHORITY=NO
FEATURE012_PRIOR_ASSISTANT_TEXT_IS_EVIDENCE=NO
FEATURE012_PROVIDER_AUTORETRY=DISABLED
FEATURE012_ALL_LLM_CALLS_AUDIT_ATTEMPTED=YES
FEATURE012_READONLY_AUDIT_FAILURE_BLOCKS_ANSWER=NO
FEATURE012_PREDECESSOR_AUDIT_SEMANTICS_CHANGED=NO
FEATURE012_PUBLIC_CONTRACT_BREAKING_CHANGE=NO
FEATURE012_PRISMA_MIGRATION=NO
```

**Current task-generation state**: `FEATURE012_TASKS_STATUS=READY_FOR_HUMAN_REVIEW`; `FEATURE012_IMPLEMENTATION_STARTED=NO`; `FEATURE012_FIRST_AUTHORIZED_PHASE=NONE`.
