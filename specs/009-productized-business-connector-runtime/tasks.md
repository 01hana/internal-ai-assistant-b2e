# Tasks: Feature 009 — Productized Business Connector Runtime

**Input**: Accepted `spec.md`, `design.md`, and `plan.md` approved for Phase 1 implementation.
**Status**: Accepted — Phase 1 baseline through Phase 7 central dark-transport gate completed. T001–T067 are complete; Phase 8 is unexecuted.

```text
PHASE1_EXECUTED=YES
PHASE2_EXECUTED=YES
PHASE3_EXECUTED=YES
T001_T035_COMPLETE=YES
PHASE4_EXECUTED=YES
T001_T044_COMPLETE=YES
PHASE5_EXECUTED=YES
T001_T057_COMPLETE=YES
PHASE6_EXECUTED=YES
T001_T067_COMPLETE=YES
PHASE7_EXECUTED=YES
PHASE8_EXECUTED=NO
FIRST_UNEXECUTED_TASK=T068
NEXT_ACTION=EXECUTE_PHASE8
```
**Scope**: Implement the reusable two-sided connector runtime, executable Synthetic Customer B portability fixture, removable Shinmone reference slice, and Shinmone-removal gate through the existing Feature 008 path. Feature 007 is a completed read-only predecessor; Phase 8 is `FEATURE009_IMPLEMENTATION_CONSUMING_ACCEPTED_FEATURE007_AMENDMENT`, never Feature 007 reimplementation.
**Test rule**: Every meaningful new contract or behavior starts with an authentic RED against current code, followed by the narrow GREEN and the phase checkpoint. Never manufacture RED by breaking production code.

## Execution and Stop Rules

- Complete phases through their checkpoint chain. A later phase cannot start while its predecessor checkpoint is incomplete.
- Each RED task preserves its initial failure output; each GREEN reruns the focused RED suite plus named adjacent regressions.
- `[P]` appears only on disjoint read-only baseline work and independent shared-contract RED authoring. All other work is sequential because it shares contracts, configuration, composition, fixtures, or authority.
- Feature 007 `spec.md`, `design.md`, `plan.md`, `tasks.md`, and historical evidence are read-only. Preserve the truthful history: original identity implementation, later incompatibility discovery, accepted amendment, then Feature 009 Stage 2 implementation.
- The accepted Feature 007 amendment changes only the native credential's allowed post-admission Customer-local destination; it does not reclassify Feature 007 as incomplete or authorize predecessor reimplementation.
- MenuDetail and `IdentityAdmissionService` must both succeed before Shinmone Stage 2. Stage 1 remains SPA → Identity Bridge → exact MenuDetail → `IdentityAdmissionService`; only after success may Shinmone Stage 2 send the same AccessToken once to the exact authenticated Customer-local binding route. This is one provider profile, not the generic bootstrap model.
- Bridge-side Feature 009 Stage 2 changes are narrowly limited to `apps/identity-bridge/src/connector-binding/**`, `apps/identity-bridge/src/exchange/**`, and approved narrow Bridge configuration/module composition.
- Generic Customer-local receipt and minting belongs to `apps/customer-connector-runtime/**`, including the exact `POST /v1/internal/connector-bindings` endpoint, registered binding-bootstrap profiles/providers, provider-owned credential handles/metadata, credential profiles/application strategies, and closed request profiles; this does not make Feature 007 SDD or historical evidence mutable.
- Connector Runtime gains no identity, permission, Customer, HostApp, Entry, or Gateway authority.
- MenuDetail remains native validity and permission authority. Feature 007/Gateway retains identity; IntegrationBinding retains Customer; allowedHostApp retains HostApp; ToolDefinition retains operation/output/timeout; Feature 008 retains permission, ToolCall, projection, evidence, answer, and SSE authority.
- Every binding mint uses an exact registered Customer-local bootstrap service profile and bounded sensitive `providerPayload`; central invocation proofs, Feature 007 user tokens, Browser calls, and cross-profile acceptance are rejected. `BRIDGE_BINDING_TRANSPORT_V1` is solely Shinmone's Stage 2 profile: exact HTTPS destination, separate `assistant-connector-binding+jwt` domain, fixed 2,000 ms lifecycle, and no proxy, redirect, retry, alternate destination, or second bearer send.
- Generic manifests use only `credentialProfileRef`; registered `CredentialProvider` and `CredentialApplicationStrategy` implementations own credential source/application. Generic binding records contain no mandatory `acceptedEntry`, `nativeAccessToken`, bearer, or JWT-exp assumption.
- V1 operation execution is limited to read-only `GET_QUERY_V1` and `POST_QUERY_JSON_V1`; adding a Customer is configuration-only when profiles suffice, otherwise a Customer-local provider/plugin extension, and never a Customer branch in Assistant core, central adapter/transport, or generic runtime orchestration.
- RefreshToken handoff, central native credentials, Browser-selected context/destination/profile, and rewriting Feature 007 evidence are stop conditions requiring `HUMAN_REQUIRED`. The same stop applies to generic URL/SQL/command execution, arbitrary POST bodies/headers, projection bypass, public Assistant/SSE/SDK change, central Prisma change, Customer-specific Assistant or generic-runtime routing, HTTP production/staging fallback, shared/cross-accepted service profiles, or real Shinmone access before T126 passes.

## Phase 1 — Baseline and Predecessor-Contract Protection

**Goal**: Freeze current Feature 007/008 behavior and distinguish accepted amendment authority from original implementation history.  
**Dependencies**: None.  
**Independent test**: Existing identity, transient-context, tool, projection, evidence, mock, public, and SSE suites pass without production or test edits.

- [X] T001 [VERIFY] [P] [IDENTITY-BRIDGE] Capture the current Feature 007 runtime baseline without rewriting its history.
  - Files: `apps/identity-bridge/test/exchange/**`, `apps/identity-bridge/test/idx/**`, `apps/identity-bridge/test/signing/**`, `apps/identity-bridge/test/jwks/**`, `test/integration/gateway-integration-binding.persistence.spec.ts`, `test/e2e/gateway-backend-trust-chain.e2e-spec.ts`.
  - Depends on: none.
  - Validation: Run focused Bridge MenuDetail, admission, permission, canonical JWT/JWKS, redaction, and existing session bootstrap suites; record current pass/fail output only in this task's later evidence.
  - Stop: Do not edit Feature 007 source, tests, documents, task checkboxes, or historical evidence.

- [X] T002 [VERIFY] [P] [BACKEND] Capture Feature 008 trusted/transient/tool authority baselines.
  - Files: `test/unit/host-integration-request.factory.spec.ts`, `test/integration/feature008-transient-boundary.spec.ts`, `test/unit/data-adapter-registry.service.spec.ts`, `test/unit/tool-registry.service.spec.ts`, `test/unit/tool-permission-precheck.service.spec.ts`, `test/unit/tool-call.service.spec.ts`.
  - Depends on: none.
  - Validation: Run the listed suites and record HostIntegrationContext, transient reference, exact registry, ToolDefinition, arguments, permission, lifecycle, and timeout behavior.
  - Stop: Do not change fixtures or assertions to make the baseline pass.

- [X] T003 [VERIFY] [P] [BACKEND] Capture Feature 008 projection, evidence, mock, answer, and public compatibility baselines.
  - Files: `test/unit/adapter-result-projector.service.spec.ts`, `test/unit/evidence-ref.service.spec.ts`, `test/unit/grounded-answer-input.spec.ts`, `test/unit/mock-connector-adapter.spec.ts`, `test/integration/authorized-evidence-answer.spec.ts`, `test/integration/tool-failure-safe-response.spec.ts`, `test/contract/assistant-messages-sse.contract.spec.ts`.
  - Depends on: none.
  - Validation: Run the listed suites and record outputSchema projection, masking, EvidenceRef, GroundedAnswerInput, mock, no-answer/tool-failure, and SSE behavior.
  - Stop: No public response, AnswerDecision, SSE, evidence, or mock contract change is permitted.

- [X] T004 [VERIFY] [P] [BACKEND] Capture protected hashes, repository scope, and prohibited-data surface baseline.
  - Files: Feature 009 `spec.md`, `design.md`, `plan.md`; Feature 007 `spec.md`, `design.md`, `plan.md`, `tasks.md`; `specs/.DS_Store`; `prisma/schema.prisma`; `prisma/migrations/`; `test/integration/secret-redaction.spec.ts`.
  - Depends on: none.
  - Validation: Record hashes/status and run existing redaction checks for native credential and `connectorContextRef`; preserve all pre-existing worktree state.
  - Stop: This task may update only later evidence in this Feature 009 `tasks.md`.

- [X] T005 [CHECKPOINT] [BACKEND] Verify and record the Phase 1 predecessor baseline gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T001, T002, T003, T004.
  - Validation: Confirm all baseline commands completed without mutation and record both `PREDECESSOR_CONTRACT_BASELINE_RESULT=PASS` and `PHASE1_EXECUTED=YES` when T005 completes. Until then, the document-level gate metadata remains `PHASE1_EXECUTED=NO`.
  - Stop: Do not proceed if Feature 007 history is rewritten or any Feature 008 authority differs from the accepted baseline.

### Phase 1 Execution Evidence — 2026-09-10

Phase 1 stopped at its checkpoint because T001 did not fully pass. No production code, test code, Feature 007 history, Feature 008 contract, Feature 009 approved input, Prisma artifact, hook, or Phase 2 task was modified.

| Task | Result | Suites | Tests | Skipped | Evidence |
| --- | --- | ---: | ---: | ---: | --- |
| T001 | FAIL | 23 passed; Gateway e2e aborted before summary | 215 passed; Gateway e2e count not reported | 0 reported | Identity Bridge: 22/22 suites and 213/213 tests passed. IntegrationBinding persistence: the first sandboxed attempt failed only because localhost PostgreSQL access was denied; the identical authorized retry passed 1/1 suite and 2/2 tests. Gateway/Backend trust-chain e2e exited 1 during `NestFactory.create(GatewayModule)` via `process.exit(1)` before Jest emitted suite/test totals; the only additional output was the existing ts-jest `allowJs` warning. No code or fixture was changed. |
| T002 | PASS | 6/6 | 76/76 | 0 | Five focused unit suites and the Feature 008 transient-boundary integration suite passed. |
| T003 | PASS | 7/7 | 41/41 | 0 | Four projection/evidence/mock unit suites, two answer/failure integration suites, and the Assistant SSE contract suite passed. |
| T004 | PASS | 1/1 | 5/5 | 0 | Secret-redaction integration passed; all protected hashes matched before and after. The failed e2e's task-created temporary signing directory and isolated `_test` database were removed by exact name after inspection. |
| T005 | BLOCKED | — | — | — | T001 is incomplete, so `PREDECESSOR_CONTRACT_BASELINE_RESULT=PASS` and `PHASE1_EXECUTED=YES` were not recorded. |

Commands executed, in order:

```text
git status --short
shasum -a 256 <Feature 009 approved inputs and protected Feature 007/008, .DS_Store, and Prisma paths>
rg <gate metadata and task checkbox checks>
docker compose ps
npm --prefix apps/identity-bridge run test:unit -- --testPathPatterns='test/(exchange|idx|signing|jwks)/'
RUN_GATEWAY_REGISTRY_DB_TESTS=true npm run test:integration -- --runInBand --runTestsByPath test/integration/gateway-integration-binding.persistence.spec.ts
RUN_GATEWAY_REGISTRY_DB_TESTS=true npm run test:integration -- --runInBand --runTestsByPath test/integration/gateway-integration-binding.persistence.spec.ts  # identical authorized retry
npm run test:e2e -- --runInBand --runTestsByPath test/e2e/gateway-backend-trust-chain.e2e-spec.ts
npm run test:unit -- --runInBand --runTestsByPath test/unit/host-integration-request.factory.spec.ts test/unit/data-adapter-registry.service.spec.ts test/unit/tool-registry.service.spec.ts test/unit/tool-permission-precheck.service.spec.ts test/unit/tool-call.service.spec.ts
npm run test:integration -- --runInBand --runTestsByPath test/integration/feature008-transient-boundary.spec.ts
npm run test:unit -- --runInBand --runTestsByPath test/unit/adapter-result-projector.service.spec.ts test/unit/evidence-ref.service.spec.ts test/unit/grounded-answer-input.spec.ts test/unit/mock-connector-adapter.spec.ts
npm run test:integration -- --runInBand --runTestsByPath test/integration/authorized-evidence-answer.spec.ts test/integration/tool-failure-safe-response.spec.ts
npm run test:contract -- --runInBand --runTestsByPath test/contract/assistant-messages-sse.contract.spec.ts
npm run test:integration -- --runInBand --runTestsByPath test/integration/secret-redaction.spec.ts
find/ls inspection of the task-created temporary signing directory
rm -rf .phase5-signing-test-h08zB2
docker compose exec -T postgres psql -U postgres -d postgres -Atc <list exact feature003 _test databases>
docker compose exec -T postgres dropdb -U postgres --force feature003_gateway_backend_trust_ch_17511_1789019630860_0_test
git status --short
shasum -a 256 <same protected paths>
```

Approved Feature 009 pre-implementation hashes, unchanged after baseline execution:

```text
SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
TASKS_PRE_EXECUTION_SHA256=09f8adf59ecc6108c8fbf0208d77ce6fae93e8fb57991750a35ca8d4829226c9
```

Protected predecessor and persistence hashes, identical before and after baseline execution:

```text
FEATURE007_SPEC_SHA256=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
FEATURE007_DESIGN_SHA256=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
FEATURE007_PLAN_SHA256=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
FEATURE007_TASKS_SHA256=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
FEATURE008_SPEC_SHA256=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
FEATURE008_DESIGN_SHA256=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
FEATURE008_PLAN_SHA256=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
FEATURE008_TASKS_SHA256=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
SPECS_DS_STORE_SHA256=3997f3af185d3d6ac31d493a98e75ee397088b6fcf966ecee095d1264bd00e51
PRISMA_SCHEMA_SHA256=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
PRISMA_MIGRATIONS_HASH_SET_CHANGED=NO
```

Checkpoint state:

```text
T001_RESULT=FAIL
T002_RESULT=PASS
T003_RESULT=PASS
T004_RESULT=PASS
T005_RESULT=BLOCKED
PREDECESSOR_CONTRACT_BASELINE_RESULT=BLOCKED
PHASE1_EXECUTED=NO
PHASE2_EXECUTED=NO
NEXT_ACTION=HUMAN_REVIEW_REQUIRED
```

#### T001 Gateway Startup Recovery Diagnosis — 2026-09-10

The diagnostic rerun preserved the production provider graph, assertions, and `process.exit(1)` behavior. A temporary Jest setup outside the repository only mirrored the existing captured Nest logger error to stderr; it did not override a provider or intercept the exit. The earliest meaningful exception was:

```text
TrustProfileRuntimeReadinessError: Profile runtime readiness cannot be completed.
at TrustProfileRuntimeReadiness.assertReady
at GatewayModule MultiProfileUpstreamTokenVerifier useFactory
at NestFactory.create(GatewayModule)
```

The isolated failed-run database contained one `Customer`, one `IntegrationBinding`, and one active `GatewaySigningKey`, but zero `RegisteredUpstreamTrustProfile` rows. `TrustProfileRuntimeReadiness.assertReady()` requires at least one enabled, active, RS256 profile with nonblank issuer/audience and a JWKS URI accepted by `ProductionJwksSourceRegistrationPolicy`. The current harness provisions no such profile and still supplies only legacy `GATEWAY_UPSTREAM_*` environment values. Existing Gateway wiring tests explicitly require startup to fail when the persisted profile set is empty even if those legacy values exist. In addition, the harness's upstream authority publishes JWKS over an HTTP loopback IP, which the current production JWKS registration policy rejects.

This is `ROOT_CAUSE_CATEGORY=B`: the accepted production fail-closed behavior is operating correctly, while `test/support/gateway-backend-trust-chain-harness.ts` and its upstream test authority retain the stale assumptions that legacy environment bootstrap is sufficient and that an HTTP loopback JWKS source is eligible. Environment-only setup cannot repair the generated database or make that source satisfy the accepted policy.

The minimal proposed repair is test-harness-only: provision an enabled/active RS256 `RegisteredUpstreamTrustProfile` matching the fixture token before Gateway startup, and replace the HTTP loopback JWKS fixture with a deterministic test authority/transport arrangement that exercises the accepted HTTPS hostname and destination-safety contract without weakening or bypassing production validation. Human approval is required before changing either test helper. No source or test file was modified during this diagnosis; the diagnostic setup, temporary signing directory, and exact isolated `_test` database were removed afterward.

```text
GATEWAY_STARTUP_ROOT_CAUSE=HARNESS_PROVISIONS_ZERO_ACCEPTED_REGISTERED_UPSTREAM_TRUST_PROFILES_AND_USES_A_POLICY_INELIGIBLE_HTTP_LOOPBACK_JWKS_FIXTURE
ROOT_CAUSE_CATEGORY=B
SOURCE_CODE_CHANGE_REQUIRED=NO
TEST_CODE_CHANGE_REQUIRED=YES
ENVIRONMENT_OR_SETUP_CHANGE_REQUIRED=NO
GATEWAY_E2E_RERUN=FAIL
T001_RESULT=FAIL
T005_RESULT=BLOCKED
PREDECESSOR_CONTRACT_BASELINE_RESULT=BLOCKED
PHASE1_EXECUTED=NO
PHASE2_EXECUTED=NO
NEXT_ACTION=HUMAN_REVIEW_REQUIRED
```

#### T001 Human-Approved Harness Maintenance and Successful Rerun — 2026-09-10

Human review accepted Category B and authorized a test-harness-only maintenance patch. The original failure and diagnosis above remain unchanged. The repair made no production change:

- `test/support/gateway-backend-trust-chain-harness.ts` now creates one enabled, active, RS256 `RegisteredUpstreamTrustProfile` per fixture IntegrationBinding before compiling the real `GatewayModule`. The exact issuer, audience, and JWKS URI come from the test authority; legacy `GATEWAY_UPSTREAM_JWT_ISSUER`, `GATEWAY_UPSTREAM_JWT_AUDIENCE`, and `GATEWAY_UPSTREAM_JWKS_URI` are explicitly absent while the harness runs.
- `test/support/gateway-upstream-test-authority.ts` now exposes `https://gateway-upstream.test:<ephemeral-port>/.well-known/jwks.json`. It generates one-day test-only TLS material in the operating-system temporary directory, uses the existing `HardenedJwksTransport` dependency seam, exercises production URI validation and both destination-resolution checks with a deterministic public-safe address, and performs the fixture request over real TLS with certificate trust and `gateway-upstream.test` hostname verification. All TLS material is deleted on disposal.
- `test/e2e/gateway-backend-trust-chain.e2e-spec.ts` asserts the persisted profile, absence of legacy authority environment values, exact HTTPS hostname, two address checks, exact JWKS request, and an authorized TLS connection before accepting the real Gateway → Backend result.
- `test/e2e/gateway-identity-negative.e2e-spec.ts` changed only the stale unknown-binding expectation from 403 to the accepted profile-first 401 `UPSTREAM_IDENTITY_INVALID`; without a matching persisted profile, authentication must fail before IntegrationBinding resolution. The first recovery run exposed this stale expectation with 11/12 tests passing; the corrected rerun passed 12/12.

Verification evidence:

```text
npm run test:e2e -- --runInBand --runTestsByPath test/e2e/gateway-backend-trust-chain.e2e-spec.ts
Test Suites: 1 passed, 1 total
Tests: 1 passed, 1 total
Snapshots: 0 total

npm run test:e2e -- --runInBand --runTestsByPath test/e2e/gateway-identity-negative.e2e-spec.ts
Test Suites: 1 passed, 1 total
Tests: 12 passed, 12 total
Snapshots: 0 total

npm --prefix apps/gateway run test:unit -- --runTestsByPath test/integration-registry/trust-profile-runtime-readiness.spec.ts test/upstream-auth/jwks-source-policy.spec.ts test/upstream-auth/jwks-transport.spec.ts test/upstream-auth/profile-scoped-verifier.spec.ts
Test Suites: 4 passed, 4 total
Tests: 60 passed, 60 total
Snapshots: 0 total
```

The related unit command's first sandboxed attempt produced `listen EPERM: operation not permitted 127.0.0.1` for its pre-existing local fixture; the identical authorized rerun above passed. No assertion was weakened for that infrastructure restriction. The original T001 Bridge and IntegrationBinding evidence plus the repaired focused e2e now establish 24/24 required baseline suites and 216/216 required baseline tests. T002–T004 evidence remains valid because all protected hashes are unchanged.

```text
GATEWAY_TEST_HARNESS_REPAIR=PASS
ROOT_CAUSE_CATEGORY=B
PERSISTED_TRUST_PROFILE_PROVISIONED=YES
LEGACY_GATEWAY_UPSTREAM_ENV_USED_AS_AUTHORITY=NO
DETERMINISTIC_HTTPS_JWKS_TEST_AUTHORITY=YES
PRODUCTION_SOURCE_MODIFIED=NO
PRODUCTION_TRUST_POLICY_WEAKENED=NO
FEATURE007_HISTORY_MODIFIED=NO
FEATURE008_AUTHORITY_CHANGED=NO
GATEWAY_E2E=PASS
T001_RESULT=PASS
T002_RESULT=PASS
T003_RESULT=PASS
T004_RESULT=PASS
T005_RESULT=PASS
PREDECESSOR_CONTRACT_BASELINE_RESULT=PASS
PHASE1_EXECUTED=YES
PHASE2_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE2
```

## Phase 2 — Shared Connector-Runtime Contracts

**Goal**: Define one strict internal contract package before either runtime side implements behavior.  
**Dependencies**: T005.  
**Independent test**: Valid V1 vectors parse identically while unknown or unsafe fields fail closed and generic execution inputs are structurally impossible.

- [X] T006 [RED] [P] [BACKEND] Add failing invocation and generic binding-bootstrap envelope contract tests.
  - Files: `packages/connector-runtime-contract/test/wire/invocation.contract.spec.ts`, `packages/connector-runtime-contract/test/wire/binding.contract.spec.ts`.
  - Depends on: T005.
  - Validation: Run package tests and preserve failures caused only by absent V1 validators; require a bounded sensitive `providerPayload`, exact authenticated bootstrap profile/context, provider-dispatched result semantics, opaque reference response, and rejection of central/user/cross-profile proofs.
  - Stop: Neither generic contract may require `nativeAccessToken`, `acceptedEntry`, MenuDetail, Bridge-only bootstrap, bearer application, or JWT-exp parsing.

- [X] T007 [GREEN] [BACKEND] Implement strict invocation and binding V1 wire contracts.
  - Files: `packages/connector-runtime-contract/src/wire/**`, package configuration and exports under `packages/connector-runtime-contract/**`.
  - Depends on: T006.
  - Validation: Make T006 pass; verify 16,384-byte requests, 16,384-byte invocation responses, 4,096-byte binding responses, versions, request IDs, trusted context, exact registered bootstrap profile, bounded provider payload, operation, and opaque reference.
  - Stop: Do not expose these types through the public Assistant or SDK API.

