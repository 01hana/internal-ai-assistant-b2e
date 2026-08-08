# Feature 003 — Identity Gateway and Customer Integration Registry Design

**Feature**: `003-identity-gateway-customer-registry`
**Status**: Technical design — implementation has not begun
**Authority order**: Constitution 2.0.0 → Feature 003 `spec.md` → accepted Feature 002 behavior and readiness gate → current source. Historical `apps/gateway/dist/**` is mechanical reference only and is not design authority.

## 1. Overview

Feature 002 has completed the Backend half of the trust chain. Its protected business endpoints already verify an RS256 internal JWT through Remote JWKS, validate the canonical claims, attach `RequestIdentityContext`, derive immutable `CustomerScope`, and perform Customer-qualified work. Feature 003 supplies the missing upstream trust boundary: a Gateway that verifies a trusted external identity, resolves one explicit Integration-to-Customer binding, signs a short-lived internal JWT, publishes public verification keys, and calls the Backend.

The canonical internal JWT is a **Gateway-to-Backend service-to-service credential**. It is not an external login token, a Frontend credential, or a reusable token returned to a Host caller.

## 2. Current Architecture Inventory

### Backend baseline — exists and is authoritative

| Area | Verified current behavior | Feature 003 consequence |
| --- | --- | --- |
| Runtime | One NestJS 11 Backend application at `src/`; root package has NestJS, Prisma 7, PostgreSQL, and `jose`. | Gateway is a separate deployable app, not another Backend module. |
| Token verifier | `RemoteJwksInternalIdentityTokenVerifier` uses `createRemoteJWKSet`, accepts only `RS256`, requires non-blank `kid`, and validates issuer, audience, `iat`, `exp`, and optional `nbf`. | Gateway must publish compatible public JWKS and issue exactly this token shape. |
| Identity | `IdentityGuard` verifies before `validateVerifiedInternalIdentityClaims()` creates `RequestIdentityContext`. | Gateway must issue `customer_id`, `integration_id`, `sub`, `org_id`, `host_app`, `roles`, `permission_scopes`, and `jti`. |
| Scope | `createCustomerScopeFromIdentityContext()` freezes Customer, integration, organization, HostApp, actor, roles, and scopes. | Gateway cannot replace Backend authorization or Customer isolation. |
| Config | Backend requires `INTERNAL_IDENTITY_JWT_ISSUER`, `INTERNAL_IDENTITY_JWT_AUDIENCE`, `INTERNAL_IDENTITY_JWKS_URI`, and tolerance in `[0,300]`. | Deployment evidence must prove exact compatible Gateway values. |
| Request correlation | Request ID middleware normalizes `x-request-id` or generates one; it is not authority. | Gateway preserves/normalizes correlation only. |
| Audit/redaction | Audit writes are CustomerScope-first and `redactSecrets()` covers tokens, claims, JWKS, signatures, credentials, secrets, raw errors, and nested values. | Gateway needs equivalent centralized redaction, but must not write Backend business audits. |
| Persistence | PostgreSQL/Prisma has an existing minimal `Customer` root with Customer-qualified constraints and migrations. | Registry binds directly to this root; no second Customer model or inference is permitted. |

### Gateway baseline — not implemented

`apps/gateway` contains only ignored generated `dist/**` files. There is no `apps/gateway/src`, package manifest, TypeScript configuration, bootstrap, signer, JWKS endpoint, configuration module, tests, or Docker service. The old generated artifacts contain obsolete assumptions such as direct private-key environment values and a single role; they must not be copied as a Feature 003 authority.

The current local Backend configuration uses Gateway port `4000`, Backend port `3000`, issuer `http://localhost:4000`, audience `internal-ai-assistant`, JWKS URI `http://localhost:4000/.well-known/jwks.json`, and clock tolerance `0`. These are local defaults only; `.env.example` has production-shaped placeholder values and does not prove deployment alignment.

## 3. Architecture Goals and Non-goals

### Goals

