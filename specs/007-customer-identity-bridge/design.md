# Feature 007 Design: Customer-side Identity Bridge & First Customer Session Bootstrap

**Status**: Design only
**Scope**: Define the independently deployable Customer-side Identity Bridge. This document creates no production code, does not change Features 002–006, and does not modify Customer IDX/Auth, application, SCM, or business systems.

## 1. Repository Placement and Trust Topology

### 1.1 Placement decision

`apps/identity-bridge` is the selected repository placement. It is compatible with the current repository: `apps/gateway` is already a standalone Nest application with its own `package.json`, Nest compiler configuration, tests, and `npm --prefix` build pattern. The root project does not require Bridge runtime composition with Gateway.

The future Bridge application follows that package/build convention, but is a separate deployable unit:

| Concern | Central Assistant | Customer environment |
| --- | --- | --- |
| Runtime | `apps/gateway` and internal Assistant Backend | `apps/identity-bridge` and Customer SPA |
| Native IDX credential | Never received | SPA sends current AccessToken only to Bridge |
| MenuDetail | Never received raw | Protected endpoint called by Bridge |
| Signing domain | Gateway internal and managed signing only | Bridge upstream signing only |
| Private key | Central Gateway private material | Customer-local Bridge secret mount |
| Customer authority | Feature 004 `IntegrationBinding` | Never issued or inferred by Bridge |

The Bridge and Gateway must not share a process, container, deployment lifecycle, environment variables, filesystem secret volume, network-trust assumption, or signing key. Sharing a source repository does not create a runtime trust relationship.

### 1.2 Identity-material egress boundary

The egress restriction applies to IDX-derived identity, authorization, credential, and signing material only. The canonical upstream JWT may cross from Customer to central Assistant services. Native IDX AccessToken, RefreshToken, raw native claims, raw MenuDetail, and Customer-local private signing material must not cross that boundary.

Normal Assistant request and response traffic remains under existing product contracts. This design creates no new chat or business-payload authority.

```text
Customer SPA --current IDX AccessToken--> Customer-local Bridge
Customer-local Bridge --one bearer request--> Customer IDX MenuDetail
Customer-local Bridge --canonical upstream JWT--> central Gateway Feature 004
central Gateway --internal JWT--> Assistant Backend
```

### 1.3 Central-reachable public JWKS topology

The identity exchange remains Customer-local, but the Bridge's public verification material must be reachable by central Gateway through a Feature-004-compatible public HTTPS JWKS URI. Central Gateway does not require access to a private Customer network and does not call the Bridge exchange endpoint.

The preferred V1 deployment exposes both paths through a Customer-controlled public HTTPS SPA origin or reverse proxy:

```text
Customer SPA public HTTPS origin / Customer-controlled reverse proxy
├─ /assistant-identity/identity/exchange
│  └─ Customer-local Bridge exchange processing
└─ /assistant-identity/.well-known/jwks.json
   └─ Bridge public JWKS
```

An equivalent Customer-controlled public HTTPS route for the JWKS is acceptable; its exact URL is deployment controlled. Its URI must satisfy the existing Feature 004 `ProductionJwksSourceRegistrationPolicy` HTTPS/public-destination requirements without any policy change. Only public JWK material may be exposed there. The JWKS route must expose no native token, private key, configuration secret, Entry, Customer data, raw claim, or MenuDetail. Public JWKS reachability does not move exchange processing or private signing material outside the Customer environment.

If a Customer deployment cannot supply a Feature-004-compatible central-reachable public HTTPS JWKS URI, it is not staging-ready.

## 2. Bridge Runtime and API Contract

### 2.1 Minimal endpoints

| Endpoint | Purpose | Authentication | Sensitive output |
| --- | --- | --- | --- |
| `POST /identity/exchange` | Exchange current IDX AccessToken for canonical upstream JWT | Required `Authorization: Bearer <IDX AccessToken>` | Short-lived canonical bearer JWT; response-only, redacted everywhere else |
| `GET /.well-known/jwks.json` | Publish Bridge public verification keys through the configured central-reachable public HTTPS route | Public | Public JWKs only |
| `GET /health` | Liveness | Public | None |
| `GET /ready` | Local configuration/key/endpoint-policy readiness | Public | None |

