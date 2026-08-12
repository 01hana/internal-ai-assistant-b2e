# Feature 003 Production Readiness

## 1. Current Status

- Implementation through Phase 8: **COMPLETE**.
- Local Gateway-to-Backend trust-chain verification: **VERIFIED**.
- Phase 9 validation: **COMPLETE**.
- Production readiness: **ASSESSED**.
- Implementation: **INCOMPLETE**.
- Verification: **INCOMPLETE**.
- Rollout: **BLOCKED**.

This final assessment records repository-supported evidence and the explicit decision. It does not treat local Phase 8 fixtures as deployment evidence.

## 2. Validation Environment Safety

`npm run test:db:init` and any DB-backed suite must run only when `NODE_ENV=test`, `ALLOW_TEST_DB_RESET=true`, and `DATABASE_URL` names `assistant_test` or another database ending in `_test`. The existing reset helper rejects other targets; production and staging databases are prohibited.

Gateway registry and Phase 8 helpers create disposable `_test` databases, apply the canonical root migration lineage, and remove them during disposal. Local listener suites require loopback binding and must retain real Gateway, Backend, and JWKS paths rather than substitute a verifier or inject an identity. Temporary RSA material is runtime-only, uses permission-restricted temporary files where a file provider is exercised, and is disposed after each test.

## 3. Actual Repository Commands

All commands below are defined in the root or Gateway manifest as of this preflight.

| Category | Command | Purpose |
| --- | --- | --- |
| Feature build | `npm run build:feature003` | Build pure identity contract, generate Prisma clients, build Backend, then build Gateway. |
| Backend build | `npm run build` | Nest Backend build. |
| Gateway build | `npm run build:gateway` | Independent Gateway Nest build. |
| Contract build | `npm run build:identity-contract` | Build the local pure identity-contract package. |
| Typecheck | `npm run typecheck` | Root TypeScript no-emit check. |
| Lint | `npm run lint` | Root ESLint command. |
| Root unit | `npm run test:unit` | Root unit-test match. |
| Root integration | `npm run test:integration` | Root integration-test match. |
| Root contract | `npm run test:contract` | Root contract-test match. |
| Root E2E | `npm run test:e2e` | Root E2E-test match. |
| Root eval | `npm run test:eval` | Root eval-test match. |
| Gateway suite | `npm --prefix apps/gateway run test:unit` | Complete Gateway test suite; no separate Gateway integration script exists. |
| Prisma validate/generate | `npx prisma validate`; `npm run prisma:generate` | Root canonical schema validation and generation. |
| Prisma deployment/migration | `npm run prisma:deploy`; `npm run prisma:migrate` | Existing deployment or development migration commands; later Phase 9 tasks choose only safe use. |
| Test DB reset/seed | `npm run test:db:init` | Guarded test-only reset and deterministic seed. |
| Seed | `npm run prisma:seed` | Existing root seed command. |

No aggregate `test:production-readiness` command exists. T078 completed guarded Gateway/root unit/integration regression; T079 completed contract, real E2E/security, and eval dynamic validation; T080 completed static/build/lint/Prisma/migration-history validation; T081 completed provisioning repeatability; T082 completed production-like runtime evidence; T083 completed the requirement evidence matrix; T084 completed the final readiness decision; and T085 completed the final repository checkpoint. Phase 9 is complete and the rollout decision is BLOCKED.

For root DB-backed Jest suites, load `.env.test` with override semantics before launching Jest so an inherited development `DATABASE_URL` cannot win. The verified pattern is `node -e` loading `dotenv` with `{ path: '.env.test', override: true }` and spawning the installed Jest binary with the required `RUN_*` guards. A plain root npm test script does not itself load `.env.test` for every integration suite.

## 4. Guarded Test Environment Variables

