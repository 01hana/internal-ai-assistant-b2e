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

- [X] T008 [TEST] Create RED required/blank/config-shape tests in `apps/identity-bridge/test/config/configuration.spec.ts`; deps: T007; cover endpoint, nonempty unique allowed-entry set, integration, HostApp, issuer/audience, signing-key shape; validate focused Jest; done when red.
- [X] T009 [TEST] Create RED network/CORS/bounds tests in `apps/identity-bridge/test/config/network-policy.spec.ts`; deps: T007; cover HTTPS/public JWKS URI, modes/CIDRs, timeout 1..5000, size 1..262144, exact origins/no wildcard; validate focused Jest; done when red.
- [X] T010 [TEST] Create RED deferred-dependency readiness tests in `apps/identity-bridge/test/health/readiness.spec.ts`; deps: T007; prove later signing/JWKS capabilities keep ready false; validate focused Jest; done when red.
- [X] T011 [IMPL] Implement typed parser/validator in `apps/identity-bridge/src/config/bridge-config.service.ts`; deps: T008,T009; validate shape only, no private-key load/JWT/JWKS; validate config suites; done when T008-T009 pass.
- [X] T012 [IMPL] Implement destination/network config model in `apps/identity-bridge/src/config/destination-policy.config.ts`; deps: T009,T011; enforce modes, CIDRs, bounds, origins; validate network suite; done when T009 passes.
- [X] T013 [IMPL] Implement readiness dependency registry and configuration-only checks in `apps/identity-bridge/src/health/readiness.service.ts`; deps: T010-T012; do not derive keys or generate JWKS; validate readiness suite; done when T010 passes.
- [X] T014 [DOC/EVIDENCE] Record config-only checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T011-T013; rerun Phase 1/2 suites; done when `BRIDGE_LOCAL_CONFIGURATION_READY` is evidenced without signing/JWKS scope leak.

**Phase 2 evidence**: T008–T010 RED contracts failed only because the Phase 2 configuration/readiness modules were absent. T011–T013 then passed the full Bridge suite, independent build, and `git diff --check`. The Phase 2 correction added internal registry progression coverage (23 tests total): valid configuration remains not ready until all five declared runtime dependencies are registered; production registers none and public `/ready` stays safe and not ready. JWKS URI validation normalizes trailing dots and IPv6 brackets without DNS or HTTP activity, and V1 key references accept only `file:` URI syntax without opening files. Configuration validity remains distinct from `BRIDGE_LOCAL_READY`; no later runtime dependency is implemented or marked ready.

## Phase 3 — Customer-local IDX transport

- [X] T015 [TEST] [US1] Create RED fixed endpoint/GET/one-bearer tests in `apps/identity-bridge/test/idx/transport-contract.spec.ts`; deps: T014; validate focused Jest; done when red.
- [X] T016 [TEST] [US1] Create RED public-only/allowlisted CIDR tests in `apps/identity-bridge/test/idx/destination-policy.spec.ts`; deps: T014; include URI credential/fragment denial; validate focused Jest; done when red.
- [X] T017 [TEST] [US1] Create RED resolution/rebinding tests in `apps/identity-bridge/test/idx/resolution-policy.spec.ts`; deps: T014; assert rejection before bearer forward; validate focused Jest; done when red.
- [X] T018 [TEST] [US1] Create RED redirect/retry/JSON/size/timeout/error tests in `apps/identity-bridge/test/idx/transport.spec.ts`; deps: T014; validate focused Jest; done when red.
- [X] T019 [IMPL] [US1] Implement endpoint/address/CIDR policy in `apps/identity-bridge/src/idx/transport/destination-policy.ts`; deps: T015-T017; no central transport import; validate policy suites; done when T015-T017 pass.
- [X] T020 [IMPL] [US1] Implement resolver and connection-time validation in `apps/identity-bridge/src/idx/transport/address-validator.ts`; deps: T017,T019; resist rebinding; validate resolution suite; done when T017 passes.
- [X] T021 [IMPL] [US1] Implement bounded one-shot GET client in `apps/identity-bridge/src/idx/transport/menu-detail.transport.ts`; deps: T018-T020; HTTPS/JSON/5s/256KiB/no redirect/no retry; validate transport suite; done when T015,T018 pass.
- [X] T022 [SECURITY] [US1] Add native-token capture/redaction guard in `apps/identity-bridge/test/idx/transport-redaction.spec.ts`; deps: T021; inspect errors/log captures for no bearer leak; validate focused Jest; done when rejected requests expose none.
- [X] T023 [DOC/EVIDENCE] Record transport checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T021,T022; run Phase 1-3 suites; done when `CUSTOMER_LOCAL_IDX_TRANSPORT_READY` is evidenced.

**Phase 3 evidence**: T015–T018 RED contracts failed only because the Phase 3 transport modules were absent. T019–T022 then passed the full Bridge suite, independent build, and `git diff --check`. The Phase 3 correction adds deterministic production pinned-lookup coverage (46 tests total): Node `all=true`, single-result, and IPv4/IPv6 family-selection callback forms return only connection-time validated addresses and make no DNS call. The Bridge-local transport uses only its configured IDX endpoint; validates all initial and connection-time resolved addresses against public-only or explicit Customer-private CIDR policy; sends one HTTPS GET with the exact native bearer; bounds the complete operation and JSON body; neither retries nor follows redirects; and returns opaque parsed JSON only. Public, loopback, and special addresses remain denied in `allowlisted_networks` even when a CIDR is misconfigured to include them. Native-token and raw-response sentinels are absent from safe transport failures. Phase 7 entry later exposed that the original safe transport projection did not retain the semantic distinction required by the exchange API; the internal contract now distinguishes HTTP 401 credential rejection, HTTP 403 identity denial, and all other transport failures as provider unavailable without changing transport security, authority, or network behavior. `CUSTOMER_LOCAL_IDX_TRANSPORT_READY=YES`; `BRIDGE_LOCAL_READY=NO`.

