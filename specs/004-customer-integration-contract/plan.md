# Feature 004 Implementation Plan

**Feature**: `004-customer-integration-contract`  
**Status**: Implementation plan — no implementation has begun  
**Authority order**: Constitution 2.0.0 → Feature 004 `spec.md` → Feature 004 `design.md` → accepted Feature 002/003 behavior.

## Current Baseline

The independent Gateway uses one deployment-configured `RemoteJwksUpstreamTokenVerifier` from `apps/gateway/src/upstream-auth/upstream-token-verifier.service.ts`. Its configuration comes from `GatewayConfigService`; it verifies RS256, `kid`, issuer, audience, time claims, and the canonical upstream claim shape, including valid empty roles/scopes.

`GatewayTrustChainHandler` already fixes the desired request sequence:

```text
UpstreamTokenVerifier
  → VerifiedUpstreamIdentity
  → CanonicalIdentityResolver
  → GatewayBackendClient
```

The root `prisma/schema.prisma` owns `IntegrationBinding(integrationId, customerId, allowedHostApp, enabled)`. `CanonicalIdentityResolver` exclusively performs binding lookup, binding enablement, HostApp equality, Customer resolution, and `CanonicalGatewayIdentity` composition. The Gateway's test command is `npm --prefix apps/gateway run test`; root Prisma migrations are the single migration lineage.

## Implementation Principles

- Extend Feature 003 incrementally; do not rewrite Gateway routes, handler, internal signing/JWKS, Backend Feature 002 verification, or CustomerScope.
- Add a database-backed `RegisteredUpstreamTrustProfile` anchored to `IntegrationBinding.integrationId`. It MUST NOT contain `customerId` or `allowedHostApp`.
- Keep multi-profile behavior behind `UpstreamTokenVerifier`; it returns only `VerifiedUpstreamIdentity` and never owns binding/Customer/HostApp authority.
- Require exactly one verifier-level `VerifiedProfileDecision`; resolver-level binding admission remains separate and never triggers verifier fallback.
- Reuse `jose` Remote JWKS verification; add a narrow transport/validation boundary only where profile-specific SSRF controls require it.

## Architecture Delta

```text
Authorization Bearer token
  → bounded iss/kid routing metadata
  → CandidateTrustProfile[]
  → profile-scoped jose verification
  → exactly one VerifiedProfileDecision
  → existing VerifiedUpstreamIdentity
  → existing CanonicalIdentityResolver
  → IntegrationBinding.customerId
  → existing internal JWT and Backend transport
```

New responsibility is limited to profile persistence, controlled provisioning, candidate routing, profile-scoped verification, JWKS hardening/caching, bootstrap migration, audit, and generic fixtures. `IntegrationBinding.customerId` and `IntegrationBinding.allowedHostApp` remain the only Customer and HostApp authorities.

## Phase Breakdown

### Phase 0 — Baseline and Contract Protection

- **Goal:** Lock Feature 003 behavior before changes.
- **Components:** Existing upstream-auth, integration-registry, backend-client, route/wiring tests.
- **Work:** Add characterization tests for single verifier behavior, empty arrays, binding-only Customer/HostApp authority, handler method set, routes, and safe 401/403 behavior.
- **Dependencies:** None.
- **Acceptance:** `BASELINE_PROTECTED`; current Gateway suite is green.

### Phase 1 — Trust Profile Persistence Model

- **Goal:** Add profile capability without a second Customer root.
- **Components:** `prisma/schema.prisma`, root migration lineage, generated Gateway client.
- **Work:** Define `RegisteredUpstreamTrustProfile` with profile ID, `integrationId` reference, issuer, exact audience, JWKS source, RS256 policy, enabled state, replacement/version metadata, and audit timestamps; add appropriate indexes/uniqueness.
- **Acceptance:** No profile Customer relation/field or duplicate HostApp field; `IntegrationBinding.customerId` is untouched.

### Phase 2 — Trust Profile Repository

- **Goal:** Provide Gateway persistence access without identity authority leakage.
- **Components:** New profile repository under `apps/gateway/src/integration-registry/` and tests.
- **Work:** Support enabled candidate lookup, profile lookup, controlled create/update/replace/disable, and activation-validation input.
- **Acceptance:** Repository never resolves Customer or accepts unverified claims; shared issuer/audience/JWKS records remain valid.

### Phase 3 — Profile Activation Validation

- **Goal:** Reject invalid policies before they become active.
- **Components:** New profile validation service and provisioning tests.
- **Work:** Validate binding existence/structure, absence of Customer authority, issuer/audience, safe JWKS source, RS256-only policy, lifecycle/replacement state, and duplicate `VerifiedProfileDecision` risk.
- **Acceptance:** Runtime binding enablement and HostApp enforcement remain with `CanonicalIdentityResolver`.