- [X] T008 [RED] [P] [BACKEND] Add failing service-proof, safe-error, and limit contract tests.
  - Files: `packages/connector-runtime-contract/test/service-auth/service-proof.contract.spec.ts`, `packages/connector-runtime-contract/test/errors/safe-errors.contract.spec.ts`, `packages/connector-runtime-contract/test/limits/limits.contract.spec.ts`.
  - Depends on: T005.
  - Validation: Preserve RED for absent central and registered binding-bootstrap claim types, provider/profile isolation, closed error codes, body/provider-payload/JSON/budget bounds, and unknown-field rejection.
  - Stop: Do not select a new algorithm, wire version, error family, or timeout authority.

- [X] T009 [GREEN] [BACKEND] Implement service-proof claims, safe errors, and shared limits.
  - Files: `packages/connector-runtime-contract/src/service-auth/**`, `src/errors/**`, `src/limits/**`, and package exports.
  - Depends on: T008, T007.
  - Validation: Make T008 pass; prove the central profile and multiple exact binding-bootstrap profiles have separate issuer/audience/provider/key domains and closed code-only failures; include the Shinmone Bridge and Customer B fixture profiles.
  - Stop: Never place private keys, credentials, endpoints, raw exceptions, or caller-controlled budgets in shared values.

- [X] T010 [RED] [P] [BACKEND] Add failing closed manifest V1 schema tests.
  - Files: `packages/connector-runtime-contract/test/manifest/manifest-v1.contract.spec.ts`.
  - Depends on: T005.
  - Validation: Preserve RED for absent versioned schema, `credentialProfileRef`, `GET_QUERY_V1`, `POST_QUERY_JSON_V1`, exact operation/version, fixed mappings, read-only agreement, response extraction, limits, and strict unknown-key rejection.
  - Stop: Do not permit callbacks, arbitrary templates, wildcard operations, or executable configuration.

- [X] T011 [GREEN] [BACKEND] Implement the versioned closed manifest schema and validator.
  - Files: `packages/connector-runtime-contract/src/manifest/**` and package exports.
  - Depends on: T010, T007, T009.
  - Validation: Make T010 pass with immutable startup validation, generic bootstrap/provider/credential/profile/application interfaces, and the two closed read-request profile schemas.
  - Stop: No Customer endpoint, credential value, policy decision, or ToolDefinition registration belongs in the shared package.

- [X] T012 [RED] [BACKEND] Add structural-negative tests for all prohibited generic inputs.
  - Files: `packages/connector-runtime-contract/test/wire/prohibited-inputs.contract.spec.ts`, `test/manifest/closed-dsl-negative.contract.spec.ts`.
  - Depends on: T007, T009, T011.
  - Validation: Demonstrate RED if accepted generic types can require Shinmone/Feature 007 token/Entry/JWT fields or represent arbitrary URL/method/path/query/header/body/credential, executable template/callback/script, SQL, shell, generic command, or side effect.
  - Stop: Do not weaken the test through type casts or permissive unknown records.

- [X] T013 [GREEN] [BACKEND] Close shared validators and exports against prohibited input representation.
  - Files: `packages/connector-runtime-contract/src/wire/**`, `src/manifest/**`, `src/limits/**`, package root exports.
  - Depends on: T012.
  - Validation: Make T012 pass and rerun T006, T008, and T010 suites.
  - Stop: Shinmone `nativeAccessToken`, `acceptedEntry`, bearer, MenuDetail, and JWT-exp semantics belong only to its later integration provider, never the generic contract package.

- [X] T014 [VERIFY] [BACKEND] Verify shared-package build, deterministic vectors, and dependency isolation.
  - Files: `packages/connector-runtime-contract/**`, root package build wiring if required by the accepted package layout.
  - Depends on: T013.
  - Validation: Run package tests/build/typecheck and verify no Nest/Prisma/Assistant/Customer integration import; source guards reject Shinmone paths/result fields/IDs and mandatory native-token/Entry/Bridge/bearer/JWT assumptions.
  - Stop: Do not begin central or Customer-local network behavior in this phase.

- [X] T015 [CHECKPOINT] [BACKEND] Verify and record the Phase 2 contract gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T007, T009, T011, T013, T014.
  - Validation: Record a machine-readable evidence block with `CONNECTOR_RUNTIME_CONTRACT_READY=YES` only when all contract and structural-negative suites pass.
  - Stop: Phase 3 cannot start with a permissive field, unresolved contract, or failing package build.

### Phase 2 Execution Evidence — 2026-09-10

Phase 2 created only the isolated dependency-free shared contract package and this checkpoint evidence. The Spec Kit prerequisite helper reported the repository's unrelated Feature 002 branch context, but the explicit accepted Feature 009 path, Phase 1 PASS metadata, T005 dependency, and protected hashes were present and authoritative. No implementation hook was registered. Phase 1's failure → diagnosis → approved harness recovery evidence above remains unchanged.

| Task | Result | Evidence |
| --- | --- | --- |
| T006 | PASS | Authentic RED: 2/2 suites failed to compile only because `../../src` and the V1 validators did not exist; 0 tests ran. |
| T007 | PASS | Wire GREEN: 2/2 suites and 18/18 tests passed for exact-byte bounds, strict invocation/bootstrap envelopes, expected profile dispatch, opaque reference response, and code-only failures. |
| T008 | PASS | Authentic RED: 3/3 suites failed to compile only because service-proof, safe-error, and limit exports did not exist; 0 tests ran. |
| T009 | PASS | Service/error/limit GREEN: after correcting an initially over-restrictive `typ` profile-value check, the focused five-suite regression passed 34/34 tests. Central, reference Bridge, and Customer B fixture profiles remain separate test domains. |
| T010 | PASS | Authentic RED: the manifest suite failed to compile because `parseConnectorOperationManifestV1` did not exist; 0 tests ran. |
| T011 | PASS | Manifest GREEN: compile-time implementation issues and one traversal-validator miss were corrected without weakening tests; the six-suite regression passed 52/52 tests. Both closed read profiles and Customer B's POST-query operation are representable. |
| T012 | PASS | Authentic structural RED: 2/2 suites failed on four unused `@ts-expect-error` directives, proving direct construction remained possible for arguments, provider payload, GET path/query, and POST body; 0 tests ran. |
| T013 | PASS | Structural GREEN: parser-produced opaque/branded values closed all four surfaces; 2/2 structural suites passed 11/11 tests and the then-complete package passed 8/8 suites and 63/63 tests. |
| T014 | PASS | Final package verification passed 10/10 suites and 68/68 tests, build, source/test typecheck, deterministic vectors, zero-dependency/import checks, Customer-assumption source guards, and emitted-declaration open-record guards. |
| T015 | PASS | Protected hashes matched the Phase 1 baseline; only the new shared package and this Phase 2 evidence are task-created changes. T016 and every later task remain unchecked and unexecuted. |

Commands executed for Phase 2 validation:

```text
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
git status --short [--untracked-files=all]
shasum -a 256 <protected Feature 009/007/008, Prisma, and .DS_Store paths>
npm --prefix packages/connector-runtime-contract test -- --runInBand --runTestsByPath test/wire/invocation.contract.spec.ts test/wire/binding.contract.spec.ts
npm --prefix packages/connector-runtime-contract test -- --runInBand --runTestsByPath test/service-auth/service-proof.contract.spec.ts test/errors/safe-errors.contract.spec.ts test/limits/limits.contract.spec.ts
npm --prefix packages/connector-runtime-contract test -- --runInBand --runTestsByPath test/manifest/manifest-v1.contract.spec.ts
npm --prefix packages/connector-runtime-contract test -- --runInBand --runTestsByPath test/wire/prohibited-inputs.contract.spec.ts test/manifest/closed-dsl-negative.contract.spec.ts
npm --prefix packages/connector-runtime-contract test -- --runInBand
npm --prefix packages/connector-runtime-contract run build
npm --prefix packages/connector-runtime-contract run typecheck
rg <dependency/import, Customer-assumption, and emitted open-record guards>
```

Protected hashes after Phase 2, unchanged from Phase 1:

```text
FEATURE009_SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
FEATURE009_PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
FEATURE007_SPEC_SHA256=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
FEATURE007_DESIGN_SHA256=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
FEATURE007_PLAN_SHA256=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
FEATURE007_TASKS_SHA256=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
FEATURE008_SPEC_SHA256=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
FEATURE008_DESIGN_SHA256=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
FEATURE008_PLAN_SHA256=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
FEATURE008_TASKS_SHA256=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
PRISMA_SCHEMA_SHA256=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
SPECS_DS_STORE_SHA256=3997f3af185d3d6ac31d493a98e75ee397088b6fcf966ecee095d1264bd00e51
```

Checkpoint result:

```text
T006_RESULT=PASS
T007_RESULT=PASS
T008_RESULT=PASS
T009_RESULT=PASS
T010_RESULT=PASS
T011_RESULT=PASS
T012_RESULT=PASS
T013_RESULT=PASS
T014_RESULT=PASS
T015_RESULT=PASS
RED_GREEN_EVIDENCE=PASS
CONNECTOR_RUNTIME_CONTRACT_READY=YES
SHINMONE_REQUIRED_BY_GENERIC_CONTRACT=NO
NATIVE_ACCESS_TOKEN_REQUIRED_BY_GENERIC_CONTRACT=NO
ACCEPTED_ENTRY_REQUIRED_BY_GENERIC_CONTRACT=NO
BEARER_REQUIRED_BY_GENERIC_CONTRACT=NO
JWT_EXP_REQUIRED_BY_GENERIC_CONTRACT=NO
ARBITRARY_URL_REPRESENTABLE=NO
ARBITRARY_METHOD_REPRESENTABLE=NO
ARBITRARY_HEADER_REPRESENTABLE=NO
ARBITRARY_BODY_REPRESENTABLE=NO
GENERIC_SQL_REPRESENTABLE=NO
GENERIC_COMMAND_REPRESENTABLE=NO
SYNTHETIC_CUSTOMER_B_REPRESENTABLE=YES
FEATURE007_HISTORY_MODIFIED=NO
FEATURE008_AUTHORITY_CHANGED=NO
PRODUCTION_ASSISTANT_CORE_MODIFIED=NO
PHASE2_EXECUTED=YES
PHASE3_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE3
```

### Phase 2 Human-Gate Hardening — 2026-09-10

Post-checkpoint human review accepted the Phase 2 architecture and required two test-quality/trust-stage corrections without reopening T006–T015. The wire parser's argument brand is now `BoundedOperationArguments`, accurately expressing only bounded parser provenance; operation-specific input-schema validation and request mapping remain deferred to Phase 5. The parser-only brand still prevents direct construction from an ordinary object, while `ValidatedProviderPayload` remains unchanged because the selected profile actually validates it.

The two deterministic tests now use fixed input → complete exact normalized-output golden assertions. The invocation vector locks every envelope, context, operation, argument, budget, and reference field plus deep freezing. The Customer-neutral, Customer-B-compatible POST-query manifest vector locks its complete normalized schema, request profile/path/fixed body/mapping, credential profile, response/extraction, limits, error map, readiness dependency, and deep freezing. No self-comparison-only vector remains.

Validation evidence:

```text
npm --prefix packages/connector-runtime-contract test -- --runInBand
Test Suites: 10 passed, 10 total
Tests: 68 passed, 68 total
Snapshots: 0 total

npm --prefix packages/connector-runtime-contract run build
RESULT=PASS

npm --prefix packages/connector-runtime-contract run typecheck
RESULT=PASS

git diff --check
RESULT=PASS

VALIDATED_OPERATION_ARGUMENTS_SYMBOL_REMAINING=NO
BOUNDED_OPERATION_ARGUMENTS_EXPORTED=YES
DIRECT_UNVALIDATED_ARGUMENT_CONSTRUCTION_ALLOWED=NO
SELF_COMPARISON_ONLY_VECTOR_REMAINING=NO
PACKAGE_DEPENDENCY_IMPORT_GUARD=PASS
PACKAGE_CUSTOMER_ASSUMPTION_GUARD=PASS
```

Protected Feature 009 inputs remained unchanged:

```text
FEATURE009_SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
FEATURE009_PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
FEATURE007_HISTORY_MODIFIED=NO
FEATURE008_AUTHORITY_CHANGED=NO
PRISMA_MODIFIED=NO
```

Hardening-attributed changed files:

```text
packages/connector-runtime-contract/src/wire/wire.types.ts
packages/connector-runtime-contract/src/wire/wire.validation.ts
packages/connector-runtime-contract/test/wire/invocation.contract.spec.ts
packages/connector-runtime-contract/test/wire/prohibited-inputs.contract.spec.ts
packages/connector-runtime-contract/test/vectors/deterministic-vectors.spec.ts
specs/009-productized-business-connector-runtime/tasks.md
```

```text
FEATURE009_PHASE2_HUMAN_GATE_HARDENING=PASS
OPERATION_ARGUMENT_WIRE_TYPE=BoundedOperationArguments
OPERATION_ARGUMENT_SCHEMA_VALIDATION_DEFERRED_TO_PHASE5=YES
INVOCATION_GOLDEN_VECTOR=PASS
MANIFEST_GOLDEN_VECTOR=PASS
CUSTOMER_B_REPRESENTABLE=YES
T006_T015_REMAIN_COMPLETE=YES
T016_EXECUTED=NO
PHASE3_EXECUTED=NO
CONNECTOR_RUNTIME_CONTRACT_READY=YES
NEXT_ACTION=EXECUTE_PHASE3
```

## Phase 3 — Customer-Local Configuration, Service Authentication, and Replay

**Goal**: Establish a dark, fail-closed Connector Runtime foundation with separate central invocation and registered binding-bootstrap verifier profiles.
**Dependencies**: T015.  
**Independent test**: Only fresh, exact, correctly signed bytes are accepted; no credential-bearing binding route is active.

- [X] T016 [RED] [CONNECTOR-RUNTIME] Add failing standalone app, configuration, health, and readiness tests.
  - Files: `apps/customer-connector-runtime/test/bootstrap.spec.ts`, `test/config/configuration.spec.ts`, `test/health/readiness.spec.ts`.
  - Depends on: T015.
  - Validation: Preserve RED caused by the absent Nest app, immutable configuration parser, `/health`, and fail-closed `/ready`.
  - Stop: Do not activate invocation, binding, manifest, credential, or upstream routes.

- [X] T017 [GREEN] [CONNECTOR-RUNTIME] Create the standalone Nest application and configuration/readiness shell.
  - Files: `apps/customer-connector-runtime/package.json`, Nest/TypeScript/Jest configuration, `src/main.ts`, root module, `src/config/**`, `src/health/**`.
  - Depends on: T016.
  - Validation: Make T016 pass and run the independent app build; readiness remains false for unavailable later capabilities.
  - Stop: No database dependency, shared Gateway runtime, business route, or production-ready claim.

- [X] T018 [RED] [CONNECTOR-RUNTIME] Add failing tests for central and registered binding-bootstrap RS256 verifier profiles.
  - Files: `apps/customer-connector-runtime/test/service-auth/verifier-profiles.spec.ts`.
  - Depends on: T017.
  - Validation: Cover central, Shinmone Bridge, and Customer B fixture profiles plus unsigned, wrong algorithm/type/issuer/audience/provider/context, shared-key-domain attempts, unknown/retired key, and full cross-acceptance matrix; preserve intended RED.
  - Stop: No profile may accept Feature 007 user tokens, central proof on bootstrap, bootstrap proof on invocation, or another provider's key/profile.

- [X] T019 [GREEN] [CONNECTOR-RUNTIME] Implement profile-specific service-proof verification and key lifecycle.
  - Files: `apps/customer-connector-runtime/src/service-auth/**`.
  - Depends on: T018.
  - Validation: Make T018 pass using a startup registry of exact provider-bound `typ`/issuer/audience/context/key profiles, five-second tolerance, and published/active/retiring rules.
  - Stop: No private signing key or native credential may enter verifier configuration.

- [X] T020 [RED] [CONNECTOR-RUNTIME] Add failing exact raw-body digest and request-bound tests.
  - Files: `apps/customer-connector-runtime/test/service-auth/raw-body-proof.spec.ts`.
  - Depends on: T019.
  - Validation: Cover both route classes, altered bytes, digest mismatch, JSON reserialization difference, absent/invalid content type, content encoding, body over 16,384 bytes, and providerPayload bounds.
  - Stop: Do not compare reserialized objects or parse before raw-body proof and bounds.

- [X] T021 [GREEN] [CONNECTOR-RUNTIME] Implement raw-body capture, exact SHA-256 verification, and preparse bounds.
  - Files: `apps/customer-connector-runtime/src/service-auth/**`, app bootstrap/body handling.
  - Depends on: T020.
  - Validation: Make T020 pass and rerun profile tests; constant-time digest comparison precedes parsing.
  - Stop: Raw request bytes and service JWT must not reach logs, audit, diagnostics, or errors.

- [X] T022 [RED] [CONNECTOR-RUNTIME] Add failing freshness, replay, and rotation lifecycle tests.
  - Files: `apps/customer-connector-runtime/test/replay/replay-cache.spec.ts`, `test/service-auth/key-lifecycle.spec.ts`.
  - Depends on: T021.
  - Validation: Cover early/expired proofs, reused `jti`, atomic claim, capacity, cleanup, restart, active/retiring/unknown keys, and failed-request nonrelease.
  - Stop: Do not make replay entries durable or reusable after downstream failure.

- [X] T023 [GREEN] [CONNECTOR-RUNTIME] Implement bounded in-memory replay protection and lifecycle checks.
  - Files: `apps/customer-connector-runtime/src/replay/**`, `src/service-auth/**`.
  - Depends on: T022.
  - Validation: Make T022 pass with one accepted `jti` use, TTL/cap cleanup, and restart invalidation.
  - Stop: V1 remains single-replica; do not introduce Redis, database, or horizontal readiness.

- [X] T024 [RED] [CONNECTOR-RUNTIME] Add failing redaction, readiness, and inactive-binding-route tests.
  - Files: `apps/customer-connector-runtime/test/observability/redaction.spec.ts`, `test/health/readiness.spec.ts`, `test/service-auth/route-activation.spec.ts`.
  - Depends on: T023.
  - Validation: Require proofs/raw bytes/key/provider-payload data absent from captures and prove `/v1/internal/connector-bindings` is not active in Phase 3.
  - Stop: Do not claim ready while bindings, manifest, upstream, or required trust/configuration are incomplete.

- [X] T025 [GREEN] [CONNECTOR-RUNTIME] Complete safe observability and foundational readiness composition.
  - Files: `apps/customer-connector-runtime/src/observability/**`, `src/health/**`, root module composition.
  - Depends on: T024.
  - Validation: Make T024 pass; expose only safe health/readiness metadata and keep credential route inactive.
  - Stop: No proof, endpoint topology, private material, or sensitive context in health, logs, audit, or telemetry.

- [X] T026 [CHECKPOINT] [CONNECTOR-RUNTIME] Verify and record the Phase 3 service-auth/replay gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T017, T019, T021, T023, T025.
  - Validation: Run the full app foundational suites/build and record `SERVICE_AUTH_REPLAY_PROTECTION=READY`, `BINDING_CREDENTIAL_ROUTE_ACTIVE=NO`, and `BINDING_BOOTSTRAP_PROFILE_ISOLATION=PASS`.
  - Stop: Do not proceed if central/bootstrap or bootstrap-provider profiles overlap, raw-body checks occur late, or replay protection is incomplete.

### Phase 3 Execution Evidence — 2026-09-11

Phase 3 implemented only the dark Customer-local security foundation. The only controllers are `GET /health` and fail-closed `GET /ready`; both `POST /v1/internal/connector-bindings` and `POST /v1/connector/invocations` remain absent and return 404. No binding, manifest, credential, upstream, database, Redis, Assistant, Gateway, or Feature 007/008 behavior was added or changed.

| Pair | RED evidence | GREEN evidence |
| --- | --- | --- |
| T016 → T017 | The root Jest command first reported no app-local tests under its existing match rules. A one-use explicit Jest configuration then ran all three suites: 3/3 failed, 0 tests, with TS2307 for the absent app, configuration, and readiness modules. | The focused shell/config/health coverage passed in the final runtime regression. An intermediate run exposed only an over-broad safe-output matcher, sandbox socket denial, and TypeScript 6 deprecation setting; these execution/test configuration issues were corrected without weakening behavior. |
| T018 → T019 | 1/1 suite failed, 0 tests, because the profile registry and verifier did not exist. | 2/2 suites and 18/18 tests passed for the initial verifier/configuration GREEN; the final suite additionally covers wrong subject and strict JWK shape. |
| T020 → T021 | 1/1 suite failed, 0 tests, because exact raw-body authentication did not exist. | 2/2 suites and 20/20 tests passed for exact central/bootstrap bytes, one-byte/digest/serialization mutation, media and 16,384-byte bounds, constant-time digest comparison, and profile payload bounds. |
| T022 → T023 | 2/2 suites failed before execution: replay protection was absent; the new lifecycle fixture also had one compile-time literal-widening error, which was corrected before GREEN. | 3/3 focused suites and 17/17 tests passed for freshness, published/active/retiring acceptance, retired/unknown rejection, atomic one-use `jti`, capacity, cleanup, restart invalidation, and downstream non-release. Replay claim was then composed after exact digest verification. |
| T024 → T025 | Redaction and readiness suites failed because safe telemetry and the Phase 3 initializer were absent. Route checks encountered the sandbox's local-socket prohibition; the identical approved local-only rerun was used for behavior evidence. | 4/4 suites and 8/8 tests passed after one fixture was corrected to supply the real replay service. Safe observability, foundational-only readiness, health output, and both inactive routes passed. |

Final commands and results:

```text
npm --prefix apps/customer-connector-runtime test -- --runInBand
Test Suites: 9 passed, 9 total
Tests: 44 passed, 44 total
Snapshots: 0 total

npm --prefix apps/customer-connector-runtime run build
RESULT=PASS

npm --prefix apps/customer-connector-runtime run typecheck
RESULT=PASS

npm --prefix packages/connector-runtime-contract test -- --runInBand
Test Suites: 10 passed, 10 total
Tests: 68 passed, 68 total
Snapshots: 0 total

npm --prefix packages/connector-runtime-contract run build
RESULT=PASS

npm --prefix packages/connector-runtime-contract run typecheck
RESULT=PASS

git diff --check
RESULT=PASS

SPEC_KIT_PREREQUISITE_RESULT=NON_BLOCKING_BRANCH_METADATA_MISMATCH
SPEC_KIT_PREREQUISITE_SELECTED=002-host-integration-gateway-and-data-adapter-contract
AUTHORIZED_FEATURE_PATH=specs/009-productized-business-connector-runtime
IMPLEMENTATION_HOOKS_CONFIGURED=NO
PACKAGE_DEPENDENCY_GUARD=PASS
DATABASE_REDIS_PRISMA_GUARD=PASS
PREDECESSOR_ASSISTANT_IMPORT_GUARD=PASS
CUSTOMER_SPECIFIC_BRANCH_GUARD=PASS
PROTECTED_ROUTE_CONTROLLER_GUARD=HEALTH_READY_ONLY
```

Protected hashes remained unchanged:

```text
FEATURE009_SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
FEATURE009_PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
FEATURE007_SPEC_SHA256=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
FEATURE007_DESIGN_SHA256=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
FEATURE007_PLAN_SHA256=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
FEATURE007_TASKS_SHA256=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
FEATURE008_SPEC_SHA256=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
FEATURE008_DESIGN_SHA256=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
FEATURE008_PLAN_SHA256=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
FEATURE008_TASKS_SHA256=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
PRISMA_SCHEMA_SHA256=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
SPECS_DS_STORE_SHA256=3997f3af185d3d6ac31d493a98e75ee397088b6fcf966ecee095d1264bd00e51
PRISMA_MIGRATIONS_HASH_SET_CHANGED=NO
TASKS_PRE_CHECKPOINT_SHA256=6e725b1e368e7b4d14e3f12835d340fef06c459d8c6953c93ebc84c05f6f441c
```

