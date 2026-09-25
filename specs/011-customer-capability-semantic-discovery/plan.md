# Implementation Plan: Feature 011 — Customer Capability Catalog & Semantic Discovery

**Date**: 2026-09-21 | **Spec**: `specs/011-customer-capability-semantic-discovery/spec.md`

**Git workflow boundary**: Git branch management is human-owned and outside Feature 011 Spec Kit artifact generation. Generating `spec.md`, `design.md`, `plan.md`, or `tasks.md` must not inspect or depend on branch state and must not create, switch, rename, merge, or rebase branches. Before separately authorizing execution of T001 or any later implementation task, the human ensures the desired branch is active. `FEATURE011_IMPLEMENTATION_AUTHORIZED=NO` remains in effect until that separate authorization.

**Input**: The approved Feature 011 specification and design in this directory.

## Summary

Implement immutable file-backed capability packs, a startup-loaded scoped registry, deterministic `zh-TW` semantic resolution, typed canonical parameters, complete binding-accounting validation, and a narrow Feature 010 integration. Cut over atomically from ToolDefinition discovery metadata to capability-pack authority after pack-backed coverage passes.

No public Assistant contract, Prisma model, Connector manifest, `GroundedContextBundleV1`, or final-answer behavior changes.

## Technical Context

**Language/Version**: TypeScript 6 on Node.js 22

**Primary Dependencies**: NestJS 11, Prisma 7, class-validator/class-transformer, existing ToolRegistry and AuditEvent infrastructure

**Storage**: Immutable JSON deployment files loaded into memory; existing PostgreSQL ToolDefinition, CustomerToolPolicy, query-understanding, and audit storage remain unchanged

**Testing**: Jest 30 with unit, contract, integration, and eval suites

**Target Platform**: Backend web service on Linux/container and local Node.js development

**Project Type**: NestJS Backend in the existing monorepo

**Performance Goals**: Bounded in-memory catalog lookup and deterministic resolution; at most 32 materialized candidates and five ambiguity references per request

**Constraints**: Fail closed; exact verified Customer/integration/HostApp scope; zero LLM calls; no hot reload, database control plane, executable pack content, global candidate pool, or legacy discovery fallback

**Scale/Scope**: Per pack: 256 KiB, 128 capabilities, 256 bindings, 16 HostApps, and the remaining approved bounds in `design.md`

**Approved invariants**:

```text
PACK_PERSISTENCE=IMMUTABLE_JSON_FILES
PRISMA_CHANGE_REQUIRED=NO
MODEL_ASSISTED_MATCHING_USED=NO
APPLICATION_SEMANTIC_LOCALE=zh-TW
CUSTOMER_BUSINESS_SEMANTICS_IN_CORE=FORBIDDEN
TOOL_KEY_SEMANTIC_INFERENCE_REQUIRED=NO
GLOBAL_CROSS_CUSTOMER_CANDIDATE_POOL=FORBIDDEN
EVERY_RESOLVED_PARAMETER_ACCOUNTED_FOR=YES
SILENT_CANONICAL_PARAMETER_DROP=FORBIDDEN
FEATURE008_TOOL_AUTHORITY_PRESERVED=YES
FEATURE009_CONNECTOR_AUTHORITY_PRESERVED=YES
FEATURE010_RETRIEVAL_AUTHORITY_PRESERVED=YES
GROUNDED_CONTEXT_BUNDLE_V1_PRESERVED=YES
FINAL_LLM_SYNTHESIS_IN_FEATURE011=NO
```

## Constitution Check

- **C1 — Maintainable architecture**: PASS. A dedicated capability module separates Customer configuration, generic resolution mechanics, Tool authority, and Connector execution.
- **C2 — Test-first and regression-safe**: PASS. Every phase begins with focused tests and ends at a named gate; Customer isolation and query-understanding evals are mandatory.
- **C3 — Trusted identity boundary**: PASS. Registry selection accepts only verified `customerId`, `integrationId`, and `hostApp`; packs and text cannot establish scope.
- **C4 — Stable embeddable contracts**: PASS. Public HTTP, SSE, SDK, history, identity, and `GroundedContextBundleV1` contracts remain unchanged.
- **C5 — Grounded Tool quality**: PASS. Resolved capabilities re-enter the current Tool lane and retain ToolDefinition, CustomerToolPolicy, permission, projection, and evidence authority.
- **C6 — Full auditability**: PASS. Resolution emits one bounded append-only audit event and fails closed before candidate release if audit persistence fails.
- **C7 — Human control**: PASS. V1 admits read-only Tool capabilities only and does not alter confirmation, approval, or escalation behavior.