- Establish a single external-to-Backend trust chain without restoring public-header identity.
- Resolve Customer ownership only through an explicit enabled Integration binding to an existing `Customer` row.
- Keep signing, JWKS, rotation, redaction, and Gateway issuance audit bounded to Gateway responsibility.
- Prove real Gateway-to-Backend Remote-JWKS interoperability and A/B isolation.

### Non-goals

Feature 003 is not a generic API Gateway, OAuth/OIDC provider, generic IAM platform, Customer lifecycle product, connector platform, HostApp capability registry, PageContext policy, selectedRows governance, sourceSystem policy, or Orders/Inventory integration. Those Host capability concerns belong to Feature 004.

## 4. Trust Boundary and Target Runtime Architecture

```text
External / Host caller
        │ external upstream credential only
        ▼
┌──────────────────────────────────────┐
│ Feature 003 Gateway                  │
│ - upstream JWT verification           │
│ - Integration → Customer resolution   │
│ - canonical identity composition      │
│ - RS256 internal JWT signing          │
│ - public JWKS and key lifecycle       │
│ - narrow Backend client               │
└───────────────────┬──────────────────┘
                    │ Authorization: Bearer <internal JWT>
                    ▼
┌──────────────────────────────────────┐
│ Feature 002 Backend                  │
│ - Remote-JWKS signature verification  │
│ - canonical claim validation           │
│ - RequestIdentityContext              │
│ - CustomerScope                        │
│ - authorization and business work      │
└──────────────────────────────────────┘
```

Gateway authority is limited to trusted upstream verification, integration authentication, explicit binding resolution, canonical identity derivation, signing-key lifecycle, JWKS publication, and Gateway security audit. Backend authority remains cryptographic verification at its boundary, claim validation, `RequestIdentityContext`, `CustomerScope`, CustomerToolPolicy, RAG, workflow, feedback/review, audit, and all Customer-qualified business access.

The external credential is consumed only by Gateway. Gateway replaces it with a newly signed internal token on the Backend request. It never returns the internal JWT in a response, SSE event, redirect, cookie, log, audit payload, or error body.

## 5. Gateway Runtime Structure and Shared Contract

### Runtime topology — decision

**Decision:** Feature 003 creates an independent NestJS Gateway application under `apps/gateway` with its own bootstrap, configuration, module graph, tests, and deployment process.

The repository is not currently a workspace monorepo, but a dedicated app is still the correct trust boundary: embedding a signer into the Backend would let the Backend both mint and verify its own identity and would not satisfy Feature 002's Gateway handoff. Gateway must not import `AppModule`, `AssistantModule`, `CustomerScope`, or any Backend business service. Backend must not import Gateway runtime modules.

The future app structure is:

```text
apps/gateway/src/
├── main.ts
├── gateway.module.ts
├── config/
├── upstream-auth/
├── integration-registry/
├── identity/
├── signing/
├── jwks/
├── backend-client/
├── audit/
├── observability/
└── health/
```

### Shared contract strategy — decision

**Decision:** create `packages/internal-identity-contract` as a private, pure local npm package. The root Backend and the future standalone Gateway each consume it through an explicit local `file:` dependency and normal package `exports` plus generated declarations. The package builds before either application; no npm workspace conversion, TypeScript path alias, or project-reference graph is introduced.

The package owns only canonical claim names, claim types, registered token metadata constants, and validation-neutral vocabulary. It must not contain Nest providers, JWT signing/verifying implementation, Prisma access, `CustomerScope`, repositories, or authority logic. Gateway owns composition and signing; Backend retains its verifier and claim validator. This prevents literal drift without turning the package into shared identity authority.

### Canonical Prisma boundary — decision

**Decision:** `prisma/schema.prisma` and its existing root migration lineage remain the repository's sole Prisma schema authority. Feature 003 adds `IntegrationBinding`, `GatewaySigningKey`, and `GatewayIdentityAuditEvent` there, in the same migration history as the existing `Customer` root. `apps/gateway` must not contain `prisma/schema.prisma`, a migrations directory, a duplicate `Customer` model, or an independent migration lineage.