Phase 3 changed only `apps/customer-connector-runtime/**` and this checkpoint evidence: five package/tooling files, sixteen source files, eleven test/fixture files, and this `tasks.md`.

```text
apps/customer-connector-runtime/jest.config.cjs
apps/customer-connector-runtime/nest-cli.json
apps/customer-connector-runtime/package.json
apps/customer-connector-runtime/tsconfig.json
apps/customer-connector-runtime/tsconfig.test.json
apps/customer-connector-runtime/src/config/configuration.module.ts
apps/customer-connector-runtime/src/config/runtime-configuration.ts
apps/customer-connector-runtime/src/customer-connector-runtime.module.ts
apps/customer-connector-runtime/src/health/phase3-readiness.initializer.ts
apps/customer-connector-runtime/src/health/readiness.service.ts
apps/customer-connector-runtime/src/health/runtime-health.controller.ts
apps/customer-connector-runtime/src/health/runtime-health.module.ts
apps/customer-connector-runtime/src/health/runtime-health.service.ts
apps/customer-connector-runtime/src/main.ts
apps/customer-connector-runtime/src/observability/safe-connector.telemetry.ts
apps/customer-connector-runtime/src/observability/safe-observability.module.ts
apps/customer-connector-runtime/src/replay/replay-protection.service.ts
apps/customer-connector-runtime/src/service-auth/exact-raw-body.authenticator.ts
apps/customer-connector-runtime/src/service-auth/service-auth.module.ts
apps/customer-connector-runtime/src/service-auth/service-profile.registry.ts
apps/customer-connector-runtime/src/service-auth/service-proof.verifier.ts
apps/customer-connector-runtime/test/bootstrap.spec.ts
apps/customer-connector-runtime/test/config/configuration.spec.ts
apps/customer-connector-runtime/test/fixtures/runtime-environment.ts
apps/customer-connector-runtime/test/fixtures/service-proof-fixtures.ts
apps/customer-connector-runtime/test/health/readiness.spec.ts
apps/customer-connector-runtime/test/observability/redaction.spec.ts
apps/customer-connector-runtime/test/replay/replay-cache.spec.ts
apps/customer-connector-runtime/test/service-auth/key-lifecycle.spec.ts
apps/customer-connector-runtime/test/service-auth/raw-body-proof.spec.ts
apps/customer-connector-runtime/test/service-auth/route-activation.spec.ts
apps/customer-connector-runtime/test/service-auth/verifier-profiles.spec.ts
specs/009-productized-business-connector-runtime/tasks.md
```

```text
FEATURE009_PHASE=3
RED_GREEN_EVIDENCE=PASS
SERVICE_AUTH_REPLAY_PROTECTION=READY
BINDING_CREDENTIAL_ROUTE_ACTIVE=NO
BINDING_BOOTSTRAP_PROFILE_ISOLATION=PASS
RAW_BODY_HASH_BEFORE_JSON_TRUST=YES
AUTHENTICATION_PROCESSING_ORDER=SIGNATURE_DIGEST_FRESHNESS_REPLAY_CONTEXT
SERVICE_PROOF_CROSS_PROFILE_ACCEPTANCE=NO
FEATURE007_USER_TOKEN_ACCEPTED_AS_SERVICE_PROOF=NO
REPLAY_JTI_ONE_USE=YES
REPLAY_STORE_DURABLE=NO
DATABASE_DEPENDENCY=NO
UPSTREAM_BUSINESS_CALL_ACTIVE=NO
SHINMONE_REQUIRED_BY_GENERIC_RUNTIME=NO
CUSTOMER_SPECIFIC_GENERIC_RUNTIME_BRANCH=NO
PHASE3_EXECUTED=YES
PHASE4_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE4
```

### Phase 3 Human-Gate Hardening — 2026-09-11

Human review accepted the Phase 3 production runtime and requested coverage-only hardening. The existing verifier fixtures now exercise all six directed central/Bridge/Customer-B cross-profile rejection paths in one table-driven matrix. Configuration regressions now lock the existing global rejection of a key domain shared across central and bootstrap kinds and of RSA public verification-key material reused across profiles; the prior bootstrap-to-bootstrap duplicate-domain assertion remains intact. No runtime production source or accepted contract changed.

Validation evidence:

```text
npm --prefix apps/customer-connector-runtime test -- --runInBand --runTestsByPath test/service-auth/verifier-profiles.spec.ts test/config/configuration.spec.ts
Test Suites: 2 passed, 2 total
Tests: 21 passed, 21 total
Snapshots: 0 total

npm --prefix apps/customer-connector-runtime test -- --runInBand
SANDBOX_ATTEMPT=INFRASTRUCTURE_ONLY_FAILURE
SANDBOX_ERROR=listen EPERM: operation not permitted 0.0.0.0
SANDBOX_RESULT=7 suites passed, 2 socket-dependent suites failed; 43 tests passed, 3 failed

npm --prefix apps/customer-connector-runtime test -- --runInBand  # identical authorized local-socket rerun
Test Suites: 9 passed, 9 total
Tests: 46 passed, 46 total
Snapshots: 0 total

npm --prefix apps/customer-connector-runtime run build
RESULT=PASS

npm --prefix apps/customer-connector-runtime run typecheck
RESULT=PASS

npm --prefix packages/connector-runtime-contract test -- --runInBand
Test Suites: 10 passed, 10 total
Tests: 68 passed, 68 total
Snapshots: 0 total

npm --prefix packages/connector-runtime-contract run build
RESULT=PASS

npm --prefix packages/connector-runtime-contract run typecheck
RESULT=PASS

git diff --check
RESULT=PASS
```

Protected hashes and the complete line-by-line `apps/customer-connector-runtime/src/**` SHA-256 inventory matched the pre-hardening baseline:

```text
FEATURE009_SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
FEATURE009_PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
FEATURE007_SPEC_SHA256=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
FEATURE007_DESIGN_SHA256=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
FEATURE007_PLAN_SHA256=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
FEATURE007_TASKS_SHA256=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
FEATURE008_SPEC_SHA256=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
FEATURE008_DESIGN_SHA256=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
FEATURE008_PLAN_SHA256=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
FEATURE008_TASKS_SHA256=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
PRISMA_SCHEMA_SHA256=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
SPECS_DS_STORE_SHA256=3997f3af185d3d6ac31d493a98e75ee397088b6fcf966ecee095d1264bd00e51
PRISMA_MIGRATIONS_HASH_SET_CHANGED=NO
RUNTIME_PRODUCTION_SOURCE_HASH_SET_CHANGED=NO
```

Hardening-attributed changed files:

```text
apps/customer-connector-runtime/test/service-auth/verifier-profiles.spec.ts
apps/customer-connector-runtime/test/config/configuration.spec.ts
specs/009-productized-business-connector-runtime/tasks.md
```

```text
FEATURE009_PHASE3_HUMAN_GATE_HARDENING=PASS
FULL_CROSS_PROFILE_MATRIX=PASS
CENTRAL_TO_BRIDGE_REJECTED=YES
CENTRAL_TO_CUSTOMER_B_REJECTED=YES
BRIDGE_TO_CENTRAL_REJECTED=YES
BRIDGE_TO_CUSTOMER_B_REJECTED=YES
CUSTOMER_B_TO_CENTRAL_REJECTED=YES
CUSTOMER_B_TO_BRIDGE_REJECTED=YES
GLOBAL_KEY_DOMAIN_ISOLATION_TEST=PASS
CROSS_KIND_SHARED_KEY_DOMAIN_REJECTED=YES
CROSS_PROFILE_KEY_MATERIAL_REUSE_REJECTED=YES
TASKS_PHASE_STATUS_SYNCHRONIZED=YES
PRODUCTION_RUNTIME_SOURCE_MODIFIED=NO
FEATURE007_HISTORY_MODIFIED=NO
FEATURE008_AUTHORITY_CHANGED=NO
FEATURE009_SPEC_DESIGN_PLAN_MODIFIED=NO
RUNTIME_TESTS=PASS
RUNTIME_BUILD=PASS
RUNTIME_TYPECHECK=PASS
SHARED_CONTRACT_REGRESSION=PASS
T016_T026_REMAIN_COMPLETE=YES
T027_EXECUTED=NO
PHASE4_EXECUTED=NO
SERVICE_AUTH_REPLAY_PROTECTION=READY
BINDING_CREDENTIAL_ROUTE_ACTIVE=NO
CONNECTOR_RUNTIME_CONTRACT_READY=YES
NEXT_ACTION=EXECUTE_PHASE4
```

## Phase 4 — Customer-Local Binding Lifecycle

**Goal**: Create, resolve, lease, revoke, and expire context-bound volatile bindings holding provider-owned handles/metadata without implementing any bootstrap initiator transport.
**Dependencies**: T026.  
**Independent test**: One valid reference resolves locally within its exact tuple and lifetime; every mismatch fails before credential access.

- [X] T027 [RED] [US1] [CONNECTOR-RUNTIME] Add failing reference generation, hashed lookup, and TTL tests.
  - Files: `apps/customer-connector-runtime/test/bindings/binding-store.spec.ts`.
  - Depends on: T026.
  - Validation: Cover 256-bit `ccr_` references, SHA-256 lookup key, no raw-reference storage, 120-second max, optional provider expiry cap minus 15 seconds, 60-second absent-cap fallback, 15-second minimum, and no generic JWT parsing.
  - Stop: Do not persist/embed credential material, `acceptedEntry`, or `nativeAccessToken` in the reference or generic binding.

- [X] T028 [GREEN] [US1] [CONNECTOR-RUNTIME] Implement the bounded in-memory binding store and lifetime calculation.
  - Files: `apps/customer-connector-runtime/src/bindings/**`.
  - Depends on: T027.
  - Validation: Make T027 pass with injected clock/randomness, provider key, opaque credential handle, bounded provider metadata, binding/credential generations, and optional actor/organization constraints.
  - Stop: No durable store, reversible reference key, Customer-specific mandatory field, RefreshToken, cookie, or central state.

- [X] T029 [RED] [US1] [CONNECTOR-RUNTIME] Add failing exact context and single-generation tests.
  - Files: `apps/customer-connector-runtime/test/bindings/binding-context.spec.ts`.
  - Depends on: T028.
  - Validation: Vary Customer, integration, HostApp, connector instance, optional organization/actor constraints, bootstrap/credential provider, binding generation, and credential generation independently.
  - Stop: Errors must not disclose which dimension mismatched.

- [X] T030 [GREEN] [US1] [CONNECTOR-RUNTIME] Implement exact binding context checks and atomic generation replacement.
  - Files: `apps/customer-connector-runtime/src/bindings/**`.
  - Depends on: T029.
  - Validation: Make T029 pass; successful remint revokes the prior generation before it can lease.
  - Stop: Browser, Assistant session ID, or reference possession must not establish context authority.

- [X] T031 [RED] [US1] [CONNECTOR-RUNTIME] Add failing concurrency, revoke, cleanup, and restart tests.
  - Files: `apps/customer-connector-runtime/test/bindings/binding-lifecycle.spec.ts`.
  - Depends on: T030.
  - Validation: Cover four leases, fifth busy before provider resolution, finally-release, expiry, administrative/provider rejection, bounded sweep, provider-handle teardown, and restart invalidation.
  - Stop: Do not exceed four leases or leave a provider handle/credential accessible after revoke/expiry.

- [X] T032 [GREEN] [US1] [CONNECTOR-RUNTIME] Implement lease, revocation, cleanup, and shutdown lifecycle.
  - Files: `apps/customer-connector-runtime/src/bindings/**` and local shutdown composition.
  - Depends on: T031.
  - Validation: Make T031 pass under deterministic timers and concurrent access.
  - Stop: Do not add cross-replica semantics or claim horizontal readiness.

- [X] T033 [RED] [US1] [CONNECTOR-RUNTIME] Add failing Customer-local binding server-route, leak, and cross-boundary tests.
  - Files: `apps/customer-connector-runtime/test/bindings/connector-binding-route.spec.ts`, `test/bindings/binding-security.spec.ts`, `test/observability/redaction.spec.ts`.
  - Depends on: T032.
  - Validation: Preserve store/leak/tuple coverage and prove the absent exact `POST /v1/internal/connector-bindings`; require POST, JSON/no encoding, 16,384-byte cap, one exact registered bootstrap `typ`/issuer/audience/provider/key profile, raw-byte SHA-256 before JSON trust, freshness/replay, signed context equality, strict generic schema with bounded sensitive `providerPayload`, provider-owned handle/cap/metadata result, and rejection of Feature 007 user JWTs, central proofs, and other bootstrap profiles. Require order raw method/content/bounds → profile proof/digest → freshness/replay/context → parse/schema → profile/config equality → selected `BindingBootstrapProvider` closed validation/create → `ConnectorBindingService.mint()` → only version/requestId/reference/expiresIn within 4,096 bytes; failures are safe and all sensitive values are redacted.
  - Stop: Never satisfy through post-storage redaction; no Browser/profile override, cross-profile provider dispatch, identity authority, generic JWT parse, or credential field in the binding.

- [X] T034 [GREEN] [US1] [CONNECTOR-RUNTIME] Implement and compose the generic Customer-local binding-bootstrap endpoint.
  - Files: `apps/customer-connector-runtime/src/bindings/connector-binding.controller.ts`, `src/bindings/connector-binding-request.service.ts`, existing `src/bindings/**`, `src/observability/**`, and narrow runtime module/root composition.
  - Depends on: T033.
  - Validation: Make T033 pass by composing Phase 3 exact bootstrap-profile verification/replay with `BindingBootstrapProviderRegistry` and `ConnectorBindingService`; activate the route only after foundations validate, preserve processing order/bounds, return no provider handle/metadata, and prove credential resolution/upstream seams remain untouched for invalid requests.
  - Stop: Do not implement any initiator/Bridge client, add identity/permission/Customer/HostApp/Entry/Gateway authority, call upstream, expose centrally, parse generic JWT expiry, or permit Browser minting.

- [X] T035 [CHECKPOINT] [US1] [CONNECTOR-RUNTIME] Verify and record the Phase 4 binding gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T028, T030, T032, T034.
  - Validation: Run all binding/route suites and record `NATIVE_CREDENTIAL_CENTRAL=NO`, `CONNECTOR_CONTEXT_REF_PERSISTED=NO`, all cross-dimension reuse denied, `BINDING_CREDENTIAL_ROUTE_ACTIVE=YES`, `BINDING_ROUTE_PROFILE=BINDING_BOOTSTRAP_ONLY`, `BINDING_ROUTE_PROFILE_ISOLATION=PASS`, `BINDING_ROUTE_NATIVE_TOKEN_CENTRAL=NO`, and `BINDING_ROUTE_SERVICE_AUTH_ORDER=PASS`; Shinmone's separate profile marker is recorded in T080.
  - Stop: Phase 5 cannot start if the Customer-local binding endpoint is inactive or insecure, or if raw reference storage, credential egress, profile confusion, ordering failure, or context ambiguity exists.

### Phase 4 Execution and Human-Gate Hardening Evidence — 2026-09-11

Phase 4 implemented only the Customer-local volatile binding lifecycle and the registered-bootstrap-only `POST /v1/internal/connector-bindings` route. The implementation stores a SHA-256 verifier rather than the returned raw reference, retains only provider-owned opaque handles and bounded metadata, and keeps `/v1/connector/invocations` absent. No manifest, credential resolution/application, upstream transport, Bridge client, central adapter, database, Redis, public Assistant/SSE/SDK contract, Feature 007/008 artifact, or Phase 5 task was changed or executed.

| Pair | RED evidence | GREEN evidence |
| --- | --- | --- |
| T027 → T028 | After correcting one test-authoring matcher typo, the authentic RED was 1/1 suite failed before execution with TS2307 for the absent in-memory binding store. | The focused store/configuration run passed 2/2 suites and 16/16 tests after implementing 256-bit reference generation, SHA-256 lookup, bounded capacities/metadata, and provider-capped/fallback TTLs. |
| T029 → T030 | 1/1 suite failed before execution with TS2307 for the absent `ConnectorBindingService`. | Exact Customer/integration/HostApp/connector/optional actor/organization/provider/generation checks and atomic generation replacement passed with the adjacent store suite: 2/2 suites and 13/13 tests. |
| T031 → T032 | 1/1 suite failed before execution because `withLease`, `revoke`, `sweepExpired`, and `shutdown` did not exist. | Lease/revoke/cleanup/restart coverage passed with adjacent binding suites: 3/3 suites and 19/19 tests. The fifth lease fails before provider use; release is in `finally`; revoke aborts active work and awaits teardown. |
| T033 → T034 | Route/orchestration suites failed because the provider and request-service modules were absent. The same run separately hit the expected sandbox `listen EPERM` for its local HTTP test. | The identical local-socket focused run passed 3/3 suites and 7/7 tests after composing the real bootstrap-only route. An intermediate fixture serialization mismatch produced safe 401 responses and was corrected without weakening authentication. |

The first full Phase 4 regression exposed one stale Phase 3 binding-route 404 expectation plus one transient Supertest parse failure; the focused route rerun passed and the stale expectation was updated to the Phase 4 fail-closed 401 contract. The pre-hardening runtime then passed 15/15 suites and 76/76 tests. Human-gate hardening added exact optional-context presence/absence isolation, mint-failure provider-handle teardown, superseded-generation teardown, and deterministic provider-expiry composition coverage. No production change was required by that hardening.

Final validation:

```text
npm --prefix apps/customer-connector-runtime test -- --runInBand
Test Suites: 15 passed, 15 total
Tests: 84 passed, 84 total
Snapshots: 0 total

npm --prefix apps/customer-connector-runtime run build
RESULT=PASS

npm --prefix apps/customer-connector-runtime run typecheck
RESULT=PASS

npm --prefix packages/connector-runtime-contract test -- --runInBand
Test Suites: 10 passed, 10 total
Tests: 68 passed, 68 total
Snapshots: 0 total

npm --prefix packages/connector-runtime-contract run build
RESULT=PASS

npm --prefix packages/connector-runtime-contract run typecheck
RESULT=PASS

git diff --check
RESULT=PASS

SPEC_KIT_PREREQUISITE_RESULT=NON_BLOCKING_BRANCH_METADATA_MISMATCH
SPEC_KIT_PREREQUISITE_SELECTED=002-host-integration-gateway-and-data-adapter-contract
AUTHORIZED_FEATURE_PATH=specs/009-productized-business-connector-runtime
IMPLEMENTATION_HOOKS_CONFIGURED=NO
```

Protected hashes remained unchanged:

```text
FEATURE009_SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
FEATURE009_PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
FEATURE007_SPEC_SHA256=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
FEATURE007_DESIGN_SHA256=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
FEATURE007_PLAN_SHA256=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
FEATURE007_TASKS_SHA256=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
FEATURE008_SPEC_SHA256=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
FEATURE008_DESIGN_SHA256=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
FEATURE008_PLAN_SHA256=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
FEATURE008_TASKS_SHA256=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
PRISMA_SCHEMA_SHA256=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
SPECS_DS_STORE_SHA256=3997f3af185d3d6ac31d493a98e75ee397088b6fcf966ecee095d1264bd00e51
PRISMA_MIGRATIONS_CHANGED=NO
TASKS_PRE_PHASE4_SHA256=64761a9ad65fc710cd6ef7f0269a9435f810aa378da48ff12f61f33738f04c2f
```

Reviewed Phase 4 production binding source inventory:

```text
apps/customer-connector-runtime/src/bindings/binding-bootstrap-provider.registry.ts
apps/customer-connector-runtime/src/bindings/binding-bootstrap-provider.ts
apps/customer-connector-runtime/src/bindings/binding-lifecycle.manager.ts
apps/customer-connector-runtime/src/bindings/binding-readiness.initializer.ts
apps/customer-connector-runtime/src/bindings/binding.types.ts
apps/customer-connector-runtime/src/bindings/connector-binding-request.service.ts
apps/customer-connector-runtime/src/bindings/connector-binding.controller.ts
apps/customer-connector-runtime/src/bindings/connector-binding.module.ts
apps/customer-connector-runtime/src/bindings/connector-binding.service.ts
apps/customer-connector-runtime/src/bindings/in-memory-connector-binding.store.ts
```

Exact Phase 4 task-attributed changed files:

```text
apps/customer-connector-runtime/src/bindings/binding-bootstrap-provider.registry.ts
apps/customer-connector-runtime/src/bindings/binding-bootstrap-provider.ts
apps/customer-connector-runtime/src/bindings/binding-lifecycle.manager.ts
apps/customer-connector-runtime/src/bindings/binding-readiness.initializer.ts
apps/customer-connector-runtime/src/bindings/binding.types.ts
apps/customer-connector-runtime/src/bindings/connector-binding-request.service.ts
apps/customer-connector-runtime/src/bindings/connector-binding.controller.ts
apps/customer-connector-runtime/src/bindings/connector-binding.module.ts
apps/customer-connector-runtime/src/bindings/connector-binding.service.ts
apps/customer-connector-runtime/src/bindings/in-memory-connector-binding.store.ts
apps/customer-connector-runtime/src/config/runtime-configuration.ts
apps/customer-connector-runtime/src/customer-connector-runtime.module.ts
apps/customer-connector-runtime/src/main.ts
apps/customer-connector-runtime/src/service-auth/exact-raw-body.authenticator.ts
apps/customer-connector-runtime/src/service-auth/service-proof.verifier.ts
apps/customer-connector-runtime/test/bindings/binding-context.spec.ts
apps/customer-connector-runtime/test/bindings/binding-lifecycle.spec.ts
apps/customer-connector-runtime/test/bindings/binding-provider-registry.spec.ts
apps/customer-connector-runtime/test/bindings/binding-security.spec.ts
apps/customer-connector-runtime/test/bindings/binding-store.spec.ts
apps/customer-connector-runtime/test/bindings/connector-binding-route.spec.ts
apps/customer-connector-runtime/test/bootstrap.spec.ts
apps/customer-connector-runtime/test/config/configuration.spec.ts
apps/customer-connector-runtime/test/fixtures/runtime-environment.ts
apps/customer-connector-runtime/test/service-auth/route-activation.spec.ts
specs/009-productized-business-connector-runtime/tasks.md
```

The shared contract package and all protected artifacts are unchanged. The human-gate hardening itself changed only `binding-context.spec.ts`, `binding-lifecycle.spec.ts`, `binding-security.spec.ts`, and this evidence section; existing production behavior satisfied every added regression.

