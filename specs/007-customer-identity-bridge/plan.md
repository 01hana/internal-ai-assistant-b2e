# Feature 007 — Customer-side Identity Bridge Implementation Plan

**Status**: Implementation plan only — no production implementation in this batch
**Authority order**: Constitution → Feature 007 `spec.md` → Feature 007 `design.md` → this plan → established Features 003–006 contracts.

## 1. Summary and Boundaries

Feature 007 adds a repository-owned, independently deployed Nest application at `apps/identity-bridge`. It exchanges the current Customer IDX AccessToken only inside the Customer environment, emits a five-minute RS256 canonical JWT, and uses unchanged Feature 004 verification, `IntegrationBinding`, and the existing session route to open the Assistant chat.

Native IDX AccessToken, RefreshToken, raw native claims, raw MenuDetail, and Customer-local private signing material never enter central Assistant services. The short-lived canonical JWT is intentionally returned to the SPA and sent to the registered central Gateway, but is redacted everywhere else. No Customer Auth Backend, Customer business Backend, Feature 003, Feature 004, Feature 005, or Feature 006 production change is planned.

The Bridge is a nested package following the existing `apps/gateway` build/test conventions: independent `npm --prefix apps/identity-bridge` build and test scripts, Nest bootstrap/module/configuration, and no database dependency. A pre-Phase-10, production-portable Bridge image and isolated local Compose rehearsal package the Bridge independently from Gateway; Customer staging and production remain deployment controlled and use the same image with approved environment, secret, ingress, and network configuration.

## 2. Dependency-Ordered Implementation Phases

### Phase 1 — Bridge application skeleton

- **Purpose**: Establish `apps/identity-bridge` as a standalone Nest application that does not import Gateway runtime modules, configuration, keys, or persistence.
- **Dependencies**: None.
- **Expected production surfaces**: `apps/identity-bridge/package.json`, `nest-cli.json`, TypeScript and Jest configuration, `src/main.ts`, root module, configuration module shell, and liveness/readiness controllers at `GET /health` and `GET /ready`.
- **Test-first entry and regression scope**: Add bootstrap/module/controller tests under `apps/identity-bridge/test` before wiring implementation; prove independent build/test commands and preserve all existing root and Gateway suites unchanged.
- **Security invariants**: No DB client, Gateway module import, central signing environment variable, or shared filesystem secret volume is introduced. `/health` is liveness only; `/ready` has no IDX call.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `IDENTITY_BRIDGE_APP_SKELETON_READY`.

### Phase 2 — Configuration and Bridge-local readiness

- **Purpose**: Implement a fail-closed deployment configuration contract, local readiness framework, dependency model, and configuration-only readiness checks.
- **Dependencies**: Phase 1.
- **Expected production surfaces**: `src/config` parsers/validators and `src/health` readiness service for `BRIDGE_IDX_MENUDETAIL_URI`, JSON-encoded `BRIDGE_IDX_ALLOWED_ENTRIES`, `BRIDGE_INTEGRATION_ID`, `BRIDGE_HOST_APP`, `BRIDGE_ISSUER`, `BRIDGE_AUDIENCE`, `BRIDGE_JWKS_PUBLIC_URI`, `BRIDGE_SIGNING_KEYS`, `IDX_DESTINATION_MODE`, `IDX_ALLOWED_CIDRS`, `BRIDGE_TIMEOUT_MS`, `BRIDGE_MAX_RESPONSE_BYTES`, and `BRIDGE_ALLOWED_ORIGINS` when a distinct origin is used.
- **Test-first entry and regression scope**: Add configuration and readiness-framework tests for missing, malformed, conflicting, disabled, unsafe, non-HTTPS, wildcard-origin, invalid CIDR, invalid public-JWKS URI, and invalid key lifecycle shape. Re-run Phase 1 tests.
- **Security invariants**: Phase 2 validates signing-key configuration shape, public-JWKS URI syntax/public topology, endpoint policy, and immutable allowed-entry configuration only. It may expose `GET /ready`, but must not implement active-key loading, public-key derivation, local JWKS generation, or lifecycle-runtime validation; unavailable later capabilities keep the service not-ready. It must not claim central-network JWKS reachability or Customer authority.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `BRIDGE_LOCAL_CONFIGURATION_READY`.

