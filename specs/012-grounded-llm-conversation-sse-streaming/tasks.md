# Tasks: Feature 012 — Grounded LLM Conversation & SSE Streaming

**Input**: Human-approved `spec.md`, `design.md`, and `plan.md` in this directory; Constitution 3.0.0 is authoritative.
**Status**: Phases A–E Gates A–E passed; T001–T049 complete. T050 is the first unexecuted task; Phase F is not authorized.
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

- [x] T001 [US1] Add RED eligibility cases for covered `COMPLETE`, covered `PARTIAL`, and revalidated `CONTEXT_ONLY`, plus blocked `CLARIFY`, `INSUFFICIENT`, conflict, invalid grounding, no covered lane, risk/approval/confirmation/escalation, and permission-only denial in new `test/unit/feature012-generation-eligibility.spec.ts`; each case must assert a server-owned decision and zero model authority.
- [x] T002 [US4] Classify and lock predecessor assertions in `test/integration/feature010-no-llm-generation.spec.ts`: identify the covered-path zero-`generateAnswer` assertion for Phase C amendment, and add passing guards for permanent zero `classifyIntent`, zero `summarize`, zero model Tool/capability/permission/coverage authority, and zero factual generation for blocked outcomes; do not change the current request path in Phase A.
- [x] T003 [US1] Add RED closed-shape and trust-class cases for eligibility, `GroundedGenerationContextV1`, attempt/result, streaming chunk, terminal metadata, and safe failure reasons in new `test/contract/feature012-generation-internal.contract.spec.ts`; reject model-controlled Tool authority, permission/policy snapshots, and raw Connector/Tool payloads.
- [x] T004 [US1] Define minimal readonly internal generation contracts in new `src/assistant/generation/grounded-generation.types.ts` until T003 passes; defer the provider interface extension to Phase D, keep these contracts internal, and leave `GroundedContextBundleV1` unchanged.
- [x] T005 [US1] Implement a pure deterministic eligibility gate in new `src/assistant/generation/generation-eligibility.service.ts` until T001 passes; require at least one covered evidence need and preserve the existing no-answer, conflict, risk, and approval decisions without invoking an LLM.
- [x] T006 [US4] Add contract assertions in `test/contract/feature010-public-compatibility.contract.spec.ts`, `test/contract/grounded-context-bundle.contract.spec.ts`, and new `test/contract/feature012-public-compatibility.contract.spec.ts` that the endpoint, SSE names/envelope/final shape, history shape, and `GroundedContextBundleV1` do not change; these must pass without request-path generation wiring.
- [x] T007 [US1] Add RED `PARTIAL` and citation-allowlist eligibility fixtures to `test/unit/feature012-generation-eligibility.spec.ts`; prove a denied/unavailable Tool lane with independently covered Document evidence stays eligible only for its covered portion, whereas permission-only denial remains blocked.
- [x] T008 Run the Phase A focused unit/contract suites and root typecheck, then record `FEATURE012_GATE_A=PASS` and the precise Feature 010 assertion amendment in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md`; STOP unless contracts are closed, public/bundle shapes unchanged, and production request behavior unchanged.

**Phase A execution evidence (2026-10-02)**:

- T001 authentic RED: `npm run test:unit -- --runInBand --runTestsByPath test/unit/feature012-generation-eligibility.spec.ts` failed with `TS2307` only for the not-yet-created eligibility service after fixture typing was corrected. T005 minimal service made the initial 16 assertions GREEN. A subsequent unlinked-evidence assertion was authentic RED (`ELIGIBLE` instead of `INVALID_GROUNDING`), then GREEN after exact covered-need linkage validation.
- T002 `EXISTING_GREEN`: `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-no-llm-generation.spec.ts` passed 6/6. The covered document/Tool/Hybrid/CONTEXT_ONLY zero-`generateAnswer` expectation is the **future Phase C superseded target only**. Zero `classifyIntent`/`summarize` semantic authority and blocked-outcome zero factual generation remain permanent; the production request path still makes no LLM call.
- T003 authentic RED: `npm run test:contract -- --runInBand --runTestsByPath test/contract/feature012-generation-internal.contract.spec.ts` failed on `TS2307` for the not-yet-created internal type module. T004 minimal readonly contracts made it 4/4 GREEN; the provider interface and `GroundedContextBundleV1` were not changed.
- T006 `EXISTING_GREEN` plus focused assertions: endpoint metadata and answer-only SSE envelope/final shape pass 2/2; existing public compatibility and bundle contracts remain GREEN. T007 `EXISTING_GREEN`: denied/unavailable Tool plus covered Document remains `PARTIAL` and exposes only covered references; permission-only denial with no covered lane remains blocked.
- T008 focused Gate A: unit suites 39/39, contract suites 46/46, predecessor integration 6/6, root typecheck PASS. Changed-file lint and `git diff --check` PASS. No Assistant production provider/module wiring, public contract shape, Gateway, Prisma, or Feature 010 bundle change.

```text
FEATURE012_GATE_A=PASS
FEATURE012_COMPLETED_TASK_RANGE=T001-T008
FEATURE012_FIRST_UNEXECUTED_TASK=T009
FEATURE012_PRODUCTION_GENERATION_ENABLED=NO
FEATURE012_PHASE_B_AUTHORIZED=NO
```

## Phase B — Bounded conversation generation context

**Prerequisite**: Gate A.
**Goal**: Project currently approved evidence and up to four completed same-scope exchanges into a generation-only, trust-labeled context.
**Independent test**: Identical inputs produce byte-for-byte stable bounded output, no foreign/incomplete source enters, and no LLM is called.

- [x] T009 [US2] Add RED same-scope and collision fixtures in new `test/unit/feature012-generation-context-projector.spec.ts` for verified Customer, session, integration compatibility, organization, HostApp, and actor; foreign text and references must be absent even when other IDs collide.
- [x] T010 [US2] Add RED completed-answer source tests in `test/unit/feature012-generation-context-projector.spec.ts` and `test/unit/conversation-context-loader.service.spec.ts`; exclude `Pending answer.`, failed, cancelled, rejected, partial-stream, and non-final assistant text while admitting only durably completed final answers.
- [x] T011 [US2] Add RED bound/order cases in `test/unit/feature012-generation-context-projector.spec.ts` for at most four exchanges, 16 KiB aggregate UTF-8, conservative at-least-one-token-per-byte estimation, 2/4/6/3/1 KiB source allocations, stable evidence selection, chronological presentation, and Unicode-safe truncation; missing required metadata/evidence must fail closed.
- [x] T012 [US2] Implement the separate projector in new `src/assistant/generation/generation-context-projector.service.ts`, consuming `src/assistant/conversation/conversation-context-loader.service.ts` and `src/assistant/grounding/grounded-context-bundle.service.ts` without turning either into a prompt builder; satisfy T009–T011 with closed trust labels and no whole-bundle serialization.
- [x] T013 [US2] Add RED prior-reference freshness/authorization and source-guard tests in `test/unit/feature012-generation-context-projector.spec.ts`; only current-request-revalidated EvidenceRefs and source-guarded user/document/final text may enter, never raw Tool or Connector results.
- [x] T014 [US2] Reuse `src/assistant/grounding/prior-grounded-evidence-eligibility.service.ts` and `src/assistant/conversation/conversation-source-guard.ts` from the projector until T013 passes; prior assistant wording remains conversation context, not an evidence, coverage, permission, capability, or freshness input.
- [x] T015 [US2] Add a two-Customer integration fixture in new `test/integration/feature012-generation-context-isolation.spec.ts` with colliding organization, HostApp, actor, and source IDs; assert zero cross-Customer text, citation, or EvidenceRef leakage and zero model calls.
- [x] T016 [US2] Add the prior-answer-100/current-approved-evidence-80 regression to new `test/eval/feature012-grounded-conversation.eval.spec.ts`; assert the projection privileges 80 and cannot promote prior text into covered evidence, then retain the same fixture for the generated-answer Gate F test.
- [x] T017 Run the Phase B projector/isolation/eval fixtures and applicable Feature 010 context/prior-evidence contracts, then record `FEATURE012_GATE_B=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md`; STOP unless projection is deterministic, bounded, same-scope, and model-free.

**Phase B execution evidence (2026-10-03)**:

- T009–T011 authentic RED: the new projector suite initially failed with `TS2307` solely because the projector did not yet exist; the completed-answer loader test independently failed because final text was absent. T012 and the narrow repository/loader source projection made those cases GREEN. Completed final text is held in a generation-only companion field, not in `GroundedContextBundleV1.boundedRecentTurns`; missing integration provenance is excluded. No Prisma change was needed.
- T013–T014 focused RED/GREEN: a prior EvidenceRef without current-request revalidation and covered metadata without a citation fail closed. The projector accepts only the existing prior-grounded service result, reuses the existing conversation source guard, and copies only declared projected Tool scalars. Prior Assistant prose remains conversation-only.
- T015–T016: two-Customer collision integration and prior-answer-100/current-approved-evidence-80 direct eval PASS. The predecessor Hybrid `PARTIAL` and `INSUFFICIENT` zero-generation assertions are separated without changing request-time behavior.
- T017 Gate B: focused unit 69/69, contracts 63/63, integration 15/15, eval 1/1; root typecheck, changed-file lint, and `git diff --check` PASS. Static check confirms the projector is not imported into the Assistant request path and no production LLM generation was enabled.

```text
FEATURE012_GATE_A=PASS
FEATURE012_GATE_B=PASS
FEATURE012_COMPLETED_TASK_RANGE=T001-T017
FEATURE012_FIRST_UNEXECUTED_TASK=T018
FEATURE012_PRODUCTION_GENERATION_ENABLED=NO
FEATURE012_PHASE_C_AUTHORIZED=NO
```

## Phase C — Non-streaming grounded-generation checkpoint

**Prerequisite**: Gate B.
**Goal**: Safely generate and durably finalize one eligible answer through the existing LLM/provider path before adding streaming.
**Independent test**: A covered request reaches the existing provider once, yields only allowlisted references and a durable answer, while blocked requests make zero factual model calls.

- [x] T018 [US1] Add RED Tool, RAG, Hybrid `COMPLETE`/`PARTIAL`, and eligible `CONTEXT_ONLY` request-path cases in new `test/integration/feature012-grounded-generation.spec.ts`; assert deterministic capability, Tool, permission, evidence, and coverage decisions are unchanged before any model call.
- [x] T019 [US4] Add RED blocked-outcome cases in `test/integration/feature012-grounded-generation.spec.ts` for clarification, insufficient evidence, conflict, invalid bundle, no covered lane, risk/approval, and permission-only denial; assert zero factual `generateAnswer`, `classifyIntent`, and `summarize` calls.
- [x] T020 [US1] Add RED prompt/projection tests in new `test/unit/feature012-grounded-prompt.spec.ts`; verify the model receives only `GroundedGenerationContextV1`, bounded source-labeled data and allowlisted references, never `JSON.stringify(GroundedContextBundleV1)`, raw Tool/Connector payloads, credentials, or model-controlled authority.
- [x] T021 [US1] Implement the server-owned prompt projection in new `src/assistant/generation/grounded-generation-prompt.service.ts` until T020 passes; preserve user/document text as delimited untrusted data and prior assistant text as non-evidence context.
- [x] T022 [US1] Add RED finalizer cases in new `test/unit/feature012-answer-finalizer.spec.ts` for 4 KiB output, 1,024 configured output tokens, allowed structure, citation syntax/allowlist, unknown EvidenceRef/ToolCall IDs, prohibited authority/reference patterns, empty output, non-stop terminal reason, unchanged coverage, and required `PARTIAL` disclosure.
- [x] T023 [US1] Implement a single server-owned finalization gate in new `src/assistant/generation/grounded-answer-finalizer.service.ts` until T022 passes; validate structure and reference identity without semantic entailment, a claim extractor, or a second LLM judge.
- [x] T024 [US4] Add RED audit tests in `test/unit/llm-observability.service.spec.ts` and new `test/unit/feature012-generation-audit.spec.ts` for an append-only attempt on every invocation, bounded trusted correlation/outcome metadata, no prompt/output/body logging, and post-commit append success, throw, or never-settling append under a server-owned deadline; throw/deadline expiry must emit `AUDIT_PERSISTED=NO` without revoking a safely completed read-only answer, while predecessor fail-closed behavior remains unchanged.
- [x] T025 [US4] Extend the single Feature 012 LLM audit path `src/llm/llm-observability.service.ts` → existing `src/audit/audit-writer.service.ts`, using `src/common/logger/structured-logger.service.ts` only for safe failure signaling, until T024 passes; reuse an existing suitable audit timeout/deadline mechanism if present and prove it by test, otherwise enforce one server-owned bounded audit-attempt wait in this path. An append throw or deadline expiry emits a fixed bounded `AUDIT_PERSISTED=NO` signal; no queue, outbox, background retry, second audit service, duplicate persistence owner, or telemetry-as-success is permitted.
- [x] T026 [US1] Add RED transaction/final-event tests in `test/unit/assistant-message.repository.spec.ts` and `test/unit/assistant-message.service.spec.ts`; successful `GroundingCheck` + `AnswerDecision` + final message content must commit together before `final`, whereas core commit failure yields no successful final or completed history.
- [x] T027 [US1] Implement scoped core finalization using existing transaction interfaces in `src/assistant/message/assistant-message.repository.ts` and `src/assistant/answer/answer-decision.service.ts` until T026 passes; if current schema cannot reliably distinguish completion, STOP with `PRISMA_SCHEMA_DECISION_REQUIRED` rather than adding a migration or weakening history checks.
- [x] T028 [US1] Wire one non-streaming generation orchestration seam through `src/assistant/assistant.module.ts`, `src/assistant/message/assistant-message.service.ts`, and existing `src/llm/llm-execution.service.ts`; call `generateAnswer` only after eligibility/projector success, validate before T027 commit, then attempt Feature 012 completion audit through T025's single path with its bounded wait before the current single-delta/final shape. After a safe read-only core commit, audit success records persistence, while append throw or deadline expiry signals `AUDIT_PERSISTED=NO` and cannot solely block successful `final`.
- [x] T029 [US4] Amend only the covered-path zero-generation assertion in `test/integration/feature010-no-llm-generation.spec.ts` to exactly one eligible generation attempt; keep zero `classifyIntent`/`summarize` authority and every blocked-outcome/no-Tool-authority assertion passing.
- [x] T030 [US1] Run focused Tool/RAG/Hybrid generation, finalizer, audit, persistence, predecessor, citation, and adversarial prompt/eval suites plus typecheck; record `FEATURE012_GATE_C=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` only if the existing provider path, safe core commit, and narrow C6 post-commit rule pass. This is not final streaming acceptance.

**Historical Phase C attempt evidence (2026-10-04; not the current state)**:

- Current T018–T019 review: the combined Feature 010 grounded retrieval, LLM-boundary, and Feature 012 request-path suites passed 32/32. T019's request-path matrix now covers CLARIFY, valid-but-unbound INSUFFICIENT, deterministic Tool evidence conflict, rejected Document provenance, no covered Document lane, confirmation, approval, and permission-only denial; each asserts zero `generateAnswer`, `classifyIntent`, and `summarize`. The conflict case reaches an executed ToolCall; the invalid-grounding case reports `DOCUMENT_EVIDENCE_PROVENANCE_INVALID`; the unbound case reports `NO_COMPATIBLE_ACTIVE_BINDING`. T019 added test-only fixture arrangements; no production semantic behavior changed.
- Current first unproven task is T020. Prompt, finalizer, eligibility, context, audit, observability, and core-completion focused unit suites passed 41/41, but the current prompt test does not directly exercise all T020 forbidden raw-authority inputs and whole-bundle non-serialization requirements. The finalizer test also does not directly assert the T022 1,024 output-token configuration. Existing terminal-audit tests cover COMPLETED append success, throw, and never-settling deadline, but there is no direct FAILED or CANCELLED append-attempt evidence for T024. These later gaps were observed during review only; no T020+ task (apart from the separately completed T029) or T030 Gate was claimed. Separate authorization is needed before Gate C final acceptance.

- T029 formal amendment: `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-no-llm-generation.spec.ts --silent` passed 7/7. Covered Document, Tool, Hybrid COMPLETE, Hybrid PARTIAL, and CONTEXT_ONLY follow-up each assert exactly one generation attempt; CONTEXT_ONLY seed and follow-up are checked separately with no new retrieval or ToolCall. CLARIFY and INSUFFICIENT remain zero-generation; `classifyIntent` and `summarize` remain zero for every case. The deterministic test stub prevents entry into the real provider. Changed-file lint and `git diff --check` passed.
- T018–T028 review found the first unproven task at T019: `test/integration/feature012-grounded-generation.spec.ts` does not yet contain request-path zero-generation cases for conflict, invalid bundle, no covered lane, or risk/approval as T019 requires. Some of these have pure eligibility-unit coverage, which does not satisfy T019's explicit request-path requirement. T019 and T030 remain unchecked; Gate C is blocked pending separate authorization to close this predecessor task gap.

- T018 request-path RED was observed: the covered Document request returned HTTP 200 while `generateAnswer` was called zero times. Temporary cutover wiring made the new focused Tool/RAG/Hybrid cases GREEN; that wiring and the covered-path Feature 010 assertion amendment were withdrawn when predecessor validation failed. The current Assistant request path remains the Gate B zero-generation path.
- Direct prompt/finalizer and single-owner audit RED suites first failed on missing modules/methods, then became GREEN. Focused unit suites: 7/7 suites, 22/22 tests; direct transaction completion and integration audit-only failure cases also passed during the temporary wiring trial. These are partial task evidence, not T018–T029 completion.
- The applicable Feature 010 predecessor `feature010-grounded-retrieval.spec.ts` failed 6/10 on legacy synthetic Customer A Tool/follow-up questions. The exact same 6/10 failure reproduced after the Phase C request-path wiring was removed. Its first mismatch is pre-generation `CAPABILITY_NOT_RECOGNIZED` for a legacy inventory phrasing absent from the current scoped pack semantic signals; resolving it would require a separate predecessor/fixture decision, not a Feature 012 model change. No Customer pack was modified.
- Focused public/bundle contracts passed 46/46; root typecheck and Backend build passed during the trial. The incomplete Gate C has not been represented as PASS. T018–T030 remain unchecked; T031+ was not executed.

```text
FEATURE012_GATE_C=NOT_PASSED
FEATURE012_PRODUCTION_GENERATION_ENABLED=NO
FEATURE012_FIRST_INCOMPLETE_TASK=T018
FEATURE012_PHASE_D_AUTHORIZED=NO
```

**Current Phase C Gate C acceptance evidence (2026-10-04; authoritative)**:

- T020–T021: direct projected-bundle sentinel test proves no whole-bundle serialization or forbidden raw authority reaches the prompt. Four trust labels, prior Assistant non-evidence instruction, current allowlisted references, adversarial delimiter handling, 16 KiB bound, and `maxOutputTokens=1024` pass. Existing production prompt implementation required no change.
- T022–T023: finalizer directly rejects empty, non-stop, malformed/foreign citation or Tool reference, and prohibited authority formats; exact 4 KiB boundary, unchanged coverage, and server-owned `PARTIAL` disclosure pass. Provider unit coverage verifies `max_output_tokens: 1024` and `maxRetries: 0`. Existing deterministic finalizer required no change.
- T024–T025: COMPLETED, FAILED, and CANCELLED each attempt exactly one append through `LlmObservabilityService` → existing `AuditWriter`. Throw and never-settling append yield a fixed safe `AUDIT_PERSISTED=NO` signal under the server-owned two-second deadline, without retry or a second persistence owner. Existing production audit implementation required no change.
- T026–T028: existing scoped transaction and direct tests establish GroundingCheck, AnswerDecision, and final message completion before successful `final`; failed core commit leaves no completed history or successful final. The existing single non-streaming Assistant generation seam required no source change in this evidence sweep. No provider-native streaming or Assistant generation retry was added.
- T030: focused Phase C unit suites 66/66; Tool/RAG/Hybrid, predecessor, monthly follow-up, context-isolation, and Feature 011 integration suites 54/54, including Feature 010 grounded retrieval 10/10, LLM boundary 7/7, and Feature 012 grounded generation 15/15; public/bundle/internal contracts 49/49 applicable tests; direct eval 6/6. The legacy follow-up test needed only a deterministic test-boundary `generateAnswer` mock after its initial 3/4 failure; it then passed 4/4 without weakening its ToolCall/route assertions or entering a real provider. Root typecheck, Backend build, changed-file lint, and `git diff --check` passed. Feature 010 scope-boundary remains 5/6 solely due to the separately known Shinmone manifest hash caveat, not a full 6/6 acceptance. Real provider smoke was not run.

```text
FEATURE012_GATE_C=PASS
FEATURE012_COMPLETED_TASK_RANGE=T001-T030
FEATURE012_FIRST_UNEXECUTED_TASK=T031
FEATURE012_PRODUCTION_GENERATION_ENABLED=YES
FEATURE012_TRUE_STREAMING_ENABLED=NO
FEATURE012_PHASE_D_AUTHORIZED=NO
```

## Phase D — True provider and SSE streaming

**Prerequisite**: Gate C.
**Goal**: Replace the checkpoint's completed-text delivery with provider-native provisional chunks through the existing Backend SSE and Gateway forwarding path.
**Independent test**: A controlled provider causes at least two client-observable deltas before provider completion, then at most one successful post-commit final.

- [x] T031 [US3] Add RED typed-stream tests in `test/unit/provider-interface-shape.spec.ts` and `test/unit/llm-execution.service.spec.ts` for async chunks, AbortSignal, deadline, byte/token caps, terminal metadata, and normalized safe failures through the existing provider selector.
- [x] T032 [US3] Add RED OpenAI-native stream tests in `test/unit/openai-provider-shell.spec.ts` for real incremental SDK events, one request on error/timeout even before the first delta, `maxRetries: 0`, abort propagation, and no complete-answer string splitting.
- [x] T033 [US3] Extend `src/llm/llm-provider.interface.ts`, `src/llm/llm-execution.service.ts`, and `src/llm/openai/openai.provider.ts` to satisfy T031–T032 using the existing client and provider selection; prohibit generation auto-retry at Assistant, wrapper, provider, and SDK layers from the first attempt.
- [x] T034 [US3] Add RED Backend event-timing/order tests in `test/unit/assistant-message.service.spec.ts` and `test/contract/assistant-messages-sse.contract.spec.ts`; real Tool/evidence events precede provider-driven provisional `answer_delta`, at least two deltas precede provider completion, and successful `final` follows full validation and durable commit.
- [x] T035 [US3] Introduce a bounded ordered event-producing generation seam in `src/assistant/message/assistant-message.service.ts` and keep `src/assistant/assistant.controller.ts` transport-only; stream each accepted provider chunk immediately while privately accumulating for final validation, without a broad Assistant service refactor or persisting deltas.
- [x] T036 [US3] Add RED cancellation/error tests in `test/contract/assistant-messages-sse.contract.spec.ts` for HTTP close → Backend abort → `LlmExecutionService` → provider, malformed chunk, provider error, and safe post-stream error event; no failed path may emit a successful `final` or raw exception text.
- [x] T037 [US3] Propagate request abort and server-owned timeout/output limits through `src/assistant/assistant.controller.ts`, `src/assistant/message/assistant-message.service.ts`, and `src/llm/llm-execution.service.ts` until T036 passes; do not create a second streaming service or public event schema.
- [x] T038 [US3] Run focused transparency/cancellation tests in `apps/gateway/test/operations/gateway-assistant.controller.spec.ts` and `test/contract/customer-assistant-sse.contract.spec.ts`; if existing `apps/gateway/src/operations/gateway-assistant.controller.ts` cannot forward incremental chunks and cancellation unchanged, STOP with `GATEWAY_STREAMING_AMENDMENT_REQUIRED` instead of redesigning Gateway.
- [x] T039 [US3] Run provider, Backend SSE, Gateway forwarding, public envelope, no-retry, and typecheck/build focused checks; record `FEATURE012_GATE_D=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` only if ≥2 deltas precede completion, abort reaches the provider, and at most one successful post-commit final exists.

Phase D interrupted-working-tree evidence (2026-10-05):

- T031–T033: existing typed/native stream implementation was retained. A new malformed-terminal-metadata test produced authentic RED (unexpected resolved promise); the existing validator was narrowly tightened and the provider/interface/execution suites passed 23/23. OpenAI native delta, pre-/post-chunk failure, incomplete/error event, SDK AbortSignal, and one-request/no-retry assertions passed. No completed-string splitting or second provider path exists.
- T034–T037: the real Backend HTTP contract passed 11/11, including two client-observed deltas before provider completion, ToolCall/evidence ordering, no premature `final` or AnswerDecision, one final after completion, malformed event, provider error, client disconnect, and 4 KiB output limit. The direct Controller unit test checks eventSink transport; the real `AssistantMessageService` HTTP contract is the authoritative timing test. Provisional text was not persisted as completed content on failure. The test-only single-delta predecessor bridge was not used as native-stream evidence.
- T038: Gateway controller, Backend client, and trust-chain suites passed 99/99. The existing Backend-client test proves reader cancellation aborts the underlying fetch signal; Gateway source was unchanged. Customer-facing SSE contract passed 11/11 with the exact command in an environment permitting a listener; the restricted sandbox attempt stopped at `listen EPERM 0.0.0.0` before assertions.
- T039 interrupted attempt: Phase D unit/contract, Feature 012 generation/context, Feature 011 scoped capability, public/bundle contracts, direct eval, root typecheck, Backend/Gateway builds, changed-file lint, and `git diff --check` passed. The expanded Feature 010 predecessor integration run had 70/74 tests pass but four failures across `feature010-prior-grounded-recall.spec.ts` and `feature010-grounded-bundle-leak.spec.ts`; those same failures reproduced when the two suites ran alone (14/18). Their files and query-understanding/prior-evidence source had no Phase D diff. This was not the known manifest-hash caveat. At that point Gate D was not represented as PASS and T039 remained unchecked pending review of the predecessor failure scope.

```text
FEATURE012_GATE_D_AT_INTERRUPTION=BLOCKED
FEATURE012_COMPLETED_TASK_RANGE_AT_INTERRUPTION=T001-T038
FEATURE012_FIRST_UNEXECUTED_TASK_AT_INTERRUPTION=T039
FEATURE012_TRUE_STREAMING_ENABLED_AT_INTERRUPTION=NO
FEATURE012_PHASE_E_AUTHORIZED_AT_INTERRUPTION=NO
```

T039 authoritative blocker resolution and Gate D acceptance (2026-10-05):

- The original two predecessor suites reproduced 4 failures (14/18). In each case the first divergence occurred on the seed turn before Phase D streaming: the Phase C generation path had no deterministic provider response in these two older integration fixtures, leaving `Pending answer.` and no completed AnswerDecision despite attached evidence. The conversation loader correctly excluded that incomplete exchange; the later Hybrid/Tool follow-up then lacked a prior capability frame and clarified, while the document recall had no prior evidence candidate and re-retrieved. This was a test-fixture gap, not a changed Feature 010 prior-evidence rule or a Phase D timing regression.
- Only `test/integration/feature010-prior-grounded-recall.spec.ts` and `test/integration/feature010-grounded-bundle-leak.spec.ts` gained a test-boundary `generateAnswer` stub returning a fixed, safe complete answer through the existing single-delta predecessor bridge. No original assertion was removed or weakened. The temporary non-sensitive diagnostic prints were removed. No production source, prior-evidence eligibility, context loader, query understanding, pack, or Feature 008–011 authority changed in this resolution.
- Exact focused rerun: `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-prior-grounded-recall.spec.ts test/integration/feature010-grounded-bundle-leak.spec.ts` passed 18/18. The original nine-suite expanded integration command (Feature 012 generation/context, Feature 010 grounded retrieval/no-LLM/follow-up/prior recall/context isolation/bundle leak, Feature 011 capability resolution) passed 74/74.
- Phase D/context unit command passed 56/56; Backend SSE/public/bundle contract command passed 48/48; Gateway controller/Backend-client/trust-chain command passed 99/99; Customer SSE contract passed 11/11 using the listener-capable environment; direct Feature 012/011 eval passed 6/6. Root `npm run typecheck`, Backend `npm run build`, Gateway `npm run build`, lint of all Phase D and the two amended predecessor files, and `git diff --check` passed.
- Existing native-stream evidence remains authoritative: at least two HTTP-observable provider deltas before completion, ToolCall/evidence before deltas, abort through Backend and Gateway to provider, one SDK request with `maxRetries: 0`, no completed partial history, and at most one final after validation and durable core completion. Gateway production source, public SSE/history shape, `GroundedContextBundleV1`, Prisma, and Feature 008–011 authorities were unchanged. Feature 010 scope-boundary's separately known 5/6 Shinmone manifest-hash caveat is not a Gate D predecessor failure and is not called full acceptance.

```text
FEATURE012_GATE_D=PASS
FEATURE012_COMPLETED_TASK_RANGE=T001-T039
FEATURE012_FIRST_UNEXECUTED_TASK=T040
FEATURE012_TRUE_STREAMING_ENABLED=YES
FEATURE012_PHASE_E_AUTHORIZED=NO
```

## Phase E — Failure, cancellation, and persistence

**Prerequisite**: Gate D.
**Goal**: Make incomplete generation non-authoritative and safely handle every pre-/post-commit failure boundary.
**Independent test**: Pre-commit failures have no successful final/reusable history; post-commit transport loss is recoverable; all invocations attempt audit and append failures are safely observable.

- [x] T040 [US4] Add RED failure matrix in new `test/integration/feature012-stream-failure-recovery.spec.ts` for disconnect before/during generation, provider error/timeout, malformed/empty/oversized output, and core transaction failure; assert zero successful final and zero completed reusable history before commit.
- [x] T041 [US4] Add RED post-commit/pre-final disconnect case in `test/integration/feature012-stream-failure-recovery.spec.ts` and `test/integration/customer-message-history.spec.ts`; the committed answer must remain retrievable through the existing history shape even when SSE `final` was not delivered.
- [x] T042 [US2] Add RED pending/history-source tests in `test/unit/conversation-context-loader.service.spec.ts`, `test/unit/assistant-history-access.service.spec.ts`, and `test/contract/assistant-message-history.contract.spec.ts`; placeholders and incomplete/failed/cancelled partial output must be excluded from next-turn answer context and completed public history without changing response shape.
- [x] T043 [US2] Tighten scoped completion predicates in `src/assistant/conversation/conversation-context.repository.ts` and `src/assistant/history/assistant-history-access.service.ts` until T042 passes; require both a completed decision and non-placeholder final text, preserving Feature 010 prior-evidence eligibility.
- [x] T044 [US4] Add RED audit-outcome tests in `test/unit/feature012-generation-audit.spec.ts` and `test/integration/feature012-stream-failure-recovery.spec.ts`; successful, failed, timed-out, and cancelled generation each attempts append-only audit through the same owner, and both append throw and never-settling append past the server-owned deadline emit only bounded request/session/message/event/reason metadata with `AUDIT_PERSISTED=NO`, without a second persistence attempt or unhandled late rejection.
- [x] T045 [US4] Complete terminal-outcome audit handling only through `src/llm/llm-observability.service.ts` → existing `src/audit/audit-writer.service.ts`, coordinated by `src/assistant/message/assistant-message.service.ts`, until T044 passes; different event types may share this owner, but Phase C success and Phase E failure/cancellation must not create competing audit subsystems. Only a post-core-commit Feature 012 read-only audit-only throw or bounded-wait expiry permits successful `final`; Feature 008–011 fail-closed gates and future write-capable flows do not inherit this policy.
- [x] T046 [US3] Add RED abort-race tests in `test/integration/feature012-stream-failure-recovery.spec.ts` for disconnect before commit, after validation/before commit, and after durable commit/before final; no provisional delta becomes completed history and no SSE/DB atomicity claim is made.
- [x] T047 [US3] Resolve the abort/commit ordering in `src/assistant/message/assistant-message.service.ts` and `src/assistant/message/assistant-message.repository.ts` until T040–T041 and T046 pass; before commit abort safely terminates, after commit history remains authoritative, and no automatic retry/replay occurs.
- [x] T048 [US4] Add one-request-on-timeout/error and repeated-POST-as-new-turn cases in `test/unit/openai-provider-shell.spec.ts` and `test/integration/feature012-stream-failure-recovery.spec.ts`; do not infer exactly-once idempotency from the non-unique `requestId`.
- [x] T049 Run failure/cancellation/history, audit-signal, no-retry, predecessor-audit, public-history, typecheck, and focused build checks; record `FEATURE012_GATE_E=PASS` in `specs/012-grounded-llm-conversation-sse-streaming/tasks.md` only if a never-settling append is bounded, append throw/deadline expiry emits the minimum safe C6 signal, a safely committed read-only answer can still reach `final`, one existing LLM audit append owner remains, and all pre-/post-commit invariants pass. If the existing schema/transaction cannot safely distinguish complete from incomplete, STOP with `PRISMA_SCHEMA_DECISION_REQUIRED` and do not add a migration.

**Phase E first-segment execution evidence (2026-10-05; T044–T049 not executed)**:

- Completion authority inspection: generated answers enter an existing scoped transaction that writes GroundingCheck, AnswerDecision, final AssistantMessage text/status, and the protected `answer_generated` audit before returning. SSE deltas precede that transaction but are not persisted as final text. The database commit and client delivery of `final` are distinct; no Prisma migration is needed for this segment.
- T040 authentic RED: `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature012-stream-failure-recovery.spec.ts` initially failed 7/8 cases because pending Assistant rows appeared in public history after pre-commit failures. The completed failure matrix is 11/11 GREEN, including pre-/post-delta provider error, deadline abort, malformed/incomplete stream, native 4 KiB abort, client disconnect, and transaction rollback; each pre-commit case has no completed reusable exchange or successful final.
- T041 existing GREEN plus new transport race: a controlled terminal-audit gate is reached only after the core transaction promise resolves; the test checks persisted AnswerDecision, GroundingCheck, and final content **before** destroying the HTTP client, then verifies no observed `final` and successful history/context recovery with one provider invocation. The separate Customer history integration checks retrieval through the unchanged public shape without SSE replay.
- T042 authentic RED: the conversation loader suite failed because placeholder and inconsistent-decision records entered completed exchanges; history-access test first failed on the absent predicate, and the public history contract failed because pending/provisional messages were returned. T043 adds one shared durable completion predicate: persisted decision ID and GroundingCheck link, matching message decision status, and valid non-placeholder final text. History scans only Customer/session-scoped rows and filters before pagination; an invisible pending cursor is rejected. Deterministic, durably recorded `no_answer` remains eligible as a Feature 010 semantic turn but never as prior factual Assistant wording.
- Regression: Phase E/history/Feature 010 predecessor integration 9 suites, 37/37 PASS; additional Feature 010 conversation/follow-up/persistence integration 4 suites, 16/16 PASS; Phase D/Phase E/prior-evidence unit 8 suites, 62/62 PASS; Backend SSE plus public history contracts 3 suites, 28/28 PASS. The first broad integration attempt hit sandbox `listen EPERM` before assertions; the identical listener-permitted rerun exposed and resolved two test-fixture gaps (synthetic incomplete context record and a legacy history test lacking a deterministic generation stub). Root typecheck, Backend build, changed-file lint, and `git diff --check` PASS. Feature 010's separate 5/6 manifest-hash caveat is unchanged.

**T040–T043 human-review closure (2026-10-05; no T044+ work)**:

- T040 now has two separate additional integration cases: a legal provider `completed(stop)` event with zero text deltas fails the finalizer and leaves no final/decision/reusable history; a deterministic provider-start gate followed by client disconnect **before** its first delta observes provider AbortSignal, zero delta/final, zero completed history/context, and exactly one provider invocation. The original incomplete-terminal and post-delta-disconnect cases remain separate. Focused failure-recovery suite: 13/13 PASS.
- The generated Prisma `AnswerDecisionStatus` also contains `tool_failed`, so its entire value set was not a safe completion allowlist. A direct predicate test and history-access test first failed when matching `tool_failed` message/decision records with valid IDs, grounding link, and non-placeholder text were incorrectly admitted. The shared predicate now explicitly admits `answered`, `clarification_required`, `no_answer`, `permission_denied`, `approval_required`, `confirmation_required`, and `escalation_required` as completed server-owned reply/interaction turns; `tool_failed` and unknown/future failure statuses cannot gain history authority. Deterministic completed `no_answer` remains available to Feature 010 semantic follow-up, not as prior factual Assistant wording.
- Final focused rerun: requested Phase E/Customer-history/Feature 010/Feature 012 predecessor integration 6 suites, 42/42 PASS; completion/context/history/LLM-provider unit 6 suites, 40/40 PASS; Backend SSE and public-history contract 2 suites, 15/15 PASS; root typecheck, Backend build, changed-file lint, `git diff --check`, and untracked-file whitespace checks PASS. No Prisma, public contract, Gateway, grounding bundle, or Feature 008–011 authority change; Gate E remains unevaluated.

```text
COMPLETION_STATUS_ALLOWLIST_SOURCE=EXPLICIT_SERVER_COMPLETED_REPLY_STATUSES
FEATURE012_COMPLETED_TASK_RANGE=T001-T043
FEATURE012_FIRST_UNEXECUTED_TASK=T044
FEATURE012_GATE_E=NOT_YET_EVALUATED
FEATURE012_PHASE_E_AUTHORIZED=YES
```

**Phase E second-segment and Gate E evidence (2026-10-05; T050+ not executed)**:

- T044 authentic RED: focused terminal-audit unit compilation rejected the missing `TIMEOUT` outcome; request-path audit matrix then failed because a provider deadline was persisted as `FAILED`. Existing append throw/deadline handling was GREEN; a new late-rejection case proves one append and no unhandled rejection. T045 adds `TIMEOUT` with bounded `PROVIDER_TIMEOUT`, keeps the sole `AssistantMessageService → LlmObservabilityService → AuditWriterService` append path, and emits a fixed `AUDIT_PERSISTED=NO` signal for append throw or the existing 2-second deadline. Successful read-only core commit plus audit-only failure retains the final. A separate RED proved that post-commit context failure skipped terminal audit; moving that existing attempt immediately after core commit made it GREEN without allowing a successful final for context failure.
- T046 authentic RED: a deterministic test held protected `answer_generated` inside the unfinished core transaction, observed client abort, then released the gate; the old path still committed and recorded `COMPLETED`. T047 passes the abort signal into the existing scoped completion transaction and checks it before the transaction and after its protected audit but before return, so pre-commit cancellation rolls back GroundingCheck, AnswerDecision, final message, and protected audit. Pre-first-delta and post-commit/pre-final disconnect cases remain separate and GREEN; durable DB completion, not SSE delivery, governs recoverable history.
- T048 existing provider-native no-retry behavior remains GREEN with explicit one-request cases before and after a delta and `maxRetries: 0`; the direct deadline test observes one provider request and abort. A repeated POST using the same non-unique `requestId` creates two distinct completed turns and two generation attempts, with no SSE replay or exactly-once claim.
- T049 focused final rerun: Phase E, Feature 010/011 predecessor, Customer history and audit integration 12 suites / 109 tests PASS (`RUN_CUSTOMER_US1_TESTS=true`); unit 11 suites / 67 tests PASS; public/SSE/history contracts 5 suites / 34 tests PASS (`RUN_CUSTOMER_US1_TESTS=true`); Feature 012 eval 1/1 PASS; Gateway SSE/cancellation 2 suites / 55 tests PASS. Root typecheck, Backend build, Gateway build, changed-file lint, and `git diff --check` PASS. The initial full integration run hit sandbox `listen EPERM` before assertions; the same command in a listener-capable execution passed. Feature 010's separate `5/6` manifest-hash caveat remains unchanged. No Prisma, public contract, grounding bundle, Gateway production, or Feature 008–011 authority change.

```text
FEATURE012_T049=PASS
FEATURE012_GATE_E=PASS
FEATURE012_COMPLETED_TASK_RANGE=T001-T049
FEATURE012_FIRST_UNEXECUTED_TASK=T050
FEATURE012_PHASE_E_COMPLETE=YES
FEATURE012_PHASE_F_AUTHORIZED=NO
HUMAN_DECISION_REQUIRED=NO
```

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

**Current implementation state**: Phases A–E Gates A–E PASS; T001–T049 are complete and T050 is the first unexecuted task. Provider-native streaming remains accepted at Gate D. Phase F is not authorized. Earlier interruption and pre-Gate-E statements above are historical evidence, not current state. Reserved Gate F markers above are not current results.
