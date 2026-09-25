# Tasks: Feature 011 — Customer Capability Catalog & Semantic Capability Discovery

**Canonical Feature Path**: `specs/011-customer-capability-semantic-discovery`
**Input**: Approved `spec.md`, `design.md`, and `plan.md` in this directory
**Implementation Status**: Not authorized; every task is unexecuted
**Testing Rule**: For each runtime behavior, add the named focused test first, retain authentic RED evidence, then implement and retain GREEN evidence. A failing gate is a hard stop.

## Format and execution boundary

- Every task uses `- [ ] TNNN [P?] [US?] Description with exact path`.
- Task IDs are local to Feature 011 and execute sequentially unless a task explicitly says otherwise.
- Story labels map to the five approved user stories; shared foundation, migration, retirement, and final-acceptance tasks have no story label.
- Creating this file authorizes no task. Do not change any checkbox until separate human authorization begins with T001.
- Git branch management is human-owned and is not inspected or performed by these tasks.

## Canonical implementation order

1. **Phase A** — Contracts and closed parser
2. **Phase B** — Atomic loader, scoped registry, and readiness
3. **Phase C** — Deterministic semantics and canonical parameters
4. **Phase D** — Binding compatibility, complete accounting, and Tool mapping
5. **Phase E** — Customer packs and direct subsystem acceptance
6. **Pre-cutover migration inventory** — Hard stop before production authority changes
7. **Phase F** — Atomic Feature 010 request-path cutover and audit
8. **Phase G** — Architecture and Customer-isolation guards
9. **Phase H** — Unreachable legacy semantic-authority retirement
10. **Phase I** — Predecessor compatibility and final acceptance

---

## Phase A — Contracts and closed parser

**Goal**: Establish exact V1 contracts and fail-closed structural parsing without querying ToolRegistry.

- [ ] T001 Add authentic RED closed-contract fixtures for valid V1 packs, unknown keys, unknown versions, non-plain objects, and whole-pack rejection in `test/contract/feature011-capability-pack.contract.spec.ts`
- [ ] T002 Add authentic RED parser cases for every approved collection/text/byte bound and deterministic rejection in `test/unit/capability-pack.parser.spec.ts`
- [ ] T003 Define the closed immutable pack, capability, semantic profile, parameter, binding, mapping, scoped-catalog, and `CapabilityResolutionResultV1` types in new `src/capabilities/capability-pack.types.ts`
- [ ] T004 Implement plain-object, exact-key, version-discriminant, finite-number, and whole-pack failure primitives in new `src/capabilities/capability-pack.parser.ts` until T001 passes
- [ ] T005 Implement approved collection, text, example, identifier, bounded-string, candidate, and `MAX_PACK_BYTES=262144` constants and enforcement in `src/capabilities/capability-pack.parser.ts` until T002 bounds cases pass
- [ ] T006 Add RED safe-identifier, no-wildcard, BCP-47-shaped locale, and semantic-version cases in `test/unit/capability-pack.parser.spec.ts`, then implement those validations in `src/capabilities/capability-pack.parser.ts`
- [ ] T007 Add RED enum and `bounded_string` parameter cases for canonical values, aliases, required flags, `SAFE_IDENTIFIER`, literal prefixes, and maximum length in `test/unit/capability-pack.parser.spec.ts`, then implement them in `src/capabilities/capability-pack.parser.ts`
- [ ] T008 Add RED semantic-profile cases for exact locale identity, required signal groups, non-empty required terms, and bounded aliases/examples/resource/intent/metric lists in `test/unit/capability-pack.parser.spec.ts`, then implement them in `src/capabilities/capability-pack.parser.ts`
- [ ] T009 Add RED structural binding cases for permitted target/mapping/constraint discriminants, scalar constants, empty Shinmone mappings, and empty Customer B constraints in `test/unit/capability-pack.parser.spec.ts`, then implement structural parsing without ToolRegistry access in `src/capabilities/capability-pack.parser.ts`
- [ ] T010 Add RED forbidden-field cases covering identity authority, permissions, credentials, routes, pointers, SQL, scripts, prompts, callbacks, regexes, templates, expressions, functions, and executable content in `test/contract/feature011-capability-pack.contract.spec.ts`, then reject them recursively in `src/capabilities/capability-pack.parser.ts`
- [ ] T011 Add RED normalized-duplicate cases for HostApps, capability keys, binding identities/versions, locales, aliases/terms, enum aliases with conflicting values, mapping sources, constraint sources, and target assignments in `test/unit/capability-pack.parser.spec.ts`, then implement deterministic duplicate rejection in `src/capabilities/capability-pack.parser.ts`
- [ ] T012 Run the Phase A contract/unit suites and record `FEATURE011_GATE_A=PASS`, including proof that unknown fields/versions reject the complete pack and structural parsing never queries ToolRegistry, in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate A**: `FEATURE011_GATE_A=PASS`

