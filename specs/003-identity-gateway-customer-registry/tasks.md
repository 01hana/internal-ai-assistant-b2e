# Tasks: Identity Gateway and Customer Integration Registry

**Input**: [spec.md](./spec.md), [design.md](./design.md), and [plan.md](./plan.md)
**Prerequisites**: Constitution 2.0.0; accepted Feature 002 identity/readiness behavior
**Tests**: Required. Every runtime decision point is test-first: add and observe the relevant failing test, implement the minimal behavior, run targeted verification, then run affected Feature 002 regression.
**Scope guard**: Feature 003 is an independent Gateway, explicit Integration-to-existing-Customer binding, RS256 internal issuance/JWKS/lifecycle, and narrow Backend transport only. It does not implement Feature 004 capabilities, Customer lifecycle/admin, generic IAM/OIDC/API-key behavior, a generic proxy, commit, push, or merge.

## Format and Dependencies

- Each task records **說明 / 輸出 / 完成條件 / 依賴 / 驗證** inline. `[P]` means only independent files and no incomplete data/contract dependency.
- All Phase checkpoint tasks record modified files, commands, pass/fail and test counts when available, skips, and remaining blockers.
- Phase 6 and Phase 7 each depend only on the Phase 5 checkpoint. Phase 8 requires both Phase 6 and Phase 7 checkpoints.

```text
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
                                              ├→ Phase 6
                                              └→ Phase 7
Phase 2 + 3 + 4 + 5 + 6 + 7 → Phase 8 → Phase 9
```

---

## Phase 0 — Architecture and Contract Guardrails

**Purpose**: Lock Feature 002 trust-boundary behavior before any Gateway runtime exists.

- [ ] T001 Inventory the locked Backend identity, CustomerScope, request-ID, audit/redaction, and protected-route authority in `src/identity/**`, `src/common/{request-id,logger}/**`, `src/audit/**`, `src/assistant/**`, and existing Feature 002 tests. **說明**: establish guarded contracts; **輸出**: Phase-0 test ownership map; **完成條件**: no historical gateway artifact treated as authority; **依賴**: none; **驗證**: static inventory review.
- [ ] T002 [P] Add canonical-claim and public-identity non-authority guards in `test/unit/internal-identity-token-verifier.spec.ts`, `test/unit/identity-context-validation.spec.ts`, and `test/contract/assistant-sessions.contract.spec.ts`. **說明**: lock eight claims and reject headers/body/query/PageContext/metadata authority; **輸出**: failing/green guards; **完成條件**: legacy inputs cannot alter identity; **依賴**: T001; **驗證**: focused Jest plus affected Backend identity contracts.
- [ ] T003 [P] Add architecture guards in `test/unit/feature003-architecture-guard.spec.ts` for no Backend↔Gateway runtime imports, no second Customer root, no Gateway-local Prisma schema/migrations, no generic proxy, and no Feature-004 surface. **說明**: prevent structural drift; **輸出**: static guard suite; **完成條件**: forbidden paths/imports fail; **依賴**: T001; **驗證**: non-socket unit suite.
- [ ] T004 [P] Add internal-JWT exposure/redaction guards in `test/unit/logger-redaction.spec.ts`, `test/unit/observability-metadata.spec.ts`, and `test/contract/customer-assistant-sse.contract.spec.ts`. **說明**: prohibit JWT in response/SSE/cookie/redirect/log/audit/error; **輸出**: negative tests; **完成條件**: all surfaces redact; **依賴**: T001; **驗證**: focused unit/contract suites.
- [ ] T005 Run and classify the focused Feature 002 identity, CustomerScope, A/B no-disclosure, SSE, audit, and redaction baseline suites. **說明**: preserve accepted behavior; **輸出**: baseline evidence; **完成條件**: unrelated failures are recorded before Gateway work; **依賴**: T002–T004; **驗證**: existing `npm run test:unit`/contract subsets.
- [ ] T006 Complete the Phase-0 checkpoint in `specs/003-identity-gateway-customer-registry/tasks.md` evidence section during implementation. **說明**: gate runtime work; **輸出**: modified-file/command/result/skip/blocker record; **完成條件**: T002–T005 pass; **依賴**: T005; **驗證**: checkpoint review.

**Checkpoint**: Feature 002 identity boundary is guarded; Gateway runtime work may begin, but no Gateway feature exists yet.

---

## Phase 1 — Shared Contract, Gateway Skeleton, and Generation Foundation