No constitutional exception or complexity waiver is required. Re-evaluate these gates after the Feature 010 cutover and again after legacy retirement.

## Internal Interfaces and File Impact

### New capability subsystem

Create under `src/capabilities/`:

- `capability-pack.types.ts`: exact approved V1 pack, capability, semantic metadata, parameter, constraint, mapping, scoped-catalog, and resolution-result contracts.
- `capability-pack.parser.ts`: closed exact-key parser, bounds, identifiers, semantic versions, duplicate detection, and forbidden-field rejection.
- `capability-pack.loader.ts`: parse `ASSISTANT_CAPABILITY_PACK_PATHS_JSON`, validate absolute regular non-symlink files and byte bounds, resolve Tool contracts, and install one complete immutable release during application bootstrap.
- `capability-catalog.registry.ts`: expose only `resolveCatalog({customerId,integrationId,hostApp})`; provide no global enumeration or capability-key-only lookup.
- `capability-semantic-resolver.service.ts`: scoped deterministic normalization, eligibility, scoring, threshold, ambiguity, and exact `zh-TW` profile handling.
- `capability-parameter-resolver.service.ts`: enum and `bounded_string` extraction, alias normalization, conflicts, invalid values, missing values, and inherited-value revalidation.
- `capability-binding-resolver.service.ts`: complete parameter accounting, semantic-constraint matching, mapping/constants, exact Tool version resolution, and Tool input validation.
- `capability-resolution-audit.service.ts`: fail-closed `capability_resolution_completed` audit with bounded safe metadata.
- `capability-resolution.service.ts`: orchestration facade returning `CapabilityResolutionResultV1` only after audit succeeds.
- `capabilities.module.ts`: own loader, registry, resolution services, ToolRegistry, and Audit dependencies.

### Existing Backend integration

Inspect and, only where required by the approved contracts, modify:

- `src/common/config/env.validation.ts` to admit `ASSISTANT_CAPABILITY_PACK_PATHS_JSON` as JSON text; semantic parsing remains in the loader.
- `src/query-understanding/query-understanding.module.ts` and `src/query-understanding/rule-based-query-understanding.pipeline.ts` to inject the capability subsystem and replace request-time Tool discovery at cutover.
- Query-understanding and conversation internal types/services to carry a bounded capability-follow-up frame separately from the existing `ConversationSemanticFrame`. Persist its safe projection in an existing JSON query-understanding field; do not add a Prisma column or place it in `GroundedContextBundleV1`.
- `src/assistant/planning/assistant-planning.service.ts` and its internal types so a resolved candidate retains exact Tool version and typed outcome projection.
- First inspect and reuse the existing exact Tool lookup/version and input-validation APIs in `src/tools/tool-registry.service.ts`. Modify ToolRegistry only if repository evidence proves the current API cannot satisfy the approved exact-version Customer-policy requirement; any change must be the smallest generic extension and must not duplicate registry functionality in Feature 011.
- `src/assistant/runtime/assistant-readonly-runtime.service.ts` to re-resolve the version-pinned Tool and fail with `tool_contract_mismatch` before ToolCall start on drift.
- Existing audit composition only as needed to await the new audit before candidate release.

No public HTTP, SSE, SDK, history, identity, permission, or grounding type changes are permitted.

### Pack and deployment configuration

Add:

- `customer-capability-packs/shinmone-scm-local/1.0.0.json`: product-owned Shinmone pack scoped to the established local identity and monthly Tool.
- `test/fixtures/capability-packs/customer-a-reference.v1.json`: predecessor-compatible test catalog for existing Customer A Tool suites.
- `test/fixtures/capability-packs/customer-b-inventory.v1.json`: distinct Customer B inventory catalog.

Update `.env.example`, `docker-compose.yml`, `Dockerfile`, and local authority documentation/generation only to supply absolute pack paths and make the checked-in pack directory available read-only at runtime. Do not modify Connector manifests or credentials.

### Legacy inventory and retirement impact