---

## Phase B — Atomic loader, scoped registry, and readiness

**Prerequisite**: Gate A.

**Goal**: Load one complete immutable release before readiness and expose only verified-scope catalog lookup.

- [ ] T013 Add RED environment cases for missing, malformed, non-array, non-string, and valid `ASSISTANT_CAPABILITY_PACK_PATHS_JSON` JSON text in `test/unit/config-validation.spec.ts`
- [ ] T014 Admit only the bounded JSON-text environment value in `src/common/config/env.validation.ts`, leaving path and pack semantics to the loader, until T013 passes
- [ ] T015 Add RED filesystem-loader cases for relative paths, symlinks, non-regular files, unreadable files, repeated paths, over-262144-byte files, and read-once behavior in new `test/unit/capability-pack.loader.spec.ts`
- [ ] T016 Add RED complete-release cases for parse failure, duplicate active scopes, duplicate scoped capability/binding identities, inactive packs, HostApp expansion, and no partial installation in `test/unit/capability-pack.loader.spec.ts`
- [ ] T017 Add RED scoped-registry cases for exact `(customerId,integrationId,hostApp)` lookup, empty registry, no `listAll`/global iterator/key-only lookup, immutable catalogs, and Customer A never reading or materializing Customer B in new `test/unit/capability-catalog.registry.spec.ts`
- [ ] T018 Implement exact scoped keys, immutable catalog results, `NO_ACTIVE_CAPABILITY_PACK`, and atomic release replacement in new `src/capabilities/capability-catalog.registry.ts` until T017 passes
- [ ] T019 Implement ordered path parsing, absolute-path enforcement, `lstat` symlink/non-file rejection, bounded read-once loading, and temporary complete-release parsing in new `src/capabilities/capability-pack.loader.ts` until T015 passes
- [ ] T020 Implement HostApp allowlist expansion, duplicate scoped identity rejection, active-pack selection, recursive deep freeze, and install-only-after-all-files-pass behavior in `src/capabilities/capability-pack.loader.ts` until T016 passes
- [ ] T021 Add RED exact existing active read-only Tool contract and invalid/stale/side-effect target provisioning cases to `test/unit/capability-pack.loader.spec.ts`, then compose the approved existing ToolRegistry exact lookup from `src/capabilities/capability-pack.loader.ts` without semantic Tool-name inference
- [ ] T022 Add RED bootstrap/readiness cases proving invalid configured releases prevent application readiness, valid/empty releases preserve the current health response shape, and no partial registry is request-visible in `test/contract/health-readiness.contract.spec.ts`
- [ ] T023 Register the loader/registry bootstrap lifecycle after Prisma and ToolRegistry initialization in new `src/capabilities/capabilities.module.ts`, `src/app.module.ts`, and `src/observability/health-readiness.service.ts` until T022 passes
- [ ] T024 Run the Phase B loader/registry/config/readiness suites and record `FEATURE011_GATE_B=PASS`, including zero foreign-catalog reads/materialization and absence of global enumeration APIs, in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate B**: `FEATURE011_GATE_B=PASS`

---

## Phase C — Deterministic semantics and canonical parameters

**Prerequisite**: Gate B.

**Goal**: Resolve scoped `zh-TW` semantics and typed canonical parameters directly while the active request path remains unchanged.

