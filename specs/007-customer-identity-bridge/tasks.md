# Tasks: Feature 007 — Customer-side Identity Bridge

**Input**: `spec.md`, `design.md`, and corrected `plan.md`.
**Rule**: RED-test-first ordering applies when a task introduces production capability. Characterization, compatibility, isolation, security regression, staging verification, and UAT evidence may first-run PASS when preceding implementation already satisfies the contract; never manufacture a RED state. Each task states type, paths, dependencies, validation, and completion. `HUMAN_REQUIRED` is never recorded as PASS.

## Phase 1 — Bridge application skeleton

- [X] T001 [TEST] Create independent-package RED tests in `apps/identity-bridge/test/package-contract.spec.ts`; deps: none; assert no Gateway runtime/DB import; validate `npm --prefix apps/identity-bridge test`; done when tests fail only for absent Bridge.
- [X] T002 [TEST] Create bootstrap/root-module RED tests in `apps/identity-bridge/test/bootstrap.spec.ts`; deps: T001; assert standalone Nest composition; validate focused Jest; done when contract is red.
- [X] T003 [TEST] Create health/readiness-controller RED tests in `apps/identity-bridge/test/health.spec.ts`; deps: T001; assert `GET /health` and initial local `GET /ready`; validate focused Jest; done when red.
- [X] T004 [IMPL] Create `apps/identity-bridge/package.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.test.json`, and Jest config; deps: T001; add independent build/test scripts only; validate `npm --prefix apps/identity-bridge run build`; done when T001 passes.
- [X] T005 [IMPL] Create `apps/identity-bridge/src/main.ts`, `bridge.module.ts`, and `src/config/configuration.module.ts`; deps: T002,T004; bootstrap independently without Gateway env/signing/DB; validate bootstrap test; done when T002 passes.
- [X] T006 [IMPL] Create `apps/identity-bridge/src/health/health.module.ts`, controllers, and readiness shell; deps: T003,T005; no IDX call or signing/JWKS capability; validate health test; done when T003 passes.
- [X] T007 [DOC/EVIDENCE] Record Phase 1 evidence in `specs/007-customer-identity-bridge/tasks.md`; deps: T004-T006; run Bridge test/build and classify skips; done when `IDENTITY_BRIDGE_APP_SKELETON_READY` is evidenced.

**Phase 1 evidence**: T001–T003 RED contracts were run with the repository Jest binary before package/runtime creation and failed only because the Bridge package and Phase 1 source files were absent. T004–T006 then passed all three Bridge suites (5 tests), `npm --prefix apps/identity-bridge run build`, and `git diff --check`. No guarded test was skipped.

## Phase 2 — Configuration and readiness framework

- [ ] T008 [TEST] Create RED required/blank/config-shape tests in `apps/identity-bridge/test/config/configuration.spec.ts`; deps: T007; cover endpoint, Entry, integration, HostApp, issuer/audience, signing-key shape; validate focused Jest; done when red.
- [ ] T009 [TEST] Create RED network/CORS/bounds tests in `apps/identity-bridge/test/config/network-policy.spec.ts`; deps: T007; cover HTTPS/public JWKS URI, modes/CIDRs, timeout 1..5000, size 1..262144, exact origins/no wildcard; validate focused Jest; done when red.
- [ ] T010 [TEST] Create RED deferred-dependency readiness tests in `apps/identity-bridge/test/health/readiness.spec.ts`; deps: T007; prove later signing/JWKS capabilities keep ready false; validate focused Jest; done when red.
- [ ] T011 [IMPL] Implement typed parser/validator in `apps/identity-bridge/src/config/bridge-config.service.ts`; deps: T008,T009; validate shape only, no private-key load/JWT/JWKS; validate config suites; done when T008-T009 pass.
- [ ] T012 [IMPL] Implement destination/network config model in `apps/identity-bridge/src/config/destination-policy.config.ts`; deps: T009,T011; enforce modes, CIDRs, bounds, origins; validate network suite; done when T009 passes.
- [ ] T013 [IMPL] Implement readiness dependency registry and configuration-only checks in `apps/identity-bridge/src/health/readiness.service.ts`; deps: T010-T012; do not derive keys or generate JWKS; validate readiness suite; done when T010 passes.
- [ ] T014 [DOC/EVIDENCE] Record config-only checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T011-T013; rerun Phase 1/2 suites; done when `BRIDGE_LOCAL_CONFIGURATION_READY` is evidenced without signing/JWKS scope leak.

## Phase 3 — Customer-local IDX transport