| Guard | Covered validation | Dependency |
| --- | --- | --- |
| `RUN_GATEWAY_REGISTRY_DB_TESTS=true` | Gateway registry persistence, local signing/JWKS integration, and binding seed/isolation suites | Safe DB and, where applicable, loopback listener. |
| `RUN_DB_BACKED_US1_TESTS=true` | DB-backed Customer US1 support | Safe test DB. |
| `RUN_CUSTOMER_US1_TESTS=true` | Customer sessions, SSE, message history, and isolation contracts/integrations | Safe test DB and listener where applicable. |
| `RUN_CUSTOMER_US2_TESTS=true` | Customer RAG, knowledge, retrieval, and evidence isolation | Safe test DB. |
| `RUN_CUSTOMER_US3_TESTS=true` | Customer tool policy, permission, and idempotency isolation | Safe test DB. |
| `RUN_CUSTOMER_MIGRATION_PREFLIGHT_CONTRACT_TESTS=true` | Customer migration preflight integration coverage | Disposable guarded test DB. |
| `RUN_CUSTOMER_PERSISTENCE_CONTRACT_TESTS=true` | Customer persistence constraints | Safe test DB. |
| `RUN_DB_BACKED_CUSTOMER_SEED_TESTS=true` | Deterministic Customer seed checks | Safe test DB. |
| `RUN_DB_BACKED_CUSTOMER_PERSISTENCE_TESTS=true` | DB-backed Customer persistence checks | Safe test DB. |
| `ALLOW_TEST_DB_RESET=true` | Enables the existing reset safety guard only with `NODE_ENV=test` | Required for reset/seed; never use outside test. |

## 5. Gateway Runtime Configuration

Gateway configuration is fail-closed and requires these names: `GATEWAY_INTERNAL_JWT_ISSUER`, `GATEWAY_INTERNAL_JWT_AUDIENCE`, `GATEWAY_PUBLIC_JWKS_URL`, `GATEWAY_UPSTREAM_JWT_ISSUER`, `GATEWAY_UPSTREAM_JWT_AUDIENCE`, `GATEWAY_UPSTREAM_JWKS_URI`, `GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS`, `GATEWAY_INTERNAL_JWT_TTL_SECONDS`, `GATEWAY_BACKEND_BASE_URL`, `GATEWAY_SIGNING_KEY_REFERENCE`, and `GATEWAY_PORT`.

The internal token TTL is fixed at 300 seconds; upstream tolerance is bounded at 300 seconds. The signing-key value is an opaque reference, not raw key material. Gateway owns the fixed Host operations and public `/.well-known/jwks.json` endpoint; it is independently bootstrapped and uses its generated Prisma client.

## 6. Backend Runtime Configuration

Backend configuration requires `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY`, `INTERNAL_IDENTITY_JWT_ISSUER`, `INTERNAL_IDENTITY_JWT_AUDIENCE`, `INTERNAL_IDENTITY_JWKS_URI`, and optional bounded `INTERNAL_IDENTITY_JWT_CLOCK_TOLERANCE_SECONDS`. The Backend protects its `api/v1` assistant routes with the existing Remote-JWKS identity verifier, canonical identity validation, `RequestIdentityContext`, and `CustomerScope`.

Backend clock tolerance is bounded at 300 seconds. Remote-JWKS cache/cooldown behavior remains the verifier/library behavior validated by the Feature 003 lifecycle tests; no separate environment override exists in the current Backend runtime configuration.

## 7. Cross-Service Alignment Requirements

- Gateway internal issuer must exactly equal Backend expected internal issuer.
- Gateway internal audience must exactly equal Backend expected internal audience.
- Backend internal JWKS URI must reach Gateway `/.well-known/jwks.json` and receive public-only keys.
- Gateway Backend base URL must reach the actual Backend listener.
- Gateway upstream issuer, audience, and JWKS URI must point to the configured trusted upstream authority.
- Gateway and Backend clocks plus configured tolerances must remain coherent with the five-minute token lifetime and rotation overlap policy.

No deployment hostname, credential, key value, or provider implementation is asserted by this preflight.

## 8. Signing-Key and Upstream Preconditions

Gateway signing metadata must contain only public JWK data and an opaque reference; private material must not enter Prisma, audit, logs, responses, or JWKS. Normal issuance requires exactly one valid active key. Public JWKS may expose only published, active, and retiring public keys. Local file references require a readable, permission-restricted private RSA signing file; provider references fail closed without an adapter.

The lifecycle is `new → published → active → retiring → retired`, with published-before-active, active-only normal signing, propagation proof, and enforced 25-minute retirement overlap. T082 completed local compiled-process evidence and exposed that production operational activation remains fail-closed without a real propagation verifier and lifecycle/rotation DI wiring. T084 classified this as open GAP-001; rollout is BLOCKED.

The upstream authority must provide RS256 tokens, exact issuer/audience, a reachable public JWKS, a protected non-blank `kid`, and valid time claims. The Phase 8 ephemeral authority is local test infrastructure only, not a production IdP.

## 9. Prisma and Migration Preconditions