### Phase 4 — Deployment-controlled Provisioning

- **Goal:** Manage profiles through a controlled deployment mechanism.
- **Components:** New command/bootstrap surface following existing `apps/gateway/src/commands/` conventions; repository and audit.
- **Work:** Create, replace, disable, validate, invalidate cache, and record safe audit events.
- **Acceptance:** No Admin UI/API, customer self-service, or generic management system.

### Phase 5 — Bounded Routing Metadata Parser

- **Goal:** Extract safe non-authoritative routing hints.
- **Components:** New upstream-auth parser and unit tests.
- **Work:** Parse only protected-header `kid` and unverified payload `iss`; bound JWT/decoded sizes; reject malformed base64url/JSON/control characters; never log raw data.
- **Acceptance:** Cannot expose or route on integration, subject, organization, HostApp, roles/scopes, or Customer claims.

### Phase 6 — Candidate Trust Profile Resolver

- **Goal:** Produce 0..N enabled candidates safely.
- **Components:** Profile repository/resolver and tests.
- **Work:** Use only unverified `iss` and optional `kid`; model zero, one, multiple, shared issuer, missing kid, and unknown kid cases.
- **Acceptance:** No unverified Customer/integration/body/header/page-context lookup.

### Phase 7 — Profile-scoped Remote JWKS Verification

- **Goal:** Reuse existing JWT verification for per-profile policy.
- **Components:** Refactor `upstream-token-verifier.service.ts` into reusable profile-scoped verification support.
- **Work:** Verify candidate tokens using profile issuer, exact audience, JWKS URI, RS256, and clock policy; create verified identity only after success.
- **Acceptance:** Existing canonical claim validation and empty arrays remain compatible; no alternate JWT stack.

### Phase 8 — JWKS SSRF and Transport Hardening

- **Goal:** Secure customer-registered verification material.
- **Components:** Profile JWKS validation and narrow verifier transport adapter, if `jose@5.10.0` cannot enforce a control.
- **Work:** First verify `jose@5.10.0` transport extension points, then enforce production HTTPS, URL validation, no credentials/fragments/redirects, DNS/IP restrictions, rebinding defense, timeouts, response limits/content checks, profile-isolated JWKS cache, unknown-kid refresh, and bounded retry. Add the narrowest transport adapter for controls the library cannot enforce.
- **Acceptance:** Loopback, private, link-local, multicast, and unspecified destinations are denied in production unless approved egress policy permits them. Local loopback is test-only. The transport-capability research and all profile-controlled JWKS protections are complete before Phase 9 can be production-acceptable.

### Phase 9 — Multi-profile `UpstreamTokenVerifier`

- **Goal:** Produce exactly one `VerifiedProfileDecision`.
- **Components:** New multi-profile verifier, upstream-auth error/telemetry tests.
- **Work:** Compose parser → candidates → profile verification → verified claim validation → verified integration/profile match; emit `VerifiedUpstreamIdentity` only for cardinality one.
- **Acceptance:** Zero/multiple decisions are generic 401. The verifier never queries IntegrationBinding, Customer, HostApp authority, or creates canonical identity.

### Phase 10 — Gateway Module Composition

- **Goal:** Inject the multi-profile verifier without handler redesign.
- **Components:** `apps/gateway/src/gateway.module.ts`, config module, wiring tests.
- **Work:** Wire profile repository, candidate resolver, profile-scoped verifier/cache, and multi-profile `UpstreamTokenVerifier`.
- **Acceptance:** `GatewayTrustChainHandler`, routes, `CanonicalIdentityResolver`, and `GatewayBackendClient` interfaces remain stable.

### Phase 11 — Legacy Config Bootstrap Migration

- **Goal:** Replace single-profile runtime authority safely.
- **Components:** Gateway config/bootstrap command, configuration tests, documentation.
- **Work:** Split migration into controlled legacy environment → DB profile bootstrap and a later `PROFILE_ONLY_RUNTIME_CUTOVER`. Bootstrap requires an explicit integration ID and valid binding, then creates/updates one profile. Cutover occurs only after Phases 9–10 are complete and that bootstrapped profile is valid.
- **Acceptance:** Legacy settings MAY be bootstrap input only. Incomplete bootstrap or cutover fails closed; the legacy global verifier is never a runtime fallback or competing active authority.

### Phase 12 — Enabled and Replacement Lifecycle

- **Goal:** Separate profile acceptance from Customer admission.
- **Components:** Profile lifecycle service/repository and audit.
- **Work:** Profile enablement; atomic successor enable/predecessor disable for issuer replacement; invalidation and safe audit.
- **Acceptance:** Disabled profile fails in verifier; disabled binding fails later in resolver; no dual-issuer or partially accepted state.

