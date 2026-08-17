# Feature 004 Tasks

## Execution Rules

- Complete each batch acceptance gate before starting a dependent batch.
- Every security-boundary implementation task names its preceding failing test or same-task verification.
- `[P]` marks only work that is independent of incomplete work in the same batch; batch acceptance remains sequential.
- Preserve `UpstreamTokenVerifier → VerifiedUpstreamIdentity → CanonicalIdentityResolver → GatewayBackendClient`. Trust profiles never own Customer or HostApp authority.
- Run Gateway checks with `npm --prefix apps/gateway run test`; use root Prisma commands for schema/migration validation.

## Batch 1 — Persistence, Repository, Activation Validation, and Provisioning

**Goal:** Add dormant trust-profile capability without changing runtime verifier authority.  
**Covered phases:** 1–4.  
**Dependencies:** Baseline protected.  
**Tests:** Schema/repository/validation/command tests precede implementation.

### Tasks

- [X] T001 [P] Add failing schema-authority contract coverage in `apps/gateway/test/integration-registry/trust-profile-persistence.spec.ts` proving a profile has no `customerId` or `allowedHostApp` authority and `IntegrationBinding` remains sole owner.
- [X] T002 [P] Add failing activation-validation cases in `apps/gateway/test/integration-registry/trust-profile-activation.spec.ts` for missing binding, blank issuer/audience, unsafe JWKS URI, unsupported algorithm, invalid lifecycle, and duplicate profile-decision risk.
- [X] T003 Define `RegisteredUpstreamTrustProfile` in `prisma/schema.prisma` with integration reference, issuer, exact audience, JWKS source, RS256 policy, enabled state, replacement/version metadata, timestamps, indexes, and no Customer/HostApp duplicate fields; verify T001.
- [X] T004 Create additive root migration under `prisma/migrations/<timestamp>_feature004_trust_profiles/migration.sql` for the approved schema only; validate with `npm run prisma:generate` and root migration checks.
- [X] T005 Implement `apps/gateway/src/integration-registry/trust-profile.repository.ts` for enabled candidate lookup, profile lookup, controlled create/update/replace/disable, and no Customer resolution; verify repository cases in `apps/gateway/test/integration-registry/trust-profile-repository.spec.ts`.
- [X] T006 Implement `apps/gateway/src/integration-registry/trust-profile-activation.validator.ts` from T002, explicitly excluding runtime binding-enabled and HostApp admission decisions; verify all T002 cases pass.
- [X] T007 [P] Add persistence/repository structural regression coverage in `apps/gateway/test/integration-registry/customer-binding-isolation.spec.ts` proving `IntegrationBinding.customerId` and `allowedHostApp` remain unchanged authorities.
- [X] T008 Add controlled profile provisioning support in `apps/gateway/src/commands/provision-trust-profile.ts`, following `provision-integration-binding.ts` conventions, with create/replace/disable, activation validation, safe audit hook, and cache-invalidation interface; verify in `apps/gateway/test/integration-registry/trust-profile-provisioning.spec.ts`.
- [X] T009 Add command idempotency/conflict/no-public-admin-surface tests in `apps/gateway/test/integration-registry/trust-profile-provisioning.spec.ts` before finalizing `provision-trust-profile.ts` behavior.
- [X] T010 Run root Prisma validation/generation and focused Gateway persistence tests; record `TRUST_PROFILE_PERSISTENCE_READY` only if no runtime verifier wiring changed.

### Acceptance Gate

`TRUST_PROFILE_PERSISTENCE_READY`: additive schema/migration validates; repository and activation tests pass; no profile Customer/HostApp authority; no runtime switch.

## Batch 2 — Routing Metadata Parser and Candidate Resolver

**Goal:** Create a narrow, non-authoritative routing boundary.  
**Covered phases:** 5–6.  
**Dependencies:** Batch 1.  
**Tests:** Parser/resolver tests precede implementation.

### Tasks