- [ ] T025 [US1] Add authentic RED normalization and semantic-resolution cases for Unicode NFKC, Latin case folding, punctuation/whitespace handling, exact `zh-TW`, no locale fallback, scoped materialization, and deterministic ordering in new `test/unit/capability-semantic-resolver.service.spec.ts`
- [ ] T026 [US1] Add RED scoring cases for required signal groups, weights `0.35/0.35/0.10/0.10/0.10`, threshold `0.70`, ambiguity delta `0.05`, 32-candidate cap, five safe ambiguity references, and candidate-overflow failure in `test/unit/capability-semantic-resolver.service.spec.ts`
- [ ] T027 [US1] Add RED example-overlap cases proving bounded token/character-bigram composition resolves unseen paraphrases without an exact-question equality branch in `test/unit/capability-semantic-resolver.service.spec.ts`
- [ ] T028 [US1] Implement generic normalization reuse, exact `zh-TW` profile selection after scoped lookup, required-group eligibility, bounded scoring, deterministic ties, and safe ambiguity references in new `src/capabilities/capability-semantic-resolver.service.ts` until T025–T027 pass; do not remove Customer vocabulary from the active legacy path yet
- [ ] T029 [US2] Add authentic RED enum cases for alias-to-canonical normalization, same-value deduplication, distinct-value conflict, unknown-value invalidity, required-value missing status, and precedence `conflicting → invalid → missing → binding` in new `test/unit/capability-parameter-resolver.service.spec.ts`
- [ ] T030 [US2] Add RED `bounded_string` cases for Core-owned `SAFE_IDENTIFIER`, maximum length, literal-prefix admission, distinct-value conflict, invalid capture, and no arbitrary regex/value creation in `test/unit/capability-parameter-resolver.service.spec.ts`
- [ ] T031 [US2] Implement typed current/inherited enum and bounded-string resolution with canonical names and no raw invalid/conflicting values in new `src/capabilities/capability-parameter-resolver.service.ts` until T029–T030 pass
- [ ] T032 [US2] Add RED closed-result cases for `RESOLVED`, `NEEDS_CLARIFICATION`, `CAPABILITY_UNAVAILABLE`, and `AMBIGUOUS`, including `CAPABILITY_NOT_RECOGNIZED`, bounded safe references, no prose, and no authority/connector/raw-value fields in `test/unit/capability-parameter-resolver.service.spec.ts`
- [ ] T033 [US1] Add RED companion-frame cases for current values, inheritance, `REPLACE`, removed/stale capability, invalidated parameter, scope change, and cross-scope rejection in new `test/unit/capability-follow-up-frame.spec.ts`
- [ ] T034 [US1] Define the bounded capability follow-up frame separately from `ConversationSemanticFrame` and its safe persisted projection in `src/assistant/conversation/conversation.types.ts` and `src/query-understanding/query-understanding.types.ts`, explicitly excluding it from `src/retrieval/grounded-retrieval.types.ts`
- [ ] T035 [US1] Extend canonical-name follow-up inheritance/replacement and active-pack revalidation in `src/assistant/conversation/follow-up-semantic-resolver.service.ts` and `src/assistant/conversation/conversation-semantic-reconstructor.service.ts` until T033 passes, without wiring capability resolution as request-time authority
- [ ] T036 [US1] Persist and reconstruct only the bounded safe companion-frame projection through existing JSON query-understanding storage in `src/query-understanding/query-understanding.repository.ts` and `src/assistant/conversation/conversation-context.repository.ts`, with RED/GREEN coverage in `test/integration/query-understanding-persistence.spec.ts`
- [ ] T037 [US1] Add a direct deterministic paraphrase/unknown/ambiguity/missing/invalid/conflict eval suite in new `test/eval/feature011-capability-resolution.eval.spec.ts`, asserting zero ToolCalls and zero model calls for non-resolved outcomes
- [ ] T038 Add focused pre-cutover regressions proving the legacy request path, existing Tool discovery, Feature 010 follow-up behavior, and `GroundedContextBundleV1` remain unchanged in `test/integration/feature010-followup-routing.spec.ts` and `test/unit/query-understanding-pipeline-wiring.spec.ts`
- [ ] T039 Run Phase C direct semantic/parameter/frame/eval suites plus the focused Feature 010 regressions and record `FEATURE011_GATE_C=PASS` and `CURRENT_REQUEST_PATH_BEHAVIOR_CHANGED=NO` in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate C**: `FEATURE011_GATE_C=PASS` and `CURRENT_REQUEST_PATH_BEHAVIOR_CHANGED=NO`

---

## Phase D — Binding compatibility, complete accounting, and Tool mapping

**Prerequisite**: Gate C.

**Goal**: Release no Tool candidate unless every supplied canonical parameter is consumed exactly once and exact Tool validation passes.