Gateway uses an independently generated Prisma client, but that client is generated from the canonical root schema through a second root-schema generator output. Root Prisma generation produces both Backend and Gateway generated clients; Gateway never generates from a local schema. This keeps runtime module graphs independent while preserving one schema, relation graph, and migration owner.

## 6. Upstream Authentication and Integration Resolution

### V1 upstream authentication — decision

**Decision:** v1 accepts one RS256 upstream JWT authenticated against a deployment-configured trusted issuer, audience, JWKS URI, and clock tolerance. The token must carry non-blank `integration_id`, `sub`, `org_id`, `host_app`, `roles`, and `permission_scopes`; the two arrays may be empty but cannot contain blank elements.

This is the smallest repository-compatible path: Backend already uses `jose`, strict RS256/JWKS validation, and canonical array semantics. It avoids creating an API-key platform, storing Host secrets, or introducing a generic enterprise IAM layer. Multiple upstream issuers, API credentials, client certificates, and opaque token introspection are deferred until separately specified.

The Gateway verifies the upstream token before reading its identity claims. A client-supplied header, request body, query parameter, page context, metadata field, visible screen, or capability value is only untrusted input and cannot supplement a verified claim.

### Resolution algorithm

```text
verify upstream JWT
  → validate trusted upstream claim shape
  → canonical integrationId from verified integration_id
  → find IntegrationBinding by integrationId
  → require enabled binding and existing Customer FK
  → require verified host_app == binding.allowedHostApp
  → compose CanonicalGatewayIdentity
  → sign one internal JWT
  → call configured Backend route
```

There is no path from `org_id`, `sub`, roles, scopes, HostApp, request ID, page context, metadata, or public header to `customer_id`. Unknown, disabled, mismatched, absent, or malformed binding state has no default Customer and performs no signing or Backend request.

### Canonical identity composition

`CanonicalGatewayIdentity` is an internal immutable value used only after upstream verification and binding validation.

| Internal JWT claim | Sole authority | Required validation |
| --- | --- | --- |
| `customer_id` | `IntegrationBinding.customerId` | Existing Customer FK; never inferred. |
| `integration_id` | Verified upstream `integration_id` | Must exactly equal the binding primary key. |
| `sub` | Verified upstream `sub` | Non-blank string. |
| `org_id` | Verified upstream `org_id` | Non-blank string. |
| `host_app` | Verified upstream `host_app` plus binding | Non-blank and exact allowed HostApp match. |
| `roles` | Verified upstream roles | Non-blank string elements; empty array valid. |
| `permission_scopes` | Verified upstream scopes | Non-blank string elements; empty array valid. |
| `jti` | Gateway | New cryptographically random UUID for every internal token. |

## 7. Integration Registry and Persistence Design

### Registry decision

**Decision:** persist the narrow Integration Registry in the existing PostgreSQL database via Prisma. Static config mapping is rejected because it cannot provide referential integrity to the Customer root, auditable enable/disable state, deterministic test fixtures, or safe controlled provisioning.

### Proposed additive models

#### `IntegrationBinding`

| Field | Contract |
| --- | --- |
| `integrationId` | Primary key; stable, canonical, non-blank integration identifier. |
| `customerId` | Required FK to existing `Customer.id`; `onDelete: Restrict`. |
| `allowedHostApp` | Required non-blank scalar; v1 binds one HostApp per integration. A further HostApp uses another explicit integration binding. |
| `enabled` | Required boolean. Only `true` can issue internal JWTs. |
| `createdAt`, `updatedAt` | Operational traceability. |

The primary key prevents one integration ID from mapping to multiple Customers. Add indexes for `customerId` and `[customerId, allowedHostApp]`; no unique constraint prevents multiple integrations for one Customer/HostApp. The binding has no organization, actor, role, scope, page-context, Customer lifecycle, credential, or secret fields.

#### `GatewaySigningKey`