```text
FEATURE009_PHASE=4
RED_GREEN_EVIDENCE=PASS
BINDING_REFERENCE_BITS>=256
RAW_CONNECTOR_CONTEXT_REF_STORED=NO
BINDING_STORE_DURABLE=NO
MAX_CONCURRENT_BINDING_LEASES=4
BINDING_CREDENTIAL_ROUTE_ACTIVE=YES
BINDING_ROUTE_PROFILE=BINDING_BOOTSTRAP_ONLY
BINDING_ROUTE_PROFILE_ISOLATION=PASS
BINDING_ROUTE_SERVICE_AUTH_ORDER=PASS
BINDING_ROUTE_NATIVE_TOKEN_CENTRAL=NO
NATIVE_CREDENTIAL_CENTRAL=NO
CONNECTOR_CONTEXT_REF_PERSISTED=NO
OPTIONAL_CONTEXT_PRESENCE_ISOLATION=PASS
MINT_FAILURE_PROVIDER_HANDLE_TEARDOWN=PASS
REMINT_SUPERSEDED_HANDLE_TEARDOWN=PASS
PROVIDER_EXPIRY_COMPOSITION=PASS
GENERIC_JWT_EXPIRY_PARSE=NO
NATIVE_CREDENTIAL_IN_GENERIC_BINDING=NO
CUSTOMER_SPECIFIC_GENERIC_BRANCH=NO
DATABASE_OR_REDIS_BINDING_STORE=NO
UPSTREAM_BUSINESS_CALL_ACTIVE=NO
FEATURE007_HISTORICAL_FILES_MODIFIED=NO
FEATURE008_ACCEPTED_AUTHORITY_CHANGED=NO
PUBLIC_ASSISTANT_SSE_SDK_CHANGE=NO
TASK_COUNT=142
T001_T035_COMPLETE=YES
T035=PASS
T036_EXECUTED=NO
PHASE4_EXECUTED=YES
PHASE5_EXECUTED=NO
FIRST_UNEXECUTED_TASK=T036
NEXT_ACTION=EXECUTE_PHASE5
```

### Phase 4 Post-Checkpoint Exception-Path Hardening — 2026-09-11

Human review identified one pre-transfer ownership exception path after T035: `BindingBootstrapProvider.create()` could succeed and `ConnectorBindingService.mint()` could reject before ownership transferred, while the outer safe-failure handler did not retain enough state to tear down the newly created provider handle. This hardening preserves the completed T027–T035 history and changes no Phase 4 contract or later-phase behavior.

Authentic RED and focused GREEN:

```text
npm --prefix apps/customer-connector-runtime test -- --runInBand --runTestsByPath test/bindings/binding-security.spec.ts
RED_RESULT=1 suite failed; 1 test failed, 5 passed
RED_ASSERTION=provider.revoke expected 1 call but received 0 after bindings.mint rejected with mint-exception-sentinel

npm --prefix apps/customer-connector-runtime test -- --runInBand --runTestsByPath test/bindings/binding-security.spec.ts
GREEN_RESULT=1 suite passed; 7 tests passed
```

`ConnectorBindingRequestService` now tracks the created provider result, whether binding ownership transferred, and whether pre-transfer cleanup was attempted. Before a successful mint, request orchestration attempts `provider.revoke(handle, "mint_failed")` at most once for both a returned failure and a thrown/rejected mint. Cleanup errors are swallowed into the same code-only safe failure. Immediately after `mint()` returns success, lifecycle ownership belongs exclusively to `ConnectorBindingService`; the successful response path invokes neither provider cleanup nor binding revocation.

Final validation:

```text
npm --prefix apps/customer-connector-runtime test -- --runInBand
Test Suites: 15 passed, 15 total
Tests: 86 passed, 86 total
Snapshots: 0 total

npm --prefix apps/customer-connector-runtime run build
RESULT=PASS

npm --prefix apps/customer-connector-runtime run typecheck
RESULT=PASS

npm --prefix packages/connector-runtime-contract test -- --runInBand
Test Suites: 10 passed, 10 total
Tests: 68 passed, 68 total
Snapshots: 0 total

npm --prefix packages/connector-runtime-contract run build
RESULT=PASS

npm --prefix packages/connector-runtime-contract run typecheck
RESULT=PASS

git diff --check
RESULT=PASS
```

Protected Feature 007/008 artifacts, Feature 009 `spec.md`/`design.md`/`plan.md`, the shared contract package, Prisma schema/migrations, and `specs/.DS_Store` retained their Phase 4 checkpoint hashes. Exact hardening-attributed changed files:

```text
apps/customer-connector-runtime/src/bindings/connector-binding-request.service.ts
apps/customer-connector-runtime/test/bindings/binding-security.spec.ts
specs/009-productized-business-connector-runtime/tasks.md
```

```text
FEATURE009_PHASE4_EXCEPTION_PATH_HARDENING=PASS
MINT_RESULT_FAILURE_PROVIDER_HANDLE_TEARDOWN=PASS
MINT_EXCEPTION_PROVIDER_HANDLE_TEARDOWN=PASS
PROVIDER_HANDLE_OWNERSHIP_TRANSFER=PASS
RUNTIME_TESTS=PASS
RUNTIME_BUILD=PASS
RUNTIME_TYPECHECK=PASS
SHARED_CONTRACT_REGRESSION=PASS
PRODUCTION_FILES_CHANGED=apps/customer-connector-runtime/src/bindings/connector-binding-request.service.ts
T001_T035_COMPLETE=YES
T035_REMAINS_COMPLETE=YES
T036_EXECUTED=NO
PHASE4_EXECUTED=YES
PHASE5_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE5
```

## Phase 5 — Closed Operation Manifest and Credential Boundary

**Goal**: Resolve only startup-approved read operations and keep provider-handle resolution plus credential application behind every trust and validation gate.
**Dependencies**: T035.  
**Independent test**: One exact fixture operation maps safely; every unknown, dynamic, executable, or excessive entry fails before credential access.

- [X] T036 [RED] [US3] [CONNECTOR-RUNTIME] Add failing closed startup manifest-schema tests.
  - Files: `apps/customer-connector-runtime/test/manifest/manifest-loader.spec.ts`.
  - Depends on: T035.
  - Validation: Cover duplicate key/version, unknown fields, wildcard, callback/template/script, dynamic URL/method/path/query/header/body, traversal, SQL/shell/command, non-read-only classification, unsupported request profile, and cap violations.
  - Stop: Do not relax the shared schema or allow runtime-generated executable configuration.

- [X] T037 [GREEN] [US3] [CONNECTOR-RUNTIME] Implement immutable startup manifest loading and readiness failure.
  - Files: `apps/customer-connector-runtime/src/manifest/**`, `src/health/**`.
  - Depends on: T036.
  - Validation: Make T036 pass using read-only absolute manifest files and strict shared validation.
  - Stop: No hot reload, callbacks, wildcard operation, or partially valid registry.

- [X] T038 [RED] [US3] [CONNECTOR-RUNTIME] Add failing exact operation/version and validated-argument mapping tests.
  - Files: `apps/customer-connector-runtime/test/manifest/operation-manifest-registry.spec.ts`.
  - Depends on: T037.
  - Validation: Cover exact success for `GET_QUERY_V1` and `POST_QUERY_JSON_V1`, missing/ambiguous/inactive/version mismatch, bad arguments, fixed literals, schema-bound named mappings, unrestricted expansion, and destination/method/path/query/header/body overrides.
  - Stop: Caller arguments may select only explicitly declared bounded values.

- [X] T039 [GREEN] [US3] [CONNECTOR-RUNTIME] Implement `OperationManifestRegistry` and closed request mapping.
  - Files: `apps/customer-connector-runtime/src/manifest/**`.
  - Depends on: T038.
  - Validation: Make T038 pass with exact immutable entries and safe failures; include generic fixture manifests for GET and Synthetic Customer B `inventory.stock-on-hand` using `POST_QUERY_JSON_V1 /inventory/stock/query`, only named `sku`, and a `credentialProfileRef`.
  - Stop: No fallback to another operation, version, service reference, or generic transport.

- [X] T040 [RED] [US3] [CONNECTOR-RUNTIME] Add failing credential-provider/profile/strategy ordering and override tests.
  - Files: `apps/customer-connector-runtime/test/credentials/credential-profile-registry.spec.ts`, `test/credentials/credential-providers.spec.ts`, `test/manifest/execution-order.spec.ts`.
  - Depends on: T039.
  - Validation: Prove provider remains uncalled until service auth, replay/context, binding, manifest/profile/read-only/arguments pass; reject unknown/incompatible/overridden profile, handle/provider, and application strategy. Cover removable Shinmone bearer and fixture-only Customer B API-key registrations.
  - Stop: Never expose material/handle to manifest, caller, errors, health, or central code; no manifest-selected header.

- [X] T041 [GREEN] [US3] [CONNECTOR-RUNTIME] Implement registered credential providers, profiles, and fixed application strategies behind validated bindings.
  - Files: `apps/customer-connector-runtime/src/credentials/**`, manifest execution composition.
  - Depends on: T040.
  - Validation: Make T040 pass with `CredentialProvider`, `CredentialProfileRegistry`, and `CredentialApplicationStrategy`; include provider-owned handle semantics, bearer fixture, and fixed allowlisted `X-Inventory-Key` fixture strategy without leaking material.
  - Stop: No credential-returning public interface, bearer-only generic contract, caller/header injection, Customer identity call, or generic RefreshToken support.

- [X] T042 [RED] [US3] [CONNECTOR-RUNTIME] Add failing response declaration, extraction pointer, limit, and readiness tests.
  - Files: `apps/customer-connector-runtime/test/manifest/response-contract.spec.ts`, `test/health/readiness.spec.ts`.
  - Depends on: T041.
  - Validation: Cover bad JSON Pointer, unsupported/incompatible credential profile or request profile, invalid response schema, excessive limit, missing provider/strategy/manifest, and incomplete readiness.
  - Stop: Readiness cannot be true with an invalid or incomplete manifest/credential boundary.

- [X] T043 [GREEN] [US3] [CONNECTOR-RUNTIME] Complete manifest response declarations, caps, and readiness composition.
  - Files: `apps/customer-connector-runtime/src/manifest/**`, `src/health/**`.
  - Depends on: T042.
  - Validation: Make T042 pass and rerun T036, T038, and T040 suites.
  - Stop: This phase does not perform an upstream connection or release a result.

- [X] T044 [CHECKPOINT] [US3] [CONNECTOR-RUNTIME] Verify and record the Phase 5 exact-manifest gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T037, T039, T041, T043.
  - Validation: Record `MANIFEST_OPERATION_EXACT_MATCH=YES`, `CREDENTIAL_PROFILE_ISOLATION=PASS`, `CLOSED_READ_REQUEST_PROFILES=GET_QUERY_V1,POST_QUERY_JSON_V1`, and all generic URL/SQL/command/body/header gates as `NO` only after the full suite passes.
  - Stop: Phase 6 cannot start if credential resolution is reachable through an invalid request.

### Phase 5 Execution Evidence — 2026-09-11

The Phase 5 implementation is confined to the Customer-local runtime manifest/credential boundary. It activates no business invocation route and performs no upstream networking. Existing Phase 1–4 evidence remains unchanged.

Authentic RED evidence:

- T036: `npm --prefix apps/customer-connector-runtime test -- --runInBand --runTestsByPath test/manifest/manifest-loader.spec.ts` failed before production changes with `TS2307` for the missing `manifest-file.loader`; 1 suite failed, 0 tests executed.
- T038: the focused operation-registry command failed before production changes with `TS2307` for the missing `operation-manifest.registry`; 1 suite failed, 0 tests executed.
- T040: the three credential/profile/order suites failed before production changes with `TS2307` for the missing credential registry and execution boundary; 3 suites failed, 0 tests executed.
- T042: response/readiness RED produced three semantic declaration failures plus the missing readiness initializer; 2 suites failed, with 3 failed and 2 passing tests.

GREEN and checkpoint evidence:

- T037 manifest loader: 1 suite, 23 tests passed after adding immutable read-only absolute-file loading, strict shared parsing, atomic multi-file validation, startup composition, and global exact-identity rejection.
- T039 manifest lookup/mapping: focused manifest suites passed with exact key/version lookup, recursive input-schema validation, fixed-literal protection, and closed GET/POST-query mappings.
- T041 credential boundary: 3 suites, 19 tests passed initially; the final execution-order suite contains 11 passing tests and composes the real exact-byte authenticator, replay service, invocation parser, binding lease, manifest validation, profile registry, provider, and strategy without registering a route.
- T043 response/readiness: 2 suites, 13 tests passed initially; final focused configuration/operation/response validation passed 3 suites and 36 tests.
- Full Customer-local runtime: 21 suites, 158 tests passed. The identical command required the approved local-only execution path because sandboxed Supertest socket binding returned `EPERM`; no source/test workaround was made.
- Shared contract regression: 10 suites, 68 tests passed. Runtime build, runtime typecheck, shared build, shared typecheck, and `git diff --check` passed.
- The read-only Spec Kit prerequisite command remained blocked by its pre-existing Feature 002 branch-selection mismatch; the accepted Feature 009 absolute path and task state were used. No implementation hooks were configured or run.

Protected artifact hashes remained unchanged:

```text
FEATURE007_SPEC_SHA256=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
FEATURE007_DESIGN_SHA256=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
FEATURE007_PLAN_SHA256=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
FEATURE007_TASKS_SHA256=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
FEATURE008_SPEC_SHA256=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
FEATURE008_DESIGN_SHA256=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
FEATURE008_PLAN_SHA256=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
FEATURE008_TASKS_SHA256=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
FEATURE009_SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
FEATURE009_PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
PRISMA_SCHEMA_SHA256=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
SPECS_DS_STORE_SHA256=3997f3af185d3d6ac31d493a98e75ee397088b6fcf966ecee095d1264bd00e51
TASKS_PRE_PHASE5_SHA256=dce26487a6cb122904c44a2ceea0263aba081f4963ab8ffd56e0df9012f3e0ac
```

Phase 5 checkpoint:

```text
MANIFEST_OPERATION_EXACT_MATCH=YES
CREDENTIAL_PROFILE_ISOLATION=PASS
CLOSED_READ_REQUEST_PROFILES=GET_QUERY_V1,POST_QUERY_JSON_V1
ARBITRARY_URL_REPRESENTABLE=NO
ARBITRARY_METHOD_REPRESENTABLE=NO
ARBITRARY_HEADER_REPRESENTABLE=NO
ARBITRARY_BODY_REPRESENTABLE=NO
GENERIC_SQL_REPRESENTABLE=NO
GENERIC_COMMAND_REPRESENTABLE=NO
OPERATION_ARGUMENT_SCHEMA_VALIDATION=READY
CREDENTIAL_PROVIDER_BEFORE_VALIDATION=NO
CREDENTIAL_MATERIAL_PUBLICLY_RETURNED=NO
SYNTHETIC_CUSTOMER_B_REPRESENTABLE=YES
SHINMONE_REQUIRED_BY_GENERIC_MANIFEST=NO
CUSTOMER_SPECIFIC_GENERIC_RUNTIME_BRANCH=NO
GENERIC_JWT_EXPIRY_PARSE=NO
NATIVE_CREDENTIAL_IN_GENERIC_MANIFEST=NO
ARBITRARY_CREDENTIAL_HEADER_SELECTION=NO
UPSTREAM_NETWORK_IMPLEMENTED=NO
UPSTREAM_CONNECTION_ACTIVE=NO
INVOCATION_ROUTE_ACTIVE=NO
T001_T044_COMPLETE=YES
PHASE5_EXECUTED=YES
T045_EXECUTED=NO
PHASE6_EXECUTED=NO
FIRST_UNEXECUTED_TASK=T045
NEXT_ACTION=EXECUTE_PHASE6
```

### Phase 5 Human-Gate Hardening — 2026-09-11

Post-checkpoint human review retained T036–T044 and the original Phase 5 RED → GREEN history while requiring three focused correctness improvements. This hardening does not activate T045, the business invocation route, upstream networking, or any Phase 6 component.

Authentic hardening RED evidence:

- Optional request mapping: `npm --prefix apps/customer-connector-runtime test -- --runInBand --runTestsByPath test/manifest/operation-manifest-registry.spec.ts` failed against the pre-hardening `RequestProfileRegistry`; 1 suite failed with 2 failed and 17 passing tests because absent optional mappings returned `CONNECTOR_OPERATION_UNAVAILABLE` for both `GET_QUERY_V1` and `POST_QUERY_JSON_V1`.
- Credential/downstream ownership: `npm --prefix apps/customer-connector-runtime test -- --runInBand --runTestsByPath test/credentials/credential-providers.spec.ts` failed against the pre-hardening `CredentialExecutionBoundary`; 1 suite failed with 1 failed and 4 passing tests because the downstream consumer sentinel was converted to `CONNECTOR_UPSTREAM_AUTH_FAILED`.

GREEN and regression evidence:

- The mapping layer now omits absent mapped arguments only after operation-specific schema validation has established that absence is legal. Required-field absence and invalid optional types still fail closed, and every declared schema property still requires an explicit closed manifest mapping.
- The credential boundary catches only provider resolution and credential-application strategy failures. Once an `AppliedCredentialRequest` exists, the downstream consumer owns its exception, which propagates unchanged.
- The boolean-only T040 placeholder was removed. Real `ExactRawBodyAuthenticator`, replay protection, `ConnectorBindingService`, `InMemoryConnectorBindingStore`, `OperationManifestRegistry`, `RequestProfileRegistry`, `CredentialProfileRegistry`, and `CredentialExecutionBoundary` coverage now proves missing/unknown and replaced references, provider/profile mismatch, and incomplete request-profile preparation cannot reach either credential provider.
- The final focused command passed 3 suites and 33 tests. A first focused GREEN attempt exposed only a missing test import (`getOperation`) while the other two suites passed; correcting that test import required no production change.
- Full Customer-local runtime: the sandboxed command reached 18 passing suites and 155 passing tests but Supertest's three socket suites were blocked by `listen EPERM`. The identical approved local-only command then passed 21 suites and 161 tests with no source/test workaround.
- Shared contract regression passed 10 suites and 68 tests. Runtime build, runtime typecheck, shared build, shared typecheck, and `git diff --check` passed.
- Source guards found no boolean-only ordering placeholder, network/DNS/TLS/HTTP client, invocation controller, database/Redis dependency, or new Customer-specific generic branch in the hardening scope.

Protected artifact hashes remained unchanged:

```text
FEATURE007_SPEC_SHA256=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
FEATURE007_DESIGN_SHA256=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
FEATURE007_PLAN_SHA256=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
FEATURE007_TASKS_SHA256=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
FEATURE008_SPEC_SHA256=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
FEATURE008_DESIGN_SHA256=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
FEATURE008_PLAN_SHA256=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
FEATURE008_TASKS_SHA256=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
FEATURE009_SPEC_SHA256=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
FEATURE009_PLAN_SHA256=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
PRISMA_SCHEMA_SHA256=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
```

Hardening-attributed changed files:

```text
apps/customer-connector-runtime/src/manifest/request-profile.registry.ts
apps/customer-connector-runtime/src/credentials/credential-execution.boundary.ts
apps/customer-connector-runtime/test/manifest/operation-manifest-registry.spec.ts
apps/customer-connector-runtime/test/credentials/credential-providers.spec.ts
apps/customer-connector-runtime/test/manifest/execution-order.spec.ts
specs/009-productized-business-connector-runtime/tasks.md
```

Phase 5 human-gate hardening result:

```text
FEATURE009_PHASE5_HUMAN_GATE_HARDENING=PASS
OPTIONAL_ARGUMENT_OMISSION_GET=PASS
OPTIONAL_ARGUMENT_OMISSION_POST=PASS
OPTIONAL_ARGUMENT_PRESENT_MAPPING=PASS
REQUIRED_ARGUMENT_ABSENCE_REJECTED=YES
CREDENTIAL_RESOLVE_FAILURE_OWNED_BY_CREDENTIAL_BOUNDARY=YES
CREDENTIAL_STRATEGY_FAILURE_OWNED_BY_CREDENTIAL_BOUNDARY=YES
DOWNSTREAM_CONSUMER_FAILURE_RECLASSIFIED_AS_AUTH=NO
REAL_SERVICE_AUTH_ORDERING_TEST=PASS
REAL_REPLAY_ORDERING_TEST=PASS
REAL_CONTEXT_ORDERING_TEST=PASS
REAL_BINDING_RESOLUTION_ORDERING_TEST=PASS
REAL_STALE_BINDING_ORDERING_TEST=PASS
REAL_PROVIDER_PROFILE_ORDERING_TEST=PASS
REAL_REQUEST_PROFILE_ORDERING_TEST=PASS
CREDENTIAL_PROVIDER_BEFORE_VALIDATION=NO
UPSTREAM_CONNECTION_ACTIVE=NO
INVOCATION_ROUTE_ACTIVE=NO
T036_T044_COMPLETE=YES
T044_REMAINS_COMPLETE=YES
T045_EXECUTED=NO
PHASE5_EXECUTED=YES
PHASE6_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE6
```

## Phase 6 — Safe Upstream Network, Execution, and Result Extraction

**Goal**: Execute a fixed manifest request over a pinned safe HTTPS connection and return only a validated bounded business envelope.  
**Dependencies**: T044.  
**Independent test**: A deterministic HTTPS fixture succeeds; every unsafe destination, response, timeout, and extraction case fails without raw release or retry.

- [X] T045 [RED] [US6] [CONNECTOR-RUNTIME] Add failing closed GET/POST-query construction and HTTPS destination-policy tests.
  - Files: `apps/customer-connector-runtime/test/upstream/destination-policy.spec.ts`.
  - Depends on: T044.
  - Validation: Cover exact `GET_QUERY_V1` query and `POST_QUERY_JSON_V1` object assembly from fixed literals/schema-bound named mappings, read-only agreement, exact scheme/host/port/base path, address modes, URI rejection, and no caller method/path/query/body/header/credential override.
  - Stop: Do not authorize HTTP, a broad private-network grant, or a generic proxy.

- [X] T046 [GREEN] [US6] [CONNECTOR-RUNTIME] Implement closed read-request builders, `ConnectorDestinationPolicy`, and immutable origin validation.
  - Files: `apps/customer-connector-runtime/src/upstream/connector-destination-policy.ts`, local config integration.
  - Depends on: T045.
  - Validation: Make T045 pass and keep readiness false for unsafe destinations.
  - Stop: Destination comes only from manifest serviceRef/config; POST cannot accept an unrestricted object, template, script, or side effect.

- [X] T047 [RED] [US6] [CONNECTOR-RUNTIME] Add failing DNS resolution, address normalization, and rebinding tests.
  - Files: `apps/customer-connector-runtime/test/upstream/dns-pinning.spec.ts`.
  - Depends on: T046.
  - Validation: Cover A/AAAA, all-address checks, IPv4-mapped IPv6, mixed answers, metadata, loopback, link-local, multicast, unspecified, public/private mode mismatch, and changed resolution.
  - Stop: No first-address-only acceptance or DNS fallback is allowed.

- [X] T048 [GREEN] [US6] [CONNECTOR-RUNTIME] Implement all-address validation and connection-time pinned lookup.
  - Files: `apps/customer-connector-runtime/src/upstream/address-validator.ts`, `src/upstream/pinned-lookup.adapter.ts`.
  - Depends on: T047.
  - Validation: Make T047 pass with injected DNS and exact validated-address pinning.
  - Stop: Test loopback requires explicit enforced test mode and cannot satisfy staging readiness.

- [X] T049 [RED] [US6] [CONNECTOR-RUNTIME] Add failing TLS, redirect, proxy, compression, and retry tests.
  - Files: `apps/customer-connector-runtime/test/upstream/safe-upstream-http-client.spec.ts`.
  - Depends on: T048.
  - Validation: Cover wrong hostname/certificate, redirect, proxy, compression, retry, fixed runtime-owned content headers, provider/strategy compatibility, code-owned bearer and `X-Inventory-Key` slots, and caller/manifest credential-header denial.
  - Stop: Do not disable certificate verification or inherit system/environment proxies.