- [ ] T040 [US3] Neutrally inspect the actual current exact-version and Customer-policy lookup APIs and tests in `src/tools/tool-registry.service.ts` and `test/unit/tool-registry.service.spec.ts`, then record exactly one evidence-backed result—`TOOL_REGISTRY_EXISTING_API=SUFFICIENT` or `TOOL_REGISTRY_EXISTING_API=MINIMAL_EXTENSION_REQUIRED`—in `specs/011-customer-capability-semantic-discovery/tasks.md` without assuming the planning snapshot
- [ ] T041 [US3] Branch only on T040's evidence: when `SUFFICIENT`, make zero production changes, record `TOOL_REGISTRY_EXTENSION_REQUIRED=NO` and `T041_EXECUTION=NOT_REQUIRED_BY_REPOSITORY_EVIDENCE` in `specs/011-customer-capability-semantic-discovery/tasks.md`, and continue to T042; when `MINIMAL_EXTENSION_REQUIRED`, add RED exact-version Customer-policy cases and only the smallest generic extension in `test/unit/tool-registry.service.spec.ts` and `src/tools/tool-registry.service.ts`; never create a parallel registry
- [ ] T042 [US3] Add authentic RED startup compatibility cases for unknown mapping/constraint parameters, unknown enum constraint values, required static consumption, optional unconsumed declarations, duplicate mapping sources, duplicate constraints, dual consumption, implicit fixed semantics, and duplicate Tool targets in new `test/unit/capability-binding-resolver.spec.ts`
- [ ] T043 [US3] Add RED Tool-contract cases for bounded scalar constants, unknown/non-top-level target fields, static type/enum incompatibility, unsatisfied required Tool inputs, stale/inactive/non-read-only versions, and Customer-policy denial in `test/unit/capability-binding-resolver.spec.ts`
- [ ] T044 [US3] Add RED runtime accounting cases for all-mapped, all-constrained, optional-unsupplied, optional-supplied, unaccounted, multiply consumed, constraint-rejected, zero-compatible, and multiple-compatible bindings in `test/unit/capability-binding-resolver.spec.ts`
- [ ] T045 [US3] Implement static capability/binding compatibility and exactly-one consumption-declaration validation in new `src/capabilities/capability-binding-resolver.service.ts` until T042 passes
- [ ] T046 [US3] Implement exact Tool/customer-policy resolution, top-level target validation, scalar constant checks, type compatibility, and required-input satisfiability in `src/capabilities/capability-binding-resolver.service.ts` until T043 passes
- [ ] T047 [US3] Implement runtime `MAPPED_PARAMETER` and `BINDING_SEMANTIC_CONSTRAINT` accounting, exact constraint matching, zero/multiple-binding fail-closed outcomes, and no silent parameter removal in `src/capabilities/capability-binding-resolver.service.ts` until T044 passes
- [ ] T048 [US3] Add RED final argument-object cases for canonical-to-Tool renaming, constants, empty Shinmone mappings, and full current Tool input-schema rejection in `test/unit/capability-binding-resolver.spec.ts`, then call existing `validateNamedOperation` on the complete mapped object from `src/capabilities/capability-binding-resolver.service.ts`
- [ ] T049 [US3] Add exact-version runtime drift cases proving a missing, changed, inactive, side-effecting, or newly policy-denied Tool releases no candidate in `test/unit/capability-binding-resolver.spec.ts`
- [ ] T050 [US3] Run Phase D binding and ToolRegistry suites and record `FEATURE011_GATE_D=PASS`, `EVERY_RESOLVED_PARAMETER_ACCOUNTED_FOR=YES`, and `SILENT_CANONICAL_PARAMETER_DROP=FORBIDDEN` in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate D**: `FEATURE011_GATE_D=PASS`

---

## Phase E — Customer packs and direct subsystem acceptance

**Prerequisite**: Gates A–D.

**Goal**: Establish pack-backed reference coverage through direct subsystem tests before any production request-path cutover.

- [ ] T051 [US1] Add the product-owned Shinmone V1 pack with `work-orders.count`, enum values `this_month`/`today`, monthly-only semantic constraint, exact `work-orders.monthly-new-count@1.0.0` target, and `mappings=[]` in new `customer-capability-packs/shinmone-scm-local/1.0.0.json`, containing no Connector/API/permission/credential details
- [ ] T052 [US4] Add the distinct Customer B inventory fixture pack with bounded `itemRef`, no semantic constraint for it, and `itemRef → sku` mapping to `inventory.stock-on-hand@1.0.0` in new `test/fixtures/capability-packs/customer-b-inventory.v1.json`
- [ ] T053 [US4] Inventory repository-evidenced current Customer A semantic fixtures and add only the required predecessor-compatible pack in new `test/fixtures/capability-packs/customer-a-reference.v1.json`; do not assume unsupported fixture behavior is a supported semantic path
- [ ] T054 Add immutable pack-path deployment configuration without secrets or hot reload in `.env.example`, `Dockerfile`, `docker-compose.yml`, `dev/connector-local/generate-local-authority.mjs`, and `dev/connector-local/README.md`, mounting checked-in packs read-only and leaving Connector manifests unchanged
- [ ] T055 [US1] Add authentic RED direct orchestration cases for at least three Shinmone monthly paraphrases, exact `timeRange=this_month`, missing time, `today` unavailable, empty mapped arguments, and exact monthly Tool candidate in new `test/integration/feature011-capability-resolution.spec.ts`
- [ ] T056 [US4] Add RED direct Customer B and isolation cases for distinct vocabulary, `itemRef → sku`, same generic resolver, and colliding capability/alias/HostApp/organization/actor values with zero foreign reads in `test/integration/feature011-customer-b-portability.spec.ts`
- [ ] T057 [US2] Add RED direct non-resolved cases proving unknown, missing, invalid, conflicting, unavailable, and ambiguous outcomes create zero ToolCalls and zero Customer requests in `test/integration/feature011-capability-resolution.spec.ts`
- [ ] T058 [US1] Implement scoped semantic → parameter → binding orchestration behind new `src/capabilities/capability-resolution.service.ts`, composing it in T055–T057 only with a TEST-ONLY bounded audit port/stub that is never registered as a production Nest provider, and return only the approved typed union
- [ ] T059 Register only pre-cutover capability providers whose real production dependencies already exist in `src/capabilities/capabilities.module.ts` and `src/query-understanding/query-understanding.module.ts`; do not register the test audit stub, do not install a no-op audit provider, do not make `CapabilityResolutionService` request-time authority, and do not require unresolved production audit wiring during bootstrap; record `PRODUCTION_TEST_AUDIT_STUB_REGISTERED=NO` in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T060 Run all direct pack/orchestration acceptance plus the active legacy request regressions and record `FEATURE011_GATE_E=PASS`, `PACK_BACKED_REFERENCE_COVERAGE=PASS`, and `CURRENT_REQUEST_PATH_BEHAVIOR_CHANGED=NO` in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate E**: `FEATURE011_GATE_E=PASS`, `PACK_BACKED_REFERENCE_COVERAGE=PASS`, and `CURRENT_REQUEST_PATH_BEHAVIOR_CHANGED=NO`