| Field | Contract |
| --- | --- |
| `kid` | Primary key and public-key selector. |
| `publicJwk` | Public JWK only; required `kty`, `kid`, `alg`, `use`, `n`, `e`. |
| `keyReference` | Non-secret deployment/provider reference; never telemetry output. |
| `status` | `new`, `published`, `active`, `retiring`, or `retired`; visibility and signing semantics are fixed below. |
| `notBefore`, `activatedAt`, `retireAfter`, `retiredAt` | Lifecycle timing and safe retirement proof. |
| `createdAt`, `updatedAt` | Operational traceability. |

Private key material is never stored in the application database. The migration must enforce at most one active key, use additive schema changes, and not rewrite Feature 002 Customer-owned data.

Key-state semantics are non-negotiable:

| State | JWKS visibility | Normal Backend request signing |
| --- | --- | --- |
| `new` | Hidden | Prohibited. Material is provisioned but no public key is published. |
| `published` | Included | Prohibited. The public JWK is available for propagation verification only. |
| `active` | Included | Required; exactly one key may issue normal Gateway-to-Backend tokens. |
| `retiring` | Included | Prohibited. Existing tokens may still be verified during overlap. |
| `retired` | Hidden | Prohibited. The JWK is removed only after the retirement invariant is satisfied. |

#### `GatewayIdentityAuditEvent`

A narrow, append-only Gateway security record stores timestamp, normalized request ID, safe event type/outcome/reason code, optional resolved Customer/integration/actor/HostApp, `jti`, and `kid`. It must not contain raw credentials, tokens, claims payloads, JWK private fields, or Backend business relations. It is not a replacement for Feature 002 `AuditEvent`.

### Provisioning and seed decision

**Decision:** v1 uses a controlled, idempotent internal provisioning command, not a public admin API. It accepts explicit existing `customerId`, `integrationId`, and HostApp; validates Customer existence; creates/enables/disables a binding; and writes only safe Gateway audit data. It cannot infer or create Customers.

Test seed fixtures create `Customer A`/`Integration A` and `Customer B`/`Integration B`. The verified upstream claims deliberately share `org_id`, `sub`, `host_app`, roles, and scopes; only Customer and integration IDs differ. Fixtures are synthetic and contain no real credential or committed private key.

## 8. Internal JWT, Signing Key Provider, and JWKS

### Issuance

`InternalIdentityTokenIssuer` is a narrow component: it receives a validated `CanonicalGatewayIdentity` and active signing-key handle, adds `iss`, `aud`, `iat`, `exp`, and protected-header `alg=RS256`, `typ=JWT`, `kid`, then signs. Algorithm, key ID, claims, and expiry are Gateway-selected; callers cannot choose or override them.

V1 internal token TTL is **5 minutes**. `nbf` is omitted to avoid unnecessary clock-boundary failures; Backend validates `iat` and `exp` with the deployment-aligned tolerance (local default `0`). Every Backend request receives a fresh token. `jti` supports trace correlation only and does not imply a replay cache or global replay prevention service.

### SigningKeyProvider

`SigningKeyProvider` exposes only the operations necessary to obtain an active signing handle and public JWK metadata. It isolates the issuer from private-key source mechanics.

- **Local/test:** an ignored developer-provisioned RSA key file is referenced by path; the real Gateway signer and real JWKS endpoint use it. Ephemeral test keys remain unit-test utilities and do not prove the real trust chain.
- **Production:** raw PEM values are prohibited in source control and environment variables. Deployment injects a read-only key reference/file into the runtime; the provider validates it without logging content. Future KMS/HSM/secret-manager adapters can implement the same boundary without changing issuance semantics.

### JWKS endpoint

Gateway publishes unauthenticated `/.well-known/jwks.json` with every `published`, `active`, and `retiring` public JWK, and with no `new` or `retired` key. It emits `Cache-Control: public, max-age=60, must-revalidate`; never includes `d`, `p`, `q`, `dp`, `dq`, or `qi`; and treats issuer URL and JWKS URL as distinct settings. Gateway unavailability is handled by the existing Backend Remote-JWKS failure behavior.