- [ ] T015 [TEST] [US1] Create RED fixed endpoint/GET/one-bearer tests in `apps/identity-bridge/test/idx/transport-contract.spec.ts`; deps: T014; validate focused Jest; done when red.
- [ ] T016 [TEST] [US1] Create RED public-only/allowlisted CIDR tests in `apps/identity-bridge/test/idx/destination-policy.spec.ts`; deps: T014; include URI credential/fragment denial; validate focused Jest; done when red.
- [ ] T017 [TEST] [US1] Create RED resolution/rebinding tests in `apps/identity-bridge/test/idx/resolution-policy.spec.ts`; deps: T014; assert rejection before bearer forward; validate focused Jest; done when red.
- [ ] T018 [TEST] [US1] Create RED redirect/retry/JSON/size/timeout/error tests in `apps/identity-bridge/test/idx/transport.spec.ts`; deps: T014; validate focused Jest; done when red.
- [ ] T019 [IMPL] [US1] Implement endpoint/address/CIDR policy in `apps/identity-bridge/src/idx/transport/destination-policy.ts`; deps: T015-T017; no central transport import; validate policy suites; done when T015-T017 pass.
- [ ] T020 [IMPL] [US1] Implement resolver and connection-time validation in `apps/identity-bridge/src/idx/transport/address-validator.ts`; deps: T017,T019; resist rebinding; validate resolution suite; done when T017 passes.
- [ ] T021 [IMPL] [US1] Implement bounded one-shot GET client in `apps/identity-bridge/src/idx/transport/menu-detail.transport.ts`; deps: T018-T020; HTTPS/JSON/5s/256KiB/no redirect/no retry; validate transport suite; done when T015,T018 pass.
- [ ] T022 [SECURITY] [US1] Add native-token capture/redaction guard in `apps/identity-bridge/test/idx/transport-redaction.spec.ts`; deps: T021; inspect errors/log captures for no bearer leak; validate focused Jest; done when rejected requests expose none.
- [ ] T023 [DOC/EVIDENCE] Record transport checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T021,T022; run Phase 1-3 suites; done when `CUSTOMER_LOCAL_IDX_TRANSPORT_READY` is evidenced.

## Phase 4 — IDX semantic conformance

- [ ] T024 [TEST] [US2] Create accepted Feature 006 semantic vectors in `apps/identity-bridge/test/fixtures/idx-semantic.vectors.ts`; deps: T023; include valid/rejected MenuDetail and claims; validate fixture tests; done when vectors are immutable/local.
- [ ] T025 [TEST] [US2] Create RED strict MenuDetail/order tests in `apps/identity-bridge/test/idx/menu-detail.validator.spec.ts`; deps: T024; acceptance precedes parsing; validate focused Jest; done when red.
- [ ] T026 [TEST] [US2] Create RED claim/admission tests in `apps/identity-bridge/test/idx/identity-admission.spec.ts`; deps: T024; sub/User, Company ambiguity, Entry mismatch; validate focused Jest; done when red.
- [ ] T027 [TEST] [US2] Create RED permission/scope tests in `apps/identity-bridge/test/idx/permission-projection.spec.ts`; deps: T024; implicit read/actions/order/dedupe/non-authority; validate focused Jest; done when red.
- [ ] T028 [IMPL] [US2] Implement `apps/identity-bridge/src/idx/menu-detail.validator.ts`; deps: T025; strictly reduce accepted body only; validate validator suite; done when T025 passes.
- [ ] T029 [IMPL] [US2] Implement `native-claim-parser.ts` and `identity-admission.service.ts` in `apps/identity-bridge/src/idx`; deps: T026,T028; parse only post-acceptance and fail closed; validate admission suite; done when T026 passes.
- [ ] T030 [IMPL] [US2] Implement `permission-normalizer.ts` and `scope-projector.ts` in `apps/identity-bridge/src/idx`; deps: T027,T028; deterministic MenuDetail-only scopes; validate projection suite; done when T027 passes.
- [ ] T031 [SECURITY] [US3] Add malformed/decode-only/non-authority regression in `apps/identity-bridge/test/idx/semantic-security.spec.ts`; deps: T028-T030; no ES512/JWKS/roles/Customer authority; validate focused Jest; done when all issue no JWT.
- [ ] T032 [DOC/EVIDENCE] Record semantic parity checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T029-T031; run Phase 3-4 suites; done when `IDX_BRIDGE_VERIFICATION_READY` is evidenced with no Feature 006 extraction.