Before cutover, perform an exhaustive read-only ownership inventory of every dependency on `ToolDiscoveryService`, `x-assistant-discovery-v1`, global Tool-backed business vocabulary, Tool-name/description semantic discovery, legacy Tool argument binding, and Customer-specific query-understanding special cases. Do not assume the three planned packs exhaust current supported behavior without repository evidence.

After that inventory passes, pack-backed coverage passes, and the atomic cutover completes:

- Remove request-time use of `ToolDiscoveryService`.
- Remove it from `ToolsModule`, then delete its obsolete semantic types, fixtures, and focused tests.
- Remove `x-assistant-discovery-v1` from seeded ToolDefinition input schemas and corresponding fixture assertions.
- Narrow `domain-lexicon.ts`, `default-tokenizer.adapter.ts`, `query-normalizer.ts`, `entity-extractor.ts`, `clarification-need.generator.ts`, and `rule-based-query-understanding.pipeline.ts` by removing Tool-backed Customer vocabulary, SO/WO/SKU assumptions, inventory enrichment, structured-resource special cases, `last_month` handling, and order-specific clarification.
- Retain generic sentence splitting, normalization, risk detection, document/RAG compatibility, page-context/deixis mechanics, Feature 010 follow-up/routing, Tool registry, authorization, projection, and evidence.

## Implementation Phases and Gates

### Phase A — Contracts and closed parser

**Prerequisite**: Approved `spec.md` and `design.md`.

Write `test/contract/feature011-capability-pack.contract.spec.ts` and `test/unit/capability-pack.parser.spec.ts` first, then implement the V1 types and parser.

Validate exact keys and version discriminants; all approved byte, collection, text, identifier, locale, and candidate bounds; safe identifiers and semantic versions; unique normalized aliases, terms, enum aliases, capability keys, binding identities, locales, HostApps, sources, constraints, and targets; forbidden authority/execution fields; scalar-only constants; and the absence of regex, template, callback, or expression languages. Structural binding checks in this phase do not query ToolRegistry.

**Gate A**: Every valid and invalid fixture is deterministic; any unknown field or version rejects the complete pack.

**Must not happen yet**: Startup loading, request wiring, Tool discovery changes, or Customer pack activation.

### Phase B — Atomic loader, registry, and readiness

**Prerequisite**: Gate A.

Implement environment parsing, bootstrap loading, and the scoped registry:

1. Parse the environment value as an ordered JSON string array.
2. Require absolute paths.
3. Use `lstat` and reject symlinks and non-regular files.
4. Read each file once within `MAX_PACK_BYTES=262144`.
5. Parse every file into a temporary release.
6. Expand explicit HostApp allowlists into exact scoped keys.
7. Reject duplicate active scopes/capabilities/bindings and validate referenced exact read-only Tools.
8. Deep-freeze the complete release.
9. Atomically install it only after every file passes.

Use application bootstrap lifecycle after Prisma and ToolRegistry initialization. Invalid configured releases throw before the Backend listens; no partial registry is visible. An empty configured path list may produce an empty ready registry, but every lookup returns `NO_ACTIVE_CAPABILITY_PACK` and cannot execute. Preserve the existing readiness response shape.

The request-facing registry accepts only verified Customer/integration/HostApp scope. It exposes no `listAll`, global iterator, or global capability lookup.

Tests: `test/unit/capability-pack.loader.spec.ts`, `test/unit/capability-catalog.registry.spec.ts`, updated `test/unit/config-validation.spec.ts`, and focused bootstrap/readiness contract coverage.

**Gate B**: Valid releases install atomically; invalid releases prevent startup; Customer A lookup never reads or materializes Customer B data.

**Must not happen yet**: Query-understanding wiring or legacy fallback changes.

### Phase C — Deterministic semantics and canonical parameters

**Prerequisite**: Gate B.

Refactor and reuse existing safe normalization/tokenization primitives:

- Apply Unicode NFKC, Latin lowercase, punctuation separation, and bounded whitespace normalization.
- Keep one generic tokenizer path; remove Customer vocabulary from it only at cutover.
- Select only the exact application-owned `zh-TW` profile.
- Materialize candidates only from the already-selected scoped catalog.
- Enforce required semantic signal groups.
- Apply approved normalized weights: alias `0.35`, required groups `0.35`, optional groups `0.10`, example overlap `0.10`, parameter signal `0.10`.
- Cap candidates at 32, require score `>=0.70`, and return ambiguity for candidates within `0.05`; expose at most five safe references.
- Use bounded token/ngram example overlap without an exact-question branch.

