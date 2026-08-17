# Feature 004 — Customer Integration Contract v1 Design

**Feature**: `004-customer-integration-contract`  
**Status**: Design accepted for implementation planning  
**Authority order**: Constitution 2.0.0 → Feature 004 `spec.md` → this design → accepted Feature 002 and Feature 003 behavior.

## 1. Objective and Boundaries

Feature 004 turns Feature 003's single deployment-level upstream JWT configuration into a scalable, deployment-controlled, per-integration upstream trust model. It retains the established chain:

```text
External Authorization
  → profile-scoped upstream verification
  → VerifiedUpstreamIdentity
  → IntegrationBinding
  → existing Customer
  → CanonicalGatewayIdentity
  → fresh Gateway internal JWT
  → Backend Feature 002
```

It only extends upstream verification and Customer onboarding configuration. It does not reopen Feature 003, change its internal JWT/JWKS lifecycle, or alter Feature 002's verifier, `RequestIdentityContext`, `CustomerScope`, or business authorization.

## 2. Current, Target, and Unchanged

### CURRENT

- `GatewayConfigService` validates one deployment-level `GATEWAY_UPSTREAM_JWT_ISSUER`, `GATEWAY_UPSTREAM_JWT_AUDIENCE`, and `GATEWAY_UPSTREAM_JWKS_URI` and supplies one `GatewayUpstreamVerificationConfig`.
- `RemoteJwksUpstreamTokenVerifier` uses `jose` Remote JWKS verification with RS256, configured issuer/audience, `kid`, and time validation. It produces `VerifiedUpstreamIdentity` only after verification; empty roles and permission scopes are already valid.
- `GatewayModule` constructs one verifier; `GatewayTrustChainHandler` depends on the `UpstreamTokenVerifier` abstraction and then calls `CanonicalIdentityResolver`.
- Root Prisma already defines `IntegrationBinding(integrationId, customerId, allowedHostApp, enabled)` with a Customer FK. `CanonicalIdentityResolver` obtains Customer authority only through that binding and checks the binding's enabled state and HostApp match.
- Gateway audit supports safe structured decision fields but has no profile-routing decision taxonomy.

### TARGET

- Runtime reads registered, database-backed upstream trust profiles as the sole upstream-verification authority.
- A profile references an existing integration identity, never a Customer. Each profile owns exactly one active issuer, exact audience, JWKS source, RS256 policy, and upstream-acceptance lifecycle.
- A profile-aware verifier remains the one dependency exposed through `UpstreamTokenVerifier`; the handler's verify → canonical resolve → narrow Backend transport sequence remains intact.
- Candidate selection may inspect only unverified `iss` and protected-header `kid`, evaluates every eligible profile independently, and accepts exactly one `VerifiedProfileDecision` before existing canonical binding resolution.

### UNCHANGED

- Assistant SDK `getAccessToken()` public contract and opaque-token behavior.
- Customer Host behavior and the four Gateway Assistant routes: create session, get session, get messages, send/stream message.
- `GatewayBackendClient` server-owned narrow route allowlist and Gateway-to-Backend internal JWT attachment.
- Gateway internal signing key provider, internal issuer/audience, public internal JWKS, and key-rotation lifecycle.
- Feature 002 Remote-JWKS internal-token verification, canonical request identity, CustomerScope, Customer-qualified business behavior, and business audit.
- Feature 001 Assistant runtime, business-data connectors, Shinmone backend, and Customer-specific frontend identity logic.

## 3. Authority Ownership

### AUTHORITY_OWNERSHIP_TABLE