- [X] T050 [GREEN] [US6] [CONNECTOR-RUNTIME] Implement the one-shot pinned `SafeUpstreamHttpClient` transport shell.
  - Files: `apps/customer-connector-runtime/src/upstream/safe-upstream-http-client.ts` and module composition.
  - Depends on: T049.
  - Validation: Make T049 pass with TLS verification, redirects/retries/proxy disabled, `Accept-Encoding: identity`, and credential strategy applied only to the already fixed request.
  - Stop: Do not yet parse or extract unbounded response data.

- [X] T051 [RED] [US6] [CONNECTOR-RUNTIME] Add failing bounded JSON and application-response tests.
  - Files: `apps/customer-connector-runtime/test/upstream/bounded-json-response.spec.ts`.
  - Depends on: T050.
  - Validation: Cover 256 KiB raw cap, UTF-8, depth 8, 100 items, 64 keys, string 1,024, malformed/truncated JSON, wrong content type/encoding, HTTP failure, and application failure.
  - Stop: Do not buffer beyond the cap or return partial/raw bodies.

- [X] T052 [GREEN] [US6] [CONNECTOR-RUNTIME] Implement bounded streaming response validation.
  - Files: `apps/customer-connector-runtime/src/upstream/bounded-json-response.ts`, `src/upstream/safe-upstream-http-client.ts`.
  - Depends on: T051.
  - Validation: Make T051 pass and prove rejected bodies never reach extraction.
  - Stop: Raw upstream bodies must not enter logs, errors, central responses, or diagnostics.

- [X] T053 [RED] [US6] [CONNECTOR-RUNTIME] Add failing response extraction and safe-error normalization tests.
  - Files: `apps/customer-connector-runtime/test/upstream/response-extractor.spec.ts`, `test/upstream/upstream-errors.spec.ts`.
  - Depends on: T052.
  - Validation: Cover missing pointer, wrong type, Shinmone noninteger/negative count, Customer B invalid sku/quantity, provider-specific auth rejection/revocation, unavailable/application failures, and code-only responses.
  - Stop: Do not expose endpoint, status body, exception, credential, or raw result.

- [X] T054 [GREEN] [US6] [CONNECTOR-RUNTIME] Implement manifest-bound extraction and safe upstream error mapping.
  - Files: `apps/customer-connector-runtime/src/upstream/response-extractor.ts`, `src/upstream/upstream-errors.ts`, binding revocation integration.
  - Depends on: T053.
  - Validation: Make T053 pass; provider credential rejection revokes its handle/binding generation and only bounded declared fields survive.
  - Stop: Local minimization must not claim Feature 008 projection authority.

- [X] T055 [RED] [US6] [CONNECTOR-RUNTIME] Add failing Customer-local invocation route, orchestration, timeout, and cleanup tests.
  - Files: `apps/customer-connector-runtime/test/invocation/connector-invocation-route.spec.ts`, `test/upstream/timeout-cancellation.spec.ts`.
  - Depends on: T054.
  - Validation: Preserve budget/cancellation/lease RED coverage and require exact `POST /v1/connector/invocations` order: (1) method/content/encoding/raw cap, (2) central proof/digest, (3) signed claims/context, (4) atomic replay claim, (5) strict parse/schema, (6) body/config equality, (7) reference lookup, (8) binding dimensions/lease, (9) manifest operation/version/read-only/arguments/request profile, (10) compatible credential profile/provider handle resolution, (11) fixed GET or POST-query construction plus code-owned strategy application, (12) destination/DNS/pinning, (13) bounded upstream execution, (14) response validation/extraction, (15) bounded envelope, (16) lease release. Reject every bootstrap/user/cross profile and ensure no early provider/upstream call or raw reference/payload/handle/credential/upstream result release.
  - Stop: Local limits may narrow but never extend the signed remaining budget; no early credential/upstream access or unsafe response is permitted.

- [X] T056 [GREEN] [US6] [CONNECTOR-RUNTIME] Implement and compose the Customer-local central-only invocation endpoint and generic readiness.
  - Files: `apps/customer-connector-runtime/src/invocation/connector-invocation.controller.ts`, `src/invocation/connector-invocation.service.ts`, existing `src/upstream/**`, binding lease integration, and narrow runtime module/readiness composition.
  - Depends on: T055.
  - Validation: Make T055 pass with a thin controller composing `ConnectorServiceProofVerifier`, replay, bindings, manifests, `CredentialProfileRegistry`, providers/strategies, closed request builders, destination/client, and extraction. Return only accepted envelopes; generic readiness becomes true only with valid central/bootstrap profiles, provider/profile/strategy/request-profile registries, bindings, manifests, network/upstream, and both routes. Test loopback cannot satisfy staging/production readiness.
  - Stop: Do not duplicate component logic in the controller, add permission or ToolDefinition authority, accept Browser destinations, create generic HTTP behavior, retry/redirect, return raw exception/endpoint/credential/reference/proof/claims/upstream payload, or leak a lease.

- [X] T057 [CHECKPOINT] [US6] [CONNECTOR-RUNTIME] Verify and record the Phase 6 safe-upstream gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T046, T048, T050, T052, T054, T056.
  - Validation: Record `DNS_REBINDING_PROTECTION=READY`, `REDIRECTS=DENIED`, `RAW_CUSTOMER_API_RESPONSE_CENTRAL=NO`, `BOUNDED_LOCAL_RESULT_ONLY=YES`, `CLOSED_READ_REQUEST_PROFILES=GET_QUERY_V1,POST_QUERY_JSON_V1`, `INVOCATION_ROUTE_ACTIVE=YES`, `INVOCATION_ROUTE_PROFILE=CENTRAL_SERVICE_ONLY`, `INVOCATION_PROCESSING_ORDER=PASS`, `INVOCATION_RAW_RESULT_RELEASE=NO`, and `CONNECTOR_RUNTIME_GENERIC_READINESS=PASS`.
  - Stop: Do not proceed if the invocation route is inactive or misordered, generic dark-runtime readiness is false, an unsafe address can connect, or any raw body can escape.

### Phase 6 RED → GREEN and Checkpoint Evidence — 2026-09-12

- Baseline: clean branch `009-productized-business-connector-runtime`; T001–T044 complete and T045 first unchecked. The read-only Spec Kit prerequisite command retained its pre-existing branch-discovery failure by resolving the current branch to the unrelated missing `002-host-integration-gateway-and-data-adapter-contract`; no setup script or hook ran, and direct Feature 009 task/plan validation proceeded.
- Protected pre/post SHA-256 values remained unchanged: Feature 009 `spec.md` `d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73`, `design.md` `250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8`, and `plan.md` `00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1`; Feature 007/008 documents and Prisma hashes also matched the Phase 5 protected baseline.
- T045 RED: `destination-policy.spec.ts` failed before execution because `src/upstream/connector-destination-policy` did not exist (1 failed suite, 0 tests). T046 GREEN: 1 suite / 10 tests passed for closed GET/POST construction and strict HTTPS configuration.
- T047 RED: `dns-pinning.spec.ts` failed before execution because the address/pinning modules did not exist (1 failed suite, 0 tests). T048 GREEN/hardening: 1 suite / 13 tests passed for A/AAAA, mapped IPv6, mixed-answer rejection, explicit CIDRs, test-only loopback, and one-address pinned lookup.
- T049 RED: `safe-upstream-http-client.spec.ts` failed before execution because the safe client did not exist (1 failed suite, 0 tests). T050 GREEN/hardening: 1 suite / 8 tests passed, including a checked-in deterministic TLS fixture, native certificate/hostname verification, fixed headers, redirect/encoding/proxy/retry denial, and one request only. The sandbox-local fixture first recorded `listen EPERM`; the identical approved local-only command passed.
- T051 RED: `bounded-json-response.spec.ts` failed before execution because the bounded-response module did not exist (1 failed suite, 0 tests). T052 GREEN: 1 suite / 9 tests passed for streaming cap, fatal UTF-8, JSON/structure/schema, content/status, optional application code, and no partial release.
- T053 RED: response-extractor and upstream-error suites both failed before execution because their modules did not exist (2 failed suites, 0 tests). T054 GREEN: 2 suites / 11 tests passed for declared-field extraction, type/conversion checks, Customer-neutral argument correlation, safe code-only normalization, and credential-rejection ownership.
- T055 RED: invocation/deadline coverage recorded the missing deadline module; the socket route attempt separately recorded sandbox `listen EPERM`. T056 GREEN: focused route/deadline/activation verification passed 3 suites / 5 tests through the approved local-only path. The composed success proof records `authenticate → binding lease → manifest → credential → upstream → lease release`; invalid proof output contains no request reference or credential data.
- Final runtime validation: `npm --prefix apps/customer-connector-runtime test -- --runInBand` passed 29 suites / 218 tests; `build` and source/test `typecheck` passed. Shared-contract regression passed 10 suites / 68 tests plus build/typecheck. `git diff --check` passed.
- Source/security review: no HTTP fallback, TLS disablement, redirect following, retry, environment proxy consumption, first-answer-only DNS acceptance, raw upstream release, Customer-specific generic branch, Prisma/database/Redis dependency, shared-contract modification, or Phase 7 source exists. The test-only TLS key/certificate are confined to `test/fixtures` and cannot establish production readiness.
- Phase 6 task-created source/test scope: binding context-only invocation lease additions; runtime upstream/invocation/configuration/readiness composition; centralized closed-schema validation; route/readiness regressions; deterministic TLS fixtures; the seven Phase 6 upstream/invocation test files; and this evidence section. No Feature 007/008 artifact, Feature 009 spec/design/plan, Prisma, public Assistant/SSE/SDK, central adapter, Bridge, or shared-contract source changed.

```text
DNS_REBINDING_PROTECTION=READY
REDIRECTS=DENIED
RETRIES=DENIED
PROXY_USAGE=NO
TLS_VERIFICATION=ENFORCED
RAW_CUSTOMER_API_RESPONSE_CENTRAL=NO
BOUNDED_LOCAL_RESULT_ONLY=YES
CREDENTIAL_FAILURE_OWNERSHIP=PASS
DOWNSTREAM_FAILURE_RECLASSIFIED_AS_AUTH=NO
CLOSED_READ_REQUEST_PROFILES=GET_QUERY_V1,POST_QUERY_JSON_V1
INVOCATION_ROUTE_ACTIVE=YES
INVOCATION_ROUTE_PROFILE=CENTRAL_SERVICE_ONLY
INVOCATION_PROCESSING_ORDER=PASS
INVOCATION_RAW_RESULT_RELEASE=NO
CONNECTOR_RUNTIME_GENERIC_READINESS=PASS
SYNTHETIC_CUSTOMER_B_UPSTREAM_REPRESENTABLE=YES
SHINMONE_REQUIRED_BY_GENERIC_UPSTREAM=NO
CUSTOMER_SPECIFIC_GENERIC_RUNTIME_BRANCH=NO
T001_T057_COMPLETE=YES
T058_EXECUTED=NO
PHASE6_EXECUTED=YES
PHASE7_EXECUTED=NO
FIRST_UNEXECUTED_TASK=T058
NEXT_ACTION=EXECUTE_PHASE7
```

### Phase 6 Human-Gate Hardening — 2026-09-13

- Scope and protected baseline: this post-checkpoint hardening changed only Customer-local Phase 6 runtime/test files plus this append-only evidence. T045–T057 and their original RED → GREEN evidence remain unchanged; T058–T142 remain unchecked. Feature 009 protected SHA-256 values remained `spec.md` `d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73`, `design.md` `250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8`, and `plan.md` `00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1`. Feature 007/008 documents, shared contracts, Prisma, central transport, and public interfaces remained unchanged.
- Address/destination RED: the initial focused run recorded 4 failed suites with 9 failed / 37 passed / 46 total tests. It exposed non-semantic mapped-address/CIDR handling, configuration acceptance of invalid CIDRs, and the missing abort-aware DNS seam. GREEN: semantic IPv4/IPv6 parsing now canonicalizes all IPv4-mapped IPv6 forms, validates family-specific prefix ranges, rejects mapped prefixes below `/96`, validates configuration before readiness, and preserves all-answer checking and pinning. The focused address/config/readiness run passed 4 suites / 72 tests.
- Cancellation/deadline/intake RED: the first focused run recorded 3 failed suites with 6 failed / 18 passed / 24 total tests, including the missing fail-fast raw-body reader, abort propagation, stream-timeout ownership, and elapsed-budget signature. GREEN: DNS and response consumption share invocation cancellation, late DNS completion cannot connect, elapsed monotonic time is subtracted before credential resolution, and the raw reader stops at declared oversize or `MAX+1` without authenticating or draining the request.
- Response/extraction/lifecycle hardening: boundary tests now cover exact cap and cap+1, split invalid UTF-8, truncated multichunk JSON, depth 8/9, arrays 100/101, keys 64/65, strings 1,024/1,025, complete Customer B extraction, and nested generic reference-count extraction. Real binding lifecycle coverage proves HTTP 401/403 and mapped application authentication rejection release the lease, revoke the generation, tear down the provider handle, and prevent subsequent acquisition; DNS, TLS, availability, timeout, and ordinary response failures do not revoke.
- Real-component orchestration: the new harness composes the real verifier, replay cache, binding store/service, manifest and request-profile registries, credential registry/boundary, destination policy, DNS pinning, safe HTTPS client, bounded response reader, extractor, and invocation service. Its initial run exposed an incomplete signed-context test fixture (16 failed / 4 passed / 20 tests); after correcting only the fixture, the expanded 24-test matrix passed. It proves invalid transport/proof/replay/context/binding/operation/profile/destination/DNS/budget cases stop at their owning gate and includes one complete bounded success with lease release. Deterministic native TLS hostname/certificate behavior remains covered by the separate safe-client fixture.
- Final validation: the sandbox run passed 27 of 32 suites and 295 of 303 tests, with only 8 listener-dependent tests failing from `listen EPERM`; the identical approved local-only command passed 32 suites / 303 tests. Runtime build and typecheck passed. Shared contracts passed 10 suites / 68 tests plus build/typecheck. `git diff --check`, protected-hash checks, 142 sequential task IDs, 15 checkpoints, T001–T057 checked/T058–T142 unchecked, dependency isolation, and source guards all passed.
- Hardening-attributed production files: `src/config/runtime-configuration.ts`; `src/invocation/connector-invocation.controller.ts`; `src/invocation/connector-invocation.service.ts`; `src/invocation/invocation-body.reader.ts`; `src/invocation/invocation-deadline.ts`; `src/upstream/address-validator.ts`; `src/upstream/bounded-json-response.ts`; `src/upstream/connector-destination-policy.ts`; `src/upstream/ip-address.ts`; `src/upstream/pinned-lookup.adapter.ts`; `src/upstream/safe-upstream-http-client.ts`; `src/upstream/upstream-execution.service.ts`.
- Hardening-attributed test files: `test/config/configuration.spec.ts`; `test/health/readiness.spec.ts`; `test/invocation/invocation-body-reader.spec.ts`; `test/invocation/invocation-early-gates.spec.ts`; `test/upstream/bounded-json-response.spec.ts`; `test/upstream/credential-rejection-lifecycle.spec.ts`; `test/upstream/destination-policy.spec.ts`; `test/upstream/dns-pinning.spec.ts`; `test/upstream/response-extractor.spec.ts`; `test/upstream/safe-upstream-http-client.spec.ts`; `test/upstream/timeout-cancellation.spec.ts`.

```text
FEATURE009_PHASE6_HUMAN_GATE_HARDENING=PASS
IPV4_MAPPED_IPV6_CANONICALIZATION=PASS
MAPPED_LOOPBACK_BYPASS_DENIED=YES
MAPPED_PRIVATE_BYPASS_DENIED=YES
CIDR_FAMILY_PREFIX_VALIDATION=PASS
INVALID_NETWORK_CAN_MARK_READY=NO
GET_QUERY_SUCCESS_CONSTRUCTION=PASS
POST_QUERY_SUCCESS_CONSTRUCTION=PASS
ENCODED_TRAVERSAL_REJECTION=PASS
DNS_ABORT_PROPAGATION=PASS
DNS_AFTER_ABORT_CAN_CONNECT=NO
STREAMING_TIMEOUT_CLASSIFICATION=PASS
PARTIAL_RESPONSE_RELEASED=NO
INVOCATION_FAIL_FAST_BYTE_CAP=PASS
SIGNED_BUDGET_ELAPSED_SUBTRACTION=PASS
SIGNED_BUDGET_EXTENDED_LOCALLY=NO
BOUNDED_RESPONSE_LIMIT_MATRIX=PASS
REFERENCE_COUNT_EXTRACTION_MATRIX=PASS
CUSTOMER_B_EXTRACTION_MATRIX=PASS
CREDENTIAL_REJECTION_REVOKES_BINDING=PASS
NON_AUTH_FAILURE_REVOKES_BINDING=NO
INVOCATION_EARLY_GATE_MATRIX=PASS
INVOCATION_PROCESSING_ORDER=PASS
DNS_REBINDING_PROTECTION=READY
RAW_CUSTOMER_API_RESPONSE_CENTRAL=NO
BOUNDED_LOCAL_RESULT_ONLY=YES
CONNECTOR_RUNTIME_GENERIC_READINESS=PASS
T057_REMAINS_COMPLETE=YES
T058_EXECUTED=NO
PHASE6_EXECUTED=YES
PHASE7_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE7
```

### Phase 6 Final Human-Gate Hardening — 2026-09-13

- Scope and baseline: this final post-checkpoint hardening preserved T045–T057, the original Phase 6 RED → GREEN/checkpoint evidence, and the previous Phase 6 Human-Gate Hardening section. T058–T142 remained unchecked. The read-only Spec Kit prerequisite command retained its pre-existing branch-discovery failure by resolving the current branch to the unrelated missing `002-host-integration-gateway-and-data-adapter-contract`; no setup script or implementation hook ran.
- Protected pre/post SHA-256 values remained unchanged: Feature 009 `spec.md` `d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73`, `design.md` `250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8`, and `plan.md` `00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1`. Feature 007/008 documents, shared-contract sources, Prisma, Assistant/SSE/SDK interfaces, central transport, and Phase 7 sources were unchanged.
- Authentic RED: the first combined focused run failed 4 suites with 1 failed / 29 passed / 30 executed tests. Three suites could not compile because the controller lacked the shared monotonic-clock/start-time contract; the DNS suite proved `fd00:ec2::254` was incorrectly accepted through an `allowlisted_networks` CIDR. This was captured before production edits.
- GREEN implementation: `InvocationMonotonicClock` is one production-injected clock domain shared by the controller and service. Route entry captures the internal start before bounded body intake, `handle()` accepts it as an optional internal second argument, and direct callers default to a service-captured monotonic start. The existing formula now covers the full route lifecycle and retains the 250 ms reserve without adding wire, response, log, or telemetry fields.
- Connection lifecycle: the controller retains request `aborted` handling and also aborts on response `close` only before successful `finish`; every listener is removed in `finally`. Real-component route tests prove close cancellation reaches hanging DNS, an in-flight pinned HTTPS request, and response streaming, releases the binding lease, emits no partial extraction, and makes no retry. A normal `finish` followed by `close` leaves the signal un-aborted.
- Destination safety: the generic unconditional deny set now explicitly contains `169.254.169.254/32` and `fd00:ec2::254/128`. Canonicalization precedes denial; denial precedes mode/allowlist evaluation. Broad and exact metadata allowlists fail, while a non-metadata Customer ULA succeeds only under its exact permitted CIDR.
- Focused GREEN: the first post-change run reached all new behavior except three route tests whose test-only controller and service clocks were in different domains (1 failed suite, 3 failed / 68 passed / 71 tests). After correcting only that fixture wiring, the identical focused matrix passed 4 suites / 71 tests.
- Final runtime validation: the sandbox run passed 27 of 32 suites and 306 tests, with only 8 listener-dependent tests failing from the known `listen EPERM`; the identical approved local-only command passed 32 suites / 314 tests. Runtime build and typecheck passed. Shared contracts passed 10 suites / 68 tests plus build/typecheck. `git diff --check`, protected hashes, source/dependency guards, 142 sequential task IDs, 15 checkpoints, and T001–T057 checked/T058–T142 unchecked all passed.
- Final-hardening production files: `apps/customer-connector-runtime/src/invocation/connector-invocation.controller.ts`; `apps/customer-connector-runtime/src/invocation/connector-invocation.service.ts`; `apps/customer-connector-runtime/src/invocation/connector-invocation.module.ts`; `apps/customer-connector-runtime/src/invocation/invocation-deadline.ts`; `apps/customer-connector-runtime/src/upstream/address-validator.ts`.
- Final-hardening test files: `apps/customer-connector-runtime/test/invocation/invocation-body-reader.spec.ts`; `apps/customer-connector-runtime/test/invocation/invocation-early-gates.spec.ts`; `apps/customer-connector-runtime/test/upstream/timeout-cancellation.spec.ts`; `apps/customer-connector-runtime/test/upstream/dns-pinning.spec.ts`.

```text
FEATURE009_PHASE6_FINAL_HUMAN_GATE_HARDENING=PASS
SIGNED_BUDGET_INBOUND_BODY_ELAPSED_SUBTRACTION=PASS
SIGNED_BUDGET_FULL_ROUTE_LIFECYCLE=PASS
SIGNED_BUDGET_EXTENDED_LOCALLY=NO
POST_BODY_CALLER_DISCONNECT_PROPAGATION=PASS
NORMAL_RESPONSE_COMPLETION_TRIGGERS_ABORT=NO
CALLER_ABORT_REACHES_DNS=YES
CALLER_ABORT_REACHES_HTTP=YES
CALLER_ABORT_RELEASES_LEASE=YES
IPV4_METADATA_ADDRESS_DENIED=YES
IPV6_METADATA_ADDRESS_DENIED=YES
ALLOWLIST_CAN_OVERRIDE_METADATA_DENY=NO
LEGITIMATE_PRIVATE_IPV6_ALLOWLIST_STILL_WORKS=YES
IPV4_MAPPED_IPV6_CANONICALIZATION=PASS
DNS_ABORT_PROPAGATION=PASS
STREAMING_TIMEOUT_CLASSIFICATION=PASS
INVOCATION_FAIL_FAST_BYTE_CAP=PASS
CIDR_FAMILY_PREFIX_VALIDATION=PASS
GET_QUERY_SUCCESS_CONSTRUCTION=PASS
POST_QUERY_SUCCESS_CONSTRUCTION=PASS
BOUNDED_RESPONSE_LIMIT_MATRIX=PASS
REFERENCE_COUNT_EXTRACTION_MATRIX=PASS
CUSTOMER_B_EXTRACTION_MATRIX=PASS
CREDENTIAL_REJECTION_REVOKES_BINDING=PASS
NON_AUTH_FAILURE_REVOKES_BINDING=NO
INVOCATION_EARLY_GATE_MATRIX=PASS
INVOCATION_PROCESSING_ORDER=PASS
DNS_REBINDING_PROTECTION=READY
RAW_CUSTOMER_API_RESPONSE_CENTRAL=NO
BOUNDED_LOCAL_RESULT_ONLY=YES
CONNECTOR_RUNTIME_GENERIC_READINESS=PASS
RUNTIME_TESTS=PASS
RUNTIME_BUILD=PASS
RUNTIME_TYPECHECK=PASS
SHARED_CONTRACT_REGRESSION=PASS
T057_REMAINS_COMPLETE=YES
T058_EXECUTED=NO
PHASE6_EXECUTED=YES
PHASE7_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE7
```