`prisma/schema.prisma` and `prisma/migrations/` remain the sole schema and migration lineage. Root generation emits both Backend and Gateway clients. The Feature 003 additive migration is `20260809000000_feature003_gateway_registry`; it contains the registry, signing-key metadata, and Gateway identity-audit persistence. T080 validated the root Prisma schema, root generation of both clients, no unexpected generated drift, migration-history consistency, and the absence of Gateway-local schemas or migration directories. This is local/static validation only and is not production database deployment evidence.

## 10. Phase 9 Execution Plan

| Task | Purpose |
| --- | --- |
| T077 | Record executable preflight, safety, config, and command prerequisites. |
| T078 | Run complete Gateway and affected Backend unit/integration regression. |
| T079 | Run contract, real E2E, and security regression. |
| T080 | Run build, lint, Prisma, and migration-history final gate. |
| T081 | Verify provisioning and seed repeatability. |
| T082 | Verify production-like local bootstrap, alignment, JWKS, and rotation evidence. |
| T083 | Build requirement traceability matrix. |
| T084 | Make evidence-based readiness decision. |
| T085 | Complete final checkpoint and repository handoff checks. |

## Phase 9 Validation Progress

- T077: COMPLETE.
- T078: COMPLETE.
- T079: COMPLETE.
- T080: COMPLETE.
- T081: COMPLETE.
- T082: COMPLETE.
- T083: COMPLETE.
- T084: COMPLETE.
- T085: COMPLETE.

T078 ran the complete Gateway suite (23 suites / 259 tests), complete root unit suite (60 / 280), and complete root integration suite (58 / 263) with all applicable Customer, registry, persistence, migration-preflight, and seed guards enabled. Required skips and test failures were zero on the accepted reruns. DB-backed root Jest invocation must load `.env.test` with override semantics so an inherited development `DATABASE_URL` cannot bypass the test-only target; this is an execution precondition, not a deployment setting. T083 completed the evidence matrix, T084 completed the readiness decision, and T085 completed the final checkpoint: Implementation is INCOMPLETE, Verification is INCOMPLETE, and Rollout is BLOCKED.

### T079 Dynamic Validation Summary

All T079 dynamic validation ran with `.env.test` loaded using `override: true`, `NODE_ENV=test`, and `ALLOW_TEST_DB_RESET=true`; the effective database target was confirmed as `assistant_test` before DB/listener batches. The full contract match with `RUN_CUSTOMER_US1_TESTS=true` passed at 13 suites / 83 tests, the full real E2E match with `RUN_CUSTOMER_US1_E2E_TESTS=true` passed at 6 / 29, and the full eval match with `RUN_CUSTOMER_US2_TESTS=true` passed at 2 / 13. Focused Gateway SSE/client/security/redaction/JWKS validation passed at 6 / 93. Required skips: 0; failures: 0; no trust-boundary mock or direct identity injection was accepted. The non-failing existing `ts-jest` local-package transform warning is not a skip. Final readiness is assessed in Section 14; rollout is BLOCKED.

### T080 Static / Prisma Validation Summary

The only T080 blocker was ESLint's missing CommonJS/Node environment for `apps/gateway/jest.config.cjs`: `module` triggered `no-undef`. The bounded ESLint 9 flat-config `**/*.cjs` override uses CommonJS source type and Node globals, without ignoring Gateway source or changing Jest semantics. Full lint, typecheck, Feature 003 build, Gateway config/health smoke, and architecture/package guards are GREEN. `npx prisma validate` and root `prisma:generate` confirm that the root schema generates both clients, and pre/post targeted diffs show no new generated drift. The root-only Feature 003 migration contains the registry models, restrictive Customer FKs, and active-key partial unique index; Gateway has no local schema/migration lineage. Artifact scan and `git diff --check` are clean. Blockers: none for T081 execution; final readiness is assessed in Section 14 and rollout is BLOCKED.

### T081 Provisioning Repeatability Summary

With `.env.test` override, `NODE_ENV=test`, and `ALLOW_TEST_DB_RESET=true`, the effective database was `assistant_test`. Guarded reset/init, no-reset seed rerun, and a second reset/init produced the same bounded synthetic A/B binding state: Integration A maps only to Customer A and Integration B only to Customer B, with `admin` and enabled state retained. A seed conflict previously could overwrite an explicit binding; it now rejects Customer/HostApp conflicts without rebind or Customer inference. Focused provisioning/seed/persistence coverage passed with no required skips or failures. These are synthetic readiness fixtures only and do not establish a production mapping.

### T082 Production-like Runtime Summary