| Value / policy | Authoritative owner | Required use | Explicit non-authority |
| --- | --- | --- | --- |
| Integration identity | Verified upstream `integration_id`, constrained by profile anchor and IntegrationBinding | Must match profile and binding exactly after verification | Browser, SDK, routing metadata, profile-derived inference |
| Customer | `IntegrationBinding.integrationId → IntegrationBinding.customerId` | Sole Customer source for canonical Gateway identity | Trust profile, JWT customer-like claims, org, HostApp, subject |
| HostApp | `IntegrationBinding.allowedHostApp` | Verified upstream `host_app` must exactly match it | Trust profile duplicate field, SDK/page context |
| Issuer | Registered trust profile | Exact cryptographic verification policy | Unverified `iss` except candidate routing hint |
| Audience | Registered trust profile | Exact cryptographic verification policy | Token-provided audience as its own expected-audience authority |
| JWKS / verification material | Registered trust profile | Per-profile public-key retrieval policy | Token-provided URI, arbitrary redirect, caller input |
| Algorithm policy | Registered trust profile | RS256-only verification policy | JOSE header-selected algorithm |
| Integration enabled | `IntegrationBinding.enabled` | Permits the integration to establish Customer identity | Trust profile enabled flag alone |
| Profile enabled | Registered trust profile lifecycle | Permits use of the upstream credential policy | IntegrationBinding alone |

`IntegrationBinding` retains `allowedHostApp`; the trust profile does not duplicate it. The effective registered integration trust contract includes allowed HostApp semantics by authoritative reference through its anchored IntegrationBinding, while profile persistence has no second HostApp authority. Profile verification requires profile enablement; subsequent Customer admission requires binding enablement.

## 4. Trust Profile Persistence and Provisioning

### Selected model: database-backed profiles

The primary model is a database-backed `RegisteredUpstreamTrustProfile` anchored by `IntegrationBinding.integrationId`. It is selected over environment-only configuration because it supports multiple Customers, independent disablement, auditable decisions, atomic profile replacement, root-schema referential integrity, deterministic tests, and future key/issuer transitions. It is still deployment-controlled: database storage does not imply a public administration surface.

### Conceptual record and constraints

| Field | Contract |
| --- | --- |
| Stable profile identity | Opaque stable identifier for audit and replacement; not a Customer identity. |
| `integrationId` | Required reference to existing `IntegrationBinding.integrationId`; the sole anchor to Customer ownership. |
| `expectedIssuer` | Required, exact, non-blank issuer; one active issuer per active profile. |
| `expectedAudience` | Required, exact, non-blank audience; values may be shared across profiles without sharing authority. |
| JWKS source | Required registered HTTPS URI and egress-validation policy reference; no token-controlled URI. |
| Algorithm policy | Required RS256-only policy in v1. |
| `enabled` | Controls whether this verification policy accepts new credentials. |
| Version/replacement metadata | Immutable creation/update traceability and explicit predecessor/successor relationship when replacing an issuer. |

The record has no `customerId`, Customer relation, or duplicated allowed HostApp. Its integration reference must be valid; profile activation rejects an absent or structurally invalid binding. The active-profile constraints permit shared issuer, audience, JWKS endpoint, and signing key where verified identity/profile matching still results in exactly one `VerifiedProfileDecision`. They prohibit configurations that can yield more than one verified profile decision for the same verified `integration_id`; runtime binding and HostApp enforcement remain the CanonicalIdentityResolver's responsibility.

### PROFILE_ACTIVATION_VALIDATION

Before a profile is enabled, controlled provisioning validates:

1. the referenced IntegrationBinding exists, is structurally valid, and has an existing Customer relation;
2. the profile has no Customer-authority field or Customer ownership relation;
3. issuer and exact audience are non-blank and policy-valid;
4. JWKS source meets URI, egress, and SSRF registration policy;
5. the algorithm policy is supported RS256 only;
6. the profile has one issuer and valid lifecycle/replacement state;
7. profile lifecycle state is valid without changing IntegrationBinding lifecycle authority; and
8. the resulting enabled profile set does not introduce a potential duplicate `VerifiedProfileDecision`.

Runtime repeats critical validity checks and fails closed. Provisioning-time validation prevents predictable bad configuration; runtime is the final security boundary against stale, partial, or manually corrupted state.