- [ ] T007 [P] Add pure-package surface tests in `test/unit/internal-identity-contract-package.spec.ts`. **說明**: require only claim names/types, registered metadata, and validation-neutral vocabulary; **輸出**: failing package contract; **完成條件**: Nest/Prisma/signer/verifier/CustomerScope/repository/authorization exports are rejected; **依賴**: T006; **驗證**: focused unit suite.
- [ ] T008 [P] Create the minimal Gateway-local test harness in `apps/gateway/{package.json,jest.config.*,tsconfig.test.json,test/config/gateway-config.spec.ts,test/health/gateway-health.spec.ts}` and add configuration/health-readiness failing tests. **說明**: own only the package manifest, Jest/test TypeScript configuration, test command, and test files required to execute these tests; missing issuer/audience/JWKS, invalid TTL/tolerance/Backend URL/signing reference fail closed; do not create `main.ts`, `gateway.module.ts`, or production config/health behavior. **輸出**: executable Gateway config/health contract harness; **完成條件**: the Gateway-local runner actually executes both tests and its observed red is only missing production behavior, never runner/module/configuration setup; **依賴**: T006; **驗證**: T008 finalizes and runs the Gateway-local Jest command.
- [ ] T009 [P] Add package/build/schema architecture guards in `test/unit/feature003-package-architecture.spec.ts`. **說明**: reject workspace conversion, TS paths/project references, runtime cross-imports, and Gateway-local Prisma schema/migrations; **輸出**: failing static guard; **完成條件**: root schema remains sole source; **依賴**: T006; **驗證**: non-socket unit suite.
- [ ] T010 Implement `packages/internal-identity-contract/{package.json,tsconfig.json,src/index.ts}` and its declarations/exports. **說明**: create the pure local package; **輸出**: buildable vocabulary package; **完成條件**: T007 passes without authority runtime; **依賴**: T007; **驗證**: package build command planned here and T007.
- [ ] T011 Modify the Gateway manifest created by T008, plus root `package.json`, `package-lock.json`, and Gateway build scripts, to add the local `file:` contract dependency and explicit build ordering. **說明**: the contract package builds before root-schema Prisma generation then Backend/Gateway builds; **輸出**: non-workspace dependency wiring; **完成條件**: both apps resolve package exports/declarations without recreating the T008 test harness; **依賴**: T008, T010; **驗證**: install/build resolution checks.
- [ ] T012 Create the first Gateway production runtime skeleton in `apps/gateway/{tsconfig.json,nest-cli.json,src/main.ts,src/gateway.module.ts}`. **說明**: independent Nest bootstrap only; the T008 manifest/test harness already exists and is not recreated here; **輸出**: isolated app structure; **完成條件**: no Backend runtime import and no issuance path; **依賴**: T008, T011; **驗證**: Gateway build/start smoke.
- [ ] T013 Implement fail-closed config and safe health/readiness in `apps/gateway/src/config/**` and `apps/gateway/src/health/**`. **說明**: use T008 contracts; **輸出**: validated configuration boundary; **完成條件**: missing/invalid config blocks bootstrap without leaks; **依賴**: T008, T012; **驗證**: Gateway config/health tests.
- [ ] T014 Add the second Gateway generated-client output to root `prisma/schema.prisma` and root generation wiring only. **說明**: one schema produces both clients; **輸出**: second generator configuration; **完成條件**: no `apps/gateway/prisma/**`; **依賴**: T009, T012; **驗證**: `prisma generate` and architecture guard.
- [ ] T015 Verify shared-package, root Prisma generation, Backend build, Gateway build/start, and no-cross-import guards. **說明**: integration evidence; **輸出**: Phase-1 verification log; **完成條件**: all T007–T014 contracts pass; **依賴**: T013–T014; **驗證**: current commands plus planned Gateway commands finalized here.
- [ ] T016 Complete the Phase-1 checkpoint evidence. **說明**: record foundation outcome; **輸出**: files/commands/results/skips/blockers; **完成條件**: T015 green; **依賴**: T015; **驗證**: checkpoint review.

**Checkpoint**: package and two independent app build paths exist; no identity issuance or Customer resolution exists.

---

## Phase 2 — Additive Persistence and Controlled Provisioning