Actual compiled Gateway and Backend child processes booted against a disposable local `_test` database with aligned localhost issuer, audience, JWKS, and Backend URLs. Gateway health, Backend health, and Gateway public JWKS were reachable; controlled file-backed registration/publish exposed only a public JWK. Gateway readiness correctly remains `not_ready` / `productionReady: false`. Current production operational activation is fail-closed because no real propagation verifier or lifecycle/rotation DI wiring is available; no direct active-row insert or test verifier was used. A valid upstream token therefore reached the signing boundary and received a safe 503 without Backend session creation, while an expired token was rejected with 401. The missing Gateway runtime environment template is a non-gating operational note; T084 classified the real propagation/activation wiring gap as GAP-001, and rollout is BLOCKED.

## 11. Requirement Evidence Matrix

The authoritative requirement wording is Feature 003 `spec.md`. The matrix separates implementation state from evidence level: Phase 8 proves a real local trust chain; T082 proves compiled-process bootstrap and exposes an operational activation boundary. It does not make a readiness decision.

| ID | Requirement | Implementation Status | Implementation Evidence | Verification Evidence | Verification Level | Remaining Gap | Readiness Relevance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US1 | Valid trusted Integration context resolves only its explicit Customer binding and allowed HostApp. | IMPLEMENTED | `IntegrationBinding`, `CanonicalIdentityResolver`, canonical composer. | T072 real A/B isolation; T073 binding denials; T081 repeatability. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / SECURITY |
| US2 | Gateway issues and attaches a canonical internal JWT only after trusted verification and explicit resolution. | IMPLEMENTED | `InternalIdentityTokenIssuer`, `GatewayBackendClient`, fixed handler. | T071 real protected create-session; T050 Backend verifier contract. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / SECURITY / RUNTIME |
| US3 | Unauthorized or misconfigured integration cannot obtain another Customer or elevated identity. | IMPLEMENTED | upstream verifier, resolver fail-closed errors, fixed handler stop paths. | T073 real negative matrix; T074 safe error scan. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / SECURITY |
| US4 | Backend obtains the Gateway public key needed to verify a genuine issued token. | IMPLEMENTED | `JwksService`, `JwksController`, signing-key repository. | T061 real Remote-JWKS rotation integration; T071 real chain. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / RUNTIME |
| US5 | Operator can introduce and retire signing keys without silently breaking valid-token verification. | PARTIAL | lifecycle, rotation, retirement-policy, and signing-key repository services. | T061 real local Remote-JWKS rotation/rollback integration; T082 fail-closed compiled-process activation. | PARTIALLY_VERIFIED | GAP-001 | SECURITY / RUNTIME / DEPLOYMENT |
| US6 | A real Gateway runtime calls a protected Backend endpoint with its own issued token. | IMPLEMENTED | Gateway ingress, trust-chain handler, fixed Backend client, issuer, JWKS. | T071 real no-mock Gateway-to-Backend E2E. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / RUNTIME |
| US7 | Security investigation retains safe traceability without exposing token or key material. | IMPLEMENTED | centralized redaction, Gateway audit writer, safe transport errors. | T074 real leakage scan; T079 dynamic security; T082 safe process scan. | VERIFIED_REAL_E2E | NONE | SECURITY |
| FR-001 | MUST maintain one stable explicit, verifiable Integration binding to one existing Customer root. | IMPLEMENTED | root Prisma `IntegrationBinding` with restrictive Customer FK; repository/provisioning command. | binding persistence/provisioning DB suites; T081 snapshots. | VERIFIED_INTEGRATION | NONE | FEATURE_ACCEPTANCE / SECURITY |
| FR-002 | Binding MUST record allowed HostApp and enabled/disabled trust state. | IMPLEMENTED | `IntegrationBinding.allowedHostApp` and `enabled`; controlled provisioning. | binding DB suites; T073 disabled/HostApp mismatch cases; T081 HostApp conflict. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / SECURITY |
| FR-003 | MUST resolve `customer_id` only from explicit binding and MUST NOT infer it from identity, request, content, or metadata. | IMPLEMENTED | `CanonicalIdentityResolver` and canonical composer. | T072 real A/B; T073 conflicts; T081 no-inference seed proof. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / SECURITY |
| FR-004 | MUST derive `sub`, `org_id`, `host_app`, roles, and scopes only from trusted upstream identity or approved integration authority. | IMPLEMENTED | RS256 upstream verifier and canonical composer. | upstream identity contracts; T071/T073 real upstream-JWKS cases. | VERIFIED_REAL_E2E | NONE | SECURITY |
| FR-005 | Unknown, disabled, unbound, Customer/HostApp-mismatched, or invalid-upstream requests MUST fail closed before signing or protected work. | IMPLEMENTED | verifier, resolver, handler stop paths, ingress error projection. | T073 negative E2E and unchanged-session proof. | VERIFIED_REAL_E2E | NONE | SECURITY / RUNTIME |
| FR-006 | Safe issuance failures MUST NOT disclose Customer, integration, binding, or credential detail. | IMPLEMENTED | safe upstream/resolution errors and controller projection. | T073 negative E2E; T074 response/error scan. | VERIFIED_REAL_E2E | NONE | SECURITY |
| FR-007 | MUST issue every canonical application claim without changing Feature 002 semantics. | IMPLEMENTED | `InternalIdentityTokenIssuer`; pure internal identity contract package. | issuer contract; T050 unchanged Backend validation. | VERIFIED_CONTRACT | NONE | FEATURE_ACCEPTANCE / SECURITY |
| FR-008 | Canonical strings MUST be non-blank; roles/scopes MUST be non-blank-string arrays and MAY be empty. | IMPLEMENTED | upstream claim parser and issuer input types. | upstream-identity and issuer contracts; T050 empty-array compatibility. | VERIFIED_CONTRACT | NONE | SECURITY |
| FR-009 | Gateway MUST generate `jti`; client input MUST NOT determine it. | IMPLEMENTED | `InternalIdentityTokenIssuer` UUID generation. | issuer contract and T050 Gateway-token compatibility. | VERIFIED_CONTRACT | NONE | SECURITY |
| FR-010 | Tokens MUST contain `iss`, `aud`, `iat`, `exp`; optional `nbf` MUST satisfy Backend validation. | IMPLEMENTED | issuer config and strict Backend-compatible token construction. | issuer contract; T050/T061 verifier integration. | VERIFIED_INTEGRATION | NONE | SECURITY / RUNTIME |
| FR-011 | Tokens MUST use RS256 and non-blank `kid`; unsafe algorithms and shared plaintext production secrets are prohibited. | IMPLEMENTED | `SigningKeyProvider`, active-key resolver, RS256 issuer/config validation. | provider/issuer/JWKS contracts; T061 real key/JWKS integration. | VERIFIED_INTEGRATION | NONE | SECURITY |
| FR-012 | Gateway issuer and audience MUST exactly align with Backend internal JWT configuration for each deployed environment. | DEPLOYMENT_INPUT | Gateway and Backend configuration services. | T071 real local alignment; T082 compiled-process localhost alignment. | PARTIALLY_VERIFIED | GAP-002 | RUNTIME / DEPLOYMENT |
| FR-013 | MUST publish a Backend-reachable public JWKS containing only required public fields for active verification keys. | IMPLEMENTED | `JwksService` and unauthenticated `JwksController`. | JWKS endpoint contract; T061 and T071 real HTTP JWKS. | VERIFIED_REAL_E2E | NONE | RUNTIME / SECURITY |
| FR-014 | JWKS and every public output MUST exclude private signing material. | IMPLEMENTED | strict JWKS projection; centralized redaction and safe errors. | T074 real public-output scan; T079 dynamic security. | VERIFIED_REAL_E2E | NONE | SECURITY |
| FR-015 | MUST publish a new public key before issuing tokens with its new `kid`. | PARTIAL | lifecycle state machine and `KeyRotationService`. | T061 local published-before-active and Backend acceptance proof. | PARTIALLY_VERIFIED | GAP-001 | SECURITY / RUNTIME / DEPLOYMENT |
| FR-016 | Retirement policy MUST prevent silent invalidation and define rollback-safe failed-rollout handling. | PARTIAL | retirement policy and rotation rollback services. | T061 deterministic overlap/rollback/Remote-JWKS integration. | PARTIALLY_VERIFIED | GAP-001 | SECURITY / RUNTIME / DEPLOYMENT |
| FR-017 | Unknown `kid`, invalid signature, issuer/audience, and invalid time claims MUST fail closed at Backend boundary. | IMPLEMENTED | unchanged Feature 002 Remote-JWKS verifier; Gateway upstream verifier. | T050/T061 verifier negatives; T073 real negative E2E. | VERIFIED_REAL_E2E | NONE | SECURITY / RUNTIME |
| FR-018 | Gateway MUST provide a local development path proving start, JWKS reachability, issuance, Backend acceptance, and negative rejection. | IMPLEMENTED | Gateway bootstrap, JWKS, fixed ingress, local test harness. | T071/T073 real local E2E; T082 compiled-process bootstrap/negative checks. | VERIFIED_REAL_E2E | NONE | RUNTIME |
| FR-019 | Completion MUST include a real Gateway-issued token accepted by protected Backend Remote-JWKS verification; fixtures/mocks alone are insufficient. | IMPLEMENTED | issuer, public JWKS, fixed Backend client, protected ingress. | T071 real no-mock protected Backend success; T061 real Remote-JWKS integration. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / RUNTIME |
| FR-020 | Integration A MUST NOT obtain Customer B token when lower identity is identical. | IMPLEMENTED | explicit binding resolver and immutable canonical identity. | T072 real A/B E2E with matching lower identity. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / SECURITY |
| FR-021 | Public headers/body/page/metadata/capability values MUST NOT establish, supplement, override, or elevate canonical identity. | IMPLEMENTED | verifier/resolver input boundaries; fixed controller/client envelopes. | T002/T029 public-input contracts; T073 header-conflict E2E. | VERIFIED_CONTRACT | NONE | SECURITY |
| FR-022 | MUST redact Authorization, tokens, signatures, private keys/JWKs, credentials, secrets, and API keys from all listed surfaces. | IMPLEMENTED | centralized redactor; safe errors; JWKS serializer; transport boundary. | T074 broad real leakage scan; T079; T082 label-only process scan. | VERIFIED_REAL_E2E | NONE | SECURITY |
| FR-023 | Audit-safe issuance and rotation records MUST retain only approved traceability and safe reasons. | IMPLEMENTED | `GatewayIdentityAuditWriter`, lifecycle/rotation audit paths. | audit-redaction and lifecycle audit contracts; T074 actual audit scan. | VERIFIED_INTEGRATION | NONE | SECURITY |
| FR-024 | MUST reuse Feature 002 Customer root and MUST NOT create another Customer authority/lifecycle/replacement context. | IMPLEMENTED | root Prisma relation; Gateway architecture boundary; resolver. | Feature 003 architecture/package guards; root schema inspection. | VERIFIED_STATIC | NONE | FEATURE_ACCEPTANCE / SECURITY |
| FR-025 | Production rollout MUST remain withheld until all Feature 003 readiness requirements have real runtime evidence. | DEPLOYMENT_INPUT | readiness documentation and explicit non-ready runtime state. | T082 observes `productionReady: false`; T083 classifies outstanding evidence. | PARTIALLY_VERIFIED | GAP-001 / GAP-002 / GAP-003 / GAP-004 | ROLLOUT_GATE / DEPLOYMENT |
| FR-026 | Internal JWTs MUST be Gateway-to-Backend credentials only and MUST NOT be exposed as reusable external credentials. | IMPLEMENTED | fixed client, controller, safe transport boundary. | T065 transport security; T071/T074 real response/SSE scan. | VERIFIED_REAL_E2E | NONE | SECURITY / RUNTIME |
| FR-027 | Each production or production-like environment MUST validate aligned configuration, reachable JWKS, safe signing source, and compatible lifetime/time settings. | DEPLOYMENT_INPUT | fail-closed Gateway/Backend config and opaque signing reference boundary. | T082 local compiled-process issuer/audience, JWKS, file-reference, TTL, and tolerance alignment. | PARTIALLY_VERIFIED | GAP-002 / GAP-003 / GAP-004 | DEPLOYMENT / ROLLOUT_GATE |
| SC-001 | 100% of valid issuance tests produce eight canonical claims with valid registered metadata. | IMPLEMENTED | issuer and active-key implementation. | issuer suite; T050 Gateway-token contract. | VERIFIED_CONTRACT | NONE | FEATURE_ACCEPTANCE / SECURITY |
| SC-002 | 100% of A/B isolation tests keep distinct Customer and integration IDs with identical lower identity. | IMPLEMENTED | explicit binding resolver and canonical identity. | T072 real A/B E2E. | VERIFIED_REAL_E2E | NONE | FEATURE_ACCEPTANCE / SECURITY |
| SC-003 | 100% of invalid/unknown/mismatched issuance cases produce no token and no protected work. | IMPLEMENTED | verifier/resolver/handler fail-closed chain. | T073 real negative E2E. | VERIFIED_REAL_E2E | NONE | SECURITY |
| SC-004 | A genuine issued token is accepted by protected Backend through configured public JWKS. | IMPLEMENTED | issuer, JWKS, fixed protected transport. | T071 real protected operation; T061 Remote-JWKS integration. | VERIFIED_REAL_E2E | NONE | RUNTIME |
| SC-005 | 100% of signature, issuer, audience, kid, time, and malformed-token cases fail before protected work. | IMPLEMENTED | strict Gateway/Backend RS256 verifiers. | T073 real negative E2E; T050/T061 verifier negatives. | VERIFIED_REAL_E2E | NONE | SECURITY |
| SC-006 | Every published key has required public metadata and no private RSA material. | IMPLEMENTED | strict public-JWK validation and serializer. | JWKS endpoint contract; T061 and T074 scans. | VERIFIED_INTEGRATION | NONE | SECURITY |
| SC-007 | New-key rollout proves Backend accepts new published `kid` before retiring old key. | IMPLEMENTED | rotation service and active-key resolver. | T061 real local Backend Remote-JWKS rotation integration. | VERIFIED_INTEGRATION | NONE | SECURITY / RUNTIME |
| SC-008 | Rotation verification demonstrates no silent invalidation under retirement policy. | IMPLEMENTED | 1500-second policy and rollback/retirement implementation. | T061 deterministic local overlap and rollback integration. | VERIFIED_INTEGRATION | NONE | SECURITY / RUNTIME |
| SC-009 | Required scans find zero raw Authorization, JWT, signature, or private-key material. | IMPLEMENTED | redactor, safe transport errors, public-only JWKS, audit writer. | T074 real leakage scan; T079 dynamic security; T082 safe process scan. | VERIFIED_REAL_E2E | NONE | SECURITY |
| SC-010 | 100% of conflicting public identity-header tests leave canonical identity unchanged or fail closed. | IMPLEMENTED | strict Gateway/Backend public-input boundaries. | T002/T029 contracts; T073 header-conflict E2E. | VERIFIED_REAL_E2E | NONE | SECURITY |
| SC-011 | Documented local path demonstrates start, JWKS, issuance, Backend acceptance, and negative rejection. | IMPLEMENTED | runtime config, harness, fixed ingress, issuer/JWKS. | T071/T073 E2E and T082 compiled-process evidence. | VERIFIED_REAL_E2E | NONE | RUNTIME |
| SC-012 | Every production or production-like environment proves alignment, reachable JWKS, safe signing source, and compatible timing. | DEPLOYMENT_INPUT | configuration validation and signing-provider boundary. | T082 local compiled-process issuer/audience, JWKS, file-reference, TTL, and tolerance alignment. | PARTIALLY_VERIFIED | GAP-002 / GAP-003 / GAP-004 | DEPLOYMENT / ROLLOUT_GATE |
| SC-013 | READY requires SC-001–SC-012 real runtime and deployment configuration evidence; otherwise rollout remains withheld. | DEPLOYMENT_INPUT | readiness state remains non-ready; no readiness decision implementation is introduced. | T083 matrix records evidence and T082 observes `productionReady: false`. | PARTIALLY_VERIFIED | GAP-001 / GAP-002 / GAP-003 / GAP-004 | ROLLOUT_GATE / DEPLOYMENT |