### Deployment-controlled operator workflow

An internal bootstrap/seed or equivalent controlled deployment mechanism creates, updates/replaces, and disables profiles. It performs activation validation, duplicate detection, safe audit recording, and cache invalidation. There is no Admin UI, public Admin API, Customer self-service mechanism, or generic management CLI requirement. The design intentionally does not select the bootstrap technology.

## 5. Multi-profile Routing and Verification

### Required sequence

```text
Authorization: Bearer compact JWT
  → bounded syntax check
  → parse protected JOSE header: kid only
  → bounded unverified payload parse: iss only
  → resolve 0..N enabled candidate trust profiles
  → cryptographically verify independently under each profile policy
  → validate verified canonical upstream semantics
  → require verified integration_id == profile.integrationId
  → collect VerifiedProfileDecisions
  → require exactly one VerifiedProfileDecision
  → emit VerifiedUpstreamIdentity
  → existing CanonicalIdentityResolver
  → IntegrationBinding lookup by verified integration_id
  → require enabled binding and verified host_app == binding.allowedHostApp
  → Customer from IntegrationBinding.customerId
  → CanonicalGatewayIdentity → existing internal JWT → Backend flow
```

The pre-verification parser is bounded by compact-JWT segment and decoded-metadata size limits, rejects malformed base64url/JSON and control characters, reads no payload claim other than `iss`, and never logs raw material. `iss` and `kid` are routing hints only; they create neither `VerifiedUpstreamIdentity` nor Customer or integration authority.

### Candidate resolution

Candidate resolution queries enabled profiles compatible with the unverified `iss`, then may use `kid` only to reduce eligible JWKS candidates where policy metadata permits. Absence of `kid`, a shared issuer, or shared JWKS may yield multiple candidates. Candidate resolution must not query by unverified `integration_id`, subject, organization, roles, permission scopes, Customer, HostApp, body, public headers, SDK options, or page context.

### Profile-scoped verification

Each candidate invokes the existing `jose` Remote JWKS capability under that profile's exact issuer, exact audience, RS256 policy, JWKS source, and clock/time policy. Its payload may be converted to `VerifiedUpstreamIdentity` only after that profile's cryptographic verification succeeds. Existing claim-shape rules are reused: `integration_id`, `sub`, `org_id`, and `host_app` are non-blank; roles and permission scopes are arrays with non-blank values or valid empty arrays.

### VerifiedProfileDecision

A signature success is not itself a verified profile decision. A candidate contributes a `VerifiedProfileDecision` only when all conditions hold:

1. its profile is enabled;
2. signature, issuer, audience, RS256, `kid`, and time policy pass;
3. canonical upstream semantics pass;
4. verified `integration_id` equals the profile's registered integration anchor.

The profile-aware `UpstreamTokenVerifier` accepts only if the `VerifiedProfileDecision` set has cardinality one, then emits the existing `VerifiedUpstreamIdentity`. Zero candidates, zero verified profile decisions, or more than one verified profile decision return a non-disclosing generic upstream-authentication failure. The verifier does not load IntegrationBinding, resolve Customer, check binding enablement or HostApp authority, or construct CanonicalGatewayIdentity. It must not select the first profile/integration, fall back to a legacy global verifier, or treat routing input as final authority.

Shared issuer, audience, JWKS, or signing key remains valid: such profiles can both verify a token cryptographically, but only a profile whose registered integration equals the token's now-verified `integration_id` contributes a `VerifiedProfileDecision`. If multiple profiles still satisfy that verifier-level condition, the configuration is ambiguous and fails closed. Binding existence, binding enabled state, HostApp match, Customer authority, and canonical identity composition happen only after the verifier has emitted one identity.

### Canonical binding decision and no fallback