### Phase 3 — Customer-local IDX transport

- **Purpose**: Add the Bridge-specific hardened protected MenuDetail transport.
- **Dependencies**: Phase 2.
- **Expected production surfaces**: `src/idx/transport` for provisioned endpoint policy, DNS resolution/connection validation, one-shot HTTPS GET, bounded JSON response handling, and typed safe failures. Do not import or alter central `delegated-http.transport.ts`.
- **Test-first entry and regression scope**: Add transport fixtures/tests for fixed URI, bearer forwarding exactly once, HTTPS-only, JSON-only, 256 KiB maximum body, 5-second maximum deadline, redirects denied, retries denied, initial and connection-time DNS rebinding checks, and safe failure projection.
- **Security invariants**: The browser cannot select a destination, method, headers, timeout, DNS policy, or retry. `public_only` accepts only public addresses; `allowlisted_networks` accepts only configured Customer CIDRs and rejects public addresses. Any rejected policy fails before native-token forwarding.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `CUSTOMER_LOCAL_IDX_TRANSPORT_READY`.

### Phase 4 — IDX semantic conformance

- **Purpose**: Implement the accepted Feature 006 IDX semantics locally, without a shared production extraction.
- **Dependencies**: Phase 3.
- **Expected production surfaces**: `src/idx/menu-detail.validator.ts`, `src/idx/native-claim-parser.ts`, `src/idx/identity-admission.service.ts`, `src/idx/permission-normalizer.ts`, and `src/idx/scope-projector.ts`; Bridge-local semantic fixture vectors under `apps/identity-bridge/test/fixtures`.
- **Test-first entry and regression scope**: Port approved semantic vectors before implementation. Cover accepted protected MenuDetail before structural native JWT parsing, strict response reduction, `sub === UUID_User`, one authoritative non-array `UUID_Company`, exact case-sensitive `UUID_Entry` membership in the deployment-controlled allowed-entry set, implicit read, permitted `Y` actions, deduplication, and ordinal/fixed-action ordering. Re-run Phase 3 security tests.
- **Security invariants**: Decoding alone never authenticates. No local IDX ES512/JWKS/key/time validation becomes authority. `UUID_Company` ambiguity fails closed; Entry never establishes Customer or HostApp authority; roles stay empty; unsupported fields/actions do not become scopes.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `IDX_BRIDGE_VERIFICATION_READY`.

### Phase 5 — Canonical JWT issuance

- **Purpose**: Add Customer-local RS256 issuance from accepted semantic identity only.
- **Dependencies**: Phases 2 and 4.
- **Expected production surfaces**: `src/signing` file-backed PKCS#8 key loader, active-key resolver, active public-key derivation/consistency check, canonical token issuer, and claim/header validation.
- **Test-first entry and regression scope**: Add issuer tests for `alg: RS256`, nonblank `kid`, configured exact `iss`/`aud`, UUID `jti`, numeric `iat`, `exp = iat + 300`, deployment-owned `integration_id`/`host_app`, accepted `sub`/`org_id`, `roles: []`, and deterministic `permission_scopes`. Add negative claim assertions before issuer implementation.
- **Security invariants**: Use only Customer-local `file:` PKCS#8 secret mounts. This phase supplies the runtime active-key load/resolve and public-key derivation dependencies declared by Phase 2, but does not generate the JWKS document. Never emit `customer_id`, Customer authority, Entry, native IDX claims, raw MenuDetail, native credential, or caller-supplied authority. Do not create central key persistence or reuse Feature 003/005 signing authority.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `BRIDGE_CANONICAL_JWT_READY`.

### Phase 6 — JWKS publication and key lifecycle