`POST /identity/exchange` accepts an empty JSON object or no body. Any body field is rejected. It never accepts Customer, `integration_id`, `host_app`, `org_id`, roles, permission scopes, `entryId`, `UUID_Entry`, `selectedEntry`, IDX endpoint, issuer, audience, or signing configuration from the browser.

Successful response shape:

```json
{
  "accessToken": "<short-lived canonical upstream JWT>",
  "tokenType": "Bearer",
  "expiresIn": 300
}
```

The canonical upstream JWT is intentionally returned only to the Customer SPA and then sent as the authentication credential to the registered central Gateway. It is sensitive bearer credential material: it is not logged as raw material, written to audit payloads, included in telemetry or tracing attributes, persisted by the Bridge, exposed in errors, health/readiness responses, diagnostics, or snapshots, or stored in browser localStorage or sessionStorage. The response otherwise contains no native IDX AccessToken, RefreshToken, raw native claims, raw MenuDetail, signing material, Customer authority, or configuration detail.

| Condition | HTTP status | Safe code |
| --- | --- | --- |
| Missing/malformed bearer or non-empty/unknown body | 400 | `IDENTITY_EXCHANGE_REQUEST_INVALID` |
| IDX rejects credential or accepted claims are invalid | 401 | `IDENTITY_EXCHANGE_IDENTITY_INVALID` |
| Exact allowed-entry membership fails | 403 | `IDENTITY_EXCHANGE_IDENTITY_DENIED` |
| IDX unavailable, unsafe destination, timeout, malformed response, key/configuration failure | 503 | `IDENTITY_EXCHANGE_UNAVAILABLE` |

Errors contain only `statusCode`, `code`, a generic message, and normalized request correlation. They do not contain the native token, canonical JWT, headers, claims, MenuDetail body/status, endpoint details, key details, or Customer data.

`/health` reports liveness only. `/ready` is a Customer-local signal and reports ready only after required configuration is present; `BRIDGE_JWKS_PUBLIC_URI` is syntactically valid HTTPS and not obviously loopback, private, or internal under the declared public topology; active-key/public-JWK configuration is internally consistent; exactly one active signing key exists; local JWKS generation is valid; and IDX endpoint-policy and Entry-admission configuration checks pass. It makes no IDX request and does not claim to prove that central Gateway can reach or trust the public JWKS URI.

### 2.2 Browser origin and token handling

V1 uses a same-origin Customer reverse-proxy path, such as `https://<customer-spa-origin>/assistant-identity`, that forwards only to the independently deployed Bridge. Browser code calls the Bridge at that path; no CORS policy is required in this primary deployment.

If an operational deployment requires a separate Bridge origin, the Bridge permits only configured exact HTTPS Customer SPA origins, `GET`, `POST`, and `OPTIONS`, and `Authorization`, `Content-Type`, `Accept`, request-correlation, and tracing headers. Wildcard origins and credentialed cookie CORS are forbidden. The bearer header is explicitly supplied by the SPA, so no ambient cookie credential is accepted; this avoids a new CSRF authority path. XSS protection remains the Customer SPA's existing security responsibility.

The narrow Customer SPA Assistant integration/composable obtains the current IDX AccessToken from existing Frontend-Auth, calls the local exchange endpoint, retains the returned canonical JWT in memory only, calls the existing central session route, and opens chat with the returned `sessionId`. It must not put the canonical JWT in localStorage or sessionStorage. On expiry it obtains a current IDX AccessToken and repeats local exchange. RefreshToken never enters this flow. Decoded-token console logging must be removed before staging UAT.

## 3. IDX Verification, Admission, and Permissions

### 3.1 Fixed verification sequence

The Bridge preserves Feature 006 semantics in this exact order:

Customer Auth completes authentication, authorized-Entry discovery, Entry selection, and current-token acquisition before this sequence begins. The Bridge calls neither `/APIs/Auth/APIs/Auth/Authentication` nor an Entry-discovery endpoint and maintains no selected-Entry state.

