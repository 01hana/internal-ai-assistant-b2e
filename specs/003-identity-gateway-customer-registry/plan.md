# Feature 003 — Identity Gateway and Customer Integration Registry Implementation Plan

**Feature**: `003-identity-gateway-customer-registry`
**Status**: Implementation plan — implementation has not begun
**Authority order**: Constitution 2.0.0 → Feature 003 `spec.md` → Feature 003 `design.md` → accepted Feature 002 behavior/readiness evidence.

## 1. Objective and Fixed Baseline

Feature 003 closes the production identity gap through one narrow trust chain:

```text
trusted upstream JWT
  → explicit IntegrationBinding → existing Customer
  → CanonicalGatewayIdentity
  → Gateway RS256 internal JWT
  → public JWKS and key lifecycle
  → allowlisted GatewayBackendClient
  → Feature 002 Remote-JWKS verification
  → real Gateway-to-Backend evidence
```

The Backend already owns RS256 Remote-JWKS verification, canonical claim validation, immutable `CustomerScope`, request-ID normalization, Customer-scoped business authorization, and Customer-owned audit/redaction. The repository is a non-workspace root npm package with one canonical `prisma/schema.prisma` and one migration lineage. `apps/gateway/dist/**` is ignored historical output only; it is not an implementation baseline.

The following are fixed inputs, not design choices for implementation:

- Gateway is an independent NestJS application under `apps/gateway`; neither app imports the other's runtime modules.
- v1 accepts one deployment-configured RS256 upstream issuer/audience/JWKS; it does not add API keys, multi-issuer IAM, OAuth/OIDC provider behavior, opaque introspection, or mTLS platform behavior.
- `IntegrationBinding` is PostgreSQL/Prisma data with an explicit FK to the existing Feature 002 `Customer`; there is no second Customer root or lifecycle platform.
- Provisioning is a controlled idempotent internal command, never a public Customer/Integration administration API.
- Internal JWTs are fresh Gateway-to-Backend service-to-service credentials: RS256, non-blank `kid`, 5-minute TTL, omitted `nbf`, Gateway-generated trace-only `jti`, and never an external/Frontend credential.
- `SigningKeyProvider` uses ignored local developer key files and production provider/reference handling; committed keys and raw production PEM environment values are prohibited.
- `new` and `retired` keys are JWKS-hidden; `published`, `active`, and `retiring` keys are visible; only `active` can normal-sign.
- Rotation is publish → verify propagation → activate → prior key retiring → at least 25-minute overlap → retire.
- `GatewayBackendClient` only uses server-owned `BackendRouteDefinition` allowlist entries. It is not a Host proxy, generic reverse proxy, catch-all, or caller-selected destination.
- `packages/internal-identity-contract` is a pure local `file:` npm package; this feature does not convert the repository to npm workspaces.
- Root `prisma/schema.prisma` remains the sole schema and migration authority. It supplies a second generated Gateway client; Gateway-local schema/migrations and duplicate Customer models are prohibited.

## 2. Phase Dependencies

```text
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5
                                              ├→ Phase 6
                                              └→ Phase 7
Phase 2 + 3 + 4 + 5 + 6 + 7 → Phase 8 → Phase 9
```

Phase 6 and Phase 7 each depend only on Phase 5 acceptance and may proceed independently after it. Phase 7 uses the Phase 5 active-key/normal-signing contract and must remain compatible with the Phase 6 lifecycle, but does not depend on Phase 6 completion. Phase 8 cannot start until all persistence, authentication, resolution, signing/JWKS, rotation, and narrow transport checkpoints — including both Phase 6 and Phase 7 acceptance — pass.

## 3. Execution Phases

### Phase 0 — Architecture and Contract Guardrails

**Purpose and dependencies.** Lock Feature 002's trust boundary before any Gateway runtime exists. This phase has no dependency.

**Existing owners reused.** `RemoteJwksInternalIdentityTokenVerifier`, canonical identity validation, `CustomerScope`, request-ID middleware, audit/redaction, and Customer A/B signed-JWT fixtures remain Backend-owned.