- **Purpose**: Publish public Bridge verification material and enforce local rotation lifecycle.
- **Dependencies**: Phase 5.
- **Expected production surfaces**: `src/jwks` service/controller at `GET /.well-known/jwks.json`, plus signing-key lifecycle validation for `published`, `active`, and `retiring` records.
- **Test-first entry and regression scope**: Add JWKS/lifecycle tests for public RSA fields only (`kty`, `kid`, `alg`, `use`, `n`, `e`), sorted keys, no private members, exactly one active key, mismatched derived public key, duplicate `kid`, unknown/retired key denial, and rotation ordering.
- **Security invariants**: This phase supplies actual local JWKS document generation and lifecycle-runtime validation to the Phase 2 readiness framework. Publish a new key before activation; retain its predecessor for at least 1,500 seconds after last issuance. Recalculate before removal when TTL, Feature 004 tolerance, JWKS cache age, unknown-kid cooldown, or propagation margin increases. This phase does not assert central retrieval.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `BRIDGE_JWKS_RUNTIME_READY`.

### Phase 7 — Exchange API and credential redaction

- **Purpose**: Complete the native-bearer-only local exchange boundary.
- **Dependencies**: Phases 3–6.
- **Expected production surfaces**: `src/exchange` controller/service/error projector, request-correlation handling, and redaction-safe logging/audit/telemetry boundaries. Expose `POST /identity/exchange` with an empty/no JSON body and required native bearer header.
- **Test-first entry and regression scope**: Add API contract tests for missing/malformed bearer, non-empty or authority-bearing body, each safe 400/401/403/503 outcome, and successful `{ accessToken, tokenType: "Bearer", expiresIn: 300 }`. Add redaction tests before implementation for native token, RefreshToken, raw claims, MenuDetail, signing material, and canonical JWT.
- **Security invariants**: Compose all local runtime dependencies into the readiness framework. After this phase succeeds, record `BRIDGE_LOCAL_READY=YES` only when valid configuration, available IDX transport, wired IDX semantic components, successful active signing-key load, valid derived public key/local JWKS generation, valid allowed-entry/endpoint policy, operational exchange runtime, and `GET /ready` are all present. The canonical JWT is returned only to the caller and may be sent to central Gateway; raw canonical JWT is absent from Bridge logs, audit payloads, telemetry/traces, errors, persistence, diagnostics, and snapshots. Native IDX material never reaches central services. No Customer or Entry authority is accepted from the browser.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `IDENTITY_BRIDGE_RUNTIME_READY`.

### Phase 8 — Multi-deployment isolation regression

- **Purpose**: Prove a configuration-driven Bridge cannot bleed identity or signing context between Customer deployments.
- **Dependencies**: Phase 7.
- **Expected production surfaces**: No new runtime capability; two isolated Bridge configuration fixtures/harnesses under `apps/identity-bridge/test/fixtures` and integration tests.
- **Test-first entry and regression scope**: Exercise two configurations differing in endpoint, two-entry allowlist, integration ID, HostApp, issuer, audience, and signing key. Prove both local Entries succeed and every cross-deployment Entry fails. Re-run all Bridge transport, semantic, signing, API, and redaction suites.
- **Security invariants**: Neither deployment can use the other's endpoint, allowed-entry set, issuer, signing key, integration, HostApp, or authority. No hard-coded Customer domain, identifier, credential, menu, or source branch is introduced. This required release regression is not part of runtime `/ready` or `BRIDGE_LOCAL_READY` semantics.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no.
- **Completion checkpoint**: `IDENTITY_BRIDGE_MULTI_DEPLOYMENT_ISOLATION_READY`.

### Phase 9 — Existing Feature 004 compatibility