The HTTP cache header is not the Backend verifier's only cache contract. The current Backend creates `createRemoteJWKSet(new URL(...))` without options. Its installed `jose@5.10.0` defaults are a 600-second effective JWKS cache, a 30-second unknown-key reload cooldown, and a 5-second fetch timeout. Any future Backend override of those values must trigger a recomputation of the retirement invariant.

### Rotation and rollback

```text
new key provisioned
  → state new and assign unique kid
  → persist public metadata
  → state published; JWKS includes new kid
  → verify JWKS publication, Backend reachability, and propagation
  → activate new kid for normal request signing
  → immediately verify Backend accepts a new-kid token
  → previous active key becomes retiring
  → retain previous JWK throughout the minimum overlap
  → state retired and remove old JWK
```

No normal Gateway-to-Backend request is signed by a `new`, `published`, or `retiring` key. The `published` verification step proves public-key availability and Backend reachability before the signer is switched; regular Backend acceptance is verified immediately after activation.

The v1 retirement overlap is **at least 25 minutes**. It must be no shorter than:

```text
maximum validity window of the final old-key token (5 minutes)
+ maximum Backend clock tolerance (5 minutes)
+ effective Backend Remote-JWKS cache (10 minutes)
+ Remote-JWKS cooldown (30 seconds)
+ JWKS/network propagation safety margin (1 minute)
```

This 21.5-minute observed minimum is rounded up to 25 minutes. `Cache-Control: max-age=60` cannot substitute for the Remote-JWKS cache/cooldown terms. If a new key/JWKS/Backend verification fails, Gateway restores normal issuance to the prior active key and leaves its public JWK available; it never removes a still-needed key as rollback.

## 9. Gateway-to-Backend Client and Transport Rules

`GatewayBackendClient` is a narrow trust-chain client, not a general proxy, Host proxy, transparent passthrough, or API gateway. Every supported incoming Gateway operation resolves through a server-owned `BackendRouteDefinition` with a fixed Backend method, path template, and operation-specific request contract:

```text
incoming Gateway operation
  → explicit BackendRouteDefinition allowlist lookup
  → upstream authentication and Integration → Customer resolution
  → fresh internal JWT
  → one known protected Backend operation
```

The caller cannot select a Backend base URL, destination, arbitrary path, dynamic mapping, unsupported operation, or catch-all route. Only parameters, query values, body, content type, accept value, normalized `x-request-id`, `traceparent`, and SSE streaming declared by that route definition may be forwarded as data; none can change the selected Backend destination.

For an approved mapping, the client strips incoming `Authorization`, cookies, all public identity headers, and routing/control headers, then sets exactly one outbound `Authorization: Bearer <fresh internal JWT>`. No automatic retries occur for business requests. JSON responses use a bounded configurable Backend timeout; SSE requires a bounded connection timeout and streams the Backend response after connection establishment rather than buffering it. Backend errors are translated to Gateway's safe error model, and internal JWT material is not exposed in any response path.

## 10. Configuration, Local Development, and Production Contract

### Gateway configuration groups

- upstream trusted issuer, audience, JWKS URI, and clock tolerance;
- internal issuer, audience, five-minute TTL, active key reference, and public JWKS URL;
- registry database connection and Gateway audit destination;
- configured Backend base URL, route mapping, JSON timeout, and SSE connection/idle timeout.

The route mapping is a version-controlled server-owned allowlist of `BackendRouteDefinition` values, not a caller-configurable proxy table. The local package dependency and canonical Prisma generation run before Backend/Gateway application builds so both apps resolve the same claim vocabulary and schema-generated types without runtime imports between them.

### Backend configuration groups

- expected issuer;
- expected audience;
- Gateway public JWKS URI;
- clock tolerance.

Each production-like environment must demonstrate:

```text
Gateway issuer   == Backend expected issuer
Gateway audience == Backend expected audience
Backend JWKS URI → Gateway public JWKS
```

It must also demonstrate a production-safe signing-key source/configuration and compatible token-time settings. Deployment topology, Kubernetes, cloud provider, KMS/HSM, secret-manager product, and network implementation remain deployment decisions.