## Phase 4 — IDX semantic conformance

- [X] T024 [TEST] [US2] Create accepted Feature 006 semantic vectors in `apps/identity-bridge/test/fixtures/idx-semantic.vectors.ts`; deps: T023; include valid/rejected MenuDetail and claims; validate fixture tests; done when vectors are immutable/local.
- [X] T025 [TEST] [US2] Create RED strict MenuDetail/order tests in `apps/identity-bridge/test/idx/menu-detail.validator.spec.ts`; deps: T024; acceptance precedes parsing; validate focused Jest; done when red.
- [X] T026 [TEST] [US2] Create RED claim/admission tests in `apps/identity-bridge/test/idx/identity-admission.spec.ts`; deps: T024; sub/User, Company ambiguity, exact allowed-entry membership; validate focused Jest; done when red.
- [X] T027 [TEST] [US2] Create RED permission/scope tests in `apps/identity-bridge/test/idx/permission-projection.spec.ts`; deps: T024; implicit read/actions/order/dedupe/non-authority; validate focused Jest; done when red.
- [X] T028 [IMPL] [US2] Implement `apps/identity-bridge/src/idx/menu-detail.validator.ts`; deps: T025; strictly reduce accepted body only; validate validator suite; done when T025 passes.
- [X] T029 [IMPL] [US2] Implement `native-claim-parser.ts` and `identity-admission.service.ts` in `apps/identity-bridge/src/idx`; deps: T026,T028; parse only post-acceptance and fail closed; validate admission suite; done when T026 passes.
- [X] T030 [IMPL] [US2] Implement `permission-normalizer.ts` and `scope-projector.ts` in `apps/identity-bridge/src/idx`; deps: T027,T028; deterministic MenuDetail-only scopes; validate projection suite; done when T027 passes.
- [X] T031 [SECURITY] [US3] Add malformed/decode-only/non-authority regression in `apps/identity-bridge/test/idx/semantic-security.spec.ts`; deps: T028-T030; no ES512/JWKS/roles/Customer authority; validate focused Jest; done when all issue no JWT.
- [X] T032 [DOC/EVIDENCE] Record semantic parity checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T029-T031; run Phase 3-4 suites; done when `IDX_BRIDGE_VERIFICATION_READY` is evidenced with no Feature 006 extraction.

**Phase 4 evidence**: T024–T027 RED contracts failed only because Bridge-local semantic modules were absent. T028–T031 passed the full Bridge suite, independent build, and `git diff --check`. The Phase 4 test-evidence correction adds behavioral parity coverage for the final Feature 006 nested MenuDetail shape (including Language, ProgramCode, StartMethod, Memo, and MenuPermission), all eight exact Y/N operation contracts, complete required-claim negative matrices, exact sub/User and allowed-entry membership, one-element UUID_Company-array denial, and unaccepted-MenuDetail identity denial. The final behavioral correction exercises hostile native privilege claims through actual admission and proves post-accepted-MenuDetail `alg`/`kid` header variants add no local authority or verification behavior (95 tests total). The current Feature 006 production MenuDetail shape is validated and immediately reduced to immutable menu/action records; native claims are structurally parsed only after that accepted semantic value, require exact sub/User and case-sensitive allowlist admission, and reject UUID_Company arrays. MenuDetail is the sole scope authority; scopes are deterministic, deduplicated, and have no native admin/permission authority. `IDX_BRIDGE_VERIFICATION_READY=YES`; `BRIDGE_LOCAL_READY=NO`.

## Phase 5 — Canonical JWT issuance

- [X] T033 [TEST] [US4] Create RED key-loader tests in `apps/identity-bridge/test/signing/signing-key-provider.spec.ts`; deps: T032; file PKCS#8, missing/malformed/public-only/non-RSA; validate focused Jest; done when red.
- [X] T034 [TEST] [US4] Create RED active-key/public-derivation tests in `apps/identity-bridge/test/signing/active-key.spec.ts`; deps: T032; exact active and public consistency; validate focused Jest; done when red.
- [X] T035 [TEST] [US4] Create RED canonical token contract tests in `apps/identity-bridge/test/signing/canonical-issuer.spec.ts`; deps: T032; header/claims/negative claims/TTL; validate focused Jest; done when red.
- [X] T036 [IMPL] [US4] Implement file-backed provider in `apps/identity-bridge/src/signing/signing-key.provider.ts`; deps: T033; Customer-local reference only; validate loader suite; done when T033 passes.
- [X] T037 [IMPL] [US4] Implement active resolver/public derivation in `apps/identity-bridge/src/signing/active-key.resolver.ts`; deps: T034,T036; one active derived-match key; validate active-key suite; done when T034 passes.
- [X] T038 [IMPL] [US4] Implement issuer in `apps/identity-bridge/src/signing/canonical-token.issuer.ts`; deps: T035,T037; RS256/300s/configured authority only; validate issuer suite; done when T035 passes.
- [X] T039 [SECURITY] [US4] Add key/token leak guards in `apps/identity-bridge/test/signing/signing-redaction.spec.ts`; deps: T036-T038; no private material/reference or forbidden claims; validate focused Jest; done when clean.
- [X] T040 [DOC/EVIDENCE] Record signing checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T038,T039; run signing and prior suites; done when `BRIDGE_CANONICAL_JWT_READY` is evidenced.