1. Validate Bridge deployment configuration and fixed IDX endpoint policy.
2. Send the exact current native bearer once to the configured protected MenuDetail endpoint.
3. Require HTTPS response success, JSON content, application `Code == 200`, and strict MenuDetail schema validation.
4. Only then structurally parse the same native JWT payload; no local IDX signature, ES512, JWKS, key-selection, or time-claim verification is performed.
5. Require nonblank `sub`, `UUID_User`, `UUID_Company`, and `UUID_Entry`; require `sub === UUID_User`.
6. Require one authoritative `UUID_Company` value, exact case-sensitive `UUID_Entry` membership in the deployment-controlled allowed-entry set, and validated semantic menu material.
7. Project canonical scopes and issue the Bridge JWT.

`UUID_Company` provided as an array, or any case where authoritative IDX behavior does not establish exactly one organization, fails closed. The Bridge does not choose an array value, accept a browser-selected company, or infer organization from Entry. The first Customer staging readiness checklist must include documentary/test evidence that the accepted production IDX behavior supplies one deterministic organization before UAT can begin.

`UUID_Entry` is the sole admission anchor and must belong to the configured allowed-entry set. It never establishes Customer, organization, integration, HostApp, issuer, audience, roles, or permission scopes. `UserType`, `IsAdmin`, `Permissions`, and `Permission_Hash` are non-authoritative.

### 3.2 Permission projection

MenuDetail is the sole V1 permission authority. Each accepted `MenuID` yields `menu:<MenuID>:read`; exact `Y` values yield the remaining actions in fixed order:

```text
read, insert, update, delete, print, import, export, copy, approval
```

Duplicate `(MenuID, action)` values are removed. Menu IDs are sorted ordinally, then actions follow the fixed order. No scope contains Customer ID, integration ID, IDX UUID, or unapproved IDX fields.

### 3.3 Customer-local destination policy

The Bridge fixes the MenuDetail endpoint in deployment configuration. The browser cannot choose a URL, method, headers, timeout, DNS policy, or retry behavior.

| Policy | Central SaaS Gateway | Customer-local Bridge |
| --- | --- | --- |
| Endpoint class | Public-only destination | One configured Customer IDX destination |
| Private networks | Rejected | Allowed only with an explicit CIDR allowlist |
| DNS validation | Reject private/internal addresses | Validate at resolution and connection against selected mode |
| Redirects/retries | Denied/no retry | Denied/no retry |
| Bounds | Existing central limits | Same 5-second maximum deadline and 256 KiB maximum JSON response |

`IDX_DESTINATION_MODE` has exactly two values:

- `public_only`: every resolved and connected address must be publicly routable.
- `allowlisted_networks`: every resolved and connected address must belong to one configured Customer CIDR allowlist; public addresses are not accepted in this mode.

Both modes require HTTPS, no URI credentials/fragments, one `GET` request with `Authorization: Bearer <native token>`, connection-time DNS rebinding validation, redirect denial, JSON-only response, the stated bounds, and no retry. A failed policy check occurs before token forwarding.

## 4. Canonical JWT and Signing Domain

### 4.1 Canonical upstream JWT

The Bridge emits a five-minute Feature-004-compatible JWT. Its protected header and claims are:

| Location | Required value |
| --- | --- |
| Header | `alg: RS256`, nonblank `kid` |
| Registered claims | configured exact `iss`, configured exact `aud`, numeric `iat`, numeric `exp = iat + 300`, generated UUID `jti` |
| Canonical claims | deployment-owned `integration_id`, accepted `sub`, accepted single `org_id`, deployment-owned `host_app`, `roles: []`, deterministic `permission_scopes` |

No `customer_id`, Customer claim, raw IDX claim, Entry, native credential, or MenuDetail material is included. The five-minute lifetime matches the existing Feature 005 managed issuer; central Feature 004 applies its existing configured clock tolerance during verification.

### 4.2 V1 signing configuration and key lifecycle

V1 uses file-backed PKCS#8 RSA private keys mounted as Customer-local deployment secrets. The key loader accepts a `file:` reference and imports it for RS256 signing. No KMS/HSM provider is assumed; KMS/HSM integration is future work and does not alter the V1 contract.

`BRIDGE_SIGNING_KEYS` is deployment configuration containing public metadata and references only:

```text
[{ kid, status, publicJwk, keyReference? }]
```