## Phase 7 — Central Deployment, Service Authentication, and Transport

**Goal**: Build the central productized transport as an exact, bounded, signed, dark module without Assistant execution reachability.  
**Dependencies**: T057.  
**Independent test**: Trusted fixture configuration produces one exact signed round-trip; ambiguity and unsafe input fail before transport.
**Route relationship**: The dark-mode signed round trip consumes the Phase 6 Customer-local `POST /v1/connector/invocations` endpoint by hosting the actual runtime app or its accepted route-level harness; Phase 7 does not create or emulate a second server contract.

- [X] T058 [RED] [US2] [BACKEND] Add failing exact `ConnectorDeploymentRegistry` tests.
  - Files: `test/unit/connector-deployment.registry.spec.ts`.
  - Depends on: T057.
  - Validation: Cover exact Customer/integration/HostApp/connector/instance success, duplicate, wildcard, blank, inactive, wrong instance, unsafe URI/policy, and invalid bounds.
  - Stop: Do not add Browser/model lookup input, fallback, database registry, or wildcard selection.

- [X] T059 [GREEN] [US2] [BACKEND] Implement startup-validated immutable deployment lookup.
  - Files: `src/connectors/productized-business/connector-deployment.registry.ts`, central configuration integration.
  - Depends on: T058.
  - Validation: Make T058 pass using `ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON` and exact tuple resolution, including a distinct Synthetic Customer B fixture tuple/instance without a source branch.
  - Stop: No Prisma schema, runtime CRUD, or Customer-specific source constant.

- [X] T060 [RED] [US2] [BACKEND] Add failing central signer and exact-byte proof tests.
  - Files: `test/unit/connector-service-auth.signer.spec.ts`.
  - Depends on: T059.
  - Validation: Cover RS256, `kid`, exact type/claims/audience/context/operation/request ID, 30-second proof, fresh UUID `jti`, body mutation, key lifecycle, and raw-byte identity.
  - Stop: Do not reuse user/Bridge signing keys or serialize after hashing.

- [X] T061 [GREEN] [US2] [BACKEND] Implement `ConnectorServiceAuthSigner` and immutable key loading.
  - Files: `src/connectors/productized-business/connector-service-auth.signer.ts`, central service-auth configuration.
  - Depends on: T060.
  - Validation: Make T060 pass with one serialization, exact SHA-256, active file-backed key, and public lifecycle metadata.
  - Stop: Private keys, proofs, and raw request bytes stay out of logs/audit/telemetry.

- [X] T062 [RED] [US2] [BACKEND] Add failing bounded central HTTPS transport tests.
  - Files: `test/unit/connector-transport.client.spec.ts`, `test/unit/connector-network-policy.spec.ts`.
  - Depends on: T061.
  - Validation: Cover HTTPS, exact destination, address policy/pinning, TLS, 16 KiB bounds, absent request encoding, redirect/proxy/retry denial, response envelopes, abort, and mismatched request ID.
  - Stop: No generic HTTP surface, credential field, ref persistence, or raw response pass-through.

- [X] T063 [GREEN] [US2] [BACKEND] Implement central network policy and `ConnectorTransportClient`.
  - Files: `src/connectors/productized-business/connector-network-policy.ts`, `connector-transport.client.ts`.
  - Depends on: T062.
  - Validation: Make T062 pass with deterministic DNS/TLS fixtures and cancellation.
  - Stop: No adapter registration or Assistant module import in this task.

- [X] T064 [RED] [US2] [BACKEND] Add failing safe-failure, readiness, and dark-module tests.
  - Files: `test/unit/productized-business-connector.module.spec.ts`, `test/integration/productized-transport-dark.spec.ts`.
  - Depends on: T063.
  - Validation: Require code-only normalized failures, fail-closed readiness, a valid configuration round trip through the already implemented Customer-local invocation route/app harness, and zero `DataAdapterRegistry` reachability.
  - Stop: Do not create a ToolCall, ToolDefinition, adapter execution, or public failure shape.

- [X] T065 [GREEN] [US2] [BACKEND] Compose the central productized transport module in dark mode.
  - Files: `src/connectors/productized-business/productized-business-connector.module.ts`, local module providers/readiness.
  - Depends on: T064.
  - Validation: Make T064 pass; the unregistered module signs and exchanges a bounded fixture envelope with the real Phase 6 route/app harness rather than a second fake server contract.
  - Stop: No native credential, raw reference storage, Prisma, or Assistant execution wiring.

- [X] T066 [VERIFY] [US2] [BACKEND] Verify central transport isolation and prohibited-surface scans.
  - Files: `src/connectors/productized-business/**`, `test/integration/secret-redaction.spec.ts`, `prisma/schema.prisma`, `prisma/migrations/`, `src/connectors/connectors.module.ts`.
  - Depends on: T065.
  - Validation: Run central focused suites/typecheck and confirm no native credential type/value, reference persistence, schema change, registration, or sensitive observability.
  - Stop: Do not mark dark-mode isolation passing if Assistant can resolve the module.

- [X] T067 [CHECKPOINT] [US2] [BACKEND] Verify and record the Phase 7 central transport gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T059, T061, T063, T065, T066.
  - Validation: Record a machine-readable evidence block with exact signed bounded round-trip `PASS` and `ASSISTANT_EXECUTION_REACHABILITY=NO`.
  - Stop: Phase 8 cannot start with unsafe config, unsigned bytes, or active Assistant wiring.

### Phase 7 RED → GREEN and Checkpoint Evidence — 2026-09-13

- Entry: T057 was checked, T058–T142 were unchecked, and the approved `spec.md`, `design.md`, and `plan.md` SHA-256 values matched the protected baseline. The read-only Spec Kit prerequisite check retained its pre-existing branch-routing failure for missing Feature 002 and performed no setup or hook action.
- T058 RED: `npm run test:unit -- --runInBand --runTestsByPath test/unit/connector-deployment.registry.spec.ts` failed with 1 suite, 0 tests because `ConnectorDeploymentRegistry` did not exist. T059 GREEN passed the exact immutable five-part registry suite; final coverage is 13 tests.
- T060 RED: the signer suite failed at compilation because `ConnectorServiceAuthSigner` did not exist. T061 GREEN validates one serialization, exact raw-byte SHA-256, RS256 header/claims, 30-second lifetime, fresh UUID `jti`, active absolute file-backed PKCS#8 ownership, public-key matching, and central-only trust-domain rejection; final coverage is 7 tests.
- T062 RED: the network-policy and transport suites failed with 2 suites, 0 tests because both central boundaries were absent. T063 GREEN validates semantic A/AAAA and mapped-address policy, all-answer rejection, deterministic pinning, TLS-only one-shot transport, absent content encoding, fixed headers, byte bounds, cancellation, correlation, safe envelopes, and no retry/redirect/proxy behavior; final coverage is 2 suites and 16 tests.
- T064 RED: the dark-module suite failed with 1 suite, 0 tests because the module did not exist. T065 GREEN passed 2 module tests. The genuine Phase 6 integration was iterated through real DNS, header, and non-2xx safe-envelope boundaries; its final approved local-only run passed 1 suite and 1 test, returning the real correlated `CONNECTOR_BINDING_INVALID` envelope from the existing runtime route.
- T066 final validation: central focused unit suites passed 5 suites/38 tests; dark transport integration passed 1 suite/1 test; existing secret-redaction integration passed 1 suite/5 tests; root build and typecheck passed. The Customer-local regression first recorded sandbox-only `listen EPERM`, then the identical approved local-only run passed 32 suites/314 tests plus build/typecheck. Shared contracts passed 10 suites/68 tests plus build/typecheck. `git diff --check` passed.
- Protected SHA-256: `spec.md=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73`; `design.md=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8`; `plan.md=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1`. Feature 007/008, Prisma, shared-contract source, Customer-local Phase 6 source, `AppModule`, and `ConnectorsModule` remained unchanged.
- Phase 7 attributed files: `package.json`, `package-lock.json`, `src/connectors/productized-business/connector-deployment.registry.ts`, `connector-service-auth.signer.ts`, `connector-network-policy.ts`, `connector-transport.client.ts`, `productized-business-connector.module.ts`, `test/unit/connector-deployment.registry.spec.ts`, `connector-service-auth.signer.spec.ts`, `connector-network-policy.spec.ts`, `connector-transport.client.spec.ts`, `productized-business-connector.module.spec.ts`, `test/integration/productized-transport-dark.spec.ts`, and this append-only checkpoint update. The pre-existing untracked Phase 6 TLS key fixture was preserved.

```text
T001_T067_COMPLETE=YES
CONNECTOR_DEPLOYMENT_EXACT_MATCH=YES
CONNECTOR_SERVICE_PROOF_SIGNING=PASS
CONNECTOR_SERVICE_PROOF_SINGLE_SERIALIZATION=PASS
CENTRAL_TRANSPORT_HTTPS_ONLY=YES
CENTRAL_DNS_REBINDING_PROTECTION=READY
CENTRAL_TLS_VERIFICATION=ENFORCED
CENTRAL_REDIRECTS=DENIED
CENTRAL_RETRIES=DENIED
CENTRAL_PROXY_USAGE=NO
CENTRAL_REQUEST_BOUND=PASS
CENTRAL_RESPONSE_BOUND=PASS
CENTRAL_REQUEST_ID_CORRELATION=PASS
CUSTOMER_LOCAL_PHASE6_ROUTE_REUSED=YES
SECOND_FAKE_INVOCATION_SERVER=NO
SIGNED_BOUNDED_ROUND_TRIP=PASS
NATIVE_CREDENTIAL_CENTRAL=NO
CONNECTOR_CONTEXT_REF_PERSISTED=NO
DATA_ADAPTER_REGISTERED=NO
ASSISTANT_EXECUTION_REACHABILITY=NO
SYNTHETIC_CUSTOMER_B_CENTRAL_TRANSPORT=PASS
SHINMONE_REQUIRED_BY_CENTRAL_TRANSPORT=NO
CUSTOMER_SPECIFIC_CENTRAL_BRANCH=NO
T067=PASS
T068_EXECUTED=NO
PHASE7_EXECUTED=YES
PHASE8_EXECUTED=NO
FIRST_UNEXECUTED_TASK=T068
NEXT_ACTION=EXECUTE_PHASE8
```

### Phase 7 Human-Gate Hardening — 2026-09-13

- Authorized design correction: only the conflicting deployment paragraph in `design.md` changed, replacing four-part active-instance uniqueness with exact five-part tuple identity. Exact duplicates remain invalid; distinct active connector instances may coexist with no first-instance or wrong-instance fallback. `design.md` changed from SHA-256 `250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8` to `bbec3cd75fa7fa00cb298d1fa4c7ddd713d3dea870924b4c0a1a625986ada6fb`; `spec.md=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73` and `plan.md=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1` remained unchanged.
- Authentic focused RED: the five Phase 7 unit suites ran 51 tests with 9 failures and 42 passes. Failures proved the four-part instance rejection, zero-deployment readiness defect, unknown-profile readiness defects for single and mixed deployment graphs, broad private-network admission through the loopback test seam, and missing active-response teardown during streaming cancellation. Hanging-DNS and pending-HTTPS cancellation already passed and were preserved without manufacturing failures.
- GREEN: the same five suites passed 51/51 tests. Registry introspection exposes only frozen active-count/profile-reference metadata; signer introspection exposes only exact profile presence. A graph is ready only with at least one active deployment and complete signer-profile coverage. Two same-authority active instances resolve independently by exact instance, private/ULA/metadata addresses remain denied in `public_only` test mode, and cancellation destroys active request/response state while returning only `CONNECTOR_TIMEOUT` with no retry or partial envelope.
- Native TLS evidence: `productized-transport-dark.spec.ts` uses the same real Customer-local Phase 6 Nest/Express handler and one deterministic TLS server. A trusted certificate with the configured hostname completed the genuine correlated round trip; the same trusted certificate with a wrong hostname and the configured hostname with an untrusted certificate both failed closed through native Node HTTPS/TLS verification. No second invocation server or TLS bypass was introduced.
- Final validation: focused unit suites passed 5 suites/51 tests; productized transport plus secret-redaction integration passed 2 suites/6 tests; root build/typecheck passed; shared contracts passed 10 suites/68 tests plus build/typecheck. The Customer-local run first preserved sandbox-only `listen EPERM` evidence (27 suites and 306 tests passed before listener failures), then the identical approved local-only command passed 32 suites/314 tests; runtime build/typecheck passed. `git diff --check`, protected-scope checks, prohibited-source scans, 142-task numbering, T067 checked, and T068–T142 unchecked all passed.
- Original Phase 7 evidence preservation: the pre-hardening evidence block SHA-256 remains `a6f5c412156422c5c6084191b7a414fddd7c77b5cd9685990788521d80459314`; no prior RED, GREEN, checkpoint, task wording, or checkbox was rewritten.
- Hardening-attributed production files: `src/connectors/productized-business/connector-deployment.registry.ts`, `connector-service-auth.signer.ts`, `connector-network-policy.ts`, `connector-transport.client.ts`, and `productized-business-connector.module.ts`. Test files: `test/unit/connector-deployment.registry.spec.ts`, `connector-network-policy.spec.ts`, `connector-transport.client.spec.ts`, `productized-business-connector.module.spec.ts`, and `test/integration/productized-transport-dark.spec.ts`. Evidence/artifact changes are this appended section and the single authorized `design.md` paragraph. Root dependency wiring and the pre-existing Phase 6 TLS key fixture were preserved unchanged by this hardening.

```text
FEATURE009_PHASE7_HUMAN_GATE_HARDENING=PASS
ZERO_DEPLOYMENT_READINESS=NOT_READY
UNKNOWN_SIGNER_PROFILE_READINESS=NOT_READY
DEPLOYMENT_SIGNER_GRAPH_VALIDATION=PASS
DISTINCT_ACTIVE_CONNECTOR_INSTANCES_SUPPORTED=YES
EXACT_FIVE_PART_DUPLICATE_REJECTED=YES
WRONG_INSTANCE_FALLBACK=NO
TEST_LOOPBACK_ONLY_SCOPE=PASS
TEST_LOOPBACK_ALLOWS_ARBITRARY_PRIVATE_NETWORK=NO
TLS_CORRECT_HOST_TRUSTED_CERT=PASS
TLS_WRONG_HOST_REJECTED=YES
TLS_UNTRUSTED_CERT_REJECTED=YES
MIDFLIGHT_DNS_ABORT=PASS
MIDFLIGHT_HTTPS_ABORT=PASS
MIDFLIGHT_RESPONSE_ABORT=PASS
CENTRAL_RETRY_AFTER_ABORT=NO
CONNECTOR_DEPLOYMENT_EXACT_MATCH=YES
CONNECTOR_SERVICE_PROOF_SINGLE_SERIALIZATION=PASS
CENTRAL_DNS_REBINDING_PROTECTION=READY
CENTRAL_TLS_VERIFICATION=ENFORCED
SIGNED_BOUNDED_ROUND_TRIP=PASS
CUSTOMER_LOCAL_PHASE6_ROUTE_REUSED=YES
SECOND_FAKE_INVOCATION_SERVER=NO
DATA_ADAPTER_REGISTERED=NO
ASSISTANT_EXECUTION_REACHABILITY=NO
T067_REMAINS_COMPLETE=YES
T068_EXECUTED=NO
PHASE7_EXECUTED=YES
PHASE8_EXECUTED=NO
NEXT_ACTION=EXECUTE_PHASE8
```

### Phase 7 Human Design Amendment Approval — 2026-09-13

1. The protected design originally required four-part active-instance uniqueness.
2. Phase 7 human-gate review identified that restriction as conflicting with the desired exact five-part deployment model.
3. The hardening implementation changed that design paragraph prematurely instead of stopping with `HUMAN_REVIEW_REQUIRED`.
4. Human review on 2026-09-13 subsequently inspected the amended design, production implementation, tests, Feature 008 authority relationship, and exact-instance behavior.
5. Human review explicitly approved the five-part amendment.
6. The amended design hash now becomes the protected Feature 009 design baseline for Phase 8 and later phases.

```text
DESIGN_AMENDMENT_PREVIOUSLY_HUMAN_APPROVED=NO
DESIGN_AMENDMENT_APPROVED_NOW=YES
DESIGN_AMENDMENT_APPROVAL_DATE=2026-09-13

DEPLOYMENT_IDENTITY=customerId,integrationId,hostApp,connectorKey,connectorInstanceId
DISTINCT_ACTIVE_CONNECTOR_INSTANCES_SUPPORTED=YES
EXACT_FIVE_PART_DUPLICATE_REJECTED=YES
WRONG_INSTANCE_FALLBACK=NO
FIRST_INSTANCE_FALLBACK=NO

FEATURE008_DATA_ADAPTER_AUTHORITY_CHANGED=NO
DATA_ADAPTER_REGISTRATION_DIMENSIONS=customerId,integrationId,hostApp,connectorKey
DEPLOYMENT_REGISTRY_ADDS_EXACT_CONNECTOR_INSTANCE=YES

OLD_FEATURE009_DESIGN_SHA256=250659dc2e4bef3361953b07d99fd1a37278989a4f6a71644860abc0387801a8
NEW_FEATURE009_DESIGN_SHA256=bbec3cd75fa7fa00cb298d1fa4c7ddd713d3dea870924b4c0a1a625986ada6fb

NEW_FEATURE009_DESIGN_HASH_ACCEPTED_AS_PROTECTED_BASELINE=YES

FEATURE009_SPEC_MODIFIED=NO
FEATURE009_PLAN_MODIFIED=NO
FEATURE007_HISTORY_MODIFIED=NO
FEATURE008_AUTHORITY_CHANGED=NO
PRISMA_MODIFIED=NO

T067_REMAINS_COMPLETE=YES
T068_EXECUTED=NO

PHASE7_FINAL_HUMAN_GATE=PASS
PHASE8_READY=YES
NEXT_ACTION=EXECUTE_PHASE8
```

## Phase 8 — Feature 009 Shinmone Stage 2 Identity Bridge Integration

**Classification**: `FEATURE009_IMPLEMENTATION_CONSUMING_ACCEPTED_FEATURE007_AMENDMENT`  
**Goal**: Add Shinmone's sole post-admission native-bearer handoff and IDX bootstrap-provider path without making it the generic product model or reopening Feature 007.
**Dependencies**: T067.  
**Independent test**: Stage 2 is impossible before MenuDetail/admission and sends the exact bearer once over the fixed secure binding transport afterward; every failure returns no reference safely.
**Route relationship**: `ConnectorBindingClient` consumes the Phase 4 Customer-local `POST /v1/internal/connector-bindings` endpoint; Phase 8 owns only the Bridge HTTPS client and exchange composition and must not implement another binding mint service.

- [ ] T068 [RED] [US4] [IDENTITY-BRIDGE] Add the outer failing amended Stage 2 acceptance regression.
  - Files: `apps/identity-bridge/test/connector-binding/stage2-acceptance.spec.ts`, existing exchange fixtures read-only unless the test requires additive setup.
  - Depends on: T067.
  - Validation: Run against current code and preserve failure caused by the absent post-admission Connector Runtime handoff, while existing Stage 1 continues passing.
  - Stop: Do not edit Feature 007 documents/tasks/history or manufacture failure by breaking MenuDetail/admission.

- [ ] T069 [RED] [US4] [IDENTITY-BRIDGE] Add failing immutable binding destination and test-mode configuration tests.
  - Files: `apps/identity-bridge/test/connector-binding/binding-config.spec.ts`, `test/connector-binding/binding-destination-policy.spec.ts`.
  - Depends on: T068.
  - Validation: Cover the `BRIDGE_BINDING_TRANSPORT_V1` exact HTTPS URI/host/port/path/query, explicit address policy, HTTP/userinfo/fragment/blank/wildcard/caller URI rejection, production loopback denial, and test-only loopback TLS.
  - Stop: No Browser/native claim/request/reference field may change any destination component.

- [ ] T070 [GREEN] [US4] [IDENTITY-BRIDGE] Implement immutable binding configuration and exact address policy.
  - Files: `apps/identity-bridge/src/connector-binding/**`, narrow `src/config/bridge-config.service.ts` integration, environment examples only if required by accepted deployment config.
  - Depends on: T069.
  - Validation: Make T069 pass; enforce `BRIDGE_BINDING_REQUEST_TIMEOUT_MS=2000` and reject test policy outside enforced test mode.
  - Stop: No HTTP fallback, generic proxy, Customer authentication redesign, or staging-ready test fixture.

- [ ] T071 [RED] [US4] [IDENTITY-BRIDGE] Add failing Bridge binding service-proof and exact-body tests.
  - Files: `apps/identity-bridge/test/connector-binding/binding-service-auth.spec.ts`.
  - Depends on: T070.
  - Validation: Cover Shinmone `assistant-connector-binding+jwt`, RS256, dedicated issuer/audience/provider/key, 30-second proof, one-use `jti`, exact raw-body SHA-256, altered bytes, wrong context, shared-key rejection, and incompatibility with central/Customer-B profiles.
  - Stop: Do not reuse canonical identity/JWKS keys or central invocation keys.

- [ ] T072 [GREEN] [US4] [IDENTITY-BRIDGE] Implement the separate binding signer and single-serialization proof builder.
  - Files: `apps/identity-bridge/src/connector-binding/**`.
  - Depends on: T071.
  - Validation: Make T071 pass with file-backed active key and exact bytes preserved for send.
  - Stop: Service proof supplies authentication/integrity only; HTTPS confidentiality remains mandatory.

- [ ] T073 [RED] [US4] [IDENTITY-BRIDGE] Add failing HTTPS binding client success and bounds tests.
  - Files: `apps/identity-bridge/test/connector-binding/binding-client.spec.ts`.
  - Depends on: T072.
  - Validation: Use deterministic TLS against the Phase 4 binding route/app harness to require `BRIDGE_BINDING_TRANSPORT_V1`, exact route, JSON, absent content encoding, 16,384-byte request, 4,096-byte response, and one successful reference response.
  - Stop: HTTP must remain rejected even under test mode.

- [ ] T074 [GREEN] [US4] [IDENTITY-BRIDGE] Implement the bounded HTTPS-only `ConnectorBindingClient` success path.
  - Files: `apps/identity-bridge/src/connector-binding/**`, narrow Bridge module composition.
  - Depends on: T073.
  - Validation: Make T073 pass with exact configured URI, pinned connection, TLS certificate/hostname verification, and response validation.
  - Stop: Do not call the client from `/identity/exchange` yet or implement a duplicate Bridge-side binding mint service.

- [ ] T075 [RED] [US4] [IDENTITY-BRIDGE] Add failing binding transport attack, timeout, and cancellation tests.
  - Files: `apps/identity-bridge/test/connector-binding/binding-transport-security.spec.ts`.
  - Depends on: T074.
  - Validation: Cover A/AAAA/all addresses, mapped IPv6, rebinding, wrong hostname/cert, redirect, proxy env, 2,000 ms timeout, socket/body abort, retry/alternate endpoint/second-send counters, and bearer sentinel capture.
  - Stop: Do not weaken TLS, inherit a proxy, resend, redirect, or use another endpoint.