## Phase 5 — Canonical JWT issuance

- [ ] T033 [TEST] [US4] Create RED key-loader tests in `apps/identity-bridge/test/signing/signing-key-provider.spec.ts`; deps: T032; file PKCS#8, missing/malformed/public-only/non-RSA; validate focused Jest; done when red.
- [ ] T034 [TEST] [US4] Create RED active-key/public-derivation tests in `apps/identity-bridge/test/signing/active-key.spec.ts`; deps: T032; exact active and public consistency; validate focused Jest; done when red.
- [ ] T035 [TEST] [US4] Create RED canonical token contract tests in `apps/identity-bridge/test/signing/canonical-issuer.spec.ts`; deps: T032; header/claims/negative claims/TTL; validate focused Jest; done when red.
- [ ] T036 [IMPL] [US4] Implement file-backed provider in `apps/identity-bridge/src/signing/signing-key.provider.ts`; deps: T033; Customer-local reference only; validate loader suite; done when T033 passes.
- [ ] T037 [IMPL] [US4] Implement active resolver/public derivation in `apps/identity-bridge/src/signing/active-key.resolver.ts`; deps: T034,T036; one active derived-match key; validate active-key suite; done when T034 passes.
- [ ] T038 [IMPL] [US4] Implement issuer in `apps/identity-bridge/src/signing/canonical-token.issuer.ts`; deps: T035,T037; RS256/300s/configured authority only; validate issuer suite; done when T035 passes.
- [ ] T039 [SECURITY] [US4] Add key/token leak guards in `apps/identity-bridge/test/signing/signing-redaction.spec.ts`; deps: T036-T038; no private material/reference or forbidden claims; validate focused Jest; done when clean.
- [ ] T040 [DOC/EVIDENCE] Record signing checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T038,T039; run signing and prior suites; done when `BRIDGE_CANONICAL_JWT_READY` is evidenced.

## Phase 6 — JWKS publication and key lifecycle

- [ ] T041 [TEST] [US4] Create RED JWKS-public-shape tests in `apps/identity-bridge/test/jwks/jwks.service.spec.ts`; deps: T040; only public fields, sorted published/active/retiring; validate focused Jest; done when red.
- [ ] T042 [TEST] [US4] Create RED lifecycle/rotation tests in `apps/identity-bridge/test/jwks/key-lifecycle.spec.ts`; deps: T040; states, duplicate kid, publish-before-active, retiring; validate focused Jest; done when red.
- [ ] T043 [TEST] [US4] Create RED retirement-window tests in `apps/identity-bridge/test/jwks/retirement-policy.spec.ts`; deps: T040; 1499 deny/1500 eligible/recalculation; validate focused Jest; done when red.
- [ ] T044 [IMPL] [US4] Implement lifecycle resolver/validator in `apps/identity-bridge/src/jwks/key-lifecycle.service.ts`; deps: T042,T043; no central DB; validate lifecycle suites; done when T042-T043 pass.
- [ ] T045 [IMPL] [US4] Implement public JWKS service/controller in `apps/identity-bridge/src/jwks`; deps: T041,T044; expose only public JWKs; validate JWKS suite; done when T041 passes.
- [ ] T046 [SECURITY] [US4] Add JWKS/private-member and unknown/retired-key regression in `apps/identity-bridge/test/jwks/jwks-security.spec.ts`; deps: T045; fail closed; validate focused Jest; done when clean.
- [ ] T047 [DOC/EVIDENCE] Record JWKS checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T045,T046; run Phase 5-6 suites; done when `BRIDGE_JWKS_RUNTIME_READY` is evidenced.

## Phase 7 — Exchange, redaction, and local readiness