**Test-first entry and implementation work.** Add contract, static architecture, and security regression guards that prove canonical claim semantics remain unchanged; public identity headers/body/query/metadata/PageContext never establish or alter identity; Gateway/Backend runtime imports are mutually forbidden; no internal JWT is externally returned; no second Customer root/schema/migration lineage exists; and no Feature 004 capability or generic-proxy surface is introduced.

**Security, verification, and regression.** Run focused Backend verifier, CustomerScope, header-non-authority, A/B isolation, SSE/no-disclosure, audit, and redaction suites. Static guards must reject Gateway runtime imports in `src/**` and Backend runtime imports in `apps/gateway/**`.

**Acceptance and checkpoint.** All trust-boundary guards pass. Gateway runtime work is blocked until this checkpoint is green.

### Phase 1 — Shared Contract, Gateway Skeleton, and Generation Foundation

**Purpose and dependencies.** Establish a minimal independently buildable Gateway foundation; depends on Phase 0.

**Existing owners reused / new outputs.** Create `packages/internal-identity-contract`, an independent Gateway Nest bootstrap/module/config/health-readiness skeleton, and a second Prisma generator in root `prisma/schema.prisma` for the Gateway generated client.

**Package and build contract.** Backend and Gateway consume the package with explicit local `file:` dependencies and standard package `exports` plus declarations. Build order is: compile the contract package, run root-schema Prisma generation for both clients, then compile Backend and Gateway. Do not add npm workspaces, TS paths, project references, or runtime cross-imports.

**Test-first entry and implementation work.** Test that the shared package exports only canonical claim names/types, registered token metadata constants, and validation-neutral vocabulary; reject Nest, Prisma, signer/verifier, repository, or CustomerScope authority imports. Test Gateway config fail-closed behavior and safe health/readiness responses before adding issuance behavior.

**Security, verification, and regression.** Gateway does not read public identity headers as authority and does not emit any internal JWT. Verify package resolution, declaration resolution, separate app startup/build, no circular runtime imports, and absence of Gateway-local Prisma schema/migration files. Re-run Feature 002 build, identity, and header guards.

**Acceptance and checkpoint.** Backend remains buildable; Gateway independently builds/starts; both applications resolve the pure package; and only the root schema produces generated clients.

### Phase 2 — Additive Persistence and Controlled Provisioning

**Purpose and dependencies.** Add the registry, signing-key metadata, and narrow Gateway security audit without changing Feature 002 ownership data; depends on Phase 1.

**Existing owners reused / new outputs.** Reuse the canonical Customer root and root Prisma migration lineage. Add `IntegrationBinding`, `GatewaySigningKey`, and `GatewayIdentityAuditEvent`, supporting Customer/HostApp indexes, key-state invariants, Gateway generated types, deterministic A/B bindings, and a controlled idempotent provisioning command.

**Test-first entry and implementation work.** Test existing Customer requirement, explicit one-integration-to-one-Customer binding, allowed HostApp, enable/disable/re-enable, duplicate command idempotency, restrictive FK behavior, and no Customer creation or inference from organization/actor/HostApp. Test audit-safe command outcomes before persistence implementation.

**Security, verification, and regression.** The migration is additive only. No Customer ownership rewrite, inferred binding backfill, or public provisioning controller is permitted. Provisioning and Gateway audit retain only approved trace/decision fields and redact key/token/credential/mapping-sensitive values. Run real Prisma migration/constraint tests, deterministic A/B seed tests, and Feature 002 schema/Customer ownership regressions.

**Acceptance and checkpoint.** Integration A/B bindings can be provisioned, disabled, and queried safely; no internal JWT is issued yet.

### Phase 3 — Upstream RS256 Authentication

**Purpose and dependencies.** Determine whether upstream identity is trustworthy, independently of Customer resolution; depends on Phase 2.