- [ ] T017 [P] Add IntegrationBinding persistence/FK/index tests in `test/integration/gateway-integration-binding.persistence.spec.ts`. **說明**: explicit existing Customer, unique integration identity, allowedHostApp/enabled, restrict deletion; **輸出**: failing DB contract; **完成條件**: one integration cannot bind two Customers; **依賴**: T016; **驗證**: DB-backed Jest suite.
- [ ] T018 [P] Add GatewaySigningKey and GatewayIdentityAuditEvent persistence/redaction tests in `test/integration/gateway-signing-key.persistence.spec.ts` and `test/unit/gateway-identity-audit-redaction.spec.ts`. **說明**: key fields/states, public-only audit, at-most-one-active requirement; **輸出**: failing constraint/audit tests; **完成條件**: no JWT/Authorization/private JWK/key; **依賴**: T016; **驗證**: focused unit/integration suites.
- [ ] T019 [P] Add controlled provisioning command tests in `test/integration/gateway-integration-provisioning.spec.ts`. **說明**: explicit Customer/integration/HostApp create, rerun, enable/disable/re-enable, conflict rejection; **輸出**: failing command contract; **完成條件**: no Customer creation/inference/public controller; **依賴**: T016; **驗證**: DB-backed suite.
- [ ] T020 [P] Add synthetic A/B binding fixtures and shared-lower-level assertions in `test/support/gateway-identity-fixtures.ts` and `test/unit/gateway-identity-fixtures.spec.ts`. **說明**: share org/sub/host/roles/scopes but differ Customer/integration; **輸出**: deterministic fixtures; **完成條件**: no real keys/credentials; **依賴**: T016; **驗證**: fixture unit suite.
- [ ] T021 Add `IntegrationBinding`, `GatewaySigningKey`, and `GatewayIdentityAuditEvent` models, relations, indexes, and enum fields to root `prisma/schema.prisma`. **說明**: additive canonical data model; **輸出**: root schema changes only; **完成條件**: Customer FK and key lifecycle fields match locked design; **依賴**: T017–T020; **驗證**: Prisma validate and failing tests advance.
- [ ] T022 Create root `prisma/migrations/<timestamp>_feature003_gateway_registry/migration.sql` with additive tables/FKs/indexes and PostgreSQL partial unique enforcement for at most one active key. **說明**: do not assume Prisma schema expresses partial uniqueness; **輸出**: explicit SQL migration; **完成條件**: invalid active-key states reject; **依賴**: T021; **驗證**: T017–T018 migration tests and rollback inspection.
- [ ] T023 Regenerate Backend and Gateway Prisma clients from root `prisma/schema.prisma`. **說明**: update generated outputs only through Prisma; **輸出**: typed generated clients; **完成條件**: no Gateway-local schema generated; **依賴**: T022; **驗證**: `prisma generate` and build checks.
- [ ] T024 Implement `apps/gateway/src/{integration-registry/**,audit/**,commands/provision-integration-binding.ts}`. **說明**: repository, safe Gateway identity audit, and idempotent internal command; **輸出**: no public provisioning controller; **完成條件**: T019 passes and conflicting rebind fails closed; **依賴**: T019, T023; **驗證**: provisioning and audit tests.
- [ ] T025 Add deterministic A/B binding seed support in `scripts/seed.ts` and `test/support/gateway-identity-fixtures.ts`. **說明**: explicit synthetic bindings only; **輸出**: repeatable A/B records; **完成條件**: no ownership inference; **依賴**: T020, T024; **驗證**: seed/fixture tests.
- [ ] T026 Run persistence, provisioning, A/B fixture, Prisma migration, and affected Feature 002 Customer-ownership regression. **說明**: prove additive compatibility; **輸出**: Phase-2 verification evidence; **完成條件**: all DB contracts green; **依賴**: T024–T025; **驗證**: targeted DB suites and Feature 002 persistence tests.
- [ ] T027 Complete the Phase-2 checkpoint evidence. **說明**: record outputs/results/skips/blockers; **輸出**: accepted registry foundation; **完成條件**: T026 green; **依賴**: T026; **驗證**: checkpoint review.

**Checkpoint**: explicit A/B bindings, key metadata, and Gateway security audit exist; no upstream identity is accepted and no internal token is signed.

---

## Phase 3 — Upstream RS256 Authentication

- [ ] T028 [US3] Add upstream RS256/JWKS/time failing tests in `apps/gateway/test/upstream-auth/upstream-token-verifier.spec.ts`. **說明**: signature, issuer/audience, `iat`/`exp`, optional `nbf`, malformed/future/expired/wrong-algorithm cases; **輸出**: verifier contract; **完成條件**: failures occur before registry/signing/Backend work; **依賴**: T027; **驗證**: Gateway unit suite.
- [ ] T029 [P] [US3] Add verified upstream claim-shape/no-authority tests in `apps/gateway/test/upstream-auth/upstream-identity.spec.ts`. **說明**: required non-blank scalars, empty valid arrays, blank array rejection, public input conflicts; **輸出**: identity-shape contract; **完成條件**: no client augmentation; **依賴**: T027; **驗證**: Gateway unit suite.
- [ ] T030 [P] [US7] Add upstream credential safe-error/redaction tests in `apps/gateway/test/upstream-auth/upstream-auth-redaction.spec.ts`. **說明**: redact raw upstream JWT/Authorization/claims; **輸出**: failure-surface contract; **完成條件**: generic denial only; **依賴**: T027; **驗證**: unit/logger tests.
- [ ] T031 Implement deployment-configured upstream auth settings in `apps/gateway/src/config/gateway-config.service.ts`. **說明**: single issuer/audience/JWKS/tolerance; **輸出**: typed config; **完成條件**: invalid values fail at bootstrap; **依賴**: T028–T030; **驗證**: T028–T030.
- [ ] T032 Implement verified-upstream types and RS256 Remote-JWKS verifier in `apps/gateway/src/upstream-auth/**`. **說明**: separate from binding/signing/Backend client; **輸出**: verified identity boundary; **完成條件**: no registry or signing dependency; **依賴**: T031; **驗證**: T028–T029.
- [ ] T033 Wire safe upstream-auth exceptions and redacted telemetry in `apps/gateway/src/{upstream-auth/**,observability/**,audit/**}`. **說明**: 401/non-disclosing failure mapping; **輸出**: safe error path; **完成條件**: T030 passes; **依賴**: T032; **驗證**: redaction tests.
- [ ] T034 Run upstream-auth targeted tests plus affected Feature 002 verifier, canonical-claim, and public-header regressions. **說明**: ensure no Backend contract drift; **輸出**: verification evidence; **完成條件**: all selected suites green; **依賴**: T033; **驗證**: Gateway and existing Backend Jest subsets.
- [ ] T035 Complete the Phase-3 checkpoint evidence. **說明**: record results/skips/blockers; **輸出**: accepted upstream boundary; **完成條件**: T034 green; **依賴**: T034; **驗證**: checkpoint review.