**Phase 5 evidence**: T033–T035 RED contracts initially failed because the Bridge-local signing modules were absent. The first behavioral evidence correction then discovered permissive RSA PKCS#1 container acceptance; exact unencrypted PKCS#8 PEM-envelope validation corrected it. The next regression discovered that `importPKCS8(..., "RS256")` accepted EC PKCS#8 material; an authoritative parsed-key check now requires an actual RSA private key before import. After both corrections, all 20 Bridge suites and 147 tests, the independent build, and `git diff --check` pass. T036–T039 prove local file-only RSA PKCS#8 loading, generic failure redaction, exactly one active key, exact derived/configured public-JWK consistency including mismatch denial, public-key verification of the exact 300-second RS256 canonical contract, unique valid UUID JTIs, integer time, deployment-owned authority, empty roles, forbidden-claim absence, and no central signing/JWKS/exchange responsibility. `BRIDGE_CANONICAL_JWT_READY=YES`; `BRIDGE_LOCAL_READY=NO`.

## Phase 6 — JWKS publication and key lifecycle

- [X] T041 [TEST] [US4] Create RED JWKS-public-shape tests in `apps/identity-bridge/test/jwks/jwks.service.spec.ts`; deps: T040; only public fields, sorted published/active/retiring; validate focused Jest; done when red.
- [X] T042 [TEST] [US4] Create RED lifecycle/rotation tests in `apps/identity-bridge/test/jwks/key-lifecycle.spec.ts`; deps: T040; states, duplicate kid, publish-before-active, retiring; validate focused Jest; done when red.
- [X] T043 [TEST] [US4] Create RED retirement-window tests in `apps/identity-bridge/test/jwks/retirement-policy.spec.ts`; deps: T040; 1499 deny/1500 eligible/recalculation; validate focused Jest; done when red.
- [X] T044 [IMPL] [US4] Implement lifecycle resolver/validator in `apps/identity-bridge/src/jwks/key-lifecycle.service.ts`; deps: T042,T043; no central DB; validate lifecycle suites; done when T042-T043 pass.
- [X] T045 [IMPL] [US4] Implement public JWKS service/controller in `apps/identity-bridge/src/jwks`; deps: T041,T044; expose only public JWKs; validate JWKS suite; done when T041 passes.
- [X] T046 [SECURITY] [US4] Add JWKS/private-member and unknown/retired-key regression in `apps/identity-bridge/test/jwks/jwks-security.spec.ts`; deps: T045; fail closed; validate focused Jest; done when clean.
- [X] T047 [DOC/EVIDENCE] Record JWKS checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T045,T046; run Phase 5-6 suites; done when `BRIDGE_JWKS_RUNTIME_READY` is evidenced.

**Phase 6 evidence**: T041–T043 RED suites failed only because the Bridge-local lifecycle and JWKS surfaces were absent. T044–T046 now validate exact immutable public RSA/RS256 JWK projection for published, active, and retiring keys; ordinal `kid` sorting; one active key; publish-before-active with the former active key retiring; active private/public consistency through the existing Phase 5 resolver; unknown/removed-key absence; generic failure redaction; and GET-only public routing. The pure retirement policy calculates `max(1500, token lifetime + clock tolerance + JWKS cache age + unknown-kid cooldown + propagation margin)`, denies 1499 seconds, permits 1500 seconds, and recalculates increased bounds. All 25 Bridge suites and 180 tests, the independent build, and `git diff --check` pass. No lifecycle database, automatic rotation, key-admin API, central retrieval, Feature 004 change, or exchange endpoint is introduced. `BRIDGE_JWKS_RUNTIME_READY=YES`; `BRIDGE_LOCAL_READY=NO`.

## Phase 7 — Exchange, redaction, and local readiness

- [X] T048 [TEST] [US1] Create RED exchange request/error tests in `apps/identity-bridge/test/exchange/exchange.controller.spec.ts`; deps: T047; bearer/body/400/401/403/503; validate focused Jest; done when red.
- [X] T049 [TEST] [US1] Create RED exchange success-chain test in `apps/identity-bridge/test/exchange/exchange.service.spec.ts`; deps: T047; transport→semantics→issuer→exact response; validate focused Jest; done when red.
- [X] T050 [TEST] [US3] Create credential-redaction tests in `apps/identity-bridge/test/exchange/redaction.spec.ts`; deps: T047; native/Refresh/claims/MenuDetail/key/canonical JWT absent except response; validate focused Jest; done when red.
- [X] T051 [IMPL] [US1] Implement controller/error projector in `apps/identity-bridge/src/exchange/exchange.controller.ts`; deps: T048; generic correlated safe errors; validate controller suite; done when T048 passes.
- [X] T052 [IMPL] [US1] Implement exchange composition in `apps/identity-bridge/src/exchange/exchange.service.ts`; deps: T049,T051; no browser authority; validate service suite; done when T049 passes.
- [X] T053 [SECURITY] [US3] Implement redaction boundaries in `apps/identity-bridge/src/exchange/redaction.ts`; deps: T050,T052; no logs/audit/traces/errors/persistence/snapshots; validate redaction suite; done when T050 passes.
- [X] T054 [IMPL] [US1] Wire all runtime dependencies into `apps/identity-bridge/src/health/readiness.service.ts`; deps: T052,T045; config/transport/semantics/key/JWKS/policy/runtime only; validate readiness suite; done when `GET /ready` is green.
- [X] T055 [DOC/EVIDENCE] [US1] Record Phase 7 checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T053,T054; run Bridge regression/build; done when `IDENTITY_BRIDGE_RUNTIME_READY` and `BRIDGE_LOCAL_READY=YES` are evidenced.