- [X] T011 Add failing parser tests in `apps/gateway/test/upstream-auth/routing-metadata-parser.spec.ts` for valid compact JWT, malformed segment count, oversized token/metadata, invalid base64url/JSON, controls, missing `iss`, and missing `kid`.
- [X] T012 Add failing parser non-authority tests in `apps/gateway/test/upstream-auth/routing-metadata-parser.spec.ts` proving `integration_id`, `sub`, `org_id`, `host_app`, roles, scopes, and Customer-like claims cannot be output or consumed.
- [X] T013 Implement `apps/gateway/src/upstream-auth/routing-metadata.parser.ts` to return only bounded unverified `iss` and protected-header `kid`; verify T011–T012 and safe non-logging.
- [X] T014 Add failing candidate-resolution tests in `apps/gateway/test/integration-registry/candidate-trust-profile-resolver.spec.ts` for zero/one/multiple candidates, shared issuer/audience/JWKS, missing/unknown kid, and disabled-profile exclusion.
- [X] T015 Implement `apps/gateway/src/integration-registry/candidate-trust-profile.resolver.ts` using only `iss` and optional `kid` with `TrustProfileRepository`; verify T014.
- [X] T016 Add static/regression tests in `apps/gateway/test/upstream-auth/routing-metadata-parser.spec.ts` proving candidate lookup never receives browser headers/body/query/page context or unverified integration/Customer fields.
- [X] T017 Run focused parser/repository tests and record `ROUTING_HINT_BOUNDARY_READY` only when candidate resolution uses no identity authority.

### Acceptance Gate

`ROUTING_HINT_BOUNDARY_READY`: only bounded `iss`/`kid` hints cross this boundary; all other unverified identity values are rejected as routing inputs.

## Batch 3 — Profile-scoped Verification and JWKS Security

**Goal:** Produce safe reusable per-profile verification before multi-profile runtime composition.  
**Covered phases:** 7–8.  
**Dependencies:** Batches 1–2.  
**Tests:** Transport research and adversarial tests precede security implementation.

### Tasks

- [X] T018 Research installed `jose@5.10.0` Remote JWKS extension points in `specs/004-customer-integration-contract/research-jose-transport.md`: custom fetch, redirects, timeout, response bounds, DNS/IP validation, cache/refresh, and unknown-kid behavior; select the minimum adapter boundary.
- [X] T019 Add failing profile-scoped verification tests in `apps/gateway/test/upstream-auth/profile-scoped-verifier.spec.ts` for exact issuer/audience, RS256, nonblank kid, invalid signature, time failures, malformed canonical claims, and empty roles/scopes.
- [X] T020 Extract reusable profile-scoped verification from `apps/gateway/src/upstream-auth/upstream-token-verifier.service.ts` into `apps/gateway/src/upstream-auth/profile-scoped-verifier.ts`, retaining existing `jose` semantics; verify T019.
- [X] T021 Add failing production JWKS registration tests in `apps/gateway/test/upstream-auth/jwks-source-policy.spec.ts` for HTTP, URL credentials/fragments, redirects, localhost/loopback, link-local, private, multicast, unspecified, and unsafe DNS destinations.
- [X] T022 Implement `apps/gateway/src/upstream-auth/jwks-source-policy.ts` and any minimal `apps/gateway/src/upstream-auth/jwks-transport.adapter.ts` required by T018; verify T021 including DNS rebinding and connection-time destination checks.
- [X] T023 Add failing transport-bound tests in `apps/gateway/test/upstream-auth/jwks-transport.spec.ts` for connection timeout, response bounds/content shape, invalid JWKS, and production rejection of test-only exceptions.
- [X] T024 Implement bounded timeout/response/content/redirect behavior in `apps/gateway/src/upstream-auth/jwks-transport.adapter.ts`; verify T023.
- [X] T025 Add failing JWKS cache tests in `apps/gateway/test/upstream-auth/profile-scoped-verifier.spec.ts` for profile isolation, unknown-kid refresh, bounded refresh/retry, network failure fail-closed, and same-issuer key rotation.
- [X] T026 Implement profile-isolated JWKS cache/refresh behavior in `apps/gateway/src/upstream-auth/profile-scoped-verifier.ts`; verify T025 without retry amplification.
- [X] T027 [P] Add explicit test-only loopback fixture policy in `apps/gateway/test/upstream-auth/upstream-jwks.fixture.ts` and `apps/gateway/test/upstream-auth/jwks-source-policy.spec.ts`, proving production cannot enable it.
- [X] T028 Re-run existing `apps/gateway/test/upstream-auth/upstream-token-verifier.spec.ts` and `upstream-identity.spec.ts` as compatibility regressions after extraction.
- [X] T029 Run all Batch 3 tests and record `PROFILE_SCOPED_VERIFICATION_READY` and `JWKS_SECURITY_GATE=PASS`; do not allow Phase 9 production acceptance if T018–T028 are incomplete.