**Checkpoint**: only a verified upstream identity may progress; it has neither Customer authority nor signing authority.

---

## Phase 4 — Integration-to-Customer Resolution and Canonical Identity

- [ ] T036 [US1] Add resolver and no-inference failing tests in `apps/gateway/test/integration-registry/canonical-identity-resolver.spec.ts`. **說明**: unknown/disabled/missing binding, HostApp mismatch, no default Customer; **輸出**: resolver contract; **完成條件**: no signing/Backend call on denial; **依賴**: T035; **驗證**: Gateway unit suite.
- [ ] T037 [P] [US1] Add A/B integration-isolation tests in `apps/gateway/test/integration-registry/customer-binding-isolation.spec.ts`. **說明**: shared lower identity with different binding Customer; **輸出**: cross-Customer denial contract; **完成條件**: A cannot obtain B and vice versa; **依賴**: T035, T025; **驗證**: Gateway DB integration suite.
- [ ] T038 Implement immutable `CanonicalGatewayIdentity` types/composer in `apps/gateway/src/identity/**`. **說明**: bounded value from verified upstream identity plus binding only; **輸出**: frozen canonical identity; **完成條件**: Customer comes solely from binding; **依賴**: T036–T037; **驗證**: resolver tests.
- [ ] T039 Implement Customer-qualified binding resolution in `apps/gateway/src/integration-registry/canonical-identity-resolver.service.ts`. **說明**: enabled, Customer FK, and HostApp checks; **輸出**: fail-closed resolver; **完成條件**: no org/sub/role/scope/header/body/PageContext/metadata inference; **依賴**: T038; **驗證**: T036–T037.
- [ ] T040 [US3] Wire safe resolution-denial telemetry in `apps/gateway/src/{identity/**,audit/**,observability/**}`. **說明**: no resource-existence disclosure; **輸出**: safe issuance denial path; **完成條件**: no business audit or Backend request; **依賴**: T039; **驗證**: resolver/redaction tests.
- [ ] T041 Run canonical resolution/A-B tests and affected Feature 002 CustomerScope, header non-authority, and no-disclosure regressions. **說明**: prove contract compatibility; **輸出**: verification evidence; **完成條件**: all selected suites green; **依賴**: T040; **驗證**: targeted Gateway/Backend suites.
- [ ] T042 Complete the Phase-4 checkpoint evidence. **說明**: record results/skips/blockers; **輸出**: accepted canonical identity boundary; **完成條件**: T041 green; **依賴**: T041; **驗證**: checkpoint review.

**Checkpoint**: Gateway can compose immutable Customer A/B identities from explicit bindings only, but cannot yet issue normal Backend tokens.

---

## Phase 5 — Internal Signing and Public JWKS