Allowed statuses are `published`, `active`, and `retiring`. Exactly one key is `active` and has a Customer-local `file:` PKCS#8 reference. `published` and `retiring` keys publish a public RSA JWK without private JWK members. Startup derives the active key's public JWK and requires it to equal the configured public JWK. It rejects duplicate IDs, private JWK members, non-RSA/RS256/signing JWKs, absent active key, or any key reference outside the Bridge deployment.

`/.well-known/jwks.json` exposes published, active, and retiring public keys, sorted by `kid`, with `kty`, `kid`, `alg`, `use`, `n`, and `e` only. Its deployment-controlled URI must remain public-HTTPS-reachable to the central Gateway under the unchanged Feature 004 production JWKS destination policy.

Rotation is deployment controlled:

1. Add the new public JWK as `published` and deploy it to the Bridge.
2. Confirm the existing central TrustProfile can retrieve and validate the Bridge JWKS.
3. Deploy the new key as `active` and mark the former active key `retiring`.
4. Retain the former public JWK for at least 1,500 seconds (25 minutes) after its last issuance. This conservative minimum covers the 300-second token lifetime, 300-second maximum Feature 004 upstream clock tolerance, 600-second maximum upstream JWKS cache age, 30-second unknown-`kid` refresh cooldown, and existing 60-second propagation safety margin; the calculated 1,290 seconds is rounded up to the established Gateway rotation minimum.
5. Recalculate the required overlap before removal whenever any cache, clock-tolerance, token-lifetime, cooldown, or propagation bound increases.
6. Remove the former key from Bridge configuration only after that eligibility window; central unknown/retired-key verification fails closed.

The Bridge signing domain is distinct from Feature 003 Gateway internal signing and Feature 005 central managed signing. It uses no central database and writes no private material to any application database, audit record, log, telemetry, or response.

## 5. Configuration and Readiness Contract

The Bridge requires these deployment values before it can become ready:

| Configuration | Validation |
| --- | --- |
| `BRIDGE_IDX_MENUDETAIL_URI` | HTTPS absolute URI, no credentials/fragments, valid under selected destination mode |
| `BRIDGE_IDX_ALLOWED_ENTRIES` | JSON array containing one or more unique, nonblank exact `UUID_Entry` admission values; matching is case-sensitive and the legacy singleton field is rejected |
| `BRIDGE_INTEGRATION_ID`, `BRIDGE_HOST_APP` | Nonblank server-owned canonical values |
| `BRIDGE_ISSUER`, `BRIDGE_AUDIENCE` | Nonblank exact JWT issuer and audience |
| `BRIDGE_JWKS_PUBLIC_URI` | Feature-004-compatible public HTTPS JWKS URI reachable from central Gateway; no loopback, private, or internal destination |
| `BRIDGE_SIGNING_KEYS` | Exactly one active valid RSA signing key; public JWK lifecycle is valid |
| `IDX_DESTINATION_MODE`, `IDX_ALLOWED_CIDRS` | One valid mode; CIDRs are required only for `allowlisted_networks` |
| `BRIDGE_TIMEOUT_MS` | Integer 1 through 5,000 |
| `BRIDGE_MAX_RESPONSE_BYTES` | Integer 1 through 262,144 |
| `BRIDGE_ALLOWED_ORIGINS` | Required only for distinct-origin deployment; exact HTTPS origins, never wildcard |

No Customer ID appears in Bridge configuration as authority. Every malformed, missing, conflicting, disabled, unsafe, or locally invalid JWKS publication value makes `/ready` not ready and causes exchange to fail with the safe unavailable result. Central provisioning/readiness must independently prove that the registered JWKS URI satisfies the unchanged Feature 004 production policy before staging UAT.

Staging identity readiness is composed explicitly as:

```text
BRIDGE_LOCAL_READY
+
CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED
=
STAGING_IDENTITY_READY
```

`CENTRAL_FEATURE004_JWKS_REACHABLE_AND_TRUSTED` requires existing `ProductionJwksSourceRegistrationPolicy` acceptance, TrustProfile provisioning, central JWKS retrieval, and Feature 004 verification of a synthetic Bridge canonical JWT. If central retrieval or verification fails, staging identity readiness fails even when Bridge `/ready` is healthy. This uses no new Feature 004 API and changes no Feature 004 behavior.