**Existing owners reused / new outputs.** Reuse strict `jose` RS256/JWKS/time-validation patterns. Add an upstream verifier and verified-upstream-identity type that cannot access `IntegrationBinding`, sign an internal token, or call Backend.

**Test-first entry and implementation work.** Cover invalid signature, wrong issuer/audience, expired/future/invalid time, wrong algorithm, malformed JWT, blank required scalar claims, malformed roles/scopes arrays, and conflicts from public headers/body/query/metadata. A verified identity may contain empty roles/scopes arrays but no blank element.

**Security, verification, and regression.** Only one deployment-configured issuer/audience/JWKS is accepted. Failures are safe 401 or non-disclosing issuance denial; no raw upstream credential reaches logs, audit, exception output, or responses. Re-run Feature 002 invalid-token, canonical-claim, and public-header regressions.

**Acceptance and checkpoint.** Only shape-valid, cryptographically verified upstream identity can progress; it still has no Customer or signing authority.

### Phase 4 — Integration-to-Customer Resolution and Canonical Identity

**Purpose and dependencies.** Resolve verified upstream identity through an enabled explicit binding and compose immutable `CanonicalGatewayIdentity`; depends on Phase 3.

**Existing owners reused / new outputs.** Reuse the Phase 2 binding repository and Customer FK. Add resolver/composer output only; do not issue a token or call Backend.

**Test-first entry and implementation work.** Cover unknown/disabled integration, missing Customer, HostApp mismatch, A requesting Customer B, A/B sharing org/sub/HostApp/roles/scopes, missing default, and every prohibited inference source. The only source for `customer_id` is `IntegrationBinding.customerId`; trusted upstream claims supply actor/org/roles/scopes/HostApp with the required binding HostApp match.

**Security, verification, and regression.** Resolution failures occur before signing, Backend request, or business audit; they disclose no Customer/integration/binding existence. Re-run CustomerScope, public-header, A/B no-disclosure, and gateway audit-redaction tests.

**Acceptance and checkpoint.** Gateway can produce a trusted canonical identity for A or B without allowing either integration to obtain the other Customer identity.

### Phase 5 — Internal Signing and Public JWKS

**Purpose and dependencies.** Build Feature-002-compatible per-request issuance and public key publication; depends on Phase 4.

**Existing owners reused / new outputs.** Add `SigningKeyProvider`, `InternalIdentityTokenIssuer`, active-key selection, and unauthenticated JWKS endpoint. Local integration uses an ignored developer RSA key file; production uses only provider/reference boundary inputs.

**Test-first entry and implementation work.** Verify RS256-only protected headers, non-blank `kid`, exact issuer/audience, `iat`/`exp`, 5-minute TTL, omitted `nbf`, Gateway-generated `jti`, canonical claims, and valid empty role/scope arrays. Clients cannot choose claims, algorithm, key, expiry, or `jti`.

**Security, verification, and regression.** JWKS contains required public fields only. Assert `new`/`retired` hidden and `published`/`active`/`retiring` visible; only `active` normal-signs. Scan JWKS, responses, logs, audit, and exceptions for raw Authorization/JWT/signature/private RSA fields/key references. Use static/test signers only for unit/contract evidence; retain Feature 002 verifier/header regressions.

**Acceptance and checkpoint.** A Gateway-issued token satisfies the unchanged Feature 002 verifier contract, but no real trust-chain readiness claim is made yet.

### Phase 6 — Key Lifecycle and Rotation

**Purpose and dependencies.** Implement rotation as an independently verifiable security boundary; depends on Phase 5.

**Existing owners reused / new outputs.** Reuse persisted key state, JWKS filtering, active-key selection, and Gateway security audit. Add publish, propagation verification, activation, retirement, rollback, and invariant enforcement operations.

**Test-first entry and implementation work.** Cover `new → published → propagation proof → active → retiring → retired`; published-before-active; published/retiring non-signing; unknown kid; premature retirement rejection; old-token verification during overlap; and rollback to the prior active key.