- **Purpose**: Prove a Bridge-issued synthetic JWT follows unchanged central Feature 004 verification and resolution.
- **Dependencies**: Phases 6 and 8.
- **Expected production surfaces**: No central production change. Add compatibility fixture/test coverage under `apps/gateway/test/identity-bridge` (or the established upstream-auth/integration-registry test locations) using the built Bridge JWT/JWKS fixture.
- **Test-first entry and regression scope**: Start with a controlled Feature-004-compatible JWKS fixture: syntactically valid public-style HTTPS URI, injected/test-controlled resolver yielding a public-routable destination, and deterministic HTTP transport returning the real Bridge public JWKS document. It must exercise unchanged `ProductionJwksSourceRegistrationPolicy`, `ProvisionIntegrationBindingCommand`, `ProvisionTrustProfileCommand`, activation semantics, `ProfileScopedVerifier`/existing upstream verifier behavior, canonical JWT verification, exactly-one profile selection, IntegrationBinding Customer resolution, and `allowedHostApp` admission. Run existing direct Feature 004 regression suites unchanged without requiring Internet access.
- **Security invariants**: The production JWKS policy remains unchanged; test injection never weakens it or presents Customer-private addresses as production-compatible evidence. No central exchange call reaches Bridge `/identity/exchange`; private Customer network access is never required; the Bridge JWT cannot establish Customer authority itself. Phase 9 proves automated contract compatibility only, not `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED`.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: no; deterministic fixture/test transport only.
- **Completion checkpoint**: `BRIDGE_FEATURE004_COMPATIBILITY_READY`.

### Pre-T065 local full E2E development track

- **Purpose**: Prove the actual local Bridge → Feature 004 → IntegrationBinding → Gateway internal JWT → Backend/session/chat chain before any staging provisioning.
- **Dependencies**: Phase 9. This track is distinct from T065–T073 and cannot establish staging or final completion markers.
- **L001 — evidence correction**: Treat the observed `UUID_Entry` solely as an ignored local positive-path value. Authentication Entry selection is user-specific; the static deployment allowlist remains unknown. Preserve exact configured membership; no wildcard, browser-supplied Entry, Bridge Authentication/discovery request, or inferred Entry set is permitted.
- **L002 — local substrate**: Prove local PostgreSQL health, Prisma client generation, migrations, deterministic seed data, Backend runtime/build identification, Gateway build identification, and existing Bridge local runtime availability. Gateway startup is intentionally excluded because the unchanged profile-only runtime requires L003 trust provisioning first.
- **L003 — local trust bootstrap**: Run a fixed loopback JWKS-only proxy at `127.0.0.1:3110`, obtain an operator-owned temporary public HTTPS tunnel URL, and provision a dedicated local Customer, `shinmone-scm-assistant-local` binding with `shinmone-scm`, and active RS256 TrustProfile through existing direct commands. Then start Gateway, execute its existing local signing bootstrap, prove Gateway health/JWKS, and retrieve Bridge JWKS through the real hardened transport. Use `https://bridge-local.example.test` and `internal-ai-assistant-local`; preserve `ProductionJwksSourceRegistrationPolicy` and `HardenedJwksTransport`. The tunnel exposes only `GET /.well-known/jwks.json` and denies all Bridge exchange and operational routes.
- **L004 — local session bootstrap**: Use an operator-entered native credential only through existing local Bridge tooling. Keep the returned canonical token in memory, submit it to the local session route, and prove the real Feature 004, binding, Gateway issuer, Backend `201`, and `sessionId` chain without substituting an internal JWT fixture.
- **L005/L006 — external SPA and chat**: After L004, apply the narrow Customer SPA handoff outside this repository, then prove an existing chat UI receives a visible SSE response. RefreshToken remains with existing browser auth and canonical JWT storage is memory-only.
- **Security invariants**: Native tokens never traverse the JWKS tunnel or central runtime. The local completion marker is `LOCAL_CUSTOMER_IDENTITY_E2E_READY=YES` only; it never implies `CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED`, `STAGING_IDENTITY_READY`, or the Feature-completion marker.
- **Completion checkpoint**: `LOCAL_CUSTOMER_IDENTITY_E2E_READY=YES` after L006 only.

### Phase 10 — First-Customer staging provisioning