## 6. Feature 006 Reuse Assessment

| Existing component | Classification | Design decision |
| --- | --- | --- |
| `idx-menu-detail.validator.ts` | `REUSABLE_AFTER_SMALL_EXTRACTION` | Preserve its schema/reduction rules through Bridge-local implementation and shared semantic fixtures; do not extract now. |
| `idx-menu-detail.permission-normalizer.ts` | `REUSABLE_AFTER_SMALL_EXTRACTION` | Preserve deterministic menu/action behavior through Bridge-local implementation and shared semantic fixtures. |
| Menu scope formatting in `managed-permission-scope.projector.ts` | `REUSABLE_AFTER_SMALL_EXTRACTION` | Preserve exact scope output locally; no central extraction in this feature. |
| `idx-delegated-verification.adapter.ts` | `CENTRAL_ONLY` | It depends on central provider contracts, persistence types, and central error model. |
| `managed-canonicalization.service.ts` | `CENTRAL_ONLY` | It reads Feature 005 central configuration and organization modes. |
| `delegated-http.transport.ts` | `DO_NOT_REUSE` | Its public-SaaS destination policy rejects legitimate Customer-private IDX endpoints. |
| `managed-upstream-token-issuer.ts` | `CENTRAL_ONLY` | It is bound to Feature 005 managed signing providers and lifecycle. |
| `managed-jwks.controller.ts` | `CENTRAL_ONLY` | It is bound to Feature 005 central issuer/key persistence. |

Feature 007 requires no Feature 006 shared extraction. Bridge-local semantic conformance fixtures must cover the accepted MenuDetail schema, claim consistency, scope ordering, and admission decisions. This keeps Feature 006 production behavior unchanged and avoids importing the managed exchange module into the Customer deployment.

## 7. Central Feature 004 Provisioning

The first Customer staging integration uses existing central mechanisms only:

1. Confirm the target Customer record already exists; Customer creation is a prerequisite, not Feature 007 behavior.
2. Use `ProvisionIntegrationBindingCommand` to provision the Bridge `integrationId`, existing Customer ID, exact `allowedHostApp`, and enabled state.
3. Use `ProvisionTrustProfileCommand` to provision an active `RegisteredUpstreamTrustProfile` anchored to that binding with Bridge issuer, exact audience, `RS256`, and the Bridge public HTTPS JWKS URI.
4. Use existing `TrustProfileActivationValidator` and `TrustProfileRuntimeReadiness` to validate that the profile, binding, algorithm, central-reachable public JWKS source, and enabled lifecycle are acceptable.
5. Validate one synthetic Bridge canonical JWT through the unchanged Feature 004 verifier before enabling SPA handoff.

This creates no new central admin endpoint, Customer-resolution mechanism, Customer claim, IntegrationBinding semantic, or Feature 004 verifier behavior. Feature 004 remains responsible for `integration_id -> customerId` and final HostApp admission only after cryptographic verification.

## 8. Validation, Rollout, and Rollback

### 8.1 Test layers

| Layer | Required evidence |
| --- | --- |
| Bridge unit/contract | Strict empty-body/bearer boundary, local `/ready` configuration checks, and API response/error shapes |
| Synthetic IDX | Verification order, strict MenuDetail reduction, claim checks, Entry mismatch, deterministic permissions |
| Signing/JWKS | Canonical claims, five-minute expiry, issuer/audience, local JWKS generation, central-reachable public HTTPS JWKS, active/published/retiring lifecycle, 1,500-second key-retirement overlap, and unknown-key denial |
| Credential redaction | Canonical JWT is returned to the SPA and accepted by the central Gateway, but absent from Bridge logs, audit payloads, telemetry/traces, error bodies, persistence, diagnostics, and snapshots; it remains memory-only in the SPA |
| Native-material non-egress | Native AccessToken, RefreshToken, raw claims, and raw MenuDetail absent from central requests, logs, audit, telemetry, persistence, snapshots, and errors |
| Feature 004 compatibility | Bridge JWT is accepted by exactly one existing profile then resolved only through IntegrationBinding |
| Two-configuration isolation | Distinct endpoint/allowed-entry-set/integration/HostApp/key configurations cannot cross-admit |
| SPA handoff | Existing Frontend-Auth supplies AccessToken only locally; JWT is memory-only; `sessionId` opens chat |
| Central provisioning/session | Existing Feature 004 provisioning/readiness proves central JWKS retrieval and synthetic Bridge JWT verification; combined with healthy local `/ready`, this proves `STAGING_IDENTITY_READY`, then the unchanged central session route returns `sessionId` |
| Real staging UAT | Real IDX login, real MenuDetail, single-company proof, canonical JWT, binding, session, chat opening, and central non-egress proof |