After one `VerifiedProfileDecision`, the existing `CanonicalIdentityResolver` performs the canonical binding decision: verified `integration_id` → IntegrationBinding lookup → binding enabled check → verified `host_app` exact match with `IntegrationBinding.allowedHostApp` → Customer from `IntegrationBinding.customerId` → CanonicalGatewayIdentity. A missing or disabled binding, HostApp mismatch, invalid binding, or failed composition is the existing generic identity-issuance denial. It MUST NOT return to candidate resolution, re-run profile verification, try another profile, binding, or Customer, or reinterpret the verified identity.

## 6. Lifecycle, Caching, and Compatibility

### Enabled state and issuer replacement

`RegisteredUpstreamTrustProfile.enabled` is the upstream-policy acceptance switch enforced by the verifier. `IntegrationBinding.enabled` is the integration-to-Customer admission switch enforced later by CanonicalIdentityResolver. Both must be true for a request to reach canonical identity issuance, but they are enforced by their respective owners and are not merged into one authority.

An active profile trusts one issuer. Normal signing-key rotation for that issuer supports multiple JWKS keys. Issuer migration is an explicit deployment-controlled replacement: validate and create the successor, disable the predecessor and enable the successor atomically, invalidate relevant profile/JWKS caches, and record safe audit decisions. V1 never keeps two concurrently authoritative issuer profiles for the same integration migration window. Failure of the transition leaves no accepted dual authority; invalid partial state fails closed.

### Cache policy

| Cache | Key | Correctness rule |
| --- | --- | --- |
| Trust profile | Profile id and candidate-routing values, never Customer | Short bounded TTL; bootstrap update/disable/replacement actively invalidates affected entries; process restart reloads storage. |
| JWKS | Profile id plus registered JWKS URI | Reuse `jose` remote-JWKS behavior per profile; cache remains isolated by profile source. |
| IntegrationBinding | `integrationId` after verification only | Prefer database read for v1; if later cached, disable/update must actively invalidate and stale enabled entries may not extend acceptance. |

Unknown `kid` triggers the library-supported refresh behavior once within a bounded cooldown; unknown key, failed refresh, network timeout, invalid JWKS, or stale data that cannot safely verify the token fails closed. There is no retry loop that can amplify a hostile token. Correctness and prompt disablement take priority over aggressive caching.

### JWKS and SSRF controls

Feature 003's `jose` verifier is retained, but Feature 004 adds registration and transport hardening because JWKS URIs become per-profile inputs. Production registration requires HTTPS, no credentials/fragments, redirect denial, DNS resolution and connection-time checks against loopback, link-local, multicast, unspecified, and private/internal ranges unless an explicitly approved platform egress policy permits a documented internal endpoint. Revalidate destination on connection to mitigate DNS rebinding. Bound DNS/connect/response time, response size, JWKS content type/shape, and cache lifetime. Never follow token-provided URLs or redirects. Local test-only fixtures may explicitly permit loopback HTTP; that exception cannot be enabled in production.

### Feature 003 configuration migration

The selected migration is **legacy environment → controlled bootstrap of one profile**. The existing `GATEWAY_UPSTREAM_JWT_ISSUER`, audience, JWKS URI, and clock tolerance are accepted only by a deployment/bootstrap migration path that validates and creates or updates one profile tied to an explicit existing integration. Runtime after Feature 004 reads profiles only and does not construct a competing global verifier. Tests cover the bootstrap path. Production startup fails closed if neither a valid profile set nor a complete controlled migration input exists; the legacy environment configuration is then removed/deprecated rather than retained as permanent authority.

## 7. Token Exchange and Test Fixtures

### Trusted Server-side Token Exchange Contract

The contract is generic, not Customer-native:

- A Customer trusted server validates its native identity before issuing any upstream credential.
- It issues a short-lived, asymmetrically signed Assistant-compatible upstream JWT from a registered issuer, for the profile's exact audience.
- The JWT contains the registered `integration_id`, authenticated stable `sub`, deterministic `org_id`, registered HostApp, and roles/scopes that may be empty.
- The server holds signing material; browsers and the SDK neither transform native claims nor hold keys.
- No native token format, Customer claim name, Shinmone field, production adapter, or managed exchange deployment is prescribed.