- **Purpose**: Establish the real deployment-controlled central trust prerequisite for first-Customer staging.
- **Dependencies**: Phase 9.
- **Expected production surfaces**: No Customer-specific source constants or new central APIs. Prepare operational evidence using the existing Customer record and control-plane commands only.
- **Test-first entry and regression scope**: In the actual central staging deployment, retrieve the actual Customer-controlled public HTTPS Bridge JWKS and verify a synthetic Bridge canonical JWT before enabling SPA handoff. Record failure evidence for missing/disabled binding/profile, wrong issuer/audience/algorithm/JWKS URI, rejected public URI, failed central retrieval, or failed verification.
- **Security invariants**: **HUMAN_REQUIRED** values are Customer record ID, integration ID, allowed HostApp, Bridge issuer, exact audience, RS256 profile, public HTTPS JWKS URI, profile lifecycle, and enabled binding lifecycle. Local `/ready` is not central-reachability proof. Phase 10, unlike Phase 9, proves real deployment/network reachability and trust provisioning.
- **External requirements**: Customer SPA repository: no. Real Customer credentials: no. Central deployment provisioning: yes, operator controlled.
- **Completion checkpoint**: `STAGING_IDENTITY_READY`, only when `BRIDGE_LOCAL_READY + CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED` is evidenced by policy acceptance, provisioned profile, central retrieval, and synthetic JWT verification.

### Phase 11 — Customer SPA Assistant handoff

- **Purpose**: Deliver the sole Customer source integration, owned outside this repository.
- **Dependencies**: Phase 10.
- **Expected production surfaces**: No in-repository Customer source. The external SPA implementation must identify its existing Frontend-Auth accessor and Assistant session/chat composable, obtain the current AccessToken, call same-origin `/assistant-identity/identity/exchange`, retain the response JWT only in memory, call existing central `POST /api/v1/assistant/sessions`, then open chat from `sessionId`.
- **Test-first entry and regression scope**: External component/integration tests must cover current-token retrieval, header-only exchange, response-only/memory-only JWT, no localStorage/sessionStorage, expiry re-exchange, no RefreshToken forwarding, generic error handling, and removal of decoded-token console logging.
- **Security invariants**: Do not change Customer IDX/Auth or business Backend. The SPA never selects Bridge authority/configuration, stores bearer credentials, or treats `sessionId` as authentication.
- **External requirements**: Customer SPA repository: yes — **HUMAN_REQUIRED** location/owner before implementation. Real Customer credentials: no. Central deployment provisioning: yes.
- **Completion checkpoint**: `CUSTOMER_SPA_BRIDGE_HANDOFF_READY`.

### Phase 12 — Session bootstrap integration

- **Purpose**: Prove the configured Bridge/central/SPA chain reaches the unchanged session route.
- **Dependencies**: Phases 10 and 11.
- **Expected production surfaces**: No new central production code. Add or run staging integration coverage using real Gateway runtime components and a staging Bridge; retain evidence in the deployment verification record.
- **Test-first entry and regression scope**: Exercise canonical JWT → Feature 004 verifier → IntegrationBinding → Gateway internal JWT → existing session endpoint → `sessionId`. A fixture internal JWT cannot replace the trust chain. Re-run direct Feature 004 and Bridge redaction regressions.
- **Security invariants**: Central receives canonical JWT only; no native credential, RefreshToken, raw claim, raw MenuDetail, Customer private key, or raw canonical JWT logging/persistence is introduced.
- **External requirements**: Customer SPA repository: yes. Real Customer credentials: staging test identity only. Central deployment provisioning: yes.
- **Completion checkpoint**: `CUSTOMER_SESSION_BOOTSTRAP_READY`.

### Phase 13 — Real first-Customer IDX staging UAT