### Phase 13 — Cache Strategy

- **Goal:** Prefer correctness and prompt disablement.
- **Components:** Profile resolver/cache; lifecycle invalidation.
- **Work:** Add only the short bounded trust-profile/candidate cache keyed by routing-compatible data/profile ID, with disable/update/replacement invalidation and process-restart reload. Keep binding database reads in v1; JWKS caching, refresh, and retries remain Phase 8 responsibilities.
- **Acceptance:** No pre-verification Customer cache/lookup; stale enabled profile entries cannot extend acceptance after disable/update/replacement.

### Phase 14 — Audit and Error Semantics

- **Goal:** Make security decisions observable without enumeration or credential leakage.
- **Components:** `GatewayIdentityAuditWriter`, upstream telemetry, error tests.
- **Work:** Add verifier events for routing/no candidate/profile disabled/signature/key/issuer/audience/claim/profile-match/ambiguity/success; retain resolver ownership of binding/HostApp/Customer events.
- **Acceptance:** Verifier failures are generic 401; binding admission failures are existing generic 403 without fallback; infrastructure failure is generic 5xx.

### Phase 15 — Direct JWT Fixture

- **Goal:** Demonstrate direct-compatible onboarding.
- **Components:** New generic fixture beside `apps/gateway/test/upstream-auth/upstream-jwks.fixture.ts`.
- **Work:** Customer A asymmetric issuer/JWKS fixture with short-lived canonical token and registered profile.
- **Acceptance:** No Customer-specific mapping or production credentials.

### Phase 16 — Token Exchange Fixture

- **Goal:** Demonstrate legacy onboarding without production adapter work.
- **Components:** New generic test-only issuer fixture.
- **Work:** Simulate trusted native identity → server-side translation → canonical upstream JWT for Customer B.
- **Acceptance:** No Shinmone fields/backend, browser signing, or production exchange service.

### Phase 17 — Multi-Customer Integration Tests

- **Goal:** Verify secure concurrent profile behavior.
- **Components:** Gateway integration tests and synthetic profile/binding data.
- **Work:** Exercise A/B success, cross-profile/binding failure, shared issuer/JWKS/key, exact audience, wrong integration, HostApp mismatch, disabled profile/binding, Customer-like claim non-authority, no candidate, and ambiguity.
- **Acceptance:** A/B isolation; exact-one profile decision; binding-only Customer and resolver-only HostApp authority.

### Phase 18 — Full Gateway-to-Backend E2E

- **Goal:** Prove the complete production trust chain.
- **Components:** Gateway/Backend E2E harness and deterministic fixtures.
- **Work:** Run Direct JWT A and Token Exchange B through multi-profile verifier → resolver → internal JWT → Feature 002 verifier → CustomerScope for all four Gateway routes.
- **Acceptance:** A cannot access B; create/read/history/SSE contracts remain unchanged.

### Phase 19 — Regression and Security Gate

- **Goal:** Complete evidence-based acceptance.
- **Components:** Gateway, Backend, Prisma, build/typecheck/lint, security suites.
- **Work:** Run Gateway unit/integration/E2E, Feature 003 regressions, Feature 002 identity regressions, SSRF negatives, schema/generation, authority/redaction static checks.
- **Acceptance:** `FEATURE004_IMPLEMENTATION_ACCEPTANCE_GATE` passes with no Customer-specific Gateway core logic.

## Dependency Graph

```text
Phase 0
  ├─→ 1 → 2 → 3 → 4 ──────────┐
  └─→ 5 → 6 → 7 → 8 → 9 → 10 ─┼→ 11 → 12 → 13
                                │       └────→ 14
                                └─ valid bootstrapped profile
15 + 16 (after stable verifier/lifecycle/audit contracts) → 17 → 18 → 19
```

Phases 1–4 and 5–8 may proceed independently after Phase 0. Phase 11 bootstrap support may be prepared after Phase 4, but `PROFILE_ONLY_RUNTIME_CUTOVER` depends on Phase 4, Phase 10, and a valid bootstrapped profile. Phase 14 follows stable verifier/lifecycle contracts. Phases 15/16 can proceed in parallel after stable verifier, lifecycle, and audit contracts; Phase 18 depends on all preceding runtime and security batches.

## Migration Strategy

Persistence migration is additive only: create trust profile capability without changing `IntegrationBinding.customerId`, Customer ownership, or `allowedHostApp` authority. Runtime migration is separately ordered as legacy environment → controlled bootstrap → valid DB profile → profile-only runtime cutover. Bootstrap may be developed after controlled provisioning, but runtime cutover is blocked until the multi-profile verifier and Gateway composition are available. Any incomplete transition fails closed; rollback restores the previous valid profile state and never restores a legacy global-verifier fallback.