---

## Mandatory pre-cutover migration inventory — HARD STOP

**Prerequisite**: Gate E.

**Goal**: Prove every currently supported Tool-backed semantic path is migrated or explicitly unsupported before changing production authority.

- [ ] T061 Exhaustively trace every production/test/fixture/seed/config dependency on `ToolDiscoveryService`, `x-assistant-discovery-v1`, global Tool-backed vocabulary, Tool-name/description discovery, legacy argument binding, and Customer-specific query-understanding branches, recording paths and repository evidence in new `specs/011-customer-capability-semantic-discovery/legacy-semantic-dependency-inventory.md`
- [ ] T062 Classify every discovered Tool-backed semantic capability exactly once as `MIGRATED_TO_CUSTOMER_CAPABILITY_PACK`, `EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH`, or `BLOCKER_REQUIRES_PACK_BEFORE_CUTOVER`, with evidence and pack/test references, in `specs/011-customer-capability-semantic-discovery/legacy-semantic-dependency-inventory.md`
- [ ] T063 Add a fail-closed architecture contract that compares the discovered legacy dependency surface with the evidence-backed classification inventory and rejects unclassified supported paths in new `test/architecture/feature011-legacy-semantic-inventory.guard.spec.ts`
- [ ] T064 If T061–T063 find any `BLOCKER_REQUIRES_PACK_BEFORE_CUTOVER`, STOP before Phase F and make no pack, semantic capability, or speculative production change; report every blocker with repository paths, existing supported semantic behavior, the current Tool target when safely identifiable, and why Gate E coverage is insufficient in `specs/011-customer-capability-semantic-discovery/legacy-semantic-dependency-inventory.md`, record `PRE_CUTOVER_BLOCKER_FOUND=YES` and `FEATURE011_TASK_AMENDMENT_REQUIRED=YES` in `specs/011-customer-capability-semantic-discovery/tasks.md`, and wait for separate human review/authorization of explicit amended pack and acceptance tasks
- [ ] T065 Run the inventory guard and direct reference gate again, then record `LEGACY_TOOL_SEMANTIC_DEPENDENCY_INVENTORY=PASS` and `UNMIGRATED_SUPPORTED_TOOL_SEMANTIC_PATHS=0` in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on any nonzero or unsupported classification

**Pre-cutover gate**: `LEGACY_TOOL_SEMANTIC_DEPENDENCY_INVENTORY=PASS` and `UNMIGRATED_SUPPORTED_TOOL_SEMANTIC_PATHS=0`

---

## Phase F — Atomic Feature 010 request-path cutover and audit

**Prerequisite**: Gate E and the mandatory pre-cutover inventory gate.

**Goal**: Make the scoped capability path the sole Tool-backed semantic authority in one change while preserving Feature 010 routing.