**Phase 7 evidence**: T048–T050 and the Phase 7 readiness extension first failed only because the Exchange controller, service, error/redaction boundary, module, and readiness composition were absent. T051–T054 now prove native-bearer-only `POST /identity/exchange`, no/empty-body enforcement, browser-authority rejection, typed 400/401/403/503 projection with UUID-only request correlation, and the exact three-field canonical response. The real success chain uses the accepted MenuDetail validator, post-acceptance admission, MenuDetail-only deterministic scopes, the real Phase 5 RSA issuer, empty roles, and no exposed `jti` or `kid`; earlier failures issue no JWT. Redaction sentinels are absent from errors and all nonexistent logging/persistence surfaces, while the canonical JWT appears only in successful `accessToken`. Local readiness constructs the transport policy without an IDX call, wires the real semantic services, resolves the real active PKCS#8 key, generates the real Phase 6 JWKS, and marks exchange ready only after those checks. All 28 Bridge suites and 235 tests, the independent build, and `git diff --check` pass. `IDENTITY_BRIDGE_RUNTIME_READY=YES`; `BRIDGE_LOCAL_READY=YES`; no staging or Phase 8 gate is claimed.

## Phase 8 — Multi-deployment isolation

- [X] T056 [TEST] [US6] Create deployment fixtures A/B in `apps/identity-bridge/test/fixtures/two-deployment.fixture.ts`; deps: T055; vary endpoint/two-entry allowlist/integration/HostApp/issuer/audience/key; validate fixture tests; done when isolated.
- [X] T057 [TEST] [US6] Create characterization cross-admission/signing tests in `apps/identity-bridge/test/integration/two-deployment.spec.ts`; deps: T056; deterministic A/B assertions may first-run PASS and require no production change to manufacture RED; validate focused Jest; done when isolation passes.
- [X] T058 [SECURITY] [US6] Add static no-Customer-branch/no-shared-mutable-config guard in `apps/identity-bridge/test/security/isolation.spec.ts`; deps: T056; validate focused Jest; done when clean.
- [X] T059 [DOC/EVIDENCE] Record isolation checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T057,T058; run full Bridge regression; done when `IDENTITY_BRIDGE_MULTI_DEPLOYMENT_ISOLATION_READY` is evidenced and `/ready` semantics unchanged.

**Phase 8 evidence**: T056 supplies fresh, deeply frozen synthetic Deployment A/B fixtures with distinct IDX endpoints, two-entry allowlists, integration IDs, HostApps, issuers, audiences, RSA keys, kids, public JWKs, native identities, and MenuDetail permissions. T057 characterization passes through two simultaneous real `ExchangeModule` contexts using only the existing deterministic transport seams: each context reaches only its configured endpoint, accepts both of its own exact Entries, rejects both Entries from the other deployment after MenuDetail acceptance and before issuance, emits only its own identity/configuration/scopes, verifies only with its own RSA public key, and publishes only its own JWKS. External environment replacement cannot change either immutable runtime configuration or allowed-entry array, and changing A readiness does not mutate B. T058 finds no Customer-specific branch, shared authority registry, central identity responsibility, persistence dependency, runtime selector, or Phase 8 readiness dependency; completed Phase 9 compatibility remains test-only. `IDENTITY_BRIDGE_MULTI_DEPLOYMENT_ISOLATION_READY=YES`; `BRIDGE_LOCAL_READY=YES`; `PRODUCTION_CODE_CHANGED_IN_PHASE8=NO`; no staging gate is claimed.

## Phase 9 — Automated Feature 004 compatibility

- [X] T060 [TEST] [US4] Create public-style JWKS fixture/injected resolver transport in `apps/gateway/test/identity-bridge/bridge-jwks.fixture.ts`; deps: T059; no Internet/private-address evidence; validate focused Jest; done when deterministic.
- [X] T061 [TEST] [US4] Create deterministic Feature 004 compatibility test in `apps/gateway/test/identity-bridge/feature007-compatibility.spec.ts`; deps: T060; exercise existing policy/profile/verifier/binding/HostApp; first-run PASS is valid, while a failure records genuine incompatibility without Feature 004 production change; validate focused Jest; done when contract evidence is recorded.
- [X] T062 [INTEGRATION] [US4] Compose only test fixture/harness boundaries in `apps/gateway/test/identity-bridge/feature007-compatibility.spec.ts`; deps: T061; Bridge JWT/JWKS→unchanged policy/TrustProfile/verifier→IntegrationBinding→Customer/HostApp must be green with no Internet or Feature 004 production change; validate direct Feature 004 regression; done when compatibility passes.
- [X] T063 [SECURITY] [US4] Add no-real-Internet/no-policy-weakening regression in `apps/gateway/test/identity-bridge/feature007-compatibility.spec.ts`; deps: T062; validate focused Jest; done when Phase 9 cannot claim staging reachability.
- [X] T064 [DOC/EVIDENCE] Record automated compatibility checkpoint in `specs/007-customer-identity-bridge/tasks.md`; deps: T062,T063; run Gateway Feature 004 suites; done when `BRIDGE_FEATURE004_COMPATIBILITY_READY` is evidenced only.

**Phase 9 evidence**: T060 uses the real Bridge `BridgeConfigService`, `ActiveKeyResolver`, `CanonicalTokenIssuer`, `KeyLifecycleService`, and `JwksService` to issue a five-minute RS256 canonical JWT and its exact public JWKS at a syntactically public HTTPS URI. T061–T063 exercise the unchanged Feature 004 registration policy, provisioning commands, activation validator, runtime readiness, Prisma repositories, profile cache/resolver, routing parser, profile-scoped verifier, multi-profile verifier, and IntegrationBinding-only Customer/HostApp resolution. The injected production `HardenedJwksTransport` performs deterministic initial and connection-time DNS validation against `93.184.216.34` and returns the real Bridge JWKS without a socket, listener, `fetch`, or Internet access. The positive path produces exactly one verified profile; negative coverage denies disabled and ambiguous profiles, disabled binding, wrong issuer/audience/HostApp, unknown `kid`, and unsupported `alg`, while policy regressions continue rejecting localhost, private, mixed, documentation, and literal-IP destinations. The focused Phase 9 suite passes 1 suite/10 tests; the unchanged relevant Gateway/Feature 004 regression set passes 12 suites/127 tests with zero relevant skips; the Bridge signing/JWKS regression set passes 9 suites/85 tests; both independent builds and `git diff --check` pass. The pre/post production-source inventories remain identical, with no diff under `apps/gateway/src/**` or `apps/identity-bridge/src/**`. `BRIDGE_FEATURE004_COMPATIBILITY_READY=YES`; `FEATURE004_PRODUCTION_CODE_CHANGED=NO`; `BRIDGE_PRODUCTION_CODE_CHANGED=NO`; `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED=NO`; `STAGING_IDENTITY_READY=NO`; highest completed task is T064, and T065+ remain unchecked.

