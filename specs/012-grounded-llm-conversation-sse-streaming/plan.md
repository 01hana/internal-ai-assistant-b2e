# Implementation Plan: Feature 012 — Grounded LLM Conversation & SSE Streaming

**Canonical Feature Path**: `specs/012-grounded-llm-conversation-sse-streaming`
**Date**: 2026-10-02
**Status**: Draft — ready for human approval; implementation not authorized
**Spec**: `specs/012-grounded-llm-conversation-sse-streaming/spec.md`
**Design**: `specs/012-grounded-llm-conversation-sse-streaming/design.md`

## Summary

Introduce grounded natural-language generation only after the existing deterministic control plane has approved covered evidence. Project the current `GroundedContextBundleV1` and at most four complete same-scope exchanges into a bounded generation-only context. Reuse and extend the existing `LlmExecutionService` and OpenAI provider, first proving non-streaming correctness, then enabling provider-driven incremental SSE. Complete and persist a successful assistant answer before sending its final event; failures and pre-commit cancellations never become reusable completed history.

This plan defines future work and acceptance gates. No task in it is authorized by creation of this file.

## Technical Context and Existing Interfaces

- **Platform**: TypeScript 6, NestJS 11 Backend, Prisma/PostgreSQL, OpenAI SDK 6; Jest unit/integration/contract/eval suites. Existing endpoint is `POST /api/v1/assistant/sessions/:id/messages` through Gateway and Backend.
- **Existing generation seam**: `src/llm/llm-execution.service.ts` and its module/provider abstractions. `AssistantModule` does not currently import `LlmModule`; a later authorized Phase C wires the existing module into the Assistant path without adding a second provider registry. The installed OpenAI SDK defaults to two retries, so generation calls require explicit `maxRetries: 0`.
- **Existing evidence seam**: Feature 010 `GroundedContextBundleV1` and prior-evidence revalidation. Bundle shape remains unchanged; the new projection is internal.
- **Existing transport seam**: Gateway already forwards backend `ReadableStream` chunks, cancels on client close, and emits a safe stream error; Backend currently constructs all events then sends them at once. The first required transport change is Backend incremental orchestration, not a new Gateway transport.
- **Existing persistence seam**: user row first, pending assistant row after planning, GroundingCheck/AnswerDecision and message completion currently separate. `requestId` has a message index but no message idempotency uniqueness. No Prisma migration is planned by default.
- **Public interface**: Retain current endpoint, request DTO, SSE names/envelope/sequence semantics, `final` data shape, and history response shape. Internal generation and streaming types may be added under existing Assistant/LLM ownership.

## Constitution Check

**Before planning**: C1 uses the existing LLM/provider and Gateway boundaries; C2 requires test-first success and failure coverage; C3 requires verified Customer scope and no model-supplied authority; C4 requires public SSE/history compatibility; C5 requires evidence and deterministic no-answer; C6 (constitution 3.0.0) requires an append-only audit attempt for every LLM invocation and a safely observable post-completion read-only storage failure, while retaining predecessor fail-closed gates; C7 leaves risk and approval with the existing control plane.

**Post-design check**: Eligibility, bounded trust-labeled projection, provider reuse, finalization transaction, and no-success-final handling preserve C1–C5 and C7. Required audit attempts for successful, failed, and cancelled invocations; a bounded safe failure signal with `AUDIT_PERSISTED=NO`; and unchanged predecessor gates align with amended C6. Safe telemetry is not represented as a successful append-only event. Implementation must prove the minimum signal and that the current schema distinguishes completed from incomplete generation; if not, stop for human decision and set `PRISMA_SCHEMA_DECISION_REQUIRED` only for the schema issue. No migration or public contract amendment is pre-authorized.

## Phase A — Contracts and Predecessor Amendment

Write RED tests for generation eligibility, trust/source categories, citation allowlist, `PARTIAL` wording boundary, and public SSE/history compatibility. Record exactly which assertion in `feature010-no-llm-generation.spec.ts` is superseded: zero `generateAnswer` on covered paths. Retain zero `classifyIntent`/`summarize` semantic authority and zero factual generation for `CLARIFY`, `INSUFFICIENT`, conflict, risk, or uncovered outcomes. Define closed internal `GroundedGenerationContextV1`, eligibility decision, attempt/result, chunk, and failure reason contracts; they must not carry Tool authority or raw Connector material.