- [ ] T076 [GREEN] [US4] [IDENTITY-BRIDGE] Implement fail-closed binding transport cancellation and egress controls.
  - Files: `apps/identity-bridge/src/connector-binding/**`.
  - Depends on: T075.
  - Validation: Make T075 pass with `AbortController`, socket destruction, zero retry/redirect/proxy/fallback/alternate destination/second bearer send.
  - Stop: Timeout must yield no accepted response or `connectorContextRef`.

- [ ] T077 [RED] [US4] [IDENTITY-BRIDGE] Add failing exchange ordering, authority, RefreshToken, failure, and negative-surface tests.
  - Files: `apps/identity-bridge/test/exchange/exchange.service.spec.ts`, `test/exchange/exchange.controller.spec.ts`, `test/exchange/redaction.spec.ts`, `test/connector-binding/stage2-acceptance.spec.ts`.
  - Depends on: T076.
  - Validation: Require MenuDetail/admission first; exact same AccessToken once; no RefreshToken; Shinmone IDX provider payload/profile carrying accepted Entry/native expiry evidence; provider-owned volatile handle state; Browser non-authority; safe failure/no reference; and no generic-binding/central/evidence/model/SSE leakage.
  - Stop: Connector Runtime cannot become identity, Entry, permission, Customer, HostApp, or Gateway authority.

- [ ] T078 [GREEN] [US4] [IDENTITY-BRIDGE] Compose the post-admission Stage 2 handoff and additive exchange response.
  - Files: `apps/identity-bridge/src/exchange/**`, `src/connector-binding/**`, narrow `src/bridge.module.ts` composition.
  - Depends on: T077.
  - Validation: Make T077 and outer T068 pass; return the unchanged canonical JWT plus reference metadata only after a successful mint.
  - Stop: No Feature 007 claim/permission/JWKS/session redesign and no native bearer outside the two allowed destinations.

- [ ] T079 [VERIFY] [US4] [IDENTITY-BRIDGE] Verify Feature 007 compatibility and immutable historical evidence.
  - Files: Existing Bridge MenuDetail/admission/permission/signing/JWKS/exchange suites, Gateway/session regressions, Feature 007 documents and `tasks.md` read-only.
  - Depends on: T078.
  - Validation: Run all Bridge tests/build and focused Gateway/session suites; compare protected hashes; scan central, reference, EvidenceRef, GroundedAnswerInput, model, SSE, public, log, audit, and telemetry surfaces.
  - Stop: `FEATURE007_HISTORICAL_TASKS_REWRITTEN` must remain `NO`; any authority drift is `HUMAN_REQUIRED`.

- [ ] T080 [CHECKPOINT] [US4] [IDENTITY-BRIDGE] Verify and record the Phase 8 accepted-amendment gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T070, T072, T074, T076, T078, T079.
  - Validation: Record every Feature 007 amendment and `BRIDGE_BINDING_*` marker plus `SHINMONE_BINDING_BOOTSTRAP_PROFILE=BRIDGE_BINDING_TRANSPORT_V1` and `GENERIC_BINDING_ROUTE_PROFILE=BINDING_BOOTSTRAP_ONLY`.
  - Stop: Phase 9 cannot start unless MenuDetail remains authority, the handoff is exact/secure/one-shot, no RefreshToken or central credential exists, and Feature 007 history is untouched.

## Phase 9 — ProductizedBusinessConnectorAdapter Through Feature 008

**Goal**: Register one productized adapter only through the existing Feature 008 runtime and release boundaries.  
**Dependencies**: T080.  
**Independent test**: Permission and exact ToolDefinition/registry selection precede transport; only projected safe fields reach evidence and mocks never serve as fallback.

- [ ] T081 [RED] [US8] [BACKEND] Add failing productized adapter contract and compatibility tests.
  - Files: `test/unit/productized-business-connector.adapter.spec.ts`, `test/unit/data-adapter-contract.spec.ts`.
  - Depends on: T080.
  - Validation: Preserve RED for absent adapter identity/capability/readiness while `DataAdapterExecuteInput` remains unchanged.
  - Stop: Do not add timeout, operation, destination, or credential authority to the adapter input.

- [ ] T082 [GREEN] [US8] [BACKEND] Implement the unregistered `ProductizedBusinessConnectorAdapter` shell.
  - Files: `src/connectors/productized-business/productized-business-connector.adapter.ts`.
  - Depends on: T081.
  - Validation: Make T081 pass for capability/compatibility/readiness without module registration.
  - Stop: No Assistant execution, public contract, or mock fallback.

- [ ] T083 [RED] [US8] [BACKEND] Add failing permission, exact ToolDefinition re-resolution, budget, and abort tests.
  - Files: `test/unit/productized-business-connector.adapter.spec.ts`, `test/unit/assistant-readonly-runtime.service.spec.ts`.
  - Depends on: T082.
  - Validation: Require permission before transport, exact key/version lookup, 5,000 ms authority, 250 ms reserve, max 4,500 ms signed budget, elapsed subtraction, exhaustion failure, and abort propagation.
  - Stop: No second timeout authority or transport before permission.

- [ ] T084 [GREEN] [US8] [BACKEND] Implement adapter execution using existing ToolDefinition timeout authority.
  - Files: `src/connectors/productized-business/productized-business-connector.adapter.ts`, narrow `src/tools/tool-registry.service.ts` exact-version lookup if required.
  - Depends on: T083.
  - Validation: Make T083 pass without changing `DataAdapterExecuteInput` or Feature 008 ordering.
  - Stop: Local/deployment limits may narrow but never extend `ToolDefinition.timeoutMs`.

- [ ] T085 [RED] [US8] [BACKEND] Add failing transport-failure, projection, and evidence boundary tests.
  - Files: `test/integration/productized-adapter-projection.spec.ts`, `test/integration/tool-failure-safe-response.spec.ts`, `test/unit/adapter-result-projector.service.spec.ts`.
  - Depends on: T084.
  - Validation: Require started ToolCall failure mapping, extra bounded fields rejected/minimized, raw local result absent, and projected facts only in EvidenceRef/GroundedAnswerInput.
  - Stop: Do not bypass outputSchema, masking, minimization, or existing failure decisions.

- [ ] T086 [GREEN] [US8] [BACKEND] Complete adapter response normalization through the existing projector/evidence path.
  - Files: `src/connectors/productized-business/productized-business-connector.adapter.ts`, approved Feature 008 composition only where necessary.
  - Depends on: T085.
  - Validation: Make T085 pass and rerun Feature 008 raw-result/evidence regressions.
  - Stop: No new projector, EvidenceRef type, AnswerDecision, or SSE event.

- [ ] T087 [RED] [US8] [BACKEND] Add failing exact registration and zero-fallback composition tests.
  - Files: `test/unit/connectors-module.spec.ts`, `test/integration/productized-adapter-registration.spec.ts`, existing mock adapter tests.
  - Depends on: T086.
  - Validation: Require one exact Customer/integration/HostApp/connector registration, duplicate failure, deployment mismatch failure, and no mock fallback.
  - Stop: No wildcard or operation authority in registration.

- [ ] T088 [GREEN] [US8] [BACKEND] Add exact productized registration beside unchanged mocks.
  - Files: `src/connectors/connectors.module.ts`, `src/connectors/productized-business/productized-business-connector.module.ts`, test app provider composition.
  - Depends on: T087.
  - Validation: Make T087 pass and rerun mock/runtime Feature 008 suites.
  - Stop: Do not remove or rewrite mock behavior in this phase.

- [ ] T089 [CHECKPOINT] [US8] [BACKEND] Verify and record the Phase 9 Feature 008 integration gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T082, T084, T086, T088.
  - Validation: Record a machine-readable evidence block with `FEATURE008_PROJECTION_BYPASS=NO`, `FEATURE008_TIMEOUT_SINGLE_AUTHORITY=ToolDefinition.timeoutMs`, and `MOCK_FALLBACK=NO`.
  - Stop: Phase 10 cannot start with any alternate execution, projection, or timeout path.

## Phase 10 — Generic ToolDefinition Discovery Migration

**Goal**: Replace hard-coded mock candidate routing with Customer-policy-filtered metadata discovery while preserving all mock behavior.  
**Dependencies**: T089.  
**Independent test**: Active permitted read-only tools are discovered generically; ambiguity clarifies; mocks remain equivalent before old branches are removed.

- [ ] T090 [RED] [US7] [BACKEND] Add failing metadata-driven discovery contract tests.
  - Files: `test/unit/tool-discovery.service.spec.ts`, `test/unit/tool-registry.service.spec.ts`.
  - Depends on: T089.
  - Validation: Preserve RED for absent `x-assistant-discovery-v1` parsing, policy filtering, active/read-only filtering, required groups, deterministic scoring, and ties.
  - Stop: No Customer/HostApp/Shinmone/endpoint/credential/full-question branch.

- [ ] T091 [GREEN] [US7] [BACKEND] Implement discovery metadata parsing, catalog filtering, and scoring.
  - Files: `src/tools/tool-discovery.service.ts`, `src/tools/tool-registry.service.ts`, `src/tools/tool-registry.types.ts`, `src/tools/tools.module.ts`.
  - Depends on: T090.
  - Validation: Make T090 pass with exact Customer policy, active read-only tools, required concept groups, deterministic score, and clarification result.
  - Stop: Discovery returns candidates only; ToolDefinition re-resolution remains canonical authority.

- [ ] T092 [DATA] [US7] [BACKEND] Add equivalent discovery metadata to all existing mock ToolDefinitions.
  - Files: `scripts/seed.ts`, `test/support/us1-test-app.helper.ts`, existing mock ToolDefinition fixtures.
  - Depends on: T091.
  - Validation: Run seed idempotency and metadata-schema tests for every existing mock operation; add the Synthetic Customer B fixture definition/policy for `inventory.stock-on-hand` with generic inventory/stock/lookup concepts and a distinct `{sku, quantity}` output policy.
  - Stop: Do not add the Shinmone reference ToolDefinition yet, change Prisma, or add Customer-specific discovery logic.

- [ ] T093 [VERIFY] [US7] [BACKEND] Prove existing mock questions through `ToolDiscoveryService` before branch removal.
  - Files: Existing mock/query-understanding unit, integration, and eval suites plus new discovery tests.
  - Depends on: T092.
  - Validation: Run all current mock query cases and record equivalent candidate, arguments, permission, adapter, and answer behavior.
  - Stop: Old hard-coded branches remain until this task is green.

- [ ] T094 [RED] [US7] [BACKEND] Add failing generic planner integration and ambiguity/argument-binding tests.
  - Files: `test/unit/query-understanding.service.spec.ts`, `test/unit/query-understanding-pipeline-wiring.spec.ts`, `test/integration/clarification-required.spec.ts`.
  - Depends on: T093.
  - Validation: Cover normalized resource/metric/intent/time concepts, missing groups, tied/low scores, invalid argumentBindings, and no execution on clarification.
  - Stop: Do not match complete phrases or inject Customer/HostApp data into the lexicon.

- [ ] T095 [GREEN] [US7] [BACKEND] Integrate `ToolDiscoveryService` into generic Query Understanding/Planning.
  - Files: `src/query-understanding/**`, `src/tools/tools.module.ts`.
  - Depends on: T094.
  - Validation: Make T094 pass while the old branches remain available only for the controlled equivalence step.
  - Stop: Candidate text may not replace ToolDefinition key/version/argument validation.

- [ ] T096 [RED] [US7] [BACKEND] Add failing source guards for obsolete and forbidden routing branches.
  - Files: `test/unit/query-understanding-generic-routing.guard.spec.ts`.
  - Depends on: T095.
  - Validation: Require absence of old mock-key branches and Customer/HostApp/complete-question literals in routing; add generic-source guards for Shinmone paths/result fields/IDs, `acceptedEntry`, mandatory `nativeAccessToken`, MenuDetail/Bridge-only bootstrap, bearer-only application, and JWT-exp assumptions while exempting explicit integration/compatibility areas; preserve RED from obsolete branches or leakage.
  - Stop: Do not delete branches before T093 and T095 are green.

- [ ] T097 [GREEN] [US7] [BACKEND] Remove obsolete hard-coded candidate branches after proven metadata equivalence.
  - Files: `src/query-understanding/**` where T096 identifies routing plus generic contract/central/runtime files identified by the guard; explicit `apps/customer-connector-runtime/integrations/shinmone/**` remains exempt.
  - Depends on: T096.
  - Validation: Make T096 pass by removing obsolete routing and moving any reference-specific assumption behind the Shinmone integration registry; rerun mock discovery/query/runtime and generic-source guard suites.
  - Stop: Do not remove generic lexicon, clarification, or existing non-tool understanding behavior.

- [ ] T098 [VERIFY] [US7] [BACKEND] Run full query-understanding and no-answer/eval regressions.
  - Files: `test/unit/query-*.spec.ts`, `test/integration/assistant-planning.spec.ts`, `test/integration/clarification-required.spec.ts`, `test/eval/**`.
  - Depends on: T097.
  - Validation: Run unit/integration/eval suites; confirm policy-denied tools are absent and ambiguous/insufficient queries never execute.
  - Stop: Do not accept a regression hidden by fallback routing.

- [ ] T099 [CHECKPOINT] [US7] [BACKEND] Verify and record the Phase 10 generic-discovery gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T091, T092, T093, T095, T097, T098.
  - Validation: Record a machine-readable evidence block with `CUSTOMER_BRANCH_IN_ASSISTANT_CORE=NO`, `SHINMONE_FULL_QUERY_BRANCH=NO`, and `MOCK_DISCOVERY_COMPATIBILITY=PASS`.
  - Stop: Phase 11 cannot start if any Customer-specific branch or mock regression survives.

## Phase 11 — First Shinmone Reference Configuration

**Goal**: Configure `work-orders.monthly-new-count` through existing data/policy/configuration surfaces and the closed local manifest.  
**Dependencies**: T099.  
**Independent test**: The actual Chinese question resolves generically and a fixture returns exactly the bounded three-field result through Feature 008 projection.

- [ ] T100 [RED] [US7] [BACKEND] Add failing Shinmone ToolDefinition, Customer policy, discovery metadata, output policy, and seed-idempotency tests.
  - Files: `test/integration/customer-tool-policy.spec.ts`, `test/integration/customer-tool-idempotency.spec.ts`, `test/unit/tool-discovery.service.spec.ts`, seed test fixtures.
  - Depends on: T099.
  - Validation: Require key `work-orders.monthly-new-count`, contract `1.0.0`, read-only policy, generic work-order/new-count/this-month concepts, and only metric/period/count output.
  - Stop: No Prisma schema/migration, Customer routing branch, complete-question literal, endpoint, or credential in discovery metadata.

- [ ] T101 [GREEN] [US7] [BACKEND] Seed the reference ToolDefinition, Customer policy, discovery metadata, and output policy idempotently.
  - Files: `scripts/seed.ts`, `test/support/us1-test-app.helper.ts` and approved test fixtures.
  - Depends on: T100.
  - Validation: Make T100 pass and run seed twice without duplicate/change drift.
  - Stop: Do not declare any live Shinmone HTTP destination ready.

- [ ] T102 [RED] [US7] [CONNECTOR-RUNTIME] Add failing Shinmone IDX bootstrap, bearer-profile, manifest, and response fixture tests.
  - Files: `apps/customer-connector-runtime/test/integrations/shinmone-bootstrap-provider.spec.ts`, `test/integrations/shinmone-manifest.spec.ts`, fixture upstream responses.
  - Depends on: T101.
  - Validation: Require Shinmone-only provider schema for same accepted token/Entry, provider-owned handle storage, native JWT-exp cap and rejection/remint semantics, `shinmone-idx-bearer-v1`, exact `GET_QUERY_V1 /Dashboard/KPIStats?TimeRange=thisMonth`, `/data/newOrders/current`, and exactly three bounded fields.
  - Stop: No alternate API, dynamic query/path, raw envelope, or checked-in HTTP origin.

- [ ] T103 [GREEN] [US7] [CONNECTOR-RUNTIME] Add the removable Shinmone IDX provider, bearer profile, and closed V1 manifest.
  - Files: `apps/customer-connector-runtime/integrations/shinmone/**` and runtime integration configuration fixtures.
  - Depends on: T102.
  - Validation: Make T102 pass through the generic manifest and upstream executor.
  - Stop: Native token/accepted Entry/JWT-exp/bearer/remint assumptions stay inside this integration provider/profile; the manifest contains only `credentialProfileRef`, closed GET profile data, and no credential/header/callback/Assistant-core logic.

- [ ] T104 [RED] [US7] [BACKEND] Add failing exact reference deployment and adapter configuration tests.
  - Files: `test/integration/shinmone-connector-deployment.spec.ts`, `test/unit/connectors-module.spec.ts`, central deployment fixtures.
  - Depends on: T103.
  - Validation: Require one exact Customer/integration/HostApp/connector instance, operation/version availability, HTTPS-only destination, and inactive/no-match failure.
  - Stop: No wildcard, database registry, real credential, or live HTTP endpoint.

- [ ] T105 [GREEN] [US7] [BACKEND] Compose the exact reference deployment and productized adapter registration fixtures/configuration.
  - Files: `src/connectors/connectors.module.ts`, central deployment fixtures/configuration, approved test app helper.
  - Depends on: T104.
  - Validation: Make T104 pass and preserve all mock registrations.
  - Stop: Do not hard-code Customer/Shinmone behavior in the adapter or Query Understanding.

- [ ] T106 [VERIFY] [US7] [BACKEND] Prove the fixture vertical slice from natural language through projected evidence.
  - Files: `test/integration/shinmone-monthly-new-count.fixture.spec.ts`, query/evidence/public contract regressions, `prisma/schema.prisma`, `prisma/migrations/` read-only.
  - Depends on: T105.
  - Validation: Start with `這個月新增幾張工單？`; prove generic unique discovery, canonical ToolDefinition, permission, adapter, fixed manifest, bounded result, outputSchema projection, and evidence; scan for forbidden branches and schema changes.
  - Stop: Direct operation invocation alone is insufficient and no fixture may claim live staging readiness.

- [ ] T107 [CHECKPOINT] [US7] [BACKEND] Verify and record the Phase 11 reference-configuration gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T101, T103, T105, T106.
  - Validation: Record a machine-readable evidence block with `GENERIC_REAL_QUESTION_RESOLUTION=PASS`, `REFERENCE_MANIFEST_FIXTURE=PASS`, and `CENTRAL_PRISMA_SCHEMA_CHANGE=NO`.
  - Stop: Phase 12 cannot start if the question uses a specific branch or the manifest/result differs from the accepted mapping.

## Phase 12 — Shinmone SPA Transient Reference Delivery

**Goal**: Carry the canonical token and opaque binding reference in memory through the existing PageContext provider without SDK or public API changes.  
**Dependencies**: T107.  
**Independent test**: The provider reacquires and attaches a valid reference transiently, with no browser persistence or public/history leakage.

- [ ] T108 [RED] [US7] [SHINMONE-SPA] Add failing in-memory identity/reference bundle and separate-expiry tests.
  - Files: `/Users/evalin/Documents/ideaxpress proj/idx-shinmone-scm-frontend/tests/unit/assistantIdentityTokenProvider.spec.ts`.
  - Depends on: T107.
  - Validation: Run `npm run test:unit -- tests/unit/assistantIdentityTokenProvider.spec.ts` in the Shinmone repository; preserve RED for absent reference acquisition/cache/expiry behavior.
  - Stop: No localStorage, sessionStorage, cookie, IndexedDB, log, or RefreshToken ownership change.

- [ ] T109 [GREEN] [US7] [SHINMONE-SPA] Implement the in-memory canonical-token/reference provider bundle.
  - Files: `/Users/evalin/Documents/ideaxpress proj/idx-shinmone-scm-frontend/composables/assistant/assistantIdentityTokenProvider.ts`.
  - Depends on: T108.
  - Validation: Make T108 pass with separate expiries, 15-second refresh window, missing/expired reacquisition, and memory-only values.
  - Stop: Do not change Customer authentication, read RefreshToken, or persist either bearer/reference.

- [ ] T110 [RED] [US7] [SHINMONE-SPA] Add failing existing-PageContext delivery tests.
  - Files: `/Users/evalin/Documents/ideaxpress proj/idx-shinmone-scm-frontend/tests/integration/assistantSdkHandoff.spec.ts`.
  - Depends on: T109.
  - Validation: Require the current provider callback to attach only `connectorContextRef` to existing PageContext immediately before send/retry, with no new request type.
  - Stop: Do not edit the SDK repository or add an Assistant public field outside existing PageContext.

- [ ] T111 [GREEN] [US7] [SHINMONE-SPA] Attach the valid transient reference through the existing widget provider.
  - Files: `/Users/evalin/Documents/ideaxpress proj/idx-shinmone-scm-frontend/composables/assistant/assistantWidget.ts`.
  - Depends on: T110.
  - Validation: Make T110 pass; omit the field safely when no valid bundle exists.
  - Stop: Browser possession remains non-authoritative and cannot choose destination/context.

- [ ] T112 [RED] [US7] [SHINMONE-SPA] Add failing refresh, native-token-change invalidation, and non-persistence/security tests.
  - Files: `/Users/evalin/Documents/ideaxpress proj/idx-shinmone-scm-frontend/tests/unit/assistantIdentityTokenProvider.spec.ts`, `tests/contract/assistantSecurityGuards.spec.ts`.
  - Depends on: T111.
  - Validation: Cover remint, simultaneous invalidation, missing/expired reference, exchange failure, no ref in storage/log/history/public request/response, and no SDK-visible contract change.
  - Stop: Do not weaken sanitization or retain a reference across native credential generation changes.

- [ ] T113 [GREEN] [US7] [SHINMONE-SPA] Complete safe invalidation/remint and transient-delivery handling.
  - Files: The two allowed Shinmone composables only.
  - Depends on: T112.
  - Validation: Make T112 pass and rerun unit/integration/contract Assistant suites.
  - Stop: No broad SPA, Auth, business client, proxy, or UI modification.

- [ ] T114 [VERIFY] [US7] [SDK-READ-ONLY] Verify the SDK and Assistant public contracts remain byte- and behavior-compatible.
  - Files: `/Users/evalin/Documents/my proj/F2E/internal-ai-assistant/packages/assistant-sdk/src/types/public.ts`, `src/context/**`, `src/request/pageContext.ts`, `src/request/hostIntegrationRequestAdapter.ts`; Backend public/SSE contracts.
  - Depends on: T113.
  - Validation: Compare SDK status/hashes and run relevant existing SDK/Backend contract tests without edits.
  - Stop: Any SDK implementation or public type change is `HUMAN_REQUIRED`.

- [ ] T115 [CHECKPOINT] [US7] [SHINMONE-SPA] Verify and record the Phase 12 transient-delivery gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T109, T111, T113, T114.
  - Validation: Record a machine-readable evidence block with `SDK_PUBLIC_API_CHANGE=NO`, `ASSISTANT_PUBLIC_API_CHANGE=NO`, and `TRANSIENT_REF_DELIVERY=PASS`.
  - Stop: Phase 13 cannot start if the reference persists, becomes authority, or requires SDK/public changes.

## Phase 13 — Isolation, Portability, Removal, and Compatibility Closeout

**Goal**: Execute isolation, Customer B portability, Shinmone-removal, generic-source, security, and predecessor/public gates before real staging access.
**Dependencies**: T115.  
**Independent test**: Two-Customer and hostile transport/manifest fixtures cannot cross any boundary or leak prohibited material while all existing contracts remain green.