**Pre-Phase 10 multi-entry admission correction evidence (2026-08-31)**: Before any real deployment, the singleton `BRIDGE_IDX_ALLOWED_ENTRY` authority was removed and replaced by immutable JSON `BRIDGE_IDX_ALLOWED_ENTRIES`. Configuration rejects legacy, empty, malformed, non-string, whitespace-normalized, control-character, and exact-duplicate values; admission accepts exact case-sensitive membership only after MenuDetail acceptance. Customer Auth retains authentication and Entry discovery/selection/state, the browser cannot submit Entry authority, and no Authentication/discovery call exists in Bridge production. Phase 8 now proves Deployment A Entries A1/A2 and Deployment B Entries B1/B2 are locally accepted and cross-denied before issuance with no shared mutable admission state. The focused correction matrix passes 9 suites/109 tests; the full Bridge regression passes 30 suites/261 tests; the DB-backed Phase 9 compatibility regression passes 1 suite/10 tests with no required skip; Bridge and Gateway builds pass. No Feature 003–006 or Customer production source changed, no Entry appears in canonical JWTs, and no staging operation was performed. `T065_STATUS=HUMAN_REQUIRED`; highest completed task remains T064; T065–T073 remain unchecked.

**PRE_PHASE10_LOCAL_DOCKER_REHEARSAL evidence (2026-08-31)**: A production-portable, non-root Identity Bridge image and isolated local Compose stack run only `identity-bridge` plus an unprivileged HTTPS IDX proxy on deterministic private addresses. Idempotent bootstrap generated and persisted a local-only RSA-2048 PKCS#8 key, derived the public-only RS256 JWK with `kid=shinmone-scm-local-2026-01`, and created a local CA plus SAN-valid `idx-proxy.local` certificate outside image layers and tracked files. The key and CA are mounted read-only; `NODE_EXTRA_CA_CERTS` preserves TLS verification; the existing HTTPS-only transport and `allowlisted_networks` checks successfully reached only the proxy's local no-upstream TLS probe. `/health`, `/ready`, and the public-only JWKS passed; an Identity Bridge restart preserved the exact JWKS; image filesystem, metadata, and history checks found no private signing material. The bootstrap suite passes 1 suite/2 tests, Phase 8 passes 2 suites/8 tests, the full Bridge regression passes 31 suites/263 tests, and DB-backed Phase 9 compatibility passes 1 suite/10 tests; Bridge and Gateway builds, Compose rendering, image build, local startup, and `git diff --check` pass. At this historical checkpoint the Entry marker was still non-Customer evidence and no real credential was used; that interim state is superseded by the final authorized human runtime evidence below. `PRE_PHASE10_LOCAL_DOCKER_REHEARSAL_COMPLETE=YES`; `T065_STATUS=HUMAN_REQUIRED`; `T066_STARTED=NO`; highest completed task remains T064; `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED=NO`; `STAGING_IDENTITY_READY=NO`.

**PRE_PHASE10_REAL_IDX_LOCAL_EVIDENCE preparation (2026-08-31)**: The actual first-Customer selected Entry UUID is available and is loaded only through ignored `apps/identity-bridge/env/local.env`, which overrides the tracked replacement marker before generated public signing metadata. The recreated local Bridge reports healthy/ready with that exact one-entry configuration. The `local:verify:idx` command accepts no arguments or token environment/config/file/browser source, requires a TTY, disables terminal echo, sends an empty-body bearer exchange, validates the canonical response in memory, scans Compose logs for both credentials, and emits normalized markers only. Its focused tooling suite passes 1 suite/10 tests; the full Bridge regression passes 32 suites/273 tests; Phase 8 passes 2 suites/8 tests; DB-backed Phase 9 passes 1 suite/10 tests; Bridge/Gateway builds, Compose rendering, and `git diff --check` pass. This preparation checkpoint ended at the human input boundary and is superseded by the final authorized human runtime evidence below. No production identity source changed. `ENTRY_ADMISSION_MODEL=INSUFFICIENT_EVIDENCE`; `MENUDETAIL_ACCEPTANCE_ALONE_PROVEN_SUFFICIENT=NO`; `T065_STATUS=HUMAN_REQUIRED`; `T066_STARTED=NO`; highest completed task remains T064; `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED=NO`; `STAGING_IDENTITY_READY=NO`.

**PRE_PHASE10_REAL_IDX_LOCAL_TTY_CORRECTION evidence (2026-08-31)**: The local verifier's macOS-prone external `stty`/`readline` path was replaced with injected Node TTY raw-mode collection. It consumes pasted synthetic credentials directly, supports CR, LF, and split terminators, rejects empty/whitespace/multiple-line input, handles Ctrl+C and terminal errors, restores the prior raw-mode state, pauses stdin, and prints only a newline plus safe progress markers. Its local request now has a 12-second abort timeout that maps only to `IDX_TRANSPORT`. The focused verifier suite passes 1 suite/20 tests; the full Bridge suite passes 32 suites/283 tests; Bridge build, Compose rendering, and `git diff --check` pass. This tooling-only checkpoint preceded the authorized human run and is superseded by the final runtime evidence below; no production identity source or Phase 10 task state changed. `T065_STATUS=HUMAN_REQUIRED`; `T066_STARTED=NO`; highest completed task remains T064.