## 12. Unresolved Evidence Gaps

| Gap ID | Category | Requirement IDs | Currently Proven Boundary | Missing Evidence |
| --- | --- | --- | --- | --- |
| GAP-001 | OPERATIONAL_WIRING_GAP | US5, FR-015, FR-016 | Lifecycle/rotation logic, 25-minute overlap, rollback, HTTP JWKS, and Backend Remote-JWKS compatibility work in local integration. Compiled-process activation fails closed safely. | A production-wired `published → propagation proof → activate` path with a real propagation verifier and lifecycle/rotation DI composition; resulting process-level normal signed issuance. |
| GAP-002 | DEPLOYMENT_EVIDENCE_GAP | FR-012, FR-025, FR-027, SC-012, SC-013 | Exact issuer/audience and Backend-reachable Gateway JWKS are proven on local E2E and localhost compiled processes. | Per-environment Gateway/Backend issuer-audience alignment and Backend-to-Gateway JWKS reachability evidence. |
| GAP-003 | DEPLOYMENT_EVIDENCE_GAP | FR-025, FR-027, SC-012, SC-013 | Local file-backed, permission-restricted signing handles and opaque-reference validation work. | Production signing-key source/custody evidence; no provider/vendor is prescribed. |
| GAP-004 | DEPLOYMENT_EVIDENCE_GAP | FR-025, FR-027, SC-012, SC-013 | The local runtime uses the locked 300-second TTL and bounded compatible tolerance. | Per-environment token-lifetime and time-validation compatibility evidence; no clock mechanism is prescribed. |