### Local topology

```text
Gateway: http://localhost:4000
Backend: http://localhost:3000
Issuer:  http://localhost:4000
JWKS:    http://localhost:4000/.well-known/jwks.json
Audience: internal-ai-assistant
```

The local Gateway uses a non-committed local signing-key file, an explicit local binding fixture, the same disposable PostgreSQL target as the controlled development/test setup, and the actual Gateway JWKS route. A test helper signer or static Backend verifier is never local integration evidence.

## 11. Error Model, Audit, Observability, and Redaction

| Internal class | Safe external outcome | Safe audit reason |
| --- | --- | --- |
| Invalid/missing upstream credential | Generic 401 authentication failure | `upstream_auth_invalid` |
| Unknown, disabled, binding/Customer/HostApp mismatch, invalid composed claims | Generic non-disclosing issuance denial | `identity_issuance_denied` with internal subtype |
| Signing provider, active key, key-state, or JWKS failure | Generic identity service unavailable | `signing_or_jwks_unavailable` |
| Backend timeout/unavailable | Generic Backend unavailable | `backend_transport_unavailable` |

Public outcomes never reveal whether a Customer, integration, key, binding, or external credential exists. Gateway telemetry may contain only request ID, resolved Customer ID after valid resolution, integration ID, actor ID, HostApp, `jti`, `kid`, decision code, duration, and safe status. `requestId` is correlation only and never participates in Customer resolution, permission, signing, or authorization.

One central Gateway redaction helper/logger policy must process HTTP request logging, HTTP client logging, exceptions, configuration errors, audit metadata, observability, and test diagnostics. Prohibited values are Authorization headers, Bearer tokens, full JWTs, signatures, private keys/JWKs, credentials, passwords, API keys, and secrets.

## 12. Test Architecture and Cross-Customer Verification

| Layer | Required proof |
| --- | --- |
| Unit | Upstream RS256 verification, claim shape, binding lookup, identity composition, issuer, signer, JWKS visibility by state, 25-minute retirement calculation, route allowlist rejection, safe errors, and redaction. |
| Integration | Gateway plus registry database, real signer/JWKS, A/B bindings, enabled/disabled/mismatch paths, published-key non-signing, retiring-key overlap, and no signing/Backend call after failed authority checks. |
| Contract | Gateway-issued JWT is accepted by Feature 002's unchanged Remote-JWKS verifier and rejected for wrong issuer/audience/signature/kid/time/claims. |
| E2E | Real Gateway runtime → real Gateway signer → real public JWKS → real Backend Remote-JWKS verifier → protected Backend endpoint. No mock verifier or test signer is evidence. |

The mandatory A/B fixture uses different `customer_id` and `integration_id`, but the same `org_id`, `sub`, `host_app`, roles, and permission scopes. Tests prove Integration A cannot obtain/sign Customer B identity and vice versa, even with identical lower-level values. They also prove that public headers cannot restore Feature 002 legacy identity behavior.

Rotation tests prove `kid-a` active, `kid-b` published and JWKS-visible without normal signing, propagated JWKS before signer switching, `kid-b` activation, `kid-a` retirement overlap for at least 25 minutes, Backend acceptance of both eligible token states, safe rollback to `kid-a`, unknown-kid rejection, and prohibition of premature key removal. Contract tests also prove that only the root canonical Prisma schema produces the separate Gateway generated client and that no Gateway-local schema/migration lineage is introduced.

## 13. Migration Strategy and Compatibility

Feature 003 schema changes are additive and are owned only by the root canonical Prisma schema/migration lineage: create the registry, signing-key metadata, and narrow Gateway audit tables; add Customer FKs and supporting indexes; and seed deterministic synthetic A/B bindings. A second generator in that same root schema produces Gateway's independent client. No Feature 002 Customer ownership data is rewritten, inferred, or remapped. Migrations fail closed on invalid existing Customer references.