Parameter resolution maps enum aliases only to declared values and admits `bounded_string` values only through Core-owned `SAFE_IDENTIFIER`, the declared maximum length, and literal prefixes. Outcome precedence is conflicting, invalid, missing, then binding selection. Raw invalid/conflicting values never enter typed results or audit. Missing locale/capability recognition produces `NEEDS_CLARIFICATION(CAPABILITY_NOT_RECOGNIZED)` without a capability reference.

Add a bounded internal capability frame alongside—not inside—the existing `ConversationSemanticFrame`. Persist only its safe canonical projection in existing JSON query-understanding storage. Extend the existing Feature 010 follow-up resolver generically to inherit or replace parameters by canonical name and revalidate inherited values against the current scoped pack. Never serialize the companion frame into `GroundedContextBundleV1`.

All Phase C work is additive and compatibility preserving. Exercise capability semantics and the companion frame only through direct subsystem tests before cutover; requests still using the legacy semantic path must retain their current behavior. Do not wire a temporary second request-time authority.

Tests: new semantic/parameter unit suites, `test/eval/feature011-capability-resolution.eval.spec.ts`, updated direct follow-up regressions for inherited, replaced, removed, invalidated, and cross-scope hints, plus focused Feature 010 regressions proving the active legacy request path is unchanged.

**Gate C**: Paraphrases and unseen compositional wording resolve deterministically in direct subsystem coverage; unknown, ambiguous, missing, invalid, and conflicting cases produce approved typed outcomes with zero ToolCalls; `CURRENT_REQUEST_PATH_BEHAVIOR_CHANGED=NO` and focused Feature 010 regressions pass.

**Must not happen yet**: Tool candidate mapping or production cutover.

### Phase D — Binding compatibility and mapping

**Prerequisite**: Gate C.

Implement startup checks for existing mapping/constraint parameters, declared constrained enum values, exactly one static consumption declaration for required parameters, duplicate or dual consumption, duplicate targets, explicit fixed semantics, exact active read-only Tool versions, top-level Tool input targets, statically compatible values, and satisfiable required Tool inputs.

At runtime, require every supplied canonical parameter to be consumed exactly once by `MAPPED_PARAMETER` or `BINDING_SEMANTIC_CONSTRAINT`. Optional unsupplied parameters need no accounting; optional supplied parameters do. Exact-match constraint values. Never remove an unaccounted value: make the binding incompatible. Zero matches yields `CAPABILITY_UNAVAILABLE`; multiple matches fail closed. Re-resolve the exact Tool version and pass the complete arguments through `validateNamedOperation`.

First prove whether existing ToolRegistry exact-version lookup and validation APIs satisfy these requirements. Reuse them when sufficient. Only if they are insufficient, add the smallest generic API extension and focused `test/unit/tool-registry.service.spec.ts` coverage; do not implement a parallel Tool registry in the capability subsystem.

Tests: `test/unit/capability-binding-resolver.spec.ts` and cases for all-mapped, all-constrained, optional-unsupplied, unaccounted, duplicate consumption, invalid constraints, constants, unknown targets, stale versions, and Tool-schema rejection, plus ToolRegistry tests only if its API requires a minimal extension.

**Gate D**: No candidate is released unless complete parameter accounting and exact Tool validation pass.

**Must not happen yet**: Request-path authority switch or old discovery deletion.

### Phase E — Customer packs and direct subsystem acceptance

**Prerequisite**: Gates A–D.

Create and validate all repository-evidenced packs before changing production request authority.

The Shinmone pack declares `work-orders.count`, required enum `timeRange` with `this_month` and `today`, and one binding to `work-orders.monthly-new-count@1.0.0`. It consumes monthly meaning through `timeRange ENUM_VALUE_IN [this_month]` and has `mappings=[]`. `today` is valid but unbound. It contains no route, upstream field, response pointer, credential, Connector reference, or permission.

The Customer B fixture declares distinct inventory vocabulary and a required bounded `itemRef`, then maps it to `sku` for `inventory.stock-on-hand@1.0.0`. It contains no Shinmone dependency or generic Customer branch.