Synthetic evidence cannot set the final feature gate. Staging UAT must prove central native AccessToken, central RefreshToken, and central raw MenuDetail are absent.

### 8.2 Rollout and rollback

1. Build and deploy the Bridge without Customer SPA handoff and before central trust is enabled.
2. Configure Customer-local signing and a central-reachable public HTTPS JWKS route; validate Bridge-local `/ready`.
3. Provision the existing central Customer binding and Feature 004 TrustProfile, then prove central JWKS retrieval and synthetic Bridge JWT verification under the unchanged policy.
4. Declare `STAGING_IDENTITY_READY` only when both Bridge-local `/ready` and central Feature 004 JWKS reachability/trust evidence pass.
5. Enable the narrow Customer SPA Assistant handoff.
6. Run the mandatory real Customer staging UAT.

Rollback disables the Bridge deployment/configuration and disables the existing IntegrationBinding or TrustProfile as appropriate. It does not modify Customer IDX/Auth, Customer SCM/application Backend, or Feature 004 semantics.

## Design Conclusion

```text
IDENTITY_BRIDGE_REPOSITORY_PLACEMENT=apps/identity-bridge
PLACEMENT_COMPATIBLE_WITH_CURRENT_REPO=YES
FEATURE007_DESIGN_READY=YES
IDENTITY_BRIDGE_PLACEMENT_DECIDED=YES
BRIDGE_INDEPENDENT_DEPLOYMENT_PRESERVED=YES
FEATURE006_SHARED_EXTRACTION_REQUIRED=NO
FEATURE006_PRODUCTION_SEMANTICS_CHANGED=NO
FEATURE006_SEMANTICS_CHANGED=NO
CANONICAL_JWT_CLASSIFIED_AS_SENSITIVE_CREDENTIAL=YES
CANONICAL_JWT_RAW_LOGGING_ALLOWED=NO
CANONICAL_JWT_BROWSER_PERSISTENCE_ALLOWED=NO
BRIDGE_READY_CLAIMS_CENTRAL_REACHABILITY=NO
CENTRAL_JWKS_REACHABILITY_SEPARATELY_PROVEN=YES
STAGING_IDENTITY_READINESS_COMPOSITION_DEFINED=YES
CENTRAL_REACHABLE_BRIDGE_JWKS_DEFINED=YES
FEATURE004_JWKS_POLICY_CHANGE_REQUIRED=NO
BRIDGE_KEY_RETIREMENT_MIN_SECONDS=1500
BRIDGE_KEY_RETIREMENT_CACHE_AWARE=YES
BRIDGE_PRIVATE_KEY_REMAINS_CUSTOMER_LOCAL=YES
NATIVE_IDX_TOKEN_CENTRAL_EGRESS_REQUIRED=NO
CUSTOMER_LOCAL_TRANSPORT_POLICY_DEFINED=YES
EXCHANGE_API_CONTRACT_DEFINED=YES
UUID_COMPANY_PRE_UAT_GATE_PRESERVED=YES
BRIDGE_SIGNING_DOMAIN_DEFINED=YES
BRIDGE_JWKS_ROTATION_DEFINED=YES
CENTRAL_FEATURE004_PROVISIONING_DEFINED=YES
CUSTOMER_SPA_HANDOFF_DEFINED=YES
REAL_CUSTOMER_UAT_DEFINED=YES
FEATURE003_MODIFICATION_REQUIRED=NO
FEATURE004_MODIFICATION_REQUIRED=NO
FEATURE005_MODIFICATION_REQUIRED=NO
FEATURE006_PRODUCTION_MODIFICATION_REQUIRED=NO
```