- [ ] T043 [US2] Add internal issuer failing tests in `apps/gateway/test/identity/internal-identity-token-issuer.spec.ts`. **說明**: RS256, `kid`, exact issuer/audience, canonical claims, 5-minute TTL, omitted `nbf`, Gateway `jti`, caller non-control; **輸出**: issuance contract; **完成條件**: empty roles/scopes remain valid; **依賴**: T042; **驗證**: Gateway unit suite.
- [ ] T044 [P] [US4] Add JWKS visibility/serialization HTTP tests in `apps/gateway/test/jwks/jwks-endpoint.spec.ts`. **說明**: new/retired hidden, published/active/retiring visible, public fields only; **輸出**: JWKS contract; **完成條件**: no private RSA fields; **依賴**: T042; **驗證**: Gateway unit/HTTP suite.
- [ ] T045 [P] [US7] Add SigningKeyProvider and internal-token redaction failing tests in `apps/gateway/test/signing/signing-key-provider.spec.ts` and `apps/gateway/test/identity/internal-token-redaction.spec.ts`. **說明**: ignored local file, production reference boundary, no raw PEM/key/JWT logs; **輸出**: safe provider contract; **完成條件**: caller cannot select key/alg/claims; **依賴**: T042; **驗證**: Gateway unit suite.
- [ ] T046 Implement `SigningKeyProvider` local-file and production-reference boundary in `apps/gateway/src/signing/**`. **說明**: validate safe reference/existence/readability without logging material; **輸出**: provider abstraction; **完成條件**: no DB private key or raw production PEM env; **依賴**: T045; **驗證**: T045.
- [ ] T047 Implement active-key resolver and `InternalIdentityTokenIssuer` in `apps/gateway/src/{signing/**,identity/**}`. **說明**: active-only signing from canonical identity; **輸出**: per-request issuer; **完成條件**: T043 passes; **依賴**: T043, T046; **驗證**: issuer tests.
- [ ] T048 Implement public-JWK serializer and state-filtered JWKS service in `apps/gateway/src/jwks/**`. **說明**: publish only allowed public fields/states; **輸出**: JWKS domain service; **完成條件**: T044 passes; **依賴**: T044, T046; **驗證**: JWKS tests.
- [ ] T049 Implement `/.well-known/jwks.json` endpoint and cache headers in `apps/gateway/src/jwks/**` and `apps/gateway/src/gateway.module.ts`. **說明**: unauthenticated public key distribution; **輸出**: HTTP endpoint; **完成條件**: no issuer/token/key leakage; **依賴**: T048; **驗證**: JWKS HTTP tests.
- [ ] T050 [US2] Add Gateway-issued-token ↔ unchanged Feature 002 verifier contract tests in `test/contract/gateway-internal-identity.contract.spec.ts`. **說明**: Backend accepts genuine compatible token and rejects wrong metadata; **輸出**: inter-app contract; **完成條件**: no Backend identity contract change; **依賴**: T047–T049; **驗證**: contract suite.
- [ ] T051 Add local real-key signer/JWKS integration tests in `apps/gateway/test/integration/local-signing-jwks.spec.ts`. **說明**: use test/integration-owned active `GatewaySigningKey` metadata and an ignored developer key file only; this is signing/JWKS fixture setup, not operational key provisioning; **輸出**: local signer proof; **完成條件**: real key material never committed/logged, and production new-key registration remains exclusively T057; **依賴**: T049–T050; **驗證**: Gateway integration suite.
- [ ] T052 Run signing/JWKS tests plus affected Feature 002 Remote-JWKS verifier, canonical claim, header, and logger-redaction regressions. **說明**: maintain Backend authority; **輸出**: verification evidence; **完成條件**: selected suites green; **依賴**: T051; **驗證**: focused Gateway/Backend commands.
- [ ] T053 Complete the Phase-5 checkpoint evidence. **說明**: record results/skips/blockers; **輸出**: base signing/JWKS acceptance; **完成條件**: T052 green; **依賴**: T052; **驗證**: checkpoint review.

**Checkpoint**: Gateway can issue Feature-002-compatible tokens and publish public JWKS using test/integration-owned active-key metadata only; operational new-key registration begins in T057, and there is no accepted rotation or real end-to-end readiness claim.

---

## Phase 6 — Key Lifecycle and Rotation

- [ ] T054 [US5] Add signing-key registration, key-state transition, and rollback failing tests in `apps/gateway/test/signing/key-lifecycle.service.spec.ts`. **說明**: `SigningKeyProvider` supplies only a safe handle/reference; derive and validate public JWK, require a unique non-blank `kid`, validate public `kty`/`kid`/`alg`/`use`/`n`/`e`, persist metadata as `new`, then cover new→published→active→retiring→retired, publish-before-activate, single active, and rollback. **輸出**: lifecycle and controlled registration contract; **完成條件**: duplicate/conflicting `kid` or invalid public/private association fails closed, private material never reaches DB/audit/logs, and published/retiring cannot normal-sign; **依賴**: T053; **驗證**: Gateway unit suite.
- [ ] T055 [P] [US5] Add 25-minute retirement-invariant tests in `apps/gateway/test/signing/key-retirement-policy.spec.ts`. **說明**: 5m token + 5m tolerance + 10m cache + 30s cooldown + 1m margin; **輸出**: deterministic eligibility contract; **完成條件**: future config changes require recalculation; **依賴**: T053; **驗證**: unit suite with controlled clock.
- [ ] T056 [P] [US7] Add rotation-audit/redaction and premature-JWK-removal tests in `apps/gateway/test/signing/key-lifecycle-audit.spec.ts`. **說明**: safe event fields and no key reference/private material; **輸出**: audit contract; **完成條件**: still-needed JWK cannot disappear; **依賴**: T053; **驗證**: unit/integration suite.
- [ ] T057 Implement the lifecycle state machine, active-key invariant, and narrow internal-service/controlled-command new signing-key metadata registration in `apps/gateway/src/signing/key-lifecycle.service.ts` and `apps/gateway/src/commands/**`. **說明**: explicit transitions only; registration persists only `kid`, public JWK, non-secret key reference, `status=new`, and lifecycle metadata from a validated provider handle; no public admin API and no private key persistence. **輸出**: transition and controlled provisioning service; **完成條件**: T054 passes and duplicate/conflicting key registration fails closed without private material in DB/audit/logs; **依賴**: T054, T055; **驗證**: lifecycle tests.
- [ ] T058 Implement JWKS propagation proof, activation, and previous-active-to-retiring operation in `apps/gateway/src/signing/key-rotation.service.ts`. **說明**: no normal new-key signing before publication/proof; **輸出**: safe activation flow; **完成條件**: T054 passes; **依賴**: T057; **驗證**: lifecycle/JWKS tests.
- [ ] T059 Implement retirement eligibility, retire, and rollback-to-prior-active operations in `apps/gateway/src/signing/key-rotation.service.ts`. **說明**: enforce overlap and failed-rollout recovery; **輸出**: safe retirement flow; **完成條件**: T055–T056 pass; **依賴**: T058; **驗證**: rotation tests.
- [ ] T060 Wire lifecycle Gateway identity audit and redaction in `apps/gateway/src/{signing/**,audit/**,observability/**}`. **說明**: audit security outcomes only; **輸出**: redacted lifecycle telemetry; **完成條件**: T056 passes; **依賴**: T059; **驗證**: audit tests.
- [ ] T061 Run key lifecycle integration, old-token verification, unknown-kid, and affected Feature 002 Remote-JWKS/redaction regressions. **說明**: verify rotation compatibility; **輸出**: evidence; **完成條件**: all selected suites green; **依賴**: T060; **驗證**: Gateway/Backend focused suites.
- [ ] T062 Complete the Phase-6 checkpoint evidence. **說明**: record results/skips/blockers; **輸出**: accepted rotation contract; **完成條件**: T061 green; **依賴**: T061; **驗證**: checkpoint review.