The Customer A compatibility fixture supplies pack-owned equivalents for existing mock Tool routing so Feature 008/010 regression tests do not rely on legacy Tool metadata after cutover.

Test `CapabilityResolutionService`, the scoped registry, parameter handling, binding compatibility, exact Tool resolution, mapping, and typed outcome projection directly. At least three Shinmone monthly paraphrases resolve through the unchanged monthly Tool candidate; missing time clarifies; `today` is unavailable with zero ToolCalls; Customer B maps `itemRef` to `sku`; and all packs use the same Core services. These tests do not route production requests through the new authority.

**Gate E**: Customer packs and direct subsystem acceptance pass; `PACK_BACKED_REFERENCE_COVERAGE=PASS`. The production request path remains legacy and `CURRENT_REQUEST_PATH_BEHAVIOR_CHANGED=NO`.

**Must not happen yet**: Production request-path cutover, a second request-time semantic authority, legacy discovery removal, real Customer endpoint calls, or Connector manifest changes.

### Pre-cutover migration inventory gate

**Prerequisite**: Gate E.

Perform an exhaustive read-only repository inventory before removing request-time legacy discovery. Trace all production, fixture, test, seed, and configuration ownership that depends on:

- `ToolDiscoveryService`;
- `x-assistant-discovery-v1`;
- global Tool-backed business vocabulary;
- Tool-name or Tool-description semantic discovery;
- legacy Tool argument binding; and
- Customer-specific query-understanding special cases.

For every existing Tool-backed semantic capability, record exactly one classification:

- `MIGRATED_TO_CUSTOMER_CAPABILITY_PACK`;
- `EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH`, supported by repository evidence; or
- `BLOCKER_REQUIRES_PACK_BEFORE_CUTOVER`.

Do not infer completeness from the Shinmone, Customer A, and Customer B fixtures. Any `BLOCKER_REQUIRES_PACK_BEFORE_CUTOVER` must receive Customer-owned pack coverage, or be proven not to be a current supported request path, before proceeding. If the inventory identifies another currently supported semantic path, return to Phase E, add its Customer-owned pack and direct acceptance coverage, re-run Gate E, and then re-run this inventory gate.

**Pre-cutover migration gate**: `LEGACY_TOOL_SEMANTIC_DEPENDENCY_INVENTORY=PASS` and `UNMIGRATED_SUPPORTED_TOOL_SEMANTIC_PATHS=0`.

**Stop condition**: If either condition fails, do not cut over.

### Phase F — Atomic Feature 010 request-path cutover and audit

**Prerequisite**: Gate E and the pre-cutover migration gate.

Write integration tests first, then perform one atomic authority switch:

1. Select the catalog from verified Customer/integration/HostApp scope.
2. Extract scoped current-message signals and a provisional capability frame.
3. Run the existing Feature 010 follow-up resolver.
4. Revalidate inherited/replaced values against the current catalog.
5. Produce the final capability, parameters, and binding result.
6. Await `capability_resolution_completed`.
7. Project the result into existing planning inputs.

Projection is closed: `RESOLVED` produces one version-pinned Tool candidate/need; `NEEDS_CLARIFICATION` and `AMBIGUOUS` use the existing `CLARIFY` path; `CAPABILITY_UNAVAILABLE` uses the existing unsupported need and `INSUFFICIENT` path. All non-resolved outcomes execute zero Tools and Customer requests.

Audit only verified scope/correlation, pack/version, outcome, safe capability/binding references, parameter names/statuses, candidate count, bounded reason, and duration. Exclude query text, aliases/examples, parameter values, Tool arguments, tokens, Connector context, credentials, and business data. Audit failure blocks candidate release.

Remove the pipeline call to `ToolDiscoveryService` in the same cutover. Do not add a feature flag or runtime fallback. The old implementation may remain unreachable until Phase H.

**Gate F**: Full Assistant planning routes all outcomes correctly, exact Tool version survives persistence, the scoped capability path is the only Tool-backed semantic authority, the request-time `ToolDiscoveryService` call is absent, and no feature flag, dual authority, or legacy runtime fallback exists.

**Must not happen yet**: Deletion of the now-unreachable legacy implementation; that occurs only in Phase H after cutover and guard coverage.

### Phase G — Architecture and isolation guards

**Prerequisite**: Gate F.