- [ ] T048 [TEST] [US1] Create RED exchange request/error tests in `apps/identity-bridge/test/exchange/exchange.controller.spec.ts`; deps: T047; bearer/body/400/401/403/503; validate focused Jest; done when red.
- [ ] T049 [TEST] [US1] Create RED exchange success-chain test in `apps/identity-bridge/test/exchange/exchange.service.spec.ts`; deps: T047; transport→semantics→issuer→exact response; validate focused Jest; done when red.
- [ ] T050 [TEST] [US3] Create credential-redaction tests in `apps/identity-bridge/test/exchange/redaction.spec.ts`; deps: T047; native/Refresh/claims/MenuDetail/key/canonical JWT absent except response; validate focused Jest; done when red.
- [ ] T051 [IMPL] [US1] Implement controller/error projector in `apps/identity-bridge/src/exchange/exchange.controller.ts`; deps: T048; generic correlated safe errors; validate controller suite; done when T048 passes.
- [ ] T052 [IMPL] [US1] Implement exchange composition in `apps/identity-bridge/src/exchange/exchange.service.ts`; deps: T049,T051; no browser authority; validate service suite; done when T049 passes.
- [ ] T053 [SECURITY] [US3] Implement redaction boundaries in `apps/identity-bridge/src/exchange/redaction.ts`; deps: T050,T052; no logs/audit/traces/errors/persistence/snapshots; validate redaction suite; done when T050 passes.
- [ ] T054 [IMPL] [US1] Wire all runtime dependencies into `apps/identity-bridge/src/health/readiness.service.ts`; deps: T052,T045; config/transport/semantics/key/JWKS/policy/runtime only; validate readiness suite; done when `GET /ready` is green.
- [ ] T055 [DOC/EVIDENCE] [US1] Record Phase 7 checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T053,T054; run Bridge regression/build; done when `IDENTITY_BRIDGE_RUNTIME_READY` and `BRIDGE_LOCAL_READY=YES` are evidenced.

## Phase 8 — Multi-deployment isolation

- [ ] T056 [TEST] [US6] Create deployment fixtures A/B in `apps/identity-bridge/test/fixtures/two-deployment.fixture.ts`; deps: T055; vary endpoint/Entry/integration/HostApp/issuer/audience/key; validate fixture tests; done when isolated.
- [ ] T057 [TEST] [US6] Create characterization cross-admission/signing tests in `apps/identity-bridge/test/integration/two-deployment.spec.ts`; deps: T056; deterministic A/B assertions may first-run PASS and require no production change to manufacture RED; validate focused Jest; done when isolation passes.
- [ ] T058 [SECURITY] [US6] Add static no-Customer-branch/no-shared-mutable-config guard in `apps/identity-bridge/test/security/isolation.spec.ts`; deps: T056; validate focused Jest; done when clean.
- [ ] T059 [DOC/EVIDENCE] Record isolation checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T057,T058; run full Bridge regression; done when `IDENTITY_BRIDGE_MULTI_DEPLOYMENT_ISOLATION_READY` is evidenced and `/ready` semantics unchanged.

## Phase 9 — Automated Feature 004 compatibility

- [ ] T060 [TEST] [US4] Create public-style JWKS fixture/injected resolver transport in `apps/gateway/test/identity-bridge/bridge-jwks.fixture.ts`; deps: T059; no Internet/private-address evidence; validate focused Jest; done when deterministic.
- [ ] T061 [TEST] [US4] Create deterministic Feature 004 compatibility test in `apps/gateway/test/identity-bridge/feature007-compatibility.spec.ts`; deps: T060; exercise existing policy/profile/verifier/binding/HostApp; first-run PASS is valid, while a failure records genuine incompatibility without Feature 004 production change; validate focused Jest; done when contract evidence is recorded.
- [ ] T062 [INTEGRATION] [US4] Compose only test fixture/harness boundaries in `apps/gateway/test/identity-bridge/feature007-compatibility.spec.ts`; deps: T061; Bridge JWT/JWKS→unchanged policy/TrustProfile/verifier→IntegrationBinding→Customer/HostApp must be green with no Internet or Feature 004 production change; validate direct Feature 004 regression; done when compatibility passes.
- [ ] T063 [SECURITY] [US4] Add no-real-Internet/no-policy-weakening regression in `apps/gateway/test/identity-bridge/feature007-compatibility.spec.ts`; deps: T062; validate focused Jest; done when Phase 9 cannot claim staging reachability.
- [ ] T064 [DOC/EVIDENCE] Record automated compatibility checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T062,T063; run Gateway Feature 004 suites; done when `BRIDGE_FEATURE004_COMPATIBILITY_READY` is evidenced only.

## Phase 10 — First-Customer staging provisioning