## 13. Non-gating Operational Notes

| Note ID | Observation | Why it is not a requirement gap |
| --- | --- | --- |
| NOTE-001 | The repository has no Gateway runtime environment template; current configuration names are documented in source and this preflight. | `spec.md` requires validated environment configuration evidence, not a particular template artifact. |
| NOTE-002 | Production database migration deployment has not been exercised. | `spec.md` does not define production database deployment as a separate Feature 003 readiness criterion; T080 remains delivery evidence for the root schema and migration lineage. |

## 14. Final Production Readiness Decision

### Decision

- Implementation: **INCOMPLETE**.
- Verification: **INCOMPLETE**.
- Rollout: **BLOCKED**.

### Decision Basis

- **FR-025** requires production rollout to remain blocked until all Feature 003 readiness requirements have real runtime evidence. GAP-001 through GAP-004 remain open.
- **FR-027** and **SC-012** require per-environment identity alignment, Backend-reachable Gateway JWKS, safe signing-key source/configuration, and compatible lifetime/time-validation evidence. T082 proves these only in the bounded local compiled-process environment.
- **SC-013** permits READY only after SC-001 through SC-012 have the required real runtime and deployment identity-configuration evidence. That condition is not met.

### Accepted Evidence

T078 completed the guarded unit/integration regression; T079 completed contract, real E2E/security, and eval validation; T080 completed static/build/lint/Prisma delivery validation; T081 completed deterministic binding repeatability; T082 completed bounded compiled-process runtime evidence; and T083 completed the requirement evidence matrix. These results prove the core local trust chain and compatibility boundaries, but do not close the current required gaps.