**Checkpoint**: rotation and controlled operational new-key metadata registration are independently accepted. Phase 7 may proceed separately after T053 and never depends on T054–T062.

---

## Phase 7 — Narrow Gateway-to-Backend Transport

- [ ] T063 [US6] Add the route compatibility guard in `apps/gateway/test/backend-client/backend-route-definition.contract.spec.ts`. **說明**: lock `POST /api/v1/assistant/sessions` and `POST /api/v1/assistant/sessions/:id/messages` to `AssistantController`, `main.ts`, and existing contract/E2E surface; **輸出**: failing mapping contract; **完成條件**: method/prefix/path/`:id` drift fails; **依賴**: T053; **驗證**: Gateway contract/static suite.
- [ ] T064 [P] [US6] Add GatewayBackendClient JSON/SSE transport failing tests in `apps/gateway/test/backend-client/gateway-backend-client.spec.ts`. **說明**: fresh token, approved body/query/headers, timeout, streaming/no buffer/no retry; **輸出**: transport contract; **完成條件**: no arbitrary route/destination; **依賴**: T053; **驗證**: Gateway unit/integration suite.
- [ ] T065 [P] [US7] Add inbound stripping/internal-token non-exposure tests in `apps/gateway/test/backend-client/gateway-backend-client-security.spec.ts`. **說明**: remove Authorization/cookies/public identity/routing headers; **輸出**: transport security contract; **完成條件**: JWT never reaches output/log/audit/error; **依賴**: T053; **驗證**: unit/logger suite.
- [ ] T066 Implement server-owned `BackendRouteDefinition` catalogue in `apps/gateway/src/backend-client/backend-route-definition.ts`. **說明**: logical create-session/send-stream-message only; **輸出**: fixed allowlist; **完成條件**: T063 passes and no second route vocabulary/catch-all; **依賴**: T063; **驗證**: route compatibility test.
- [ ] T067 Implement `GatewayBackendClient` in `apps/gateway/src/backend-client/gateway-backend-client.service.ts`. **說明**: fixed Backend base URL, fresh active-key token, safe forwarding/stripping/timeouts/SSE; **輸出**: narrow client; **完成條件**: T064–T065 pass; **依賴**: T064–T066; **驗證**: client tests.
- [ ] T068 Implement Gateway trust-chain operation handlers in `apps/gateway/src/backend-client/**` and `apps/gateway/src/gateway.module.ts`. **說明**: for each server-owned operation, consume external/Host Authorization through `UpstreamTokenVerifier` → `VerifiedUpstreamIdentity` → `CanonicalIdentityResolver` → IntegrationBinding/Customer validation → `CanonicalGatewayIdentity` → `GatewayBackendClient` → one fresh internal JWT → known protected Backend route; the client never reparses external identity. When building the Backend request, remove external Authorization, cookies, and public identity/routing headers, inject exactly one fresh internal Bearer token, and never return either internal token or upstream credential. **輸出**: no transparent proxy endpoint or second route vocabulary; **完成條件**: invalid auth reaches no resolver/business work, invalid binding produces no internal token/Backend call, valid input makes exactly one known Backend call, and callers cannot choose Backend destination; **依賴**: T042, T067; **驗證**: transport integration tests.
- [ ] T069 Run route/client tests and affected Feature 002 protected-session/SSE, header non-authority, A/B safe-not-found/no-side-effect, audit, and redaction regressions. **說明**: validate adaptation to Backend; **輸出**: evidence; **完成條件**: all selected suites green; **依賴**: T068; **驗證**: focused Gateway/Backend suites.
- [ ] T070 Complete the Phase-7 checkpoint evidence. **說明**: record results/skips/blockers; **輸出**: accepted narrow transport; **完成條件**: T069 green; **依賴**: T069; **驗證**: checkpoint review.

**Checkpoint**: a narrow allowlisted transport exists. It depends only on Phase 5; Phase 8 waits for both T062 and T070.