- [ ] T065 [OPS] [US5] Obtain HUMAN_REQUIRED staging values in `specs/007-customer-identity-bridge/tasks.md`; deps: T064; Customer/integration/HostApp/issuer/audience/RS256/JWKS URI/lifecycle; validate operator review; done when inputs are approved, not source-coded.
- [ ] T066 [OPS] [US5] Deploy Customer-local Bridge and public JWKS route per `specs/007-customer-identity-bridge/design.md`; deps: T065; validate Bridge `/ready`; done when deployment evidence exists.
- [ ] T067 [OPS] [US5] Provision existing binding with `apps/gateway/src/commands/provision-integration-binding.ts`; deps: T065,T066; enabled exact HostApp; validate command/audit outcome; done when binding active.
- [ ] T068 [OPS] [US5] Provision TrustProfile with `apps/gateway/src/commands/provision-trust-profile.ts`; deps: T067; exact issuer/audience/RS256/real public JWKS; validate activation outcome; done when active.
- [ ] T069 [INTEGRATION] [US5] Run central retrieval/readiness using existing Feature 004 runtime; deps: T068; validate TrustProfile runtime readiness; done when real JWKS fetch succeeds.
- [ ] T070 [INTEGRATION] [US5] Verify synthetic Bridge JWT through central staging Feature 004; deps: T069; validate verifier/binding/HostApp result; done when accepted.
- [ ] T071 [SECURITY] [US5] Record negative staging evidence in `specs/007-customer-identity-bridge/tasks.md`; deps: T068; test wrong URI/issuer/audience/algorithm, disabled binding/profile, and unreachable JWKS only with isolated/temporary records where possible or explicit reversible transitions; restore and revalidate the approved binding/profile before completion; validate operator results; done when failures are closed and accepted configuration is healthy.
- [ ] T072 [DOC/EVIDENCE] [US5] Record `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED=YES` in staging evidence; deps: T069-T071; require restored healthy approved configuration plus actual retrieval/verification proof; validate deployment evidence; done when accepted.
- [ ] T073 [DOC/EVIDENCE] [US5] Record combined staging gate in `specs/007-customer-identity-bridge/tasks.md`; deps: T055,T072; validate both gates; done when `STAGING_IDENTITY_READY` is evidenced.

## Phase 11 — External Customer SPA handoff

- [ ] T074 [DOC/EVIDENCE] [US5] [EXTERNAL_REPO] [CUSTOMER_REPO_REQUIRED] [HUMAN_REQUIRED] Inspect the actual Customer SPA repository; deps: T073; identify Frontend-Auth current-token accessor, Assistant session/chat boundary, and exact external paths without implementation; validate review record; done when targets are selected outside `internal-ai-assistant.com`.
- [ ] T075 [TEST] [US5] [EXTERNAL_REPO] [CUSTOMER_REPO_REQUIRED] Create RED SPA integration contract tests only at T074-selected external paths; deps: T074; cover current AccessToken, Bridge exchange, memory-only JWT/no storage, no RefreshToken, expiry re-exchange, safe errors, and sessionId non-auth; validate external suite; done when red.
- [ ] T076 [IMPL] [US5] [EXTERNAL_REPO] [CUSTOMER_REPO_REQUIRED] Implement only the narrow T075 flow at T074-selected paths; deps: T075; current token→same-origin Bridge→memory-only JWT→existing session bootstrap→sessionId/chat, with no Customer Backend change; validate external suite; done when T075 passes.
- [ ] T077 [SECURITY] [US5] [EXTERNAL_REPO] [CUSTOMER_REPO_REQUIRED] Remove decoded-token logging and inspect external console/telemetry/token paths selected by T074; deps: T076; validate source/runtime review; done when raw token is absent.
- [ ] T078 [DOC/EVIDENCE] [US5] [EXTERNAL_REPO] [CUSTOMER_REPO_REQUIRED] Record external handoff checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T075-T077; validate successful external evidence; done when `CUSTOMER_SPA_BRIDGE_HANDOFF_READY` is evidenced.

## Phase 12 — Session bootstrap integration

- [ ] T079 [INTEGRATION] [US5] [STAGING_INTEGRATION] Create/run staging trust-chain test in `apps/gateway/test/identity-bridge/feature007-session-bootstrap.spec.ts`; deps: T078; canonical JWT→Feature 004→binding→internal JWT→session; validate staging suite; done when real chain is represented.
- [ ] T080 [INTEGRATION] [US5] [STAGING_INTEGRATION] Execute real runtime session creation at existing `POST /api/v1/assistant/sessions`; deps: T079; no fixture internal JWT; validate returned `sessionId`; done when chain succeeds.
- [ ] T081 [SECURITY] [US5] [STAGING_INTEGRATION] Inspect central staging logs/audit/telemetry/persistence for forbidden raw material; deps: T080; native/Refresh/claims/MenuDetail/key/canonical JWT absent; validate evidence review; done when clean.
- [ ] T082 [DOC/EVIDENCE] [US5] [STAGING_INTEGRATION] Re-run Bridge redaction and Feature 004 regressions in `specs/007-customer-identity-bridge/tasks.md`; deps: T080,T081; classify skips; done when required suites pass.
- [ ] T083 [DOC/EVIDENCE] [US5] [STAGING_INTEGRATION] Record session checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T082; validate sessionId evidence; done when `CUSTOMER_SESSION_BOOTSTRAP_READY` is evidenced.