### Acceptance Gate

`PROFILE_SCOPED_VERIFICATION_READY` and `JWKS_SECURITY_GATE=PASS`: safe per-profile verification, JWKS transport hardening, JWKS cache/refresh, and no loopback policy leakage.

## Batch 4 — Multi-profile Verifier and Gateway Composition

**Goal:** Compose candidates into one verified identity without taking resolver authority.  
**Covered phases:** 9–10.  
**Dependencies:** Batches 1–3.  
**Tests:** Decision tests precede verifier and wiring changes.

### Tasks

- [X] T030 Add failing `VerifiedProfileDecision` tests in `apps/gateway/test/upstream-auth/multi-profile-upstream-token-verifier.spec.ts` for zero, exactly-one, multiple, disabled profile, verified integration/profile mismatch, and shared issuer/audience/JWKS/key.
- [X] T031 Add failing static authority tests in `apps/gateway/test/upstream-auth/multi-profile-upstream-token-verifier.spec.ts` proving the multi-profile verifier cannot query `IntegrationBinding`, Customer, HostApp authority, or construct `CanonicalGatewayIdentity`.
- [X] T032 Implement `apps/gateway/src/upstream-auth/multi-profile-upstream-token-verifier.ts` using parser, candidate resolver, profile-scoped verifier, canonical claim validation, and exact-one decision; verify T030–T031.
- [X] T033 Add no-legacy-fallback tests in `apps/gateway/test/upstream-auth/multi-profile-upstream-token-verifier.spec.ts` before Gateway wiring; verify verifier failure is generic 401.
- [X] T034 Update `apps/gateway/src/gateway.module.ts` to compose `TrustProfileRepository`, `CandidateTrustProfileResolver`, profile-scoped verification, and `MultiProfileUpstreamTokenVerifier` behind `UpstreamTokenVerifier`; verify `apps/gateway/test/backend-client/gateway-trust-chain-wiring.spec.ts`.
- [X] T035 Add Gateway handler/route regression coverage in `apps/gateway/test/backend-client/gateway-trust-chain-handler.spec.ts` proving the handler and resolver contracts are unchanged under multi-profile verifier wiring.
- [X] T036 Run focused upstream-auth/wiring tests and record `MULTI_PROFILE_GATEWAY_PATH_READY` only when no legacy verifier fallback exists in the new runtime path.

### Acceptance Gate

`MULTI_PROFILE_GATEWAY_PATH_READY`: exactly-one profile decision feeds the unchanged resolver path; no binding/Customer authority or legacy fallback exists in verifier composition.

`MULTI_PROFILE_GATEWAY_PATH_READY=YES` — T030–T036 acceptance evidence completed.

## Batch 5 — Bootstrap, Profile-only Cutover, Lifecycle, and Profile Cache

**Goal:** Migrate safely to profile-only runtime and manage profile lifecycle.  
**Covered phases:** 11–13.  
**Dependencies:** Batch 4 and a valid bootstrapped profile before cutover.  
**Tests:** Bootstrap/cutover/lifecycle/cache tests precede corresponding implementation.

### Tasks

