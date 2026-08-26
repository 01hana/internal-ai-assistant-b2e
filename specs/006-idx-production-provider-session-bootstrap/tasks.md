# Tasks: Feature 006 — IDX Production Provider Session Bootstrap

**Input**: `spec.md`, `design.md`, and `plan.md` in this directory.  
**Scope**: Additive Feature 005 IDX provider/permission extension only. Feature 004 remains the managed-JWT verifier and Customer/HostApp authority; Feature 002, SDK source, Customer deployment, local ES512/JWKS verification, and Customer-specific branches are out of scope.

## Execution Rules

- Complete each phase gate before dependent phases. Every test task must be observed failing for the intended missing behavior before its implementation task starts.
- `[P]` appears only for work in separate files with no unfinished contract dependency. All other tasks are deliberately sequential.
- Use the existing managed-exchange test fixtures and registry DB helper; do not require live IDX infrastructure or create parallel test infrastructure.
- Feature 006 provider logic, IDX trusted material, permission scopes, audit/log/telemetry, and newly introduced Feature 006 persistence MUST NOT contain or establish Customer ID authority. Existing Feature 004 `IntegrationBinding.customerId` persistence and test fixtures remain allowed and unchanged; Feature 004 remains the sole Customer authority. No task may persist or log a native credential, Authorization header, RefreshToken, raw native claims, raw MenuDetail response, or SDK state.

## Phase 1 — Baseline and Failing-First Contract Tests

**Goal**: Establish the executable Feature 006 contract before runtime work.  
**Dependencies**: None.  
**Completion gate**: `IDX_CONTRACT_TESTS_RED` — new IDX expectations fail only because Feature 006 is absent; existing Feature 005/004 regressions remain green.

- [x] T001 Create failing IDX provider-tuple and POST-regression tests in `apps/gateway/test/managed-identity-exchange/idx-provider-contract.spec.ts` for `idx_delegated`/`idx-menu-detail/v1`/GET/bearer/JSON/sole `idx_entry`, and prove generic `delegated_http/v1` remains POST. Tests: near-miss tuple failures; no browser endpoint or dynamic contract acceptance. Depends on: none.
- [x] T002 Create failing enum migration expectations in `apps/gateway/test/managed-identity-exchange/persistence.spec.ts` for retained `POST`, `allow_empty`, `required` plus additive `GET` and `provider_trusted`. Tests: no new Customer/token/MenuDetail/SDK persistence. Depends on: T001.
- [x] T003 Create failing closed-material and provider-trusted tests in `apps/gateway/test/managed-identity-exchange/permission-idx-fixture.spec.ts` and `permission-pipeline.spec.ts`. Tests: immutable `idx-menu-detail/v1`, null source ID, missing/wrong material denial, and proof no Permission Source adapter is invoked. Depends on: T001.
- [x] T004 Create failing incomplete-IDX readiness cases in `apps/gateway/test/managed-identity-exchange/readiness.spec.ts`. Tests: every missing Provider Instance, Entry policy, normalizer, projection, issuer/key, or Feature 004 profile prerequisite fails closed without an external call. Depends on: T001.

## Phase 2 — Additive Prisma Enum Migration

**Goal**: Make the two additive enum values representable without altering existing models.  
**Dependencies**: Phase 1.  
**Completion gate**: `IDX_ENUM_MIGRATION_READY` — old records remain valid; new enum values exist; enum presence alone cannot make IDX ready.

- [x] T005 Update `ManagedHttpMethod` and `ManagedPermissionMode` in `prisma/schema.prisma` to add only `GET` and `provider_trusted`. Tests: satisfy T002 source/schema expectations; retain every existing enum value. Depends on: T002.
- [x] T006 Add one additive root enum migration in `prisma/migrations/<timestamp>_feature006_idx_provider/migration.sql`. Tests: apply against the existing migration lineage; do not add tables, columns, Customer fields, credentials, raw payloads, or SDK storage. Depends on: T005.
- [x] T007 Refresh generated Prisma client and add DB-backed enum compatibility coverage in `apps/gateway/test/managed-identity-exchange/persistence.spec.ts`. Tests: use `RUN_GATEWAY_REGISTRY_DB_TESTS=true`, prove legacy rows/readiness are unchanged, and run `npx prisma validate` plus `npm run prisma:generate`. Depends on: T006.

## Phase 3 — Fixed IDX Provider Contract

**Goal**: Allow only the exact registered IDX Provider Instance tuple.  
**Dependencies**: Phase 2.  
**Completion gate**: `IDX_PROVIDER_CONTRACT_READY` — exact IDX configuration is accepted; near misses fail closed; generic delegated POST is unchanged.