**Security, verification, and regression.** Enforce a minimum 25-minute overlap: final old-key 5-minute token validity + maximum Backend clock tolerance 5 minutes + current `jose` Remote-JWKS cache 10 minutes + cooldown 30 seconds + 1-minute propagation margin. Backend cache/cooldown/tolerance changes require recalculation before retirement is permitted. Key lifecycle audit remains redacted and old JWK removal cannot occur early.

**Acceptance and checkpoint.** Publish/activate/retire/rollback behavior passes independently; valid old-key tokens are not silently invalidated inside the declared policy window.

### Phase 7 — Narrow Gateway-to-Backend Transport

**Purpose and dependencies.** Add the smallest server-owned transport necessary to prove the real trust chain; depends on Phase 5's active-key/normal-signing contract. Phase 6 rotation work may proceed in parallel and defines lifecycle compatibility requirements, but Phase 7 does not depend on Phase 6 completion.

**Existing owners reused / new outputs.** Add `BackendRouteDefinition` catalogue and `GatewayBackendClient`. The v1 logical operations are create assistant session and send/stream assistant message. Their verified current Backend mappings are `POST /api/v1/assistant/sessions` and `POST /api/v1/assistant/sessions/:id/messages` (SSE). These mappings are derived from the existing `AssistantController` `@Post`/`@Param("id")` declarations, `main.ts` global prefix `api/v1`, and existing assistant session/SSE contract and E2E tests. Before implementation, every mapping MUST be locked against that controller/bootstrap/contract-test route surface; Gateway adapts to Backend routes and must not define a second route vocabulary or change Backend routes to fit Gateway.

**Test-first entry and implementation work.** Reject arbitrary paths, destinations, dynamic mappings, unsupported operations, and catch-all routing. Add a route compatibility contract guard that proves every `BackendRouteDefinition` matches the existing Backend controller, bootstrap global prefix, and contract-test route surface. The guard must fail if an HTTP method, path template, `:id` parameter naming, or global-prefix assumption changes; it must not silently call an alternate or wrong route. Verify fresh token attachment, inbound Authorization/cookie/public-identity-header stripping, request-ID/traceparent propagation, route-contract-controlled params/query/body/content type/accept, bounded JSON timeout, SSE connection/stream behavior, safe Backend error translation, and no automatic business retry.

**Security, verification, and regression.** The caller cannot select Backend base URL or routing target, and forwarded data cannot alter the server-owned mapping. Internal JWTs never appear in response, redirect, cookie, SSE payload, logs, audit, or errors. Re-run Feature 002 protected session/SSE, header non-authority, A/B no-disclosure, and redaction regressions.

**Acceptance and checkpoint.** The transport is demonstrably an allowlisted trust-chain client, not a generic Gateway; it may compose a real chain but is not deployment READY.

### Phase 8 — Real Gateway-to-Backend Integration and Security Evidence

**Purpose and dependencies.** Obtain the primary vertical acceptance evidence; depends on Phases 2–7.

**Existing owners reused / new outputs.** Compose a real Gateway runtime, upstream JWT verifier, registry DB, local real signing provider, Gateway HTTP JWKS endpoint, unchanged Backend Remote-JWKS verifier, and protected Backend session/SSE operations.

**Test-first entry and implementation work.** Test happy path; signature/issuer/audience/time failures; unknown kid; public-header conflict; A/B cross-Customer isolation; SSE forwarding; and internal-token non-exposure. No mock verifier, static Backend verifier, or fixture internal JWT can substitute for this phase.

**Security, verification, and regression.** Failed identity paths stop before Backend business work. A/B share org/sub/HostApp/roles/scopes but cannot sign or obtain each other's Customer identity. Validate Gateway audit and centralized redaction against raw Authorization/JWT/private-key/JWK leakage. Run affected Feature 002 identity, Customer, RAG, tool, workflow, audit, SSE, and logger regressions.

**Acceptance and checkpoint.** Real local Gateway → HTTP JWKS → Backend Remote-JWKS → protected Backend endpoint is VERIFIED.

### Phase 9 — Production Readiness and Final Regression