### Reference/test fixture

A generic test-only issuer fixture belongs in Gateway test support beside the existing upstream-JWKS fixture. It uses ephemeral/local asymmetric keys, exposes a local JWKS mechanism, issues short-lived canonical upstream JWTs, and contains no production credential or Customer-specific mapping. Unit tests consume it for verifier behavior; integration/E2E tests use it as Customer B's legacy-exchange issuer. Customer A uses an independent Direct JWT issuer. Both must traverse the same production-verifier abstraction and existing internal Gateway-to-Backend path.

## 8. Module Composition, Audit, and Errors

### Gateway composition

Future Feature 004 composition adds a profile repository, candidate resolver, profile-scoped verifier factory/cache, and multi-profile verifier behind `UpstreamTokenVerifier`. `GatewayModule` injects that single verifier abstraction into `GatewayTrustChainHandler`; the handler and its routes remain unchanged. `CanonicalIdentityResolver` keeps ownership of IntegrationBinding lookup and canonical composition; it does not obtain profile or JWKS authority.

### Audit and external error behavior

Extend the existing safe `GatewayIdentityAuditWriter` and telemetry at two boundaries. Verifier-level events cover candidate resolution, unknown issuer/no candidate, disabled profile, signature failure, unknown `kid`, issuer/audience mismatch, invalid canonical upstream claim shape, integration/profile mismatch, ambiguous `VerifiedProfileDecision`, and verified-profile success. Canonical-resolver events retain or extend the existing binding missing, binding disabled, HostApp mismatch, and Customer binding-resolution categories. Records retain only approved request, profile/integration, resolved actor/HostApp after verification, and safe outcome fields; they never store raw token, full claims, JWKS body, private material, or URL-derived secrets.

Malformed/missing credentials, no candidate, profile verification failures, and ambiguous `VerifiedProfileDecision` reuse the generic upstream authentication failure category (401) without enumeration details. A successfully verified identity that cannot resolve a valid enabled binding/HostApp continues to use existing generic identity-issuance denial (403), without verifier fallback. Profile/JWKS infrastructure unavailability is a generic identity-service failure (5xx). No profile or Customer discovery condition returns a distinguishing 404.

## 9. Threat Model

| Threat | Control | Remaining risk |
| --- | --- | --- |
| JWT claim tampering | Verify signature before creating identity; strict claim validation | Compromised issuer remains issuer-level risk. |
| Unverified integration routing | Only `iss`/`kid` routing hints; verified identity/profile match required | Routing may cause bounded work, not authority. |
| Issuer spoofing | Exact profile issuer and one-issuer policy | Registered issuer compromise requires controlled disablement. |
| `kid`/algorithm confusion | RS256 only, non-blank `kid`, profile-isolated JWKS | Unknown key yields denial. |
| JWKS SSRF | Registration validation, HTTPS/egress rules, redirects denied, bounded transport | Approved internal endpoints require operational review. |
| Shared IdP confusion | Exact-one `VerifiedProfileDecision` from verified integration/profile matching; CanonicalIdentityResolver independently enforces binding and HostApp | Ambiguous profile configuration fails closed. |
| Disabled integration replay | Both profile and binding enabled at decision time; short cache/invalidation | A request already past decision is handled by existing token TTL/boundaries. |
| Cache staleness | Bounded cache, explicit invalidation, fail-closed refresh failures | Brief availability impact is preferred over unsafe acceptance. |
| Customer authority drift | Profile has no Customer field; binding is sole mapping | Storage corruption still fails validation/runtime checks. |
| Browser identity injection | Existing opaque SDK and public-input non-authority rules | Browser can only submit an otherwise valid credential. |
| Ambiguous verification | Count `VerifiedProfileDecision` values, never signatures alone; resolver remains a separate binding decision | Availability denial signals a configuration error, not a data leak. |