- [x] T008 Extend closed provider contract registry coverage in `apps/gateway/test/managed-identity-exchange/idx-provider-contract.spec.ts` for IDX response version, JSON contract, and sole `idx_entry` declaration. Tests: reject arbitrary methods, anchor kinds, JSONPath/expressions, dynamic headers, and Customer-specific values. Depends on: T007.
- [x] T009 Extend `apps/gateway/src/managed-identity-exchange/persistence/managed-contract-registries.ts` with the fixed `idx-menu-detail/v1` validator and active eligibility. Tests: make T008 pass without broadening generic contract registration. Depends on: T008.
- [x] T010 Extend `apps/gateway/src/managed-identity-exchange/persistence/managed-exchange-activation.validator.ts` and `providers/delegated-endpoint.policy.ts` to validate exactly the IDX GET/bearer/HTTPS tuple. Tests: add activation/provider-policy negatives in `idx-provider-contract.spec.ts`; no hardcoded endpoint, selector, Entry, Customer, or SCM value. Depends on: T009.

## Phase 4 — Safe GET Delegated Transport

**Goal**: Execute the validated IDX GET request through the existing hardened transport.  
**Dependencies**: Phase 3.  
**Completion gate**: `IDX_GET_TRANSPORT_READY` — one registered IDX GET request is safe; generic delegated POST protections and behavior are unchanged.

- [x] T011 Add failing GET transport/security regression cases in `apps/gateway/test/managed-identity-exchange/delegated-transport.spec.ts`. Tests: method, one bearer forward/no retry, unsafe destination, redirect, bad content type, oversized body, deadline, DNS/rebinding, and POST regression. Depends on: T010.
- [x] T012 Extend request-method typing and execution in `apps/gateway/src/managed-identity-exchange/providers/delegated-http.transport.ts` to use only the validated stored GET/POST method. Tests: make T011 pass while preserving HTTPS, pre-request DNS, connection-time DNS, 256 KiB cap, ≤5s deadline, JSON-only response, and one-send semantics. Depends on: T011.
- [x] T013 Update `apps/gateway/src/managed-identity-exchange/providers/delegated-http-v1.adapter.ts` regression coverage in `delegated-provider.spec.ts` so existing `delegated_http/v1` remains POST-only and unaffected by IDX GET capability. Tests: all generic provider contract assertions stay green. Depends on: T012.

## Phase 5 — Internal Provider Error Classification

**Goal**: Preserve IDX typed outcomes without changing non-enumerating public responses.  
**Dependencies**: Phase 4.  
**Completion gate**: `IDX_ERROR_CLASSIFICATION_READY` — 401/403/503 meanings are distinct internally and existing public projector contracts are unchanged.

- [x] T014 Add failing classified IDX transport/provider tests in `apps/gateway/test/managed-identity-exchange/idx-delegated-provider.spec.ts` for 401 credential invalid, 403 identity denied, 500/503 unavailable, network/deadline/DNS unavailable, and malformed success unavailable. Tests: assert no raw HTTP body/status leaks. Depends on: T012.
- [x] T015 Preserve 401/403 distinction in `apps/gateway/src/managed-identity-exchange/providers/delegated-http.transport.ts` and `exchange.service.ts`. Tests: make T014 pass; retain `exchange-error.projector.ts` public 401/403/503 envelopes without IDX diagnostics. Depends on: T014.

## Phase 6 — Strict IDX MenuDetail Validator

**Goal**: Reduce only successful IDX MenuDetail responses into semantic menu data.  
**Dependencies**: Phase 5.  
**Completion gate**: `IDX_MENUDETAIL_VALIDATION_READY` — accepted output is semantic-only and raw response data cannot escape the adapter boundary.

- [x] T016 Add failing MenuDetail schema cases in `apps/gateway/test/managed-identity-exchange/idx-menu-detail.validator.spec.ts`. Tests: valid response, `Code != 200`, missing/non-array Data, blank MenuID, invalid operation value, malformed/unknown structure, duplicates, all-N menu, and accepted non-authority fields if the final schema permits them. Depends on: T015.
- [x] T017 Implement strict semantic reduction in `apps/gateway/src/managed-identity-exchange/providers/idx-menu-detail.validator.ts`. Tests: make T016 pass; output only `menuId` plus normalized approved actions, never UUID, raw record, response metadata, native claims, or HTTP body. Depends on: T016.

## Phase 7 — Post-Verification IDX Claim Parsing