- [ ] T066 [US3] Add authentic RED request-path integration cases for scoped catalog selection, current-message signals, follow-up revalidation, version-pinned candidate projection, and absence of any `ToolDiscoveryService` call in new `test/integration/feature011-feature010-cutover.spec.ts`
- [ ] T067 [US2] Add RED planning cases projecting `NEEDS_CLARIFICATION`/`AMBIGUOUS` to existing `CLARIFY` and `CAPABILITY_UNAVAILABLE` to existing `INSUFFICIENT`, with zero ToolCalls and Customer requests, in `test/integration/feature011-feature010-cutover.spec.ts`
- [ ] T068 [US3] Add RED planning/runtime cases proving `RESOLVED` produces exactly one version-pinned Tool need, multiple Tool needs remain unsupported, and exact-version drift fails with `tool_contract_mismatch` before ToolCall start in `test/unit/assistant-planning.service.spec.ts` and `test/unit/assistant-readonly-runtime.service.spec.ts`
- [ ] T069 [US3] Add RED bounded audit, fail-closed persistence, and production-wiring cases for `capability_resolution_completed` in new `test/unit/capability-resolution-audit.service.spec.ts`, covering allowed scope/correlation/references/status metadata, forbidden query/value/argument/token/Connector/business data, and proof that no test/no-op audit stub is registered in production
- [ ] T070 [US3] Implement the real bounded append-only `capability_resolution_completed` dependency and fail-closed candidate release in new `src/capabilities/capability-resolution-audit.service.ts` and `src/capabilities/capability-resolution.service.ts` using existing `src/audit/audit-writer.interface.ts`
- [ ] T071 [US1] As one atomic cutover, register the real production capability audit and `CapabilityResolutionService` dependencies in `src/capabilities/capabilities.module.ts` and `src/query-understanding/query-understanding.module.ts`, replace request-time Tool discovery in `src/query-understanding/rule-based-query-understanding.pipeline.ts`, and remove the old call with no test/no-op provider, feature flag, fallback, dual authority, or second coordinator
- [ ] T072 [US2] Project the four typed outcomes into existing clarification/unsupported planning inputs without adding user-facing prose in `src/query-understanding/query-understanding.types.ts`, `src/query-understanding/clarification-need.generator.ts`, and `src/assistant/planning/assistant-planning.service.ts` until T067 passes
- [ ] T073 [US3] Carry exact Tool version and validated mapped arguments through internal planning/persistence types in `src/assistant/planning/assistant-planning.types.ts`, `src/assistant/planning/assistant-planning.service.ts`, and `src/query-understanding/query-understanding.repository.ts` without public contract changes
- [ ] T074 [US3] Re-resolve the pinned Tool/customer policy immediately before ToolCall creation and fail on drift in `src/assistant/runtime/assistant-readonly-runtime.service.ts` until T068 passes
- [ ] T075 [US5] Add follow-up and prior-context cutover cases proving inherited values are revalidated under the current pack while existing Tool/RAG/Hybrid routing and prior evidence rules remain authoritative in `test/integration/feature010-followup-routing.spec.ts` and `test/integration/feature010-prior-grounded-recall.spec.ts`
- [ ] T076 Add a negative request-path regression proving legacy discovery metadata with no scoped pack capability cannot resolve or execute in `test/integration/feature011-feature010-cutover.spec.ts`
- [ ] T077 Run Phase F cutover/audit/planning/runtime suites and record `FEATURE011_GATE_F=PASS`, `FEATURE011_ONLY_TOOL_SEMANTIC_AUTHORITY=CAPABILITY_PACK`, `REQUEST_TIME_TOOL_DISCOVERY_USED=NO`, `LEGACY_RUNTIME_FALLBACK=NO`, and `DUAL_SEMANTIC_AUTHORITY=NO` in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate F**: `FEATURE011_GATE_F=PASS` with exactly one Tool semantic authority.

---

## Phase G — Architecture and Customer-isolation guards

**Prerequisite**: Gate F.

**Goal**: Prevent Customer semantics, cross-Customer enumeration, Tool-key inference, and legacy fallback from returning to generic production ownership.

- [ ] T078 [US4] Add authentic RED static guard fixtures for Customer names/business vocabulary, API routes/fields, exact reference questions, literal Customer/integration/HostApp branches, Tool-key/name semantic inputs, global enumeration, legacy fallback, and executable mappings in new `test/architecture/feature011-generic-semantic-ownership.guard.spec.ts`
- [ ] T079 [US4] Implement the guard's narrowly scoped generic-production allow/deny ownership rules in `test/architecture/feature011-generic-semantic-ownership.guard.spec.ts`, explicitly allowing Customer packs, Customer integration/configuration, fixture builders, and tests
- [ ] T080 [US4] Add behavioral isolation instrumentation with colliding capability keys, aliases, HostApps, organization IDs, and actor IDs, proving zero foreign catalog reads/materialization/binding lookup/existence disclosure in new `test/integration/feature011-customer-isolation.spec.ts`
- [ ] T081 [US4] Add a portability regression proving Customer B acceptance still passes when all Shinmone pack/configuration inputs are absent in `test/integration/feature011-customer-b-portability.spec.ts`
- [ ] T082 Run the static and behavioral isolation suites and record `FEATURE011_GATE_G=PASS` and zero cross-Customer leakage in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate G**: `FEATURE011_GATE_G=PASS`

---

## Phase H — Unreachable legacy semantic-authority retirement

**Prerequisite**: Gate E, pre-cutover inventory gate, Gate F, and Gate G.

**Goal**: Delete or narrow only the now-unreachable legacy Tool semantic implementation while retaining Tool execution and non-Tool behavior.

Every T084–T089 action is subordinate to `specs/011-customer-capability-semantic-discovery/legacy-semantic-dependency-inventory.md`. Delete only ownership proven to be legacy semantic authority, unreachable after Gate F, and unnecessary for retained generic/RAG/execution behavior. Narrow shared files instead of deleting them wholesale; if ownership remains ambiguous, STOP and report evidence before changing that element.