**PRE_PHASE10_SAME_TOKEN_MENUDETAIL_DIAGNOSTIC evidence (2026-08-31)**: The same interactive, memory-only native token is now passed exactly once to a tooling-only direct legacy MenuDetail GET and once to the local Bridge exchange; neither path prints or persists it. The direct diagnostic is bounded to 12 seconds, emits only HTTP status and a `Code === 200` boolean, and remains outside `apps/identity-bridge/src/**`, preserving the Bridge's HTTPS-only production transport. Safe comparison coverage proves direct/Bridge accept and reject combinations plus timeout or malformed direct-response `INCONCLUSIVE` classification, with no token or raw MenuDetail disclosure. The focused verifier suite passes 1 suite/26 tests; the full Bridge suite passes 32 suites/289 tests; Bridge build and Compose rendering pass. This tooling checkpoint preceded the authorized human run and is superseded by the final runtime evidence below. `ENTRY_ADMISSION_MODEL=INSUFFICIENT_EVIDENCE`; `T065_STATUS=HUMAN_REQUIRED`; `T066_STARTED=NO`; highest completed task remains T064.

**PRE_PHASE10_REAL_IDX_LOCAL_EVIDENCE final (2026-09-01)**: An authorized human operator supplied the current native AccessToken once through the hidden raw-TTY prompt. The same exact in-memory token received direct legacy MenuDetail HTTP 200 with application `Code === 200` and local Bridge exchange HTTP 200. The Bridge accepted MenuDetail, admitted the configured selected Entry, and returned a five-minute RS256 canonical JWT with a nonblank signing key identifier, empty roles, configured authority, no Entry claim, and no Customer authority. The native credential and canonical JWT were neither persisted nor logged; no raw token, claims, MenuDetail response, canonical JWT, Authorization header, or private-key material is recorded here. The earlier Bridge HTTP 401 was not reproduced by the final same-token comparison, so its cause remains unconfirmed and neither the proxy nor Bridge transport is classified as defective. Only the selected SCM Entry positive path has real evidence; no alternate-Entry/application token has been tested, so the allowlist remains and broader Entry authority remains unresolved.

```text
PRE_PHASE10_REAL_IDX_LOCAL_EVIDENCE_COMPLETE=YES
REAL_IDX_LOCAL_EXCHANGE=PASS
SAME_TOKEN_DIAGNOSIS=DIRECT_AND_BRIDGE_ACCEPT

REAL_IDX_MENUDETAIL_REQUEST_REACHED=YES
REAL_IDX_MENUDETAIL_ACCEPTED=YES
REAL_IDX_ENTRY_ADMISSION=PASS

CANONICAL_JWT_RECEIVED=YES
CANONICAL_JWT_RS256=YES
CANONICAL_JWT_TTL_VALID=YES
CANONICAL_JWT_ENTRY_ABSENT=YES
CANONICAL_JWT_CUSTOMER_AUTHORITY_ABSENT=YES

NATIVE_TOKEN_PERSISTED=NO
NATIVE_TOKEN_LOGGED=NO
CANONICAL_JWT_LOGGED=NO

PREVIOUS_401_REPRODUCED=NO
PREVIOUS_401_ROOT_CAUSE=UNCONFIRMED
PROXY_DEFECT_CONFIRMED=NO
BRIDGE_TRANSPORT_DEFECT_CONFIRMED=NO

ENTRY_ADMISSION_MODEL=INSUFFICIENT_EVIDENCE
MENUDETAIL_ACCEPTANCE_ALONE_PROVEN_SUFFICIENT=NO
```

## Pre-T065 local full E2E development track

This local-development track is deliberately separate from the numbered staging tasks. It may establish only `LOCAL_CUSTOMER_IDENTITY_E2E_READY`; it cannot complete, unblock, or alter T065–T073, `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED`, `STAGING_IDENTITY_READY`, or the final Feature 007 gate.

- [X] L001 [DOC/EVIDENCE] Correct Entry-admission evidence and the T065 worksheet; deps: T064; retain the observed Entry only in ignored local configuration as a selected positive path, prohibit wildcard/browser/Bridge Authentication authority, and preserve exact Bridge membership checks; validate documentation review; done when the provisional state is explicit.
- [X] L002 [OPS] Prepare the local substrate; deps: L001; prove local PostgreSQL healthy, Prisma clients generated, migrations applied, deterministic seed complete, Backend runtime/build identified, Gateway build identified, and the existing Identity Bridge local runtime available; validate local evidence; done without requiring profile-gated Gateway startup.
- [X] L003 [INTEGRATION] Complete local trust bootstrap; deps: L002; expose only Bridge JWKS through the loopback proxy and operator-owned public HTTPS tunnel, provision/replay the dedicated local Customer/binding/active RS256 TrustProfile through existing commands, start real Gateway, run its existing local signing bootstrap, prove Gateway health/JWKS, and retrieve Bridge JWKS through unchanged `HardenedJwksTransport`; done only after runtime tunnel evidence.
- [ ] L004 [INTEGRATION] Run the real local session bootstrap; deps: L003; operator-entered native bearer reaches only local Bridge, returned canonical JWT remains in memory, and local Gateway creates a Backend session through Feature 004, IntegrationBinding, and its internal JWT; done when `201` and a real `sessionId` are evidenced with no fixture internal JWT.
- [ ] L005 [EXTERNAL_REPO] Integrate the actual Customer SPA locally only after L004; deps: L004; existing Frontend-Auth supplies the current AccessToken, the SPA uses same-origin Bridge exchange and an in-memory canonical JWT, and RefreshToken ownership remains unchanged; done when external tests/evidence pass.
- [ ] L006 [INTEGRATION] Prove local chat E2E; deps: L005; existing chat UI opens from the real session and displays an SSE response through Gateway and Backend; done when safe evidence establishes `LOCAL_CUSTOMER_IDENTITY_E2E_READY=YES` without a staging claim.