**Gate A**: Contract tests distinguish eligible from blocked outcomes; predecessor amendment is explicit; no public or Feature 010 bundle shape changes. No LLM request path is switched yet.

## Phase B — Bounded Conversation Generation Context

Write RED tests for same Customer/session/organization/HostApp/actor scope, capability integration compatibility, four-exchange maximum, chronological presentation, source guard, total byte/token and per-source allocations, deterministic truncation, and rejection of incomplete assistant answer text. Add a generation-only projector consuming the existing context loader, scoped completed assistant answer records, and current bundle. Revalidate prior EvidenceRefs with existing freshness/authorization services; prior assistant text is conversational context only, never evidence or a coverage/freshness/authorization override. Test prior answer inventory 100 against current approved Tool evidence 80: the generated answer must use 80. Do not turn the context loader into a prompt builder or create memory storage. Unit, contract, and two-Customer collision tests must prove no cross-Customer text or source-reference leakage.

**Gate B**: The same inputs yield byte-for-byte stable bounded projection; pending, failed, stale, foreign, and rejected material is absent; no model invocation occurs.

## Phase C — Non-Streaming Grounded Generation Checkpoint

Write RED Tool, RAG, Hybrid `COMPLETE`/`PARTIAL`, `CONTEXT_ONLY`, citation, empty/error/length, core-persistence-failure, and post-commit Feature 012 audit-only-failure tests. Assert an append-only audit attempt for every invocation, including failed/cancelled generation. Import the existing `LlmModule` into Assistant composition, pass only the projected context through `LlmExecutionService.generateAnswer`, and preserve deterministic no-answer/clarification/risk branches. Add one server-owned output/finalization gate for output bounds, allowed structure, citation/reference syntax and allowlist, unknown ToolCall/EvidenceRef identities, prohibited authority/reference patterns, unchanged coverage, and required `PARTIAL` disclosure. Do not promise deterministic semantic entailment or add a second model judge; assess grounded semantic quality with prompt contract, fixtures, and adversarial evals. On successful validation, persist GroundingCheck, AnswerDecision, and assistant final text together, attempt the narrowly scoped Feature 012 completion audit, then emit the existing single-delta/final shape for this intermediate checkpoint. Audit-only failure after core commit does not revoke completion; predecessor audits remain fail closed. Do not enable provider streaming yet.

**Gate C**: One eligible invocation uses the existing provider and produces a grounded validated answer; blocked cases use zero factual model calls; the Feature 010 generation-only predecessor assertion is intentionally replaced while its other invariants pass. This checkpoint is not final V1 acceptance.

## Phase D — Provider and Backend True Streaming

Write controlled-provider RED tests proving at least two chunks reach the client before provider completion, event sequence and Tool/evidence ordering, abort propagation, stream error redaction, Gateway forwarding without buffering, and one provider request even on timeout/error before the first delta. Extend the existing provider interface, OpenAI provider, and `LlmExecutionService` with a typed async stream, AbortSignal, deadline, output bound, terminal metadata, and safe failure normalization. Disable automatic generation retries at every layer, including SDK/client `maxRetries: 0`. The Backend orchestration/controller emits provider-driven provisional deltas incrementally, subject to incrementally checkable bounds/structure/reference syntax, while privately accumulating for complete final validation; it must not wait for the full answer before sending deltas. Do not split a completed string, retry after the first attempt, add a second streaming service, or change public event schemas. Keep Gateway source unchanged if its focused tests prove transparent forwarding; otherwise stop for a narrow reviewed amendment.

**Gate D**: Client observes genuine incremental deltas and cancellation reaches the provider; there is at most one successful final, after durable validated completion.

## Phase E — Failure, Cancellation, and Persistence