## Test Strategy

Adopt test-first coverage for unverified-claim routing denial, wrong issuer/audience, profile/integration mismatch, shared IdP selection, ambiguous decisions, profile disablement, binding/HostApp regression, Customer-like claims, unsafe JWKS rejection, and no legacy verifier fallback.

Production tests require registered profiles, HTTPS JWKS, SSRF restrictions, and no loopback exception. Test-only fixtures use loopback, ephemeral asymmetric keys, and isolated local configuration.

## Security Gates

- No unverified identity claim is profile-routing or Customer authority beyond `iss`/`kid` hints.
- Every accepted request has exactly one `VerifiedProfileDecision` before resolver admission.
- `IntegrationBinding.customerId` and `IntegrationBinding.allowedHostApp` remain sole authorities.
- Audit/error/redaction scans contain no bearer token, full JWT, private key, JWKS payload, or profile enumeration detail.
- Runtime has no legacy global upstream-verifier fallback.

## Rollout Strategy

1. Deploy dormant persistence and controlled validation.
2. Bootstrap one existing Feature 003 profile in a non-production environment.
3. Verify audit/JWKS/profile behavior and profile-only runtime.
4. Add a second synthetic profile and complete multi-Customer integration proof.
5. Obtain real E2E evidence and deprecate legacy runtime authority.

## Risk Register

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Profile ambiguity/shared IdP | Exact-one `VerifiedProfileDecision` | Shared issuer/key tests |
| Legacy dual authority | One-way bootstrap and profile-only runtime | No-fallback configuration tests |
| JWKS SSRF/rebinding | Registration and connection-time egress controls | Adversarial URL/DNS tests |
| Cache stale acceptance | Bounded cache and active invalidation | Disable/replacement tests |
| Customer authority duplication | No profile Customer field/relation | Schema/repository tests |
| Resolver logic duplication | Verifier has no binding/Customer dependency | Unit/wiring guards |
| Test policy leakage | Explicit production/test transport split | Production config negative tests |

## Implementation Batch Strategy

1. **Phases 1–4 — Persistence, repository, activation validation, controlled provisioning.** No dependencies; accepts only profiles with no duplicate Customer/HostApp authority.
2. **Phases 5–6 — Bounded routing parser and candidate resolver.** Depends on Batch 1 candidate-profile data; accepts only `iss`/`kid` routing.
3. **Phases 7–8 — Profile-scoped verifier and JWKS SSRF/transport hardening.** Depends on Batches 1–2; accepts safe reusable per-profile verification, including JWKS cache/refresh behavior.
4. **Phases 9–10 — Multi-profile verifier and Gateway composition.** Depends on Batches 1–3; accepts exactly-one `VerifiedProfileDecision` through the existing verifier abstraction, with no legacy runtime fallback.
5. **Phases 11–13 — Legacy bootstrap/profile-only cutover, profile lifecycle, and trust-profile cache.** Depends on Batch 4 and a valid bootstrapped profile before cutover; accepts profile-only runtime, lifecycle invalidation, and no JWKS cache reimplementation.
6. **Phase 14 — Audit, error semantics, and no-fallback observability.** Depends on stable verifier and lifecycle contracts; accepts boundary-specific safe telemetry.
7. **Phases 15–16 — Direct JWT and Token Exchange fixtures.** Depends on stable verifier/lifecycle/audit contracts; accepts two generic fixture paths through the same abstraction.
8. **Phases 17–19 — Multi-Customer integration, full Gateway→Backend E2E, and final gates.** Depends on all preceding runtime/security batches; accepts complete Feature 004 evidence.

Each batch begins with failing boundary tests and ends only when its associated phases meet their acceptance criteria.

## Exit Criteria

1. Two integrations with different issuer/JWKS sources work concurrently.
2. Shared issuer/JWKS/key situations yield exactly one `VerifiedProfileDecision` or fail closed.
3. Customer authority remains only `IntegrationBinding.customerId`.
4. HostApp authority remains only `IntegrationBinding.allowedHostApp`.
5. Disabled profile and disabled binding fail in their distinct layers.
6. Legacy global verifier is no longer runtime authority.
7. Direct JWT and Token Exchange fixtures use the same verifier abstraction.
8. Existing Gateway → Backend → Feature 002 CustomerScope flows have no regression.
9. No Customer-specific Gateway core logic exists.

## Explicit Non-goals

No tasks document or implementation in this batch; no Admin UI/API, Customer self-service, IAM/broker, Shinmone adapter/claim mapping, production Customer exchange service, SDK/Customer Host change, Backend Feature 001/002 change, internal Gateway JWT redesign, generic proxy, or business-data connector work.