```text
AUTHENTICATION_ENTRIES_USER_SPECIFIC=YES
LOCAL_ENTRY_ADMISSION_POSITIVE_PATH_ONLY=YES
STATIC_DEPLOYMENT_ALLOWLIST_COMPLETE=UNKNOWN

LOCAL_FULL_E2E_TRACK_ADDED=YES
LOCAL_BRIDGE_PUBLIC_JWKS_URI=AVAILABLE_FOR_OPERATOR_VERIFY_ONLY
PRODUCTION_JWKS_POLICY_CHANGED=NO

L001_STATUS=PASS
L002_STATUS=PASS
L003_STATUS=PASS
L004_STATUS=HUMAN_REQUIRED
L005_STATUS=NOT_STARTED
L006_STATUS=NOT_STARTED
LOCAL_CUSTOMER_IDENTITY_E2E_READY=NO
```

**Corrected L002 execution evidence (2026-09-01)**: L002 is substrate-only. The existing local Compose PostgreSQL service was healthy; Prisma clients generated; all nine repository migrations applied to local `assistant_dev`; deterministic seed data created two Customers and two existing `admin` bindings; Backend runtime/build and Gateway build were identified; and the existing Identity Bridge reported health/JWKS on loopback. Gateway startup and signing bootstrap correctly move to L003 because the unchanged profile-only runtime requires an enabled active TrustProfile before startup. `LOCAL_TASK_ORDERING_DEFECT_CORRECTED=YES`; `L002_STATUS=PASS`.

**L003 local tooling preparation evidence (2026-09-01)**: The dependency-free JWKS-only proxy binds exactly `127.0.0.1:3110`, fetches only the local Bridge public JWKS at `127.0.0.1:3107`, enforces GET/exact path/JSON/256-KiB bounds, and forwards no caller authority or body. Synthetic coverage passes 1 suite/7 tests; live loopback verification returns JWKS 200 while exchange, health, and readiness return 404 and POST JWKS returns 405. The local provisioning tool validates a runtime public HTTPS JWKS URI through unchanged production policy and real hardened transport before mutation, then composes the existing binding/profile commands with exact local authority and fail-closed conflict handling. Its isolated DB suite passes 1 suite/9 tests. `cloudflared` is absent, so no tunnel, Customer, binding, profile, Gateway runtime, or signing bootstrap was started; L003 stops at the operator installation boundary.

**L003 hardened JWKS transport compatibility correction (2026-09-01)**: Operator evidence on Node `v22.17.1` isolated a real production transport defect after the same public tunnel JWKS passed curl, DNS, plain Node HTTPS, Content-Type, JSON, and RSA/RS256 shape validation. The custom HTTPS socket lookup ignored Node's `all=true` callback contract and always returned the single-address overload. RED-first regression coverage now proves the typed adapter returns validated address records for `all=true`, preserves ordered IPv4/IPv6 results, supports the normal single-address overload, honors explicit family 4/6 constraints, and fails closed when no compatible validated address exists. Initial and connection-time public-destination validation, mixed-answer denial, HTTPS-only retrieval, timeout, size, Content-Type, and loopback-bypass guards remain unchanged. Local-only provisioning diagnostics now distinguish policy and hardened-retrieval stages while keeping database mutation `NO` for verify-only. Automated correction evidence does not replace the required operator rerun against the active tunnel; L003 remains `HUMAN_REQUIRED`, and no local authority database mutation was performed.

**L003 completion evidence (2026-09-01)**: The authorized operator rerun completed the exact L003 contract. The dedicated local Customer exists; its IntegrationBinding and active RS256 TrustProfile report `READY`; the real Gateway started after local signing bootstrap; Gateway health and public JWKS succeeded; and the corrected production `HardenedJwksTransport` accepted the runtime tunnel URI through the unchanged public-source policy and retrieved the current Bridge public JWKS. This is local development evidence only: `L003_STATUS=PASS`; `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED=NO`; `STAGING_IDENTITY_READY=NO`.

**L004 local session verifier preparation evidence (2026-09-01)**: RED-first coverage initially failed only because the local verifier surface did not exist. The completed dependency-free tool reuses the established hidden raw-TTY reader, rejects arguments and non-interactive input, sends the entered native bearer once only to the fixed local Bridge exchange, retains the exact canonical response token in memory, and sends it once only to the fixed real Gateway session route with a fresh request ID and `{pageContext:{}}`. It validates the real Gateway/Backend `201` envelope without printing the session ID and performs a read-only parameterized `psql` lookup against loopback `assistant_dev`, emitting only local Customer/HostApp match results. Focused verifier and existing IDX-tool coverage passes 2 suites/49 tests; unchanged Gateway Feature 004, provisioning, hardened-JWKS, trust-chain, and Gateway-to-Backend coverage passes 8 suites/129 tests; both independent builds pass. No interactive credential run occurred, no production source changed for L004, and L004 remains at the human input boundary: `LOCAL_SESSION_VERIFIER_READY=YES`; `L004_STATUS=HUMAN_REQUIRED`; `LOCAL_CUSTOMER_IDENTITY_E2E_READY=NO`.