Write RED tests for disconnect before/during generation, provider timeout/error, malformed chunk, empty/oversized output, failed core transaction, post-commit Feature 012 audit-only failure, and disconnect after durable commit. Prove failed/cancelled invocations attempt append-only audit at terminal outcome and any append failure emits a bounded safe operational signal with `AUDIT_PERSISTED=NO`. Tighten context and history predicates so incomplete or placeholder assistant rows cannot become next-turn answer authority or leak as completed history. Keep generated deltas ephemeral and acknowledge that delivered provisional text cannot be recalled. Define the post-commit/pre-final delivery race explicitly: history contains the committed answer, and the existing history endpoint supplies recovery, even if the client missed `final`. After core commit, attempt the Feature 012 completion audit; only its audit-only failure leaves the completed read-only answer intact and allows `final`, never arbitrary exception text. A minimum safe failure signal is required for acceptance; if none can be provided, stop rather than treating `DEFERRED_FEATURE012_AUDIT_OBSERVABILITY_DEBT` as a substitute. Do not change Feature 008–011 fail-closed audit semantics or define write-operation policy. Do not claim exactly-once retry from non-unique `requestId`; prohibit automatic provider retry from first attempt and document repeated POST as a separate turn unless a later reviewed idempotency design is approved.

**Hard stop**: If atomic completed/incomplete distinction cannot be made with current schema and transaction interfaces, record `PRISMA_SCHEMA_DECISION_REQUIRED`, halt subsequent phases, and request human review. Do not add a migration or weaken history checks to make tests pass.

**Gate E**: Every pre-commit failure/cancellation yields zero successful final and zero completed assistant history; post-commit transport loss remains recoverable without duplicate automatic generation. Every invocation has an audit attempt. A post-commit Feature 012 audit-only failure remains safely observable with `AUDIT_PERSISTED=NO` but does not block `final` or remove completed history; a successful audit contains bounded outcome metadata, never prompts or sensitive payloads. This gate must prove the minimum safe signal required by amended C6.

## Phase F — End-to-End and Compatibility Acceptance

Run fixed Tool, RAG, Hybrid, `PARTIAL`, `CONTEXT_ONLY`, prior assistant answer versus newer approved evidence, citation, two-Customer isolation, prompt-injection, permission/policy denial, risk/approval, no-answer, and evidence-conflict scenarios. Prove generation uses only approved evidence, no model-driven Tool/capability decision, no public contract drift, no raw/authority leakage, true Gateway-to-client incremental delivery, no automatic generation retry including SDK behavior, and predecessor audit fail-closed compatibility. Run applicable Feature 008 Tool/permission/projection/EvidenceRef, Feature 009 transport/isolation (excluding T126–T142), Feature 010 context/coverage/public compatibility/prior recall, Feature 011 Gate F scoped-capability, existing LLM tests, typecheck, Backend/Gateway builds, changed-file lint, and `git diff --check`. Classify the prior zero-generation assertion as superseded rather than treating its deliberate failure as an unrelated regression. Record the Feature 010 `5/6` manifest-hash caveat separately; never call it full acceptance.

**Gate F**: All authorized Feature 012 acceptance and predecessor safety tests pass; no real Customer business endpoint or live Tool call is required for this proof. Human review remains required before deployment or additional Feature 011 work.

## Rollout, Stops, and Artifact Control

- Phase C is a reversible implementation checkpoint. Phase D switches the same eligible path to streaming only after non-streaming grounding and persistence are proven. No dual generation authority, feature-flag fallback to ungrounded text, or model-driven retrieval path is permitted.
- Amended C6 permits only the safely observable audit-only failure of an otherwise completed read-only grounded answer; it does not make audit attempts optional, change predecessor fail-closed gates, or make telemetry equivalent to persisted audit. A missing minimum safe failure signal stops implementation acceptance.
- Fail closed if a proposed implementation requires changing public HTTP/SSE/SDK/history contracts, `GroundedContextBundleV1`, Prisma schema, Feature 008–011 authority, or Gateway transport beyond verified minimal need. Record the evidence and seek separate human approval.
- Scope excludes autonomous agents, model Tool selection/arguments, memory extraction or summarization, keyword-to-vector migration, write Tools, Feature 011 G/H/I, and Feature 009 T126–T142.
- This planning round creates only `spec.md`, `design.md`, and `plan.md`. It does not create `tasks.md`, checklist/research/data-model/contracts/quickstart artifacts, update `.specify/feature.json` or `AGENTS.md`, execute optional Spec Kit hooks, inspect/manage Git branches, stage, commit, push, or start implementation. After human approval of all three documents, task generation and then task execution each require separate authorization.