### Blocking Requirements and Closure Conditions

| Gap ID | Requirement IDs | Why It Prevents Completion | Closure Condition |
| --- | --- | --- | --- |
| GAP-001 | US5, FR-015, FR-016; indirect FR-025 and SC-013 relevance | Required production operational key-rotation behavior is not fully wired: the compiled Gateway fails closed without a real propagation verifier and lifecycle/rotation DI composition. | Gateway production wiring provides a real propagation verifier; controlled lifecycle can publish, prove, and activate; compiled-process normal issuance succeeds after activation; Backend accepts the new token and required overlap remains valid. |
| GAP-002 | FR-012, FR-025, FR-027, SC-012, SC-013 | Localhost alignment does not prove target-environment issuer/audience alignment or deployed Backend-to-Gateway JWKS reachability. | Each target environment supplies exact aligned issuer/audience values and the Backend can reach the deployed Gateway public JWKS. |
| GAP-003 | FR-025, FR-027, SC-012, SC-013 | Local temporary file evidence does not establish the target environment's production-safe signing-key source/custody. | Each target environment provides a production-safe signing-key source/configuration that Gateway can use without exposing private material; no provider vendor is prescribed. |
| GAP-004 | FR-025, FR-027, SC-012, SC-013 | The locked local TTL and tolerance do not establish per-environment time-validation compatibility. | Each target environment proves compatible Gateway/Backend token lifetime and time-validation settings; no clock mechanism is prescribed. |

### Non-blocking Notes

NOTE-001 (Gateway runtime environment template absent) and NOTE-002 (production database migration deployment not exercised) remain operational handoff observations only. They are not independent Feature 003 requirement blockers and are not part of this rollout decision.

## 15. Phase 9 Final Checkpoint

T077 through T085 are complete. The final assessment is Implementation **INCOMPLETE**, Verification **INCOMPLETE**, and Rollout **BLOCKED** because GAP-001 through GAP-004 remain open. NOTE-001 and NOTE-002 are non-gating operational notes.

Accepted Phase 9 evidence retained zero required skips: T078 guarded unit/integration regression, T079 contract/real-E2E/security/eval validation, T081 repeatability, T082 compiled-process runtime evidence, and their focused cleanups. T080 remains the authority for build/static/Prisma/migration-lineage validation; no schema or migration changed after it.

The final repository handoff captured six modified tracked Feature 003 files and two untracked Feature 003 files. `git diff --check` passes. The bounded artifact scan found no private-key, database-dump, credential-named, or process-log artifact. No deployment, commit, push, or merge was performed.