Feature 002 remains unchanged and authoritative for Backend verification, canonical claim validation, scope creation, business authorization, Customer-qualified persistence, RAG, tools, workflow, feedback/review, and Backend audit. Gateway forwards a signed internal JWT, not `x-customer-id` or any public identity fallback. Production rollout remains BLOCKED until real runtime and deployment evidence satisfies every Feature 003 success criterion.

## 14. Threat Model and Non-negotiable Invariants

| Threat | Mitigation |
| --- | --- |
| Spoofed customer/integration/HostApp headers | Ignore as authority; require verified upstream claims and explicit binding. |
| Customer binding confusion | Integration primary key maps to exactly one Customer; FK plus enabled/HostApp checks happen before signing. |
| Permission elevation | Roles/scopes come only from verified upstream token; body/page/metadata cannot augment them. |
| Algorithm or `kid` confusion | RS256-only verifier/signer, Gateway-selected `kid`, JWKS public-key selection, unknown-kid fail closed. |
| Private key/JWKS leakage | Provider boundary, no DB private key, public-only JWKS, centralized redaction. |
| Premature retirement | New/published/active/retiring/retired lifecycle, JWKS visibility rules, 25-minute minimum overlap, rollback to prior active key. |
| Direct Backend bypass | Protected Backend continues to require its verified internal JWT; no header fallback exists. |
| Frontend internal-token exposure | Internal token is minted per Gateway→Backend request and never returned externally. |
| Generic Gateway proxy bypass | Server-owned `BackendRouteDefinition` allowlist rejects arbitrary destinations, paths, and catch-all forwarding. |
| Schema/migration split brain | One root Prisma schema and migration lineage produces both generated clients; Gateway-local schemas are prohibited. |
| Gateway audit becomes business audit | Gateway records only identity/security events; Feature 002 retains business audit ownership. |

## 15. Alternatives Considered

| Decision | Selected | Rejected alternative | Reason and impact |
| --- | --- | --- | --- |
| Registry | DB-backed Prisma/PostgreSQL binding | Static/config mapping | Direct Customer FK, auditable state, deterministic tests, and controlled provisioning. |
| Runtime | Independent NestJS Gateway | Embed issuer in Backend | Preserves the external trust boundary and avoids Backend self-issuance. |
| Upstream auth | One configured RS256 upstream JWT issuer/JWKS | API-key platform, opaque introspection, multi-issuer IAM | Smallest secure path compatible with current `jose`/JWKS patterns. |
| Key source | `SigningKeyProvider` with local file and production reference/file | Raw PEM source control or environment value | Prevents ordinary configuration/logging leakage while permitting future KMS/HSM. |
| Contract | Local `file:` pure vocabulary package with exports/declarations | Workspace conversion, TS path aliases, duplicated literals | Prevents drift without shared authority or a monorepo overhaul. |
| Prisma | One root schema/migration lineage with a second Gateway client generator | Gateway-local schema or migration history | Preserves one Customer relation graph while keeping app runtime modules independent. |
| Backend transport | Server-owned `BackendRouteDefinition` allowlist | Catch-all reverse proxy or caller-selected destination | Limits Feature 003 to the real identity trust chain. |
| Retirement | Published-before-active lifecycle and 25-minute overlap | 15-minute fixed overlap or HTTP-cache-only reasoning | Covers current Backend validity, verifier cache/cooldown, and propagation behavior. |
| Token reuse | Fresh 5-minute token per Backend request | Long-lived cached user token | Limits exposure and simplifies identity freshness; increases signing calls intentionally. |

## 16. Final Design Decisions and Open Questions

All required v1 decisions are resolved: independent Gateway, signed upstream JWT verification, DB-backed explicit registry, controlled provisioning command, five-minute per-request internal JWT, omitted `nbf`, provider-based key handling, public JWKS, safe key rotation, and real Runtime E2E proof.

There are no blocking design questions. Exact deployment provider, KMS/HSM adapter, secret product, upstream identity-system onboarding mechanics, and route-level deployment infrastructure remain implementation/deployment choices constrained by this design and the locked Feature 003 specification.