- **Purpose**: Obtain the only evidence that may declare the Feature complete.
- **Dependencies**: Phase 12.
- **Expected production surfaces**: No code changes. Execute a documented staging UAT and retain operator-approved evidence.
- **Test-first entry and regression scope**: Before a real user run, use checklists to prove authoritative single-company IDX behavior, Customer-owned Entry selection, selected Entry membership in the Bridge allowlist, enabled Bridge/local readiness, central trust readiness, and SPA deployment. Then test real IDX login/Entry selection → current token → local exchange → protected real MenuDetail → accepted identity/Entry/permissions → canonical JWT → Feature 004 → IntegrationBinding → `sessionId` → existing chat window.
- **Security invariants**: Inspect central paths to prove absence of native AccessToken, RefreshToken, raw native claims, raw MenuDetail, and Customer private key. Prove canonical JWT is usable but absent raw from Bridge/central logs, audit, telemetry, persistence, diagnostics, and snapshots. Synthetic evidence cannot substitute.
- **External requirements**: Customer SPA repository: yes. Real Customer credentials: yes, authorized staging account. Central deployment provisioning: yes.
- **Completion checkpoint**: `CUSTOMER_IDENTITY_SESSION_INTEGRATION_READY=YES`.

## 3. Validation and Rollout

Run each phase's focused Bridge tests before moving to its checkpoint, then run independent Bridge build/test, the existing Gateway Feature 004 upstream-auth/integration-registry regressions, and repository checks appropriate to changed packages. Do not run real Customer dependencies in CI; use fixtures through Phase 9.

Roll out in this order: Bridge skeleton/configuration → local transport/semantics → signing/JWKS → exchange/redaction → isolation → central compatibility → central staging provisioning → SPA handoff → real trust-chain session test → real Customer UAT.

Rollback disables the Customer SPA Assistant handoff, Bridge deployment/configuration, existing IntegrationBinding, or existing TrustProfile. It does not alter Customer IDX/Auth, SCM, business Backend, Feature 004 semantics, or Feature 006 production behavior.

## 4. Completion Markers

```text
FEATURE007_PLAN_READY=YES
TOTAL_IMPLEMENTATION_PHASES=13
IDENTITY_BRIDGE_APP_PHASE_DEFINED=YES
CUSTOMER_LOCAL_TRANSPORT_PHASE_DEFINED=YES
IDX_SEMANTIC_CONFORMANCE_PHASE_DEFINED=YES
BRIDGE_SIGNING_PHASE_DEFINED=YES
BRIDGE_JWKS_PHASE_DEFINED=YES
CANONICAL_CREDENTIAL_REDACTION_PHASE_DEFINED=YES
FEATURE004_COMPATIBILITY_PHASE_DEFINED=YES
FIRST_CUSTOMER_PROVISIONING_PHASE_DEFINED=YES
CUSTOMER_SPA_INTEGRATION_PHASE_DEFINED=YES
SESSION_BOOTSTRAP_PHASE_DEFINED=YES
REAL_CUSTOMER_UAT_PHASE_DEFINED=YES
CUSTOMER_AUTH_BACKEND_MODIFICATION_REQUIRED=NO
CUSTOMER_BUSINESS_BACKEND_MODIFICATION_REQUIRED=NO
FEATURE003_MODIFICATION_REQUIRED=NO
FEATURE004_MODIFICATION_REQUIRED=NO
FEATURE005_MODIFICATION_REQUIRED=NO
FEATURE006_PRODUCTION_MODIFICATION_REQUIRED=NO
PHASE2_PREMATURE_SIGNING_IMPLEMENTATION_REQUIRED=NO
PHASE2_PREMATURE_JWKS_IMPLEMENTATION_REQUIRED=NO
BRIDGE_LOCAL_READY_GATE_DEFINED=YES
BRIDGE_LOCAL_READY_ESTABLISHED_PHASE=7
PHASE8_PART_OF_RUNTIME_READY_SEMANTICS=NO
PHASE9_REQUIRES_REAL_PUBLIC_INTERNET=NO
PHASE9_AUTOMATED_FEATURE004_COMPATIBILITY_DEFINED=YES
PHASE10_REAL_JWKS_REACHABILITY_DEFINED=YES
LOCAL_FULL_E2E_TRACK_DEFINED=YES
LOCAL_FULL_E2E_IS_NOT_STAGING=YES
```