- [ ] T083 Re-run the negative legacy-metadata/no-pack regression before deletion and pin its post-retirement expectation in `test/integration/feature011-feature010-cutover.spec.ts`
- [ ] T084 Using only inventory-proven ownership, remove the unreachable `ToolDiscoveryService` and module export from `src/tools/tool-discovery.service.ts` and `src/tools/tools.module.ts`; in `src/tools/tool-registry.types.ts`, remove only proven legacy semantic metadata types and retain all Tool registry/execution types; STOP on ambiguous shared ownership
- [ ] T085 Using only inventory-proven ownership, remove obsolete discovery-only fixtures/assertions from `test/support/tool-discovery.fixture.ts`, `test/unit/tool-discovery.service.spec.ts`, `test/unit/tool-discovery-equivalence.spec.ts`, and `test/integration/tool-discovery-mock-equivalence.spec.ts`, migrating every still-supported generic/execution assertion to Feature 011 pack tests and STOP on ambiguous retained coverage
- [ ] T086 Using only inventory-proven ownership, remove `x-assistant-discovery-v1` semantic metadata from ToolDefinition seed/test inputs in `prisma/seed.ts`, `test/support/us1-test-app.helper.ts`, and the exact files listed by `specs/011-customer-capability-semantic-discovery/legacy-semantic-dependency-inventory.md`, while retaining Tool execution schemas and CustomerToolPolicy; STOP on ambiguous schema ownership
- [ ] T087 Using only inventory-proven ownership, narrow Tool-backed Customer vocabulary/temporal aliases in `src/query-understanding/domain-lexicon.ts` and identifier assumptions in `src/query-understanding/default-tokenizer.adapter.ts` and `src/query-understanding/query-normalizer.ts`; retain all Customer-neutral normalization, tokenization, and safety symbols and STOP rather than deleting a shared file or ambiguous symbol
- [ ] T088 Using only inventory-proven ownership, narrow SO/WO/SKU business extraction assumptions in `src/query-understanding/entity-extractor.ts` while retaining any generic/page-context/RAG extraction behavior; rely on the Phase C bounded parameter mechanics only where explicitly covered and STOP on ambiguous ownership
- [ ] T089 Using only inventory-proven ownership, narrow `enrichInventoryAvailability`, structured-resource Tool special cases, hard-coded `last_month` Tool behavior, and order-specific clarification in `src/query-understanding/rule-based-query-understanding.pipeline.ts`, `src/query-understanding/time-range.parser.ts`, and `src/query-understanding/clarification-need.generator.ts`; retain generic time parsing, clarification, document/RAG, page-context/deixis, risk, and Feature 010 behavior and STOP on ambiguous ownership
- [ ] T090 Add focused retained-behavior regressions for generic normalization, risk classification, RAG/document routing, page-context/deixis validation, Feature 010 follow-up, Tool registry/execution, authorization, projection, and evidence in `test/unit/query-understanding-generic-routing.guard.spec.ts` and `test/integration/feature010-grounded-retrieval.spec.ts`
- [ ] T091 Run retirement, negative legacy-metadata, and retained-behavior suites; prove no runtime reference to old discovery metadata remains and record `FEATURE011_GATE_H=PASS` in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP on failure

**Gate H**: `FEATURE011_GATE_H=PASS`

---

## Phase I — Compatibility and final acceptance

**Prerequisite**: Gates A–H and the pre-cutover inventory gate.

**Goal**: Prove Feature 011 and all predecessor boundaries without executing Feature 009 T126–T142 or any real Customer request.

- [ ] T092 Run all Feature 011 contract, unit, integration, eval, and architecture suites and record exact results plus `FEATURE011_FOCUSED_SUITES=PASS` in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T093 Run focused Feature 008 Tool registry, CustomerToolPolicy, permission precheck, readonly runtime, projection, masking, and EvidenceRef suites and record `FEATURE008_TOOL_AUTHORITY_PRESERVED=YES` in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T094 Run focused Feature 009 transport, isolation, Customer B portability, and Shinmone reference suites while explicitly excluding T126–T142, and record `FEATURE009_CONNECTOR_AUTHORITY_PRESERVED=YES` in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T095 Run focused Feature 010 context, follow-up, Tool/RAG/Hybrid routing, prior evidence, coverage, safe failure, and no-LLM suites and record `FEATURE010_RETRIEVAL_AUTHORITY_PRESERVED=YES` in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T096 Run public Assistant HTTP/SSE/SDK/history contract suites and the `GroundedContextBundleV1` leak/shape contracts, recording `PUBLIC_ASSISTANT_CONTRACT_CHANGED=NO` and `GROUNDED_CONTEXT_BUNDLE_V1_PRESERVED=YES` in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T097 Run `npm run typecheck` and applicable workspace typechecks, recording exact PASS/FAIL evidence in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T098 Run the Backend and applicable workspace builds, recording exact PASS/FAIL evidence in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T099 Run changed-file lint and `git diff --check`, recording exact PASS/FAIL evidence and confirming no Prisma migration, Connector manifest, public contract, Feature 012, hot-reload, write-capability, real Tool, or Customer endpoint change in `specs/011-customer-capability-semantic-discovery/tasks.md`
- [ ] T100 Review all gate evidence and record `FEATURE011_GATE_I=PASS` only when Gates A–H, predecessor compatibility, zero final LLM calls, and every approved invariant pass in `specs/011-customer-capability-semantic-discovery/tasks.md`; STOP otherwise