---

## Phase 8 — Real Gateway-to-Backend Integration and Security Evidence

- [ ] T071 [US6] Add the shared real trust-chain E2E harness and happy-path foundation in `test/e2e/gateway-backend-trust-chain.e2e-spec.ts` with the sole ephemeral upstream test authority in `test/support/gateway-upstream-test-authority.ts`. **說明**: generate a temporary RSA upstream key, issue real RS256 upstream JWTs, serve a real local HTTP upstream JWKS endpoint, configure Gateway upstream issuer/audience/JWKS, and support real Gateway and Backend runtime startup; exercise upstream Remote-JWKS verification, PostgreSQL binding, Gateway signer/JWKS, Backend Remote-JWKS, and a protected route. **輸出**: shared no-mock acceptance harness; **完成條件**: happy E2E neither mocks `UpstreamTokenVerifier` nor injects `VerifiedUpstreamIdentity` nor bypasses upstream signature verification; ephemeral upstream material is never committed and cannot replace the Gateway internal signer/JWKS or Backend Remote-JWKS; **依賴**: T062, T070; **驗證**: planned full-access local E2E command.
- [ ] T072 [P] [US1] Add real A/B binding-isolation E2E cases in `test/e2e/gateway-customer-isolation.e2e-spec.ts`. **說明**: reuse the T071 shared harness and sole upstream authority for Customer A/Integration A and Customer B/Integration B with shared lower identity; do not create a second upstream authority. **輸出**: cross-Customer proof; **完成條件**: neither obtains the other identity; **依賴**: T071; **驗證**: real local E2E.
- [ ] T073 [P] [US3] Add real negative upstream/internal-token E2E cases in `test/e2e/gateway-identity-negative.e2e-spec.ts`. **說明**: reuse the T071 upstream authority for wrong issuer/audience/expired-token cases and use a separate ephemeral attacker key only for invalid upstream signature, alongside kid/binding/HostApp/header conflicts. **輸出**: fail-before-business proof; **完成條件**: no disclosed binding or side effect, no committed private key, and neither authority substitutes for the Gateway internal signer/JWKS or Backend Remote-JWKS; **依賴**: T071; **驗證**: real local E2E.
- [ ] T074 [P] [US7] Add end-to-end token/key leakage scan in `test/e2e/gateway-identity-redaction.e2e-spec.ts`. **說明**: reuse the T071 real Gateway→JWKS→Backend runtime harness for response/SSE/cookie/redirect/Gateway+Backend logs/audit/errors/artifacts; do not create a fake Gateway runtime. **輸出**: non-exposure contract; **完成條件**: no raw internal JWT/private material; **依賴**: T071; **驗證**: E2E/security scan.
- [ ] T075 Execute the real Gateway→JWKS→Backend E2E suites and full affected Feature 002 identity/Customer/RAG/tool/workflow/audit/SSE/logger regression. **說明**: vertical acceptance; **輸出**: execution evidence; **完成條件**: T071–T074 green with no mocks at trust boundary; **依賴**: T071–T074; **驗證**: sandbox-external/local listener command as needed.
- [ ] T076 Complete the Phase-8 checkpoint evidence. **說明**: record real-runtime commands/results/counts/skips/blockers; **輸出**: local trust-chain VERIFIED evidence; **完成條件**: T075 green; **依賴**: T075; **驗證**: checkpoint review.

**Checkpoint**: real local Gateway → HTTP JWKS → unchanged Backend Remote-JWKS → protected Backend route is verified; rollout is not automatically READY.

---

## Phase 9 — Production Readiness and Final Regression