**Goal**: Create identity authority only after the exact credential is accepted and MenuDetail validates.  
**Dependencies**: Phase 6.  
**Completion gate**: `IDX_VERIFIED_IDENTITY_READY` — accepted credentials create the required verified identity; decoded claims cannot establish authority before acceptance.

- [x] T018 Add failing post-acceptance ordering and claim-consistency tests in `apps/gateway/test/managed-identity-exchange/idx-delegated-provider.spec.ts`. Tests: parser unreachable before acceptance; missing/mismatched `sub`/`UUID_User`, missing Company/Entry fail closed; UserType/IsAdmin/Permissions/Permission_Hash create no authority. Depends on: T017.
- [x] T019 Implement post-validation native claim parsing and verified identity construction in `apps/gateway/src/managed-identity-exchange/providers/idx-delegated-verification.adapter.ts`. Tests: map `sub`, `UUID_Company`, and `{ kind: "idx_entry", value: UUID_Entry }`; perform no ES512/JWKS/kid/time-only verification or role inference. Depends on: T018.

## Phase 8 — Closed IDX Trusted Permission Material

**Goal**: Add only the provider-specific immutable structured material needed by IDX.  
**Dependencies**: Phase 7.  
**Completion gate**: `IDX_TRUSTED_MATERIAL_READY` — scalar Feature 005 material remains valid and generic arbitrary provider JSON is impossible.

- [x] T020 Extend failing domain contract coverage in `apps/gateway/test/managed-identity-exchange/domain-contracts.spec.ts` for `idx-menu-detail/v1` immutability, unknown-key/wrong-kind rejection, forbidden UUID/token/claims/HTTP/Customer/integration fields, and scalar-material regression. Depends on: T019.
- [x] T021 Extend `TrustedPermissionMaterial` constructors and validation in `apps/gateway/src/managed-identity-exchange/domain/managed-exchange.domain.ts` with a closed discriminated IDX menu variant. Tests: make T020 pass; freeze nested records/actions and keep provider-specific details out of generic domain callers. Depends on: T020.

## Phase 9 — `provider_trusted` Permission Mode

**Goal**: Normalize verified provider material without a Permission Source.  
**Dependencies**: Phase 8.  
**Completion gate**: `IDX_PROVIDER_TRUSTED_PIPELINE_READY` — only admitted IDX material reaches its normalizer; existing modes remain unchanged.

- [ ] T022 Add failing provider-trusted activation and existing-mode regressions in `apps/gateway/test/managed-identity-exchange/permission-pipeline.spec.ts`. Tests: null source ID required; normalizer/projection required; missing/wrong material denied; `allow_empty`/`required` behavior unchanged. Depends on: T021.
- [ ] T023 Extend permission-policy validation in `apps/gateway/src/managed-identity-exchange/persistence/managed-exchange-activation.validator.ts` for `provider_trusted`. Tests: make T022 activation cases pass; reject source-backed or arbitrary material configuration. Depends on: T022.
- [ ] T024 Extend `apps/gateway/src/managed-identity-exchange/permissions/managed-permission.service.ts` with the direct provider-trusted branch. Tests: make T022 pipeline cases pass; never select/invoke a Permission Source, never forward native credential, and fail closed on absent/wrong material. Depends on: T023.

## Phase 10 — IDX Permission Normalizer

**Goal**: Produce deterministic provider-neutral normalized permissions and reuse the generic projector.  
**Dependencies**: Phase 9.  
**Completion gate**: `IDX_PERMISSION_NORMALIZATION_READY` — scopes are exact, ordered, deduplicated, and free of opaque IDX/Customer/role identifiers.

- [ ] T025 Add failing IDX normalizer cases in `apps/gateway/test/managed-identity-exchange/permission-normalization.spec.ts`. Tests: implicit read, each Y operation, all-N menu, duplicates, multiple MenuIDs, fixed ordering, invalid material, and generic projector output. Depends on: T024.
- [ ] T026 Implement `apps/gateway/src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer.ts`. Tests: sort MenuID then `read, insert, update, delete, print, import, export, copy, approval`; emit existing `NormalizedPermission` only and reject wrong kind. Depends on: T025.
- [ ] T027 Verify exact `menu:<MenuID>:<action>` projection through `apps/gateway/src/managed-identity-exchange/permissions/managed-permission-scope.projector.ts` and `permission-normalization.spec.ts`. Tests: no IDX UUID, Customer ID, integration ID, UserType, or IsAdmin in scopes; do not add an IDX-specific projector. Depends on: T026.