**Purpose and dependencies.** Consolidate all evidence and make the strictly evidence-based READY/BLOCKED decision; depends on Phase 8.

**Existing owners reused / new outputs.** Reuse Feature 002 readiness evidence; create Feature 003 requirement/success-criteria verification matrix, local runbook evidence, and production-like configuration evidence.

**Test-first entry and implementation work.** Run full Gateway/Backend unit, integration, contract, E2E, and security suites; build/typecheck/lint; root Prisma validate/generate/migration checks; provisioning/seed repeatability; bootstrap; JWKS reachability; rotation proof; and output leakage scan.

**Security, verification, and regression.** Verify each production-like environment has exact Gateway/Backend issuer and audience alignment, Backend-reachable Gateway JWKS, safe signing-key source/configuration, and compatible token-time settings. Re-run full Feature 002 regression to prove no identity boundary regression.

**Acceptance and checkpoint.** Record evidence for FR-001–FR-027 and SC-001–SC-013. Only complete real runtime and deployment identity-configuration evidence permits READY; otherwise implementation/verification may be complete while rollout remains BLOCKED.

## 4. Traceability

| Coverage | Phase(s) |
| --- | --- |
| US1 — Resolve trusted Integration | 2, 4, 8 |
| US2 — Issue canonical JWT | 5, 7, 8 |
| US3 — Reject unauthorized issuance | 3, 4, 7, 8 |
| US4 — Publish public keys | 5, 6, 8 |
| US5 — Rotate keys safely | 6, 8 |
| US6 — Real Gateway-to-Backend integration | 7, 8 |
| US7 — Protect tokens, keys, metadata | 0, 2, 5–9 |
| FR-001–FR-003 | 2, 4 |
| FR-004–FR-006 | 3, 4 |
| FR-007–FR-014 | 5 |
| FR-015–FR-017 | 5, 6, 8 |
| FR-018–FR-019 | 8, 9 |
| FR-020–FR-021 | 0, 3, 4, 7, 8 |
| FR-022–FR-023 | 0, 2, 5–9 |
| FR-024 | 0–2 |
| FR-025 | 9 |
| FR-026 | 0, 5, 7, 8 |
| FR-027 | 1, 8, 9 |
| SC-001 | 5, 8 |
| SC-002 | 4, 8 |
| SC-003 | 3, 4, 8 |
| SC-004 | 8 |
| SC-005 | 3, 5, 8 |
| SC-006 | 5 |
| SC-007–SC-008 | 6, 8 |
| SC-009 | 0, 2, 5–9 |
| SC-010 | 0, 3, 7, 8 |
| SC-011 | 8, 9 |
| SC-012–SC-013 | 9 |

## 5. Cross-Cutting Test and Boundary Strategy

Unit coverage fixes pure contracts: identity vocabulary, upstream verification, binding resolution, canonical composition, signing, JWKS filtering, rotation calculations, redaction, and route allowlist. Integration coverage uses real Prisma bindings/key metadata/provider state. Contract coverage proves a Gateway token remains compatible with the unchanged Feature 002 verifier. E2E coverage requires real Gateway, HTTP JWKS, and protected Backend behavior.

Every identity-affecting phase runs the relevant Feature 002 verifier, canonical-claim, CustomerScope, public-header non-authority, A/B isolation, safe 404/no-side-effect, SSE/envelope, audit, and redaction regressions. Feature 003 must adapt to Feature 002's accepted contract; it must not restore legacy public identity authority or require Backend behavior changes to accommodate a Gateway shortcut.

Feature 004 remains outside this plan: no HostApp capability registry, screen/entity/interaction policy, PageContext policy, selectedRows/sourceSystem governance, Orders/Inventory reference integration, connector framework, or data-adapter governance. Feature 003 uses only verified `host_app` and `IntegrationBinding.allowedHostApp` for identity binding.

There are no blocking planning issues. The current repository supports the locked design through a local `file:` package, a second generator from the canonical root schema, a separate Gateway application, and existing protected Backend session/SSE operations.