## Phase 13 — Real first-Customer staging UAT

- [ ] T084 [OPS] [US5] [HUMAN_REQUIRED] [STAGING_ONLY] [REAL_CUSTOMER_CREDENTIAL_REQUIRED] Mark pre-UAT evidence in `specs/007-customer-identity-bridge/tasks.md`; deps: T083; prove authoritative single UUID_Company, local/central/SPA readiness; validate approval; done when UAT authorized.
- [ ] T085 [INTEGRATION] [US5] [HUMAN_REQUIRED] [STAGING_ONLY] [REAL_CUSTOMER_CREDENTIAL_REQUIRED] Execute real IDX login through chat at Customer staging; deps: T084; validate token→local Bridge→real MenuDetail→sub/User/Company/Entry/scopes→Gateway→sessionId→chat; done when evidence captured.
- [ ] T086 [SECURITY] [US5] [HUMAN_REQUIRED] [STAGING_ONLY] [REAL_CUSTOMER_CREDENTIAL_REQUIRED] Inspect real UAT central evidence in `specs/007-customer-identity-bridge/tasks.md`; deps: T085; prove no native/Refresh/raw claims/MenuDetail/private key and redacted canonical JWT; validate accepted review; done when clean.
- [ ] T087 [DOC/EVIDENCE] [US5] [HUMAN_REQUIRED] [STAGING_ONLY] [REAL_CUSTOMER_CREDENTIAL_REQUIRED] Record final real-UAT evidence and guarded-test statuses in `specs/007-customer-identity-bridge/tasks.md`; deps: T085,T086; synthetic or mocked credentials prohibited; validate operator acceptance; done when accepted.
- [ ] T088 [DOC/EVIDENCE] [US5] [HUMAN_REQUIRED] [STAGING_ONLY] [REAL_CUSTOMER_CREDENTIAL_REQUIRED] Set final marker in `specs/007-customer-identity-bridge/tasks.md`; deps: T087; validate accepted real evidence only; done when `CUSTOMER_IDENTITY_SESSION_INTEGRATION_READY=YES`.

## Dependencies and Execution

`T001→T007→T014→T023→T032→T040→T047→T055→T059→T064→T073→T078→T083→T088` is the mandatory checkpoint path. Within a phase, `[P]` is omitted unless explicitly safe; implementation waits for its RED contract. Phase 9 is automated compatibility only; Phase 10 proves real reachability. Phase 11 is `EXTERNAL_REPO`; Phases 10 and 13 are `HUMAN_REQUIRED`.

Suggested MVP: complete through T055 for a safe local Bridge runtime; do not claim staging or Feature completion before T088.

```text
FEATURE007_TASKS_READY=YES
TOTAL_TASKS=88
TOTAL_PHASES=13
ALL_PHASES_HAVE_CHECKPOINT_TASK=YES
TEST_FIRST_TASK_ORDER_PRESERVED=YES
PHASE2_SIGNING_SCOPE_LEAK=NO
PHASE2_JWKS_SCOPE_LEAK=NO
BRIDGE_LOCAL_READY_PHASE7_ONLY=YES
PHASE8_RUNTIME_READY_COUPLING=NO
PHASE9_REAL_INTERNET_DEPENDENCY=NO
PHASE10_HUMAN_REQUIRED_VALUES_EXPLICIT=YES
PHASE11_EXTERNAL_REPO_EXPLICIT=YES
PHASE12_REAL_TRUST_CHAIN_REQUIRED=YES
PHASE13_REAL_CUSTOMER_UAT_REQUIRED=YES
SYNTHETIC_EVIDENCE_CAN_CLOSE_FEATURE=NO
CUSTOMER_AUTH_BACKEND_MODIFICATION_TASK_PRESENT=NO
CUSTOMER_BUSINESS_BACKEND_MODIFICATION_TASK_PRESENT=NO
FEATURE003_PRODUCTION_MODIFICATION_TASK_PRESENT=NO
FEATURE004_PRODUCTION_MODIFICATION_TASK_PRESENT=NO
FEATURE005_PRODUCTION_MODIFICATION_TASK_PRESENT=NO
FEATURE006_PRODUCTION_MODIFICATION_TASK_PRESENT=NO
```