## Phase 11 — IDX Adapter and Normalizer Composition

**Goal**: Wire only the registered IDX capability into existing Feature 005 composition.  
**Dependencies**: Phase 10.  
**Completion gate**: `IDX_COMPOSITION_READY` — valid IDX config resolves its real adapter/normalizer; non-IDX selection remains unchanged.

- [ ] T028 Add failing composition/registry tests in `apps/gateway/test/managed-identity-exchange/phase2a-composition.spec.ts` for IDX adapter/normalizer registration and non-IDX resolution regression. Depends on: T027.
- [ ] T029 Register the IDX adapter dependencies and normalizer in `apps/gateway/src/managed-identity-exchange/managed-identity-exchange.module.ts` and preserve fixed selection in `providers/identity-provider-adapter.registry.ts`. Tests: make T028 pass; no hardcoded endpoint, Entry, selector, Customer, or SCM branch. Depends on: T028.

## Phase 12 — IDX Entry Admission

**Goal**: Prove exact Entry admission prevents selector replay.  
**Dependencies**: Phase 11.  
**Completion gate**: `IDX_ENTRY_ADMISSION_READY` — Entry A passes selector A and fails selector B before canonicalization/issuance.

- [ ] T030 Add IDX Entry A→B replay cases to `apps/gateway/test/managed-identity-exchange/integration-admission.spec.ts`. Tests: selector alone is non-authoritative; UUID_Company cannot substitute for `idx_entry`; Feature 006 performs no Customer resolution. Depends on: T029.
- [ ] T031 Validate existing `apps/gateway/src/managed-identity-exchange/admission/integration-admission.service.ts` requires no IDX-specific branch and make T030 pass through adapter-produced anchors. Tests: exact verified-anchor behavior remains generic. Depends on: T030.

## Phase 13 — IDX Readiness Extension

**Goal**: Make only fully provisioned IDX integrations ready without calling IDX.  
**Dependencies**: Phase 12.  
**Completion gate**: `IDX_READINESS_READY` — every missing, disabled, duplicate, or incompatible prerequisite fails closed; provider readiness is distinct from Customer deployment readiness.

- [ ] T032 Expand failing readiness matrix in `apps/gateway/test/managed-identity-exchange/readiness.spec.ts` for all 13 IDX prerequisites, duplicates, disabled records, incompatible Feature 004 profile, and no-external-call assertion. Depends on: T031.
- [ ] T033 Extend `apps/gateway/src/managed-identity-exchange/persistence/managed-exchange-readiness.validator.ts` and `managed-exchange-readiness.composition.ts` for active IDX contract, `idx_entry`, provider-trusted policy, registered normalizer/projection, issuer/key, and Feature 004 profile. Tests: make T032 pass; keep readiness read-only and no Customer deployment inference. Depends on: T032.

## Phase 14 — Audit, Logging, and Secret-Leak Guards

**Goal**: Prove native credential and MenuDetail data remain transient.  
**Dependencies**: Phase 13.  
**Completion gate**: `IDX_REDACTION_READY` — raw IDX security material cannot survive provider processing.

- [ ] T034 Add IDX redaction/source guards in `apps/gateway/test/managed-identity-exchange/feature005-security.spec.ts` and `exchange-audit-module.spec.ts`. Tests: prohibit raw AccessToken, Authorization, RefreshToken, native claims, MenuDetail payload, response body in logs/audit/telemetry/errors/persistence/snapshots; do not add logging. Depends on: T033.
- [ ] T035 Harden only necessary IDX adapter/audit boundaries in `apps/gateway/src/managed-identity-exchange/providers/idx-delegated-verification.adapter.ts` and `persistence/managed-exchange-audit.writer.ts` to satisfy T034. Tests: existing generic audit redaction remains green. Depends on: T034.

## Phase 15 — Two-Integration Reuse Evidence

**Goal**: Demonstrate configuration-first IDX reuse without Customer-specific code.  
**Dependencies**: Phase 14.  
**Completion gate**: `IDX_REUSE_READY` — two integrations share capability but remain endpoint/selector/Entry isolated.

- [ ] T036 Add two independently provisioned IDX integration fixture coverage in `apps/gateway/test/managed-identity-exchange/feature004-compatibility.spec.ts`. Tests: same adapter capability, distinct selectors/Entry anchors/configuration, Entry A denial for B, and no Customer-specific source branch. Depends on: T035.
- [ ] T037 Extend production-shaped IDX test fixtures in `apps/gateway/test/managed-identity-exchange/fixtures/` only as needed for T036. Tests: fixture contains no real Customer domain, credential, Entry, or production secret. Depends on: T036.