- [ ] T037 Add failing legacy-bootstrap tests in `apps/gateway/test/config/trust-profile-bootstrap.spec.ts` for complete/incomplete legacy environment, explicit integration ID, missing binding, invalid issuer/audience/JWKS, and conflicting profile.
- [ ] T038 Implement controlled legacy bootstrap in `apps/gateway/src/commands/bootstrap-legacy-upstream-trust-profile.ts` using `GatewayConfigService`, binding validation, and `TrustProfileRepository`; verify T037.
- [ ] T039 Add failing `PROFILE_ONLY_RUNTIME_CUTOVER` tests in `apps/gateway/test/config/gateway-config.spec.ts` for valid profile runtime, no DB profile, invalid profile with legacy env present, and absence of global-verifier fallback.
- [ ] T040 Update `apps/gateway/src/config/gateway-config.service.ts` and `apps/gateway/src/gateway.module.ts` for profile-only runtime cutover after T039; verify cutover only follows Batch 4 and valid bootstrap profile.
- [ ] T041 Add failing lifecycle tests in `apps/gateway/test/integration-registry/trust-profile-lifecycle.spec.ts` for enabled/disabled profile, disabled IntegrationBinding regression, successor validation, atomic predecessor/successor transition, partial replacement rollback, and no dual active issuer.
- [ ] T042 Implement `apps/gateway/src/integration-registry/trust-profile-lifecycle.service.ts` and repository transaction support; verify T041 and safe audit/invalidation hooks.
- [ ] T043 Add failing trust-profile cache tests in `apps/gateway/test/integration-registry/trust-profile-cache.spec.ts` for bounded TTL, disable/update/replacement invalidation, and process-restart reload.
- [ ] T044 Implement `apps/gateway/src/integration-registry/trust-profile-cache.ts` for candidate/profile caching only; verify T043 and do not reimplement JWKS or binding cache.
- [ ] T045 Update `.env.example` and `README.md` with bootstrap-only legacy configuration and profile-only runtime guidance; verify configuration examples cannot imply a runtime fallback.
- [ ] T046 Run bootstrap/cutover/lifecycle/cache regression tests and record `PROFILE_ONLY_RUNTIME_READY` and `LEGACY_RUNTIME_AUTHORITY_REMOVED=YES`.

### Acceptance Gate

`PROFILE_ONLY_RUNTIME_READY`: legacy values are bootstrap input only; profile runtime, lifecycle invalidation, and trust-profile cache work without JWKS/binding cache duplication.

## Batch 6 — Audit, Errors, and Security Observability

**Goal:** Deliver safe boundary-specific diagnostics and stable public failures.  
**Covered phases:** 14.  
**Dependencies:** Batch 5.  
**Tests:** Audit/error/redaction tests precede telemetry changes.

### Tasks

- [ ] T047 Add failing verifier-audit tests in `apps/gateway/test/upstream-auth/upstream-auth-telemetry.spec.ts` for no candidate, disabled profile, signature/key/issuer/audience/claim failures, profile mismatch, ambiguity, and success.
- [ ] T048 Implement verifier event taxonomy in `apps/gateway/src/upstream-auth/upstream-auth-telemetry.ts` and safe profile decision fields in `apps/gateway/src/audit/gateway-identity-audit.writer.ts`; verify T047.
- [ ] T049 Add resolver-audit regression tests in `apps/gateway/test/integration-registry/canonical-identity-resolver.spec.ts` for binding missing/disabled, HostApp mismatch, and Customer binding authority.
- [ ] T050 Add failing error mapping tests in `apps/gateway/test/operations/gateway-assistant.controller.spec.ts` for generic verifier 401, existing resolver 403, profile/JWKS generic 5xx, and no profile/Customer enumeration.
- [ ] T051 Implement safe error/telemetry wiring in `apps/gateway/src/upstream-auth/upstream-auth.error.ts`, `apps/gateway/src/operations/gateway-assistant.controller.ts`, and audit surfaces; verify T050 without changing public enumeration protections.
- [ ] T052 Extend `apps/gateway/test/upstream-auth/upstream-auth-redaction.spec.ts` and `apps/gateway/test/identity/internal-token-redaction.spec.ts` to reject Authorization/Bearer/full JWT/claims/private key/raw JWKS/URL-secret leakage; record `FEATURE004_OBSERVABILITY_READY` when all pass.

### Acceptance Gate

`FEATURE004_OBSERVABILITY_READY`: verifier and resolver events are separated; public 401/403/5xx behavior is safe and sensitive output is redacted.

## Batch 7 — Direct JWT and Token Exchange Fixtures

**Goal:** Supply generic reference evidence for both onboarding patterns.  
**Covered phases:** 15–16.  
**Dependencies:** Batch 6.  
**Tests:** Fixture contract tests precede fixture finalization.

### Tasks