## 10. Verification Strategy

| Layer | Required proof |
| --- | --- |
| Unit — multi-profile verifier | Bounded `iss`/`kid` routing, exact issuer/audience, empty arrays, verified integration/profile mismatch, shared issuer/key behavior, zero/multiple `VerifiedProfileDecision` values, disabled profile, and exactly-one success. No Customer or binding resolution is exercised here. |
| Unit — CanonicalIdentityResolver regression | Binding existence, binding enabled state, HostApp match, and Customer authority remain verified independently. |
| Integration | Deployment-controlled profile provisioning, activation validation, duplicate handling, profile/JWKS cache and rotation behavior, SSRF rules, safe boundary-specific audit, and legacy-env bootstrap migration. |
| E2E | Customer A Direct JWT issuer and Customer B Token Exchange fixture issuer operate concurrently through real Gateway verification, existing internal signing/JWKS, and Feature 002 Backend verification. |

E2E negatives cover cross-profile/binding use, unknown issuer, wrong audience, wrong verified integration, HostApp mismatch, ambiguous decision, disabled profile/integration, Customer-like claims that cannot override the binding, and non-exposure of token/key/profile details. Existing Feature 003 signing, JWKS, narrow transport, and Feature 002 CustomerScope regressions remain required.

## 11. Design Decisions

| ID | Decision | Reason / alternatives | Security consequence |
| --- | --- | --- | --- |
| DECISION-001 | DB-backed trust profiles anchored to IntegrationBinding | Chosen over environment-only or a separate CustomerIntegration table | One Customer authority and auditable lifecycle. |
| DECISION-002 | Profile-aware verifier behind existing abstraction | Chosen over Customer-specific verifier classes | Handler and protected flow remain stable. |
| DECISION-003 | Exact-one `VerifiedProfileDecision` before canonical binding resolution | Chosen over first-match, signature-count, or verifier-owned Customer binding | Shared IdPs remain safe; unverified integration has no authority, while binding/Customer stay with the existing resolver. |
| DECISION-004 | Binding owns Customer and HostApp; profile owns verification policy | Chosen over duplicate profile fields | Prevents authority drift and double switches. |
| DECISION-005 | One active issuer/profile; replacement transition for migration | Chosen over concurrent dual issuer | Avoids accidental dual trust. |
| DECISION-006 | Exact audience/profile | Chosen over accepting any token audience | Audience cannot become a cross-integration authority shortcut. |
| DECISION-007 | Reuse `jose` Remote JWKS with Feature 004 hardening | Chosen over a new JWT stack | Keeps known verification behavior while addressing URI SSRF. |
| DECISION-008 | Deployment-controlled provisioning | Chosen over public administration | Limits control-plane exposure. |
| DECISION-009 | Bootstrap legacy env into one profile, then profile-only runtime | Chosen over permanent compatibility mode or abrupt removal | Prevents two competing upstream authorities. |
| DECISION-010 | Generic exchange contract plus test fixture | Chosen over production Customer adapter | Demonstrates legacy path without embedding Customer logic. |
| DECISION-011 | Safe audit taxonomy and bounded caches | Chosen over raw diagnostics/aggressive caching | Preserves investigation value without credential leakage or stale acceptance. |

## 12. Implementation Boundary

Future Feature 004 work may modify `apps/gateway/**`, the root Prisma schema/migration lineage if persistence is implemented, Gateway test fixtures, and Feature 004 documentation. It must not modify the Assistant SDK public contract, Customer frontend, Shinmone backend, Backend Feature 001 business runtime, Backend Feature 002 CustomerScope, or the Gateway internal signing contract.

No remaining design unknown blocks implementation planning. Deployment mechanism, actual database migration expression, operational egress allowlist, and infrastructure deployment remain implementation/deployment decisions constrained by this design.