- [ ] T116 [VERIFY] [US5] [BACKEND] Execute two-Customer discovery, deployment, policy, adapter, and evidence isolation.
  - Files: `test/integration/feature009-customer-isolation.spec.ts`, existing Customer isolation fixtures/suites.
  - Depends on: T115.
  - Validation: Use identical organization/actor/HostApp/reference-shaped values across Customers and prove Customer remains the outer boundary; this task is isolation-only and does not substitute for executable reuse.
  - Stop: No cross-Customer existence detail or shared registration/binding/evidence.

- [ ] T117 [VERIFY] [US5] [CONNECTOR-RUNTIME] Execute service replay and every cross-binding-dimension attack.
  - Files: Runtime service-auth/replay/binding security suites and composed binding/invocation route suites.
  - Depends on: T116.
  - Validation: Reuse signed bytes/reference while varying context/provider/generation/expiry/revocation/leases; invoke both routes and prove central, Shinmone Bridge, Customer B, and other bootstrap profiles cannot cross-accept. Also execute duplicate/wildcard/dynamic URL/method/path/query/header/body/credential/traversal/callback/template/script/SQL/shell/command/bad-pointer/cap/write-classification manifest attacks. Record both route/profile isolation markers.
  - Stop: Credential resolver/upstream must remain uncalled on every rejection.

- [ ] T118 [VERIFY] [CONNECTOR-RUNTIME] Execute Synthetic Customer B vertical portability and Shinmone-removal verification.
  - Files: Customer B fixture integration/provider/profile/manifest suites, generic/shared/central build targets, Shinmone-removal topology, and Feature 008 discovery/projection harness.
  - Depends on: T117.
  - Validation: Execute `inventory.stock-on-hand` for tuple `customer-b` / `inventory-b` / `customer-b-inventory` and instance `customer-b-inventory-connector-1` using generic inventory/stock/lookup discovery, the same contract/adapter/registry/runtime/service-auth/Feature 008 path, fixed `POST_QUERY_JSON_V1 /inventory/stock/query`, strict `sku` body, fixture provider-owned API-key handle, fixed allowlisted code-owned `X-Inventory-Key`, and exact `{sku, quantity}` projection. Then disable/remove every Shinmone provider/profile/manifest/deployment/ToolDefinition-policy/SPA fixture and prove generic builds plus Customer B still pass.
  - Stop: No Customer-B/Shinmone conditional in Assistant core, central adapter/transport, or generic runtime; fixture API-key strategy is not production approval.

- [ ] T119 [VERIFY] [BACKEND] Execute all three network-profile security matrices.
  - Files: Central connector transport, Bridge binding transport, runtime upstream network/TLS/DNS suites, and composed Bridge → binding-route and central → invocation-route harnesses.
  - Depends on: T118.
  - Validation: Exercise Bridge → `POST /v1/internal/connector-bindings` and central → `POST /v1/connector/invocations` in composed mode while covering HTTPS, profile isolation, address modes, all A/AAAA/mapped/mixed results, rebinding, TLS, redirect, proxy, compression, limits, cancellation, zero retry, and test-only loopback isolation.
  - Stop: No HTTP staging/production fallback or broad Customer-private access.

- [ ] T120 [VERIFY] [BACKEND] Execute credential, reference, proof, raw-body, raw-response, and pre-projection leak scans.
  - Files: `test/integration/secret-redaction.spec.ts`, composed binding/invocation endpoint harnesses, runtime/Bridge redaction suites, and captured log/audit/telemetry/model/SSE/public/persistence fixtures.
  - Depends on: T119.
  - Validation: Place unique sentinels in every prohibited class and inspect complete binding/invocation paths; also scan non-exempt generic contract, central adapter/transport, runtime orchestration, and Query Understanding sources for Shinmone paths/results/IDs, `acceptedEntry`, mandatory `nativeAccessToken`, MenuDetail/Bridge-only bootstrap, bearer-only application, JWT-exp parsing, or Customer branching.
  - Stop: Hashes or reversible encodings do not count as safe unless explicitly approved one-way binding verifiers.

- [ ] T121 [VERIFY] [IDENTITY-BRIDGE] Re-run complete Feature 007 identity/session/JWKS compatibility.
  - Files: All Identity Bridge tests/build and focused Gateway/session trust-chain suites; Feature 007 artifacts read-only.
  - Depends on: T120.
  - Validation: Confirm MenuDetail/admission/Entry/permission/JWT/JWKS/session semantics unchanged and accepted Stage 2 additive behavior only.
  - Stop: Never edit or retroactively complete Feature 007 historical tasks.

- [ ] T122 [VERIFY] [BACKEND] Re-run complete Feature 008 permission, lifecycle, projection, evidence, answer, and mock compatibility.
  - Files: Feature 008 unit/integration/eval suites and existing mock fixtures.
  - Depends on: T121.
  - Validation: Confirm permission precedes transport, ToolCall states remain exact, outputSchema is final release authority, evidence is projected, and mocks have zero fallback role.
  - Stop: No new Assistant execution path or competing timeout authority.

- [ ] T123 [VERIFY] [BACKEND] Re-run public API, SSE, history, feedback, approval, and failure-semantics contracts.
  - Files: `test/contract/**` relevant Assistant suites, history/feedback/approval integrations, no-answer/tool-failure tests.
  - Depends on: T122.
  - Validation: Run unchanged contracts and confirm connector failures collapse into existing failed ToolCall and answer/SSE behavior.
  - Stop: No new endpoint, request mode, decision, event, public error, or connector-specific client contract.

- [ ] T124 [VERIFY] [BACKEND] Execute composed timeout, disconnect, abort, cleanup, and readiness-loss races.
  - Files: Feature 009 central/runtime/Bridge timeout suites and integration harness.
  - Depends on: T123.
  - Validation: Prove 2,000 ms binding domain separation, 5,000/250/4,500/250/3,500 ms business hierarchy, monotonic elapsed handling, socket abort, lease release, and zero retry.
  - Stop: Binding timeout must never become or extend ToolDefinition timeout authority.

- [ ] T125 [CHECKPOINT] [BACKEND] Verify and record the complete pre-staging security gate matrix.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T116, T117, T118, T119, T120, T121, T122, T123, T124.
  - Validation: Record every Section 9 gate plus `SECOND_CUSTOMER_REUSE_PROOF=PASS`, `SHINMONE_REMOVAL_GENERIC_RUNTIME_PASS=YES`, `CUSTOMER_SPECIFIC_ASSISTANT_CORE_BRANCH=NO`, `CUSTOMER_SPECIFIC_GENERIC_RUNTIME_BRANCH=NO`, and `FEATURE009_PRE_STAGING_SECURITY_CLOSEOUT=PASS` only when all evidence is green.
  - Stop: Any omitted/failing gate blocks Phase 14 and is not eligible for silent waiver.

## Phase 14 — Live Shinmone Staging Vertical Slice

**Goal**: Prove the actual natural-language question through the real approved Customer staging path.  
**Dependencies**: T125 and explicit T126 human/deployment approval.  
**Independent test**: `這個月新增幾張工單？` produces an existing evidence-backed answer/SSE response from the approved HTTPS Shinmone API with safe negative behavior.

- [ ] T126 [OPS] [US7] [STAGING] Obtain and verify the mandatory HUMAN_REQUIRED live-staging prerequisite set.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` operator worksheet/evidence only; deployment systems are read-only until approval.
  - Depends on: T125.
  - Validation: Approve `APPROVED_SHINMONE_HTTPS_ORIGIN`, trust/key material, exact deployment, ready single runtime, admitted user, Customer tool policy, and deployed provider.
  - Stop: Do not continue with `http://59.125.138.139/APIs/SCM/`, mocks, local fixtures, direct-operation substitution, missing approval, or recorded secrets.

- [ ] T127 [OPS] [US7] [STAGING] Deploy/configure and prove Bridge, Connector Runtime, trust, manifest, provider, and central readiness.
  - Files: Approved deployment configuration/secrets outside source; `tasks.md` receives only safe evidence.
  - Depends on: T126.
  - Validation: Check exact HTTPS/TLS/address policy, separate proof profiles, single replica, manifest hash/version, central deployment, policy, provider version, health/readiness, and rotation state.
  - Stop: Do not source-code staging values or proceed while any readiness gate is false.

- [ ] T128 [VERIFY] [US7] [STAGING] Prove real Stage 1 followed by the exact secure Stage 2 binding mint.
  - Files: Running staging Bridge/Connector Runtime and safe correlated evidence in this `tasks.md` only.
  - Depends on: T127.
  - Validation: Authorized user completes MenuDetail/admission, then one HTTPS binding handoff yields a transient reference without revealing native material.
  - Stop: No credential, reference, proof, claims, or endpoint detail may be recorded in evidence.

- [ ] T129 [VERIFY] [US7] [US8] [STAGING] Execute the primary natural-language live vertical slice.
  - Files: Running staging Assistant/Bridge/runtime/Shinmone/provider; safe evidence in this `tasks.md` only.
  - Depends on: T128.
  - Validation: Start at `這個月新增幾張工單？`; prove generic discovery, ToolDefinition, permission, adapter, signed transport, binding, fixed HTTPS GET, `newOrders.current`, bounded result, projection, EvidenceRef, GroundedAnswerInput, and existing answer/SSE.
  - Stop: Direct named-operation invocation, mock data, or fixture API is not primary acceptance.

- [ ] T130 [VERIFY] [US7] [STAGING] Execute expired/revoked binding and permission-denial live negatives.
  - Files: Running staging components and safe evidence only.
  - Depends on: T129.
  - Validation: Prove no local credential/upstream access for invalid binding and no connector transport after permission denial; retain safe existing outcomes.
  - Stop: Do not record foreign-resource existence or raw identifiers beyond approved correlation.

- [ ] T131 [VERIFY] [US8] [STAGING] Execute native-auth rejection, upstream failure, timeout, and readiness-loss live negatives.
  - Files: Running staging components and safe evidence only.
  - Depends on: T130.
  - Validation: Use approved reversible staging controls to prove revocation, failed ToolCall/no-answer behavior, abort/zero retry, no partial release, and restored readiness.
  - Stop: Do not make destructive Customer changes, expose secrets, or leave staging unhealthy.

- [ ] T132 [CHECKPOINT] [US7] [US8] [STAGING] Verify and record the Phase 14 live gate.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` safe evidence only.
  - Depends on: T127, T128, T129, T130, T131.
  - Validation: Record a machine-readable evidence block with `SHINMONE_LIVE_VERTICAL_SLICE_READY=YES` only when primary and negative proofs pass and approved configuration is restored healthy.
  - Stop: A mock, fixture, HTTP endpoint, or manual direct operation cannot complete this checkpoint.

## Phase 15 — Final Compatibility and Rollback Closeout

**Goal**: Establish full quality, scope, reversibility, and final acceptance evidence.  
**Dependencies**: T132.  
**Independent test**: Full suites pass, rollback restores predecessor/mock behavior without migration rollback, staging is safely restored, and every machine-readable gate is satisfied.

- [ ] T133 [VERIFY] [BACKEND] Run the complete Backend unit, integration, contract, e2e, and eval suites.
  - Files: Root `package.json` scripts and all `test/**` suites.
  - Depends on: T132.
  - Validation: Run `npm run test:unit`, `test:integration`, `test:contract`, `test:e2e`, and `test:eval` with required test DB preparation only under established safe commands.
  - Stop: Do not update snapshots or skip failures to obtain green.

- [ ] T134 [VERIFY] [CONNECTOR-RUNTIME] Run the complete Connector Runtime suite and build.
  - Files: `apps/customer-connector-runtime/**`.
  - Depends on: T133.
  - Validation: Run its full tests, typecheck/lint where configured, and independent build.
  - Stop: No skipped security suite, multi-replica claim, or test-mode production readiness.

- [ ] T135 [VERIFY] [IDENTITY-BRIDGE] Run complete Identity Bridge, Gateway, and session regressions.
  - Files: `apps/identity-bridge/**`, `apps/gateway/**`, focused Backend trust/session suites.
  - Depends on: T134.
  - Validation: Run full Bridge tests/build, Gateway build/tests, and canonical session chain regressions.
  - Stop: Feature 007 artifacts/history remain read-only and identity authority unchanged.

- [ ] T136 [VERIFY] [SHINMONE-SPA] Run external focused tests and verify SDK read-only state.
  - Files: The two Shinmone composables and three focused test files; SDK provider/request/public type paths read-only.
  - Depends on: T135.
  - Validation: Run Shinmone unit/integration/contract/typecheck/lint/build and compare SDK hashes/status.
  - Stop: No SDK implementation, unrelated SPA edit, or uncommitted secret/reference artifact.

- [ ] T137 [VERIFY] [BACKEND] Run full typecheck, lint, build, aggregate test, and diff-format checks.
  - Files: Root, shared package, Connector Runtime, Identity Bridge, and Gateway build configurations.
  - Depends on: T136.
  - Validation: Run root/package/app typechecks, lint, builds, aggregate tests, and `git diff --check`; classify only demonstrably pre-existing failures.
  - Stop: Do not auto-fix unrelated files or hide a Feature 009 failure as pre-existing.

- [ ] T138 [VERIFY] [BACKEND] Audit final repository scope, Prisma, protected docs, public contracts, and prohibited material.
  - Files: Repository status/diff, `prisma/schema.prisma`, migrations, Feature 007 artifacts, Feature 009 artifacts, `.specify/`, `AGENTS.md`, SDK/SPA status, log/audit/telemetry/evidence fixtures.
  - Depends on: T137.
  - Validation: Prove no central schema/migration, hook/context, predecessor-history, SDK public, Assistant public/SSE, or secret/reference/raw-result leak outside authorized implementation scope.
  - Stop: Any unexplained drift is a release blocker.

- [ ] T139 [OPS] [STAGING] Rehearse rollback of Customer policy/tool availability and exact productized adapter/deployment activation.
  - Files: Reversible staging configuration and safe evidence in this `tasks.md`; no schema/data migration.
  - Depends on: T138.
  - Validation: Disable Customer tool availability, remove/disable exact registration and ConnectorDeployment entry, and confirm no productized invocation can start.
  - Stop: Do not delete Customer data, alter Feature 007 trust, or affect unrelated Customers/tools.

- [ ] T140 [OPS] [STAGING] Rehearse SPA reference withholding and Connector Runtime restart rollback behavior.
  - Files: Reversible Shinmone provider/deployment settings and safe evidence.
  - Depends on: T139.
  - Validation: Withhold `connectorContextRef`, restart the runtime, prove volatile state invalidation, Feature 007 identity/session continuity, Feature 008 mock operation, and unchanged public/SSE behavior.
  - Stop: No migration rollback, native-token exposure, or permanent staging disablement.

- [ ] T141 [OPS] [STAGING] Restore the approved staging configuration and revalidate readiness/live smoke behavior.
  - Files: Approved staging configuration and safe evidence only.
  - Depends on: T140.
  - Validation: Restore policy, exact registration/deployment, provider delivery, and runtime; confirm readiness and rerun the natural-language smoke proof without recording sensitive values.
  - Stop: Do not finish with staging partially restored or using different authority/configuration.

- [ ] T142 [CHECKPOINT] [BACKEND] Record the final Feature 009 implementation acceptance report.
  - Files: `specs/009-productized-business-connector-runtime/tasks.md` evidence only.
  - Depends on: T133, T134, T135, T136, T137, T138, T139, T140, T141.
  - Validation: After gate approval and execution, record every marker below including all portability gates and end with `FEATURE009_IMPLEMENTATION_STATUS=PASS`; this unchecked Draft task records no current pass.
  - Stop: Do not mark complete with a failing/unknown gate, rewritten Feature 007 history, unapproved scope, or unavailable live proof.

## Dependencies and Execution Order

```text
T005 → T015 → T026 → T035 → T044 → T057 → T067 → T080
     → T089 → T099 → T107 → T115 → T125 → T132 → T142
```

- T001–T004 are the only parallel baseline tasks.
- T006, T008, and T010 may be authored in parallel after T005 because their RED files are disjoint; their GREEN implementations and shared exports are sequential.
- No other task is marked `[P]`. Shared module composition, seed data, query-understanding, Bridge exchange, external provider state, security gates, and staging controls require their declared order.
- Each phase's first task depends on the preceding checkpoint, and every checkpoint depends on all required tasks in its phase.

## User Story Traceability

| Story | Primary tasks | Independent completion evidence |
| --- | --- | --- |
| US1 Customer-local binding | T027–T035, T116–T117 | Exact valid resolution; expiry, revoke, generation, lease, and every context mismatch fail before credentials |
| US2 authenticated service transport | T016–T026, T058–T067 | Valid exact proof succeeds; altered, stale, replayed, wrong-audience/context requests fail first |
| US3 fixed named operations | T036–T044, T100–T107 | Exact manifest operation runs; arbitrary HTTP/SQL/command/credential input cannot execute |
| US4 native credential isolation | T027–T035, T068–T080, T120 | Credential is Customer-local, sent only in ordered Stage 1/2, and absent from all prohibited surfaces |
| US5 Customer/integration/host isolation | T029–T035, T116–T117 | Two Customers with identical subordinate IDs cannot cross any trusted dimension |
| US6 bounded network/failure behavior | T045–T067, T119, T124 | Unsafe network, limits, replay, timeout, and dependency failures normalize safely without retry/release |
| US7 Shinmone monthly question | T090–T115, T126–T132 | Actual question resolves generically and invokes only the configured monthly-count operation |
| US8 grounded existing answer | T081–T089, T122–T123, T129–T132 | Only projected facts reach evidence/grounded input and existing answer/SSE behavior |

## Final Acceptance Report

T080 and T142 must preserve the predecessor-amendment markers; T142 must report the complete gate set:

```text
FEATURE007_AMENDMENT_PRESERVED=YES
FEATURE007_IDENTITY_AUTHORITY_CHANGED=NO
NATIVE_CREDENTIAL_ALLOWED_DESTINATION_CHANGED=YES
MENUDDETAIL_REMAINS_VALIDITY_AUTHORITY=YES
CUSTOMER_LOCAL_CONNECTOR_HANDOFF_ALLOWED=YES
CENTRAL_NATIVE_CREDENTIAL_ALLOWED=NO
REFRESH_TOKEN_HANDOFF_ALLOWED=NO

FEATURE008_AUTHORITIES_PRESERVED=YES
NATIVE_CREDENTIAL_CENTRAL=NO
CONNECTOR_CONTEXT_REF_PERSISTED=NO
BROWSER_AUTHORITY=NO
SERVICE_AUTH_REPLAY_PROTECTION=READY
BINDING_CREDENTIAL_ROUTE_ACTIVE=YES
BINDING_ROUTE_PROFILE=BINDING_BOOTSTRAP_ONLY
BINDING_ROUTE_PROFILE_ISOLATION=PASS
SHINMONE_BINDING_BOOTSTRAP_PROFILE=BRIDGE_BINDING_TRANSPORT_V1
INVOCATION_ROUTE_ACTIVE=YES
INVOCATION_ROUTE_PROFILE_ISOLATION=PASS
INVOCATION_PROCESSING_ORDER=PASS
CONNECTOR_RUNTIME_GENERIC_READINESS=PASS

BRIDGE_BINDING_TRANSPORT_PROFILE=BRIDGE_BINDING_TRANSPORT_V1
BRIDGE_BINDING_TRANSPORT_HTTPS=YES
BRIDGE_BINDING_HTTPS_ONLY=YES
BRIDGE_BINDING_DESTINATION_TRUSTED_CONFIG_ONLY=YES
BRIDGE_BINDING_DESTINATION_BROWSER_OVERRIDE=NO
BRIDGE_BINDING_TLS_HOSTNAME_VERIFY=YES
BRIDGE_BINDING_RETRY=NO
BRIDGE_BINDING_REDIRECT=NO
BRIDGE_BINDING_PROXY_INHERITANCE=NO
BRIDGE_BINDING_NATIVE_CREDENTIAL_CONFIDENTIALITY=PASS
BRIDGE_BINDING_NATIVE_TOKEN_LEAK=NO
BRIDGE_BINDING_TIMEOUT_MS=2000

GENERIC_HTTP_PROXY=NO
GENERIC_SQL=NO
GENERIC_COMMAND_EXECUTION=NO
CLOSED_READ_REQUEST_PROFILES=GET_QUERY_V1,POST_QUERY_JSON_V1
CREDENTIAL_PROFILE_ISOLATION=PASS
CROSS_CUSTOMER_BINDING_REUSE=DENIED
CROSS_INTEGRATION_REUSE=DENIED
CROSS_HOSTAPP_REUSE=DENIED
CROSS_CONNECTOR_INSTANCE_REUSE=DENIED
CROSS_ACTOR_REUSE=DENIED
MANIFEST_OPERATION_EXACT_MATCH=YES
DESTINATION_BROWSER_OVERRIDE=NO
DNS_REBINDING_PROTECTION=READY
REDIRECTS=DENIED

RAW_CUSTOMER_API_RESPONSE_CENTRAL=NO
BOUNDED_LOCAL_RESULT_ONLY=YES
FEATURE008_PROJECTION_BYPASS=NO
FEATURE008_TIMEOUT_SINGLE_AUTHORITY=ToolDefinition.timeoutMs
MOCK_FALLBACK=NO

CUSTOMER_BRANCH_IN_ASSISTANT_CORE=NO
SHINMONE_FULL_QUERY_BRANCH=NO
SECOND_CUSTOMER_REUSE_PROOF=PASS
SHINMONE_REMOVAL_GENERIC_RUNTIME_PASS=YES
CUSTOMER_SPECIFIC_ASSISTANT_CORE_BRANCH=NO
CUSTOMER_SPECIFIC_GENERIC_RUNTIME_BRANCH=NO
PUBLIC_API_CHANGE=NO
SSE_CONTRACT_CHANGE=NO
SDK_PUBLIC_API_CHANGE=NO
CENTRAL_PRISMA_SCHEMA_CHANGE=NO

OPEN_IMPLEMENTATION_BLOCKERS=0
SHINMONE_LIVE_VERTICAL_SLICE_READY=YES
FEATURE007_HISTORICAL_TASKS_REWRITTEN=NO
FEATURE009_IMPLEMENTATION_STATUS=PASS
```

## Task-List Generation Summary

```text
TASKS_FILE=specs/009-productized-business-connector-runtime/tasks.md
TASKS_ONLY=YES
TOTAL_TASKS=142
PHASES_REPRESENTED=15
PHASE_CHECKPOINTS=15
RED_GREEN_PAIRS_PRESENT=YES
SECURITY_GATE_TASKS_COMPLETE=YES
BRIDGE_BINDING_TRANSPORT_TASKS_PRESENT=YES
PHASE14_STAGING_GATE_EXPLICIT=YES
SDK_IMPLEMENTATION_TASKS_PRESENT=NO
FEATURE007_HISTORICAL_TASKS_REWRITTEN=NO
OPEN_TASK_DESIGN_BLOCKERS=0
PREDECESSOR_CONTRACT_BASELINE_RESULT=PASS
PHASE1_EXECUTED=YES
CONNECTOR_RUNTIME_CONTRACT_READY=YES
PHASE2_EXECUTED=YES
PHASE3_EXECUTED=YES
IMPLEMENTATION_GATE_APPROVED=YES
HUMAN_IMPLEMENTATION_GATE_REVIEW=PASS
READY_FOR_HUMAN_GATE_REVIEW=NO
NEXT_ACTION=EXECUTE_PHASE4
```