## Phase 16 — Feature 004 Compatibility and Session Bootstrap

**Goal**: Prove IDX exchange reaches the existing session path through real Feature 004 authority.  
**Dependencies**: Phase 15.  
**Completion gate**: `IDX_SESSION_HANDOFF_READY` — managed IDX JWT, never native IDX token, creates a session through unchanged Feature 004.

- [ ] T038 Add failing managed IDX JWT integration coverage in `apps/gateway/test/managed-identity-exchange/feature004-compatibility.spec.ts` and `apps/gateway/test/integration/feature004-gateway-backend.e2e.spec.ts`. Tests: real verifier, exactly-one profile, IntegrationBinding Customer/HostApp resolution, Gateway internal identity, existing create-session route, and `sessionId`. Depends on: T037.
- [ ] T039 Complete IDX exchange composition in `apps/gateway/src/managed-identity-exchange/exchange.service.ts` only as required for T038. Tests: preserve direct Feature 004 and non-IDX Feature 005 behavior; no IDX session endpoint or Feature 004 modification. Depends on: T038.
- [ ] T040 Add re-exchange/session-continuity evidence in `apps/gateway/test/integration/feature004-gateway-backend.e2e.spec.ts` where existing session semantics permit it. Tests: a new managed credential does not itself destroy an existing conversation; sessionId is never authentication. Depends on: T039.

## Phase 17 — Host/SDK Integration Contract Documentation

**Goal**: Separate server capability from out-of-repository client implementation.  
**Dependencies**: Phase 16.  
**Completion gate**: `IDX_HOST_CONTRACT_DOCUMENTED` — the native-to-managed-to-session sequence is clear without fabricated SDK work.

- [ ] T041 Update the Feature 006 Host/SDK section in `specs/006-idx-production-provider-session-bootstrap/design.md` and `plan.md` with the final callback → exchange → managed JWT → session sequence and re-exchange behavior. Tests: document that sessionId is not authentication, Host owns AccessToken/RefreshToken, and SDK implementation/persistence is out of scope. Depends on: T040.

## Phase 18 — Full Regression and Final Verification

**Goal**: Establish reusable IDX provider capability readiness, not Customer deployment readiness.  
**Dependencies**: Phase 17.  
**Completion gate**: `IDX_PROVIDER_CAPABILITY_READY` — all required focused, DB-backed, compatibility, security, and tooling evidence passes with classified skips only.

- [ ] T042 Run and record Feature 006 focused provider, transport, validator, adapter, material, permission, admission, readiness, redaction, reuse, and session suites in `specs/006-idx-production-provider-session-bootstrap/verification.md`. Tests: no live IDX dependency; no required acceptance suite silently skipped. Depends on: T041.
- [ ] T043 Run and record DB-backed migration/readiness, full Feature 005 managed-exchange/non-IDX regression, Feature 004 direct-path/compatibility, and root regression in `specs/006-idx-production-provider-session-bootstrap/verification.md`. Tests: use `RUN_GATEWAY_REGISTRY_DB_TESTS=true` and explicitly classify every skip. Depends on: T042.
- [ ] T044 Run and record `npx prisma validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:gateway`, `npm --prefix apps/gateway run test:unit`, source/redaction guards, and `git diff --check` in `specs/006-idx-production-provider-session-bootstrap/verification.md`. Tests: block readiness on any critical failure or unclassified required skip; distinguish IDX provider capability from Customer deployment readiness. Depends on: T043.

## Dependencies and Parallel Work

```text
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
  → Phase 8 → Phase 9 → Phase 10 → Phase 11 → Phase 12 → Phase 13
  → Phase 14 → Phase 15 → Phase 16 → Phase 17 → Phase 18
```

- T001–T004 establish the shared failing baseline; T005–T007 complete the enum-only prerequisite.
- Transport, adapter, material, permission pipeline, composition, admission, and readiness are intentionally sequential because each consumes the previous contract.
- T041 is documentation-only, follows T040, and must not modify SDK source or runtime behavior.
- The suggested MVP is Phases 1–13: a safe, ready-able IDX provider capability with no Customer deployment claim. Phases 14–18 add cross-cutting proof, session evidence, and release gates.

FEATURE006_TASKS_READY=YES
FEATURE005_BROADER_REDESIGN_REQUIRED=NO
FEATURE005_ADDITIVE_EXTENSION_REQUIRED=YES
FEATURE004_MODIFICATION_REQUIRED=NO