```text
LOCAL_DATABASE_SCHEMA_AND_SEEDS_READY=YES
LOCAL_BACKEND_RUNTIME_IDENTIFIED=YES
LOCAL_GATEWAY_RUNTIME_IDENTIFIED=YES
LOCAL_GATEWAY_SIGNING_BOOTSTRAP_IDENTIFIED=YES
LOCAL_FEATURE004_CUSTOMER_STATE=READY
LOCAL_FEATURE004_BINDING_STATE=READY
LOCAL_FEATURE004_TRUST_PROFILE_STATE=READY
LOCAL_JWKS_ONLY_PROXY_READY=YES
LOCAL_JWKS_PROXY_ORIGIN=http://127.0.0.1:3110
CLOUDFLARED_AVAILABLE=YES
LOCAL_BRIDGE_PUBLIC_JWKS_URI=AVAILABLE_FOR_OPERATOR_VERIFY_ONLY
LOCAL_FEATURE004_PROVISIONING_TOOL_READY=YES
LOCAL_SESSION_VERIFIER_READY=YES
L003_STATUS=PASS
L004_STATUS=HUMAN_REQUIRED
L005_STARTED=NO
L006_STARTED=NO
```

## Phase 10 — First-Customer staging provisioning

- [ ] T065 [OPS] [US5] Obtain HUMAN_REQUIRED staging values in `specs/007-customer-identity-bridge/tasks.md`; deps: T064; Customer/integration/HostApp/issuer/audience/RS256/JWKS URI/lifecycle; validate operator review; done when inputs are approved, not source-coded.

### T065 operator worksheet — preparation only

| Value | Status | Source/evidence | Operator action required |
|---|---|---|---|
| `CUSTOMER_ID` | `HUMAN_REQUIRED` | `Customer.id` must already exist; binding provisioning rejects unknown Customers. Test/seed IDs are synthetic. | Supply and verify the approved central staging Customer record ID. |
| `INTEGRATION_ID` | `HUMAN_REQUIRED` | Assistant deployment-owned; it is the binding primary key and canonical `integration_id`. Local/Phase-9 values are non-staging fixtures. | Approve one unused staging integration ID and use it identically in Bridge, binding, and TrustProfile. |
| `HOST_APP` | `DERIVABLE` | `shinmone-scm` is the established first-Customer candidate in repository and real local evidence, but local values are not automatically promoted. | Confirm `shinmone-scm` as the exact staging `allowedHostApp` or provide the approved replacement. |
| `BRIDGE_ISSUER` | `HUMAN_REQUIRED` | Bridge deployment/TrustProfile-owned; IDX native issuer has no authority here. | Supply the exact staging Bridge issuer used in JWTs and the TrustProfile. |
| `BRIDGE_AUDIENCE` | `HUMAN_REQUIRED` | Central Assistant/Gateway trust-owned and matched exactly by Feature 004. | Supply the approved staging audience. |
| `BRIDGE_JWKS_PUBLIC_URI` | `HUMAN_REQUIRED` | Must be public HTTPS, policy-compatible, and centrally reachable; the local synthetic URI is invalid staging evidence. | Provision or approve the real staging JWKS route and verify DNS, TLS, and public reachability. |
| `SIGNING_ALGORITHM` | `KNOWN` | Bridge and Feature 004 support exactly `RS256`. | Record `RS256`; no algorithm choice remains. |
| `ACTIVE_KID` | `HUMAN_REQUIRED` | Deployment-owned; local `shinmone-scm-local-2026-01` must not be promoted. | Allocate a nonblank staging `kid` and ensure it matches the active public JWK. |
| `SIGNING_KEY_REFERENCE / secret-mount destination` | `HUMAN_REQUIRED` | Bridge accepts Customer-local `file:` PKCS#8 references; private material must remain in a read-only secret mount. | Provide the approved mount destination and corresponding `file:` URI without recording key contents. |
| `KEY_LIFECYCLE / rotation state` | `HUMAN_REQUIRED` | Exactly one Bridge key must be active; initial versus successor rotation depends on existing deployment/profile state. | Inventory existing staging keys/profiles and approve active/published/retiring state, profile version, and predecessor if applicable. |
| `BRIDGE_IDX_MENUDETAIL_URI` | `HUMAN_REQUIRED` | Production requires HTTPS. The legacy HTTP endpoint and local `idx-proxy.local` URI are not staging values. | Supply the Customer-local staging HTTPS MenuDetail URI or approved HTTPS proxy URI. |
| `IDX_DESTINATION_MODE` | `DERIVABLE` | `public_only` is required for public destinations; `allowlisted_networks` is required for approved Customer-private destinations. | Select the mode from the approved staging endpoint's actual network topology. |
| `IDX_ALLOWED_CIDRS` | `DERIVABLE` | Empty and not applicable under `public_only`; exact CIDRs are mandatory under `allowlisted_networks`. | Record `NOT_APPLICABLE` for public mode or supply the minimal approved staging CIDRs. |
| `BRIDGE_IDX_ALLOWED_ENTRIES` | `HUMAN_REQUIRED` | The observed value is evidence only for one selected local positive path. Authentication Entries are user-specific, and no complete static deployment allowlist has been established. | Obtain an approved staging allowlist from the Customer authority; do not promote the local value, infer additional Entries, or use a wildcard. |
| `BRIDGE_ALLOWED_ORIGINS / same-origin ingress decision` | `DERIVABLE` | Feature 007 V1 prefers same-origin, represented by an empty origin list; distinct-origin deployment requires exact HTTPS origins. | Confirm same-origin ingress or provide the explicit staging SPA HTTPS origin list. |

Before T065 can be completed, the operator must also supply existing-command metadata: binding/profile `requestId` values, TrustProfile `id`, positive `version`, `action`, and `replacesProfileId` when rotation applies. The intended enabled states remain `IntegrationBinding.enabled=true` and TrustProfile `enabled=true`, `lifecycle=active`.

```text
T065_WORKSHEET_READY=YES
T065_STATUS=HUMAN_REQUIRED
T066_STARTED=NO
HIGHEST_COMPLETED_TASK=T064
CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED=NO
STAGING_IDENTITY_READY=NO
```

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