**Gate I**: `FEATURE011_GATE_I=PASS`

---

## Dependencies and hard-stop rules

### Phase dependencies

```text
Gate A
  → Gate B
  → Gate C + CURRENT_REQUEST_PATH_BEHAVIOR_CHANGED=NO
  → Gate D
  → Gate E + PACK_BACKED_REFERENCE_COVERAGE=PASS
  → pre-cutover migration inventory PASS + unmigrated supported paths=0
  → Gate F atomic authority switch
  → Gate G architecture/isolation guards
  → Gate H unreachable legacy retirement
  → Gate I final compatibility
```

Phase F MUST NOT begin until Gate E and both pre-cutover inventory markers pass. If inventory finds another supported semantic capability, T064 stops for human review; Codex must not invent coverage. Only a later human-approved amendment may add explicit pack and direct-acceptance tasks, after which Gate E and the inventory are rerun. Phase H MUST NOT begin before Gates F and G pass.

### Stop and report instead of redesigning

Codex executing these tasks later must stop at the first occurrence of any of the following:

- a gate or prerequisite fails;
- an unmigrated supported legacy Tool semantic path remains;
- T061–T063 report `BLOCKER_REQUIRES_PACK_BEFORE_CUTOVER`, which requires the T064 human-review stop and task amendment;
- the approved architecture would need to change;
- a dual semantic authority, legacy fallback, global candidate pool, or Customer branch appears necessary;
- a Prisma schema/migration or Connector manifest change appears necessary;
- a real Tool invocation or Customer business endpoint call appears necessary;
- Feature 009 T126–T142 would need to execute;
- a public Assistant contract, `GroundedContextBundleV1`, or Feature 012 behavior would need to change.

Report the blocker with repository evidence. Do not silently redesign, widen scope, weaken validation, or bypass a gate.

### TDD and review order

- Each RED task must fail only for its named missing behavior before its paired implementation task begins.
- Run the focused GREEN suite after each implementation task and the complete phase suite at its gate.
- Task execution is sequential by default. No parallel execution is authorized across a gate or between a RED task and its implementation.
- Review each gate before advancing to the next phase.

## User-story traceability and independent acceptance

- **US1 — Natural-language capability resolution**: T025–T028, T033–T037, T051, T055, T058, T066, T071. Independently passes when varied and unseen Shinmone phrasing resolves directly to one canonical capability and `this_month` without Tool-name inference.
- **US2 — Typed non-resolved outcomes**: T029–T032, T057, T067, T072. Independently passes when unknown/missing/invalid/conflicting/unavailable/ambiguous cases are distinct and execute nothing.
- **US3 — Existing authorized execution binding**: T040–T050, T055, T066, T068–T070, T073–T074. Independently passes when every parameter is accounted for and one exact-version candidate re-enters existing authority without bypass.
- **US4 — Customer isolation and reuse**: T052–T053, T056, T078–T082. Independently passes when Customer B uses the same Core and foreign catalogs are never read or materialized despite collisions.
- **US5 — Existing Tool/RAG/Hybrid preservation**: T075, T090, T095–T096. Independently passes when the existing routing/grounding contracts remain unchanged and V1 adds no second RAG path.

## Implementation strategy

This feature has no deployable partial MVP before the atomic cutover. Gates A–D create directly testable foundations; Gate E creates the reviewable pack-backed acceptance milestone. The pre-cutover inventory is the release stop. Phase F is the sole request-authority switch, followed by guards, unreachable-code retirement, and full compatibility. No feature flag or dual-running migration is permitted.

## Execution authorization state

```text
FEATURE011_IMPLEMENTATION_AUTHORIZED=NO
ALL_TASKS_INITIAL_STATE=UNEXECUTED
FIRST_UNEXECUTED_TASK=T001
IMPLEMENTATION_REQUIRES_SEPARATE_HUMAN_AUTHORIZATION=YES
REAL_TOOL_INVOCATION_EXECUTED=NO
CUSTOMER_BUSINESS_ENDPOINT_CALLED=NO
FEATURE009_T126_T142_EXECUTED=NO
```