- [ ] T077 Create the validation-command preflight in `specs/003-identity-gateway-customer-registry/production-readiness.md`. **說明**: enumerate actual scripts, DB target/guards, ports, Gateway/Backend config, key file, upstream-JWKS authority, Prisma generation, env prerequisites; **輸出**: executable validation prerequisites; **完成條件**: no nonexistent command is claimed current; **依賴**: T076; **驗證**: read-only script/config inspection.
- [ ] T078 Run full Gateway and Backend unit/integration regression, including Feature 002 identity/Customer/RAG/tool/workflow/audit/redaction suites. **說明**: cross-cutting regression; **輸出**: pass/fail/count/skip log; **完成條件**: failures classified and resolved within scope; **依賴**: T077; **驗證**: actual scripts finalized by Phase 1.
- [ ] T079 Run full contract and real E2E/security regression. **說明**: verify HTTP/SSE/identity trust chain and leakage behavior; **輸出**: pass/fail/count/skip log; **完成條件**: no required skip or mocked core E2E evidence; **依賴**: T078; **驗證**: contract/E2E commands.
- [ ] T080 Run Gateway/Backend build, typecheck, lint, root Prisma validate/generate, and migration-history verification. **說明**: static/delivery gate; **輸出**: generated-diff and migration evidence; **完成條件**: no schema split brain; **依賴**: T079; **驗證**: actual build/lint/Prisma commands.
- [ ] T081 Verify controlled provisioning and seed repeatability against the safe test database. **說明**: repeat A/B bindings without Customer inference or duplicates; **輸出**: deterministic snapshot evidence; **完成條件**: no production mapping assumption; **依賴**: T080; **驗證**: guarded DB commands.
- [ ] T082 Verify Gateway/Backend bootstrap, public JWKS reachability, issuer/audience/time alignment, and rotation evidence in the production-like local environment. **說明**: operational trust-chain check; **輸出**: runtime/config evidence; **完成條件**: no secret values reported; **依賴**: T081; **驗證**: bounded local smoke and JWKS checks.
- [ ] T083 Build the FR-001–FR-027, SC-001–SC-013, and US1–US7 evidence matrix in `specs/003-identity-gateway-customer-registry/production-readiness.md`. **說明**: map requirement, evidence, test/command, result, remaining gap; **輸出**: complete traceability matrix; **完成條件**: every row has evidence or explicit blocker; **依賴**: T078–T082; **驗證**: matrix completeness review.
- [ ] T084 Finalize Feature 003 production-readiness decision in `specs/003-identity-gateway-customer-registry/production-readiness.md`. **說明**: separately state Implementation COMPLETE/INCOMPLETE, Verification COMPLETE/INCOMPLETE, rollout READY/BLOCKED; **輸出**: evidence-based readiness report; **完成條件**: tests alone never imply READY; **依賴**: T083; **驗證**: readiness review against spec FR-025/FR-027 and SC-012/SC-013.
- [ ] T085 Complete the Phase-9 final checkpoint evidence and run `git diff --check`, `git status --short`, and `git diff --stat`. **說明**: handoff without commit/push; **輸出**: final files/commands/results/counts/skips/blockers report; **完成條件**: T084 completed and no unclassified required validation gap; **依賴**: T084; **驗證**: final repository checks.

**Checkpoint**: implementation and verification status are evidence-based; production rollout is READY only if every required runtime and deployment identity condition is proven, otherwise BLOCKED.

---

## Requirement Traceability

| Requirement coverage | Tasks |
| --- | --- |
| US1 — trusted Integration to Customer | T017, T020, T025, T036–T042, T072 |
| US2 — canonical internal JWT | T043, T047, T050–T053, T068, T071 |
| US3 — unauthorized issuance denial | T028–T035, T036–T041, T073 |
| US4 — public verification keys | T018, T044, T048–T051, T071 |
| US5 — safe key rotation and controlled new-key registration | T054–T062, T082 |
| US6 — real Gateway-to-Backend integration | T063–T076 (T068 orchestration; T071 real upstream authority) |
| US7 — token/key/metadata protection | T004, T018, T030, T045, T056, T065, T074, T077–T085 |
| FR-001–FR-003 | T017, T019, T021, T024–T025, T036–T042 |
| FR-004–FR-006 | T028–T035, T036–T041 |
| FR-007–FR-014 | T043–T053 |
| FR-015–FR-017 | T044, T048–T062, T071, T073 |
| FR-018–FR-019 | T071–T076, T082 |
| FR-020–FR-021 | T002, T029, T037, T063–T075 |
| FR-022–FR-023 | T004, T018, T030, T045, T056, T065, T074, T078–T085 |
| FR-024 | T003, T017–T025 |
| FR-025 | T083–T085 |
| FR-026 | T004, T043, T050, T063–T075 |
| FR-027 | T008, T031, T077, T082–T085 |
| SC-001–SC-006 | T043–T053, T071 |
| SC-007–SC-008 | T054–T062, T071–T076 |
| SC-009–SC-010 | T002–T004, T030, T045, T056, T065, T074, T078–T085 |
| SC-011 | T071–T076, T082 |
| SC-012–SC-013 | T077, T082–T085 |

## Parallel Opportunities

- T002–T004 may run in parallel after T001 because they edit separate identity/architecture/redaction test surfaces.
- T007–T009 may run in parallel after T006: T008 alone owns the minimal Gateway-local manifest/test runner, while T007 and T009 use distinct root test files and do not depend on that harness.
- T017–T020 may run in parallel after T016 because binding, key/audit, provisioning, and fixtures are separate failing-test contracts.
- T029–T030, T037, T044–T045, T055–T056, and T064–T065 are parallel only after their listed shared checkpoint. T072–T074 are parallel only after T071 because they edit distinct E2E test surfaces while consuming its shared real trust-chain/upstream-authority harness.
- No failing-test task is parallel with its implementing task. Phase 6 and Phase 7 are parallel streams only after T053; T071–T076 wait for both T062 and T070.

## Implementation Strategy

1. Stop after every Phase checkpoint; report evidence before starting the next dependency gate.
2. The first independently demonstrable vertical value is explicit A/B binding and canonical identity through T042; issuance follows only after this boundary is secure.
3. Real local trust-chain proof is exclusively Phase 8. Static verifier fixtures, mock signers, and isolated JWKS tests do not satisfy it.
4. Feature 002 remains the sole Backend verification, CustomerScope, business authorization, RAG/tool/workflow/feedback/review, and business-audit authority throughout.