Add a Feature 011 guard scoped to generic production ownership. Detect Customer names/business vocabulary, Customer API paths/fields, exact reference questions, literal Customer/integration/HostApp business branches, Tool-key semantic inference, global catalog enumeration, fallback to legacy discovery, and executable mapping constructs. Explicitly allow Customer pack/configuration paths, Customer integration directories, fixtures, and tests.

Behavioral isolation tests instrument registry access while colliding capability keys, aliases, HostApps, organization IDs, and actor IDs. They must prove foreign catalogs are never read or materialized.

**Gate G**: Static and behavioral guards pass with zero cross-Customer leakage.

### Phase H — Legacy semantic-authority retirement

**Prerequisite**: `PACK_BACKED_REFERENCE_COVERAGE=PASS`, the pre-cutover migration gate, and Gates F–G.

Delete or narrow the unreachable legacy path: remove `ToolDiscoveryService`, its module export, metadata parser, old fixtures/tests, and `x-assistant-discovery-v1` seed/test metadata. Remove Tool-backed Customer terms, identifier assumptions, inventory enrichment, structured-resource special cases, `last_month` logic, and order-specific clarification from generic query understanding. Retain Customer-neutral language/safety mechanics and existing RAG, page-context, follow-up, routing, Tool, authorization, projection, and evidence behavior.

Add a negative regression containing matching legacy Tool metadata but no pack capability; it must not resolve or execute.

**Gate H**: No runtime reference to old discovery metadata remains, while ToolDefinition execution contracts remain unchanged.

### Phase I — Compatibility and final acceptance

**Prerequisite**: Gates A–H.

Run:

- Focused Feature 011 unit, contract, integration, eval, and architecture suites.
- Feature 008 Tool registry, policy, permission, runtime, projection, masking, and EvidenceRef suites.
- Feature 009 transport, Customer B portability, isolation, and Shinmone reference suites, excluding T126–T142.
- Feature 010 context, follow-up, Tool/RAG/Hybrid routing, prior evidence, coverage, no-LLM, public API/SSE/history, and scope-boundary suites.
- `npm run typecheck`.
- Backend and applicable workspace builds.
- Changed-file lint.
- `git diff --check`.

**Gate I**: All predecessor contracts pass, `GroundedContextBundleV1` and public contracts remain unchanged, and final LLM call count remains zero.

## Cutover and Rollback

Before cutover, Gates A–D build and validate the subsystem, Gate E establishes direct pack-backed reference coverage, and the migration inventory proves that no supported Tool semantic path remains unmigrated. The legacy request authority remains active and unchanged throughout this period; the new services are exercised directly and never form a temporary second request-time authority.

```text
Gates A–D pass
→ Gate E Customer packs and direct subsystem acceptance pass
→ PACK_BACKED_REFERENCE_COVERAGE=PASS
→ LEGACY_TOOL_SEMANTIC_DEPENDENCY_INVENTORY=PASS
→ UNMIGRATED_SUPPORTED_TOOL_SEMANTIC_PATHS=0
→ Phase F atomically switches the pipeline to CapabilityResolutionService
→ legacy Tool discovery call is removed in the same change
→ exactly one Tool-backed semantic authority remains
→ no feature flag, dual authority, or runtime fallback exists
→ Phase G proves architecture and isolation guards
→ Phase H deletes unreachable legacy authority
→ Phase I proves predecessor compatibility and final acceptance
```

Development rollback restores the preceding code revision and prior validated pack-path set, then restarts the Backend. Deployment rollback restores the previous immutable pack files and `ASSISTANT_CAPABILITY_PACK_PATHS_JSON`, then restarts. Neither rollback changes Connector manifests, Customer APIs, credentials, ToolDefinitions, or Feature 009 release state.

## Artifact Controls

- This `plan.md` is the only artifact created in the planning stage.
- Approved `spec.md` and `design.md` remain unchanged.
- Do not create `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, `tasks.md`, a checklist, or an agent-context update.
- Skip the optional `speckit-agent-context-update` hook because it would modify `AGENTS.md`.
- Do not stage or commit the plan during this stage.
- Do not perform Prisma work, Connector manifest changes, live Tool invocations, Customer endpoint calls, Feature 012 implementation, write-capability support, hot reload, or Feature 009 T126–T142.
- Human review of `plan.md` is required before authorizing `tasks.md`.