- [ ] T053 [P] Add Direct JWT fixture contract tests in `apps/gateway/test/upstream-auth/direct-jwt.fixture.spec.ts` for asymmetric key/JWKS, exact audience, short TTL, canonical claims, and empty roles/scopes.
- [ ] T054 Implement generic Customer A fixture in `apps/gateway/test/upstream-auth/direct-jwt.fixture.ts`; verify T053 and prohibit Customer-specific claim mapping.
- [ ] T055 [P] Add Token Exchange fixture contract tests in `apps/gateway/test/upstream-auth/token-exchange.fixture.spec.ts` for trusted server-side native identity simulation, separate issuer/JWKS/key, short TTL, canonical output, and browser non-authority.
- [ ] T056 Implement generic Customer B fixture in `apps/gateway/test/upstream-auth/token-exchange.fixture.ts`; verify T055 and prohibit Shinmone fields, browser signing, production credentials, and production exchange behavior.

### Acceptance Gate

`REFERENCE_INTEGRATION_FIXTURES_READY`: Direct JWT and Token Exchange fixtures are generic and traverse the same production verifier abstraction.

## Batch 8 — Multi-Customer Integration, E2E, and Final Acceptance

**Goal:** Prove the real Feature 004 trust chain and regressions.  
**Covered phases:** 17–19.  
**Dependencies:** Batches 1–7.  
**Tests:** Integration/E2E/security gates are the batch work.

### Tasks

- [ ] T057 Add A/B multi-Customer integration coverage in `apps/gateway/test/integration/multi-profile-trust-chain.spec.ts` for different issuer/JWKS, cross-profile/binding denial, shared issuer/JWKS/key, wrong audience/integration, HostApp mismatch, disabled profile/binding, Customer-like claims, zero candidate, and ambiguity.
- [ ] T058 Add full Gateway→Backend E2E harness in `apps/gateway/test/integration/feature004-gateway-backend.e2e.spec.ts` using both fixtures and real profile verifier → resolver → internal JWT → Feature 002 verifier across create/read/history/SSE routes.
- [ ] T059 Add CustomerScope isolation assertions to `apps/gateway/test/integration/feature004-gateway-backend.e2e.spec.ts` proving Customer A cannot read Customer B session/history or affect B state.
- [ ] T060 Add static authority guards in `apps/gateway/test/integration/multi-profile-trust-chain.spec.ts` preventing profile `customerId`/`allowedHostApp`, verifier Customer/resolver imports, browser identity authority, and legacy verifier fallback.
- [ ] T061 Execute and record Gateway/Feature 003/Feature 002 regressions, `npm run prisma:generate`, build, typecheck, lint, SSRF negatives, redaction scans, and narrow transport/internal-JWT checks in `specs/004-customer-integration-contract/verification.md`.
- [ ] T062 Evaluate every exit criterion in `specs/004-customer-integration-contract/verification.md` and mark `FEATURE004_IMPLEMENTATION_ACCEPTANCE_GATE=PASS` only with complete real evidence and no Customer-specific Gateway core logic.

### Acceptance Gate

`FEATURE004_IMPLEMENTATION_ACCEPTANCE_GATE=PASS`: real multi-profile A/B evidence, unchanged Gateway→Backend chain, CustomerScope isolation, all regressions, and all security gates pass.

## Cross-Batch Dependency Map

```text
Batch 1 → Batch 2
Batch 1 + Batch 2 → Batch 3
Batch 1 + Batch 2 + Batch 3 → Batch 4
Batch 4 → Batch 5 → Batch 6 → Batch 7 → Batch 8
```

Parallel opportunities: T001/T002/T007; T021/T027; T053/T055. They remain subject to their batch gates.

## Final Acceptance Gate

Feature 004 is complete only when T062 has evidence for every plan exit criterion: concurrent integrations, safe shared IdP behavior, exact-one `VerifiedProfileDecision`, sole IntegrationBinding Customer/HostApp authority, distinct disabled-profile/binding behavior, removed legacy runtime authority, generic fixtures, four-route Gateway→Backend compatibility, and no Customer-specific core logic.

## Explicit Non-goals / Do Not Modify

- Assistant SDK public contract or opaque-token behavior.
- Customer frontend, Shinmone backend, real Customer issuer, Shinmone Token Exchange, UUID/Permissions mapping, or Customer-specific Gateway adapter.
- Backend Feature 001 business runtime, Backend Feature 002 CustomerScope, or Gateway internal JWT contract.
- Gateway narrow business routes, generic proxy behavior, or Customer business connectors.
