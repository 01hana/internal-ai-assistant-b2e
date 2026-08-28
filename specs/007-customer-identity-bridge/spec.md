# Feature Specification: Customer-side Identity Bridge & First Customer Session Bootstrap

**Feature Branch**: `007-customer-identity-bridge`
**Created**: 2026-08-28
**Status**: Draft
**Input**: Build an Assistant-owned, independently deployable Customer-side identity runtime that keeps native IDX credentials in the Customer environment and completes the first real Customer staging Assistant session bootstrap.

## Product Context and Boundary

Feature 007 supplies the Customer-controlled trusted server boundary established by Feature 004's trusted server-side token exchange contract. It is repository-owned by the Assistant product but deployed independently in the Customer environment. It does not change Customer IDX/Auth, application, SCM, or business Backend systems.

```text
Customer Nuxt SPA
  -> current native IDX AccessToken
  -> Customer-local Identity Bridge
  -> configured protected IDX MenuDetail endpoint
  -> accepted IDX identity, admission, and permission projection
  -> short-lived canonical upstream JWT
  -> central Gateway Feature 004 verification
  -> IntegrationBinding -> Customer and allowed HostApp
  -> Gateway internal JWT -> Backend CustomerScope
  -> existing POST /api/v1/assistant/sessions -> sessionId -> chat window
```

The following restriction applies only to IDX-derived identity, authorization, credential, and signing material. The canonical upstream JWT may cross from the Customer environment to central Assistant services. Native IDX AccessToken, RefreshToken, raw native claims, raw MenuDetail responses, and Customer-local private signing material must remain in the Customer environment. Normal non-identity Assistant application request and response traffic remains governed by existing product contracts and is outside this identity-material egress restriction; this feature establishes no new chat or business-payload authority.

Feature 007 defines one reusable bridge for configuration-driven Customer deployments. It does not create a generic IAM product, Customer-specific central Gateway path, Customer account store, or Customer-specific source branch.

## Authority Ownership

| Semantic | Authoritative source | Explicitly not authoritative |
| --- | --- | --- |
| Native IDX credential validity | Configured protected MenuDetail endpoint accepting the exact presented bearer | Native JWT decoding, local signature/key guessing, browser assertion |
| `sub` | Accepted IDX identity | Browser-supplied identity |
| `UUID_User` | Consistency check; it must equal `sub` | A separate actor identity |
| `org_id` | One accepted, authoritative `UUID_Company` value | First array item, Entry inference, browser active-company selection |
| `UUID_Entry` | Exact configured admission anchor | Customer resolution or HostApp authority |
| Permission scopes | Successful MenuDetail result | `UserType`, `IsAdmin`, `Permissions`, `Permission_Hash`, browser input |
| `integration_id`, `host_app` | Bridge deployment configuration | SPA, SDK, IDX native claims |
| Customer and final HostApp admission | Existing Feature 004 `IntegrationBinding` | Bridge credential, Entry, organization, selector |

The Bridge emits exactly the existing canonical upstream semantics: `integration_id`, `sub`, `org_id`, `host_app`, `roles`, and `permission_scopes`. Roles are always `[]`; the credential contains no Customer claim or Customer authority.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exchange a Current IDX Credential Locally (Priority: P1)

An authenticated Customer user obtains an Assistant-compatible credential without sending a native IDX credential to central Assistant services.

**Why this priority**: This establishes the required Customer-side trust boundary.

**Independent Test**: Present a current native IDX AccessToken to the Customer-local Bridge and verify that only a short-lived canonical credential reaches the central Gateway path.

**Acceptance Scenarios**:

1. **Given** a Customer SPA has a current IDX AccessToken, **When** it requests a local identity exchange, **Then** the Bridge accepts only that bearer credential and returns the short-lived canonical upstream JWT, with only minimal safe token-lifecycle metadata if required by the eventual client contract.
2. **Given** an exchange succeeds, **When** the central Gateway receives the next request, **Then** it receives the canonical upstream JWT and not the IDX AccessToken, RefreshToken, raw claims, or raw MenuDetail response.
3. **Given** a caller supplies Customer, integration, HostApp, organization, roles, scopes, Entry, issuer, audience, or endpoint values, **When** exchange is requested, **Then** none changes Bridge authority.

---

### User Story 2 - Verify and Project Accepted IDX Identity (Priority: P1)

An IDX credential becomes a canonical identity only after the configured protected MenuDetail endpoint accepts that exact credential and its response is valid.

**Why this priority**: It preserves the established IDX authority model rather than trusting decoded browser credentials.

**Independent Test**: Exercise valid and invalid protected-endpoint responses, IDX claim consistency, Entry admission, and MenuDetail permission records.

**Acceptance Scenarios**:

1. **Given** MenuDetail accepts the exact bearer and returns a valid successful response, **When** identity is projected, **Then** a nonblank `sub`, matching `UUID_User`, one authoritative `UUID_Company`, and nonblank `UUID_Entry` are required.
2. **Given** MenuDetail has not accepted the credential, **When** a decodable native JWT is supplied, **Then** no identity or permission authority is established.
3. **Given** the accepted Entry does not exactly match the configured admission value, **When** exchange is requested, **Then** no canonical JWT is issued.
4. **Given** a valid MenuDetail record, **When** scopes are projected, **Then** it yields implicit `menu:<MenuID>:read` and only enabled actions in the fixed order: `insert`, `update`, `delete`, `print`, `import`, `export`, `copy`, and `approval`.

---

### User Story 3 - Fail Closed for Ambiguous Organization and Sensitive Failures (Priority: P1)

An ambiguous IDX organization or unavailable/invalid verification never becomes Assistant authority and never discloses sensitive IDX material.

**Why this priority**: A multi-company selection error can cross an organization boundary before downstream authorization applies.

**Independent Test**: Test absent, blank, mismatched, multi-valued, malformed, denied, unavailable, and malformed-success cases without issuing a canonical JWT.

**Acceptance Scenarios**:

1. **Given** accepted IDX identity contains `UUID_Company` as multiple values or lacks a deterministic authoritative single organization, **When** exchange is requested, **Then** it fails closed and no browser value selects an organization.
2. **Given** IDX returns a rejection, timeout, unavailable response, or malformed success response, **When** exchange is requested, **Then** no canonical JWT is issued and the response does not disclose raw IDX material.
3. **Given** native credentials or raw MenuDetail are processed locally, **When** logs, audit data, telemetry, persistence, snapshots, or public errors are inspected, **Then** those sensitive values are absent.

---

### User Story 4 - Trust a Customer-local Signing Domain (Priority: P1)

A central operator can register and trust the Bridge's public verification material while private signing material remains Customer-local.

**Why this priority**: The central Gateway must verify the same canonical contract without receiving Customer native credentials.

**Independent Test**: Register the Bridge issuer, exact audience, and public JWKS through the existing Feature 004 trust profile, then verify valid, unknown-key, retired-key, and wrong-audience credentials.

**Acceptance Scenarios**:

1. **Given** a provisioned Bridge signing domain, **When** it issues a canonical credential, **Then** the credential is short-lived, asymmetrically signed with RS256, has a nonblank `kid`, and has the configured issuer and exact audience.
2. **Given** the Bridge publishes public verification material, **When** Feature 004 verifies the credential, **Then** it uses the registered TrustProfile and no central signing domain is reused.
3. **Given** a key is unknown or retired, **When** a credential is presented, **Then** verification fails closed without fallback to a private key or a different issuer.

---

### User Story 5 - Bootstrap the First Customer Assistant Session (Priority: P1)

A Customer user opens the existing Assistant chat after the SPA exchanges its current native credential locally and uses the returned canonical credential with the existing central session route.

**Why this priority**: The product outcome is a real usable Assistant conversation, not bridge startup alone.

**Independent Test**: In Customer staging, begin with the existing IDX login and complete local exchange, central verification, binding resolution, session creation, and chat opening.

**Acceptance Scenarios**:

1. **Given** a valid locally issued canonical JWT, **When** the SPA creates an Assistant session, **Then** unchanged Feature 004 verification and IntegrationBinding resolve the correct Customer and HostApp before the existing session route returns a `sessionId`.
2. **Given** a `sessionId` has been returned, **When** the chat opens, **Then** it is used only as conversation identity and never as an authentication credential.
3. **Given** the canonical JWT expires, **When** the SPA needs another Assistant credential, **Then** its existing frontend-auth layer supplies a current IDX AccessToken for a new local exchange without sending or managing RefreshToken through the Bridge.

---

### User Story 6 - Reuse the Bridge by Configuration (Priority: P2)

An operator can configure another Customer deployment without a Customer-specific code path.

**Why this priority**: The first staging integration must establish a reusable product boundary.

**Independent Test**: Compare two deployment configurations with different endpoint, Entry, integration, HostApp, issuer, audience, and signing-key references; verify no source change is needed.

**Acceptance Scenarios**:

1. **Given** a new Customer deployment configuration, **When** it is provisioned, **Then** its endpoint, Entry admission, canonical values, signing reference, and public verification material are deployment-controlled.
2. **Given** two Bridge deployments, **When** each exchanges a credential, **Then** neither can use the other's configuration or create Customer authority through source branching.

### Edge Cases

- A native token is missing, malformed, expired, or syntactically decodable but has not been accepted by MenuDetail: fail closed; never use local IDX ES512/JWKS verification or decode-only trust.
- `sub`, `UUID_User`, `UUID_Company`, `UUID_Entry`, `MenuID`, or permission flags are missing, blank, inconsistent, malformed, or unsupported: do not issue a canonical JWT.
- `UUID_Company` is an array, or its one-value semantics are not established by accepted IDX behavior: fail closed pending authoritative pre-UAT clarification.
- Duplicate menus are deduplicated and ordered deterministically; no operation outside the approved list becomes a scope.
- A Bridge key has not been published, is unknown, or has retired: fail closed.
- A central trust profile, IntegrationBinding, allowed HostApp, or Bridge JWKS registration is missing, disabled, mismatched, or ambiguous: no session is created.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide one independently deployable, Customer-local Identity Bridge owned by the Assistant product; it MUST be separately configured and trusted from the central Gateway.
- **FR-002**: The Bridge MUST accept only the current IDX AccessToken as native exchange input. It MUST NOT receive, store, refresh, or manage an IDX RefreshToken.
- **FR-003**: The Bridge MUST forward the native bearer at most once and only to its configured protected IDX MenuDetail endpoint. Native credentials MUST NOT enter central Gateway, Feature 004, Assistant Backend, business connectors, a Permission Source, or browser-selected destinations.
- **FR-004**: The Bridge MUST establish IDX credential validity only after the configured protected MenuDetail endpoint accepts the exact bearer and yields a strict successful response. Native JWT decoding alone MUST establish no authority.
- **FR-005**: The Bridge MUST require nonblank `sub`, `UUID_User`, `UUID_Company`, and `UUID_Entry` after accepted verification; `UUID_User` MUST equal `sub`.
- **FR-006**: The Bridge MUST accept `UUID_Company` only when accepted IDX behavior provides one authoritative deterministic organization value. Multi-value or ambiguous organization input MUST fail closed until a documented pre-UAT rule is approved.
- **FR-007**: The Bridge MUST use `UUID_Entry` only for exact configured admission. It MUST NOT use Entry to determine Customer, organization, or HostApp authority.
- **FR-008**: The successful MenuDetail response MUST be the sole V1 permission authority. Each accepted menu MUST imply `read`; enabled `Insert`, `Update`, `Delete`, `Print`, `Import`, `Export`, `Copy`, and `Approval` values MUST yield the corresponding canonical action in the fixed order.
- **FR-009**: Canonical scopes MUST be exactly `menu:<MenuID>:<action>`, deduplicated and deterministic. `UserType`, `IsAdmin`, `Permissions`, and `Permission_Hash` MUST NOT establish roles or scopes.
- **FR-010**: The Bridge MUST issue only the existing Feature 004 canonical upstream identity semantics: deployment-owned `integration_id` and `host_app`; accepted `sub` and `org_id`; `roles: []`; and approved MenuDetail-derived `permission_scopes`.
- **FR-011**: Customer authority MUST remain exclusively `IntegrationBinding.integrationId -> customerId`; the Bridge credential MUST contain no Customer authority and must not override Feature 004 `allowedHostApp` admission.
- **FR-012**: Bridge-issued credentials MUST use short-lived RS256 asymmetric signing, nonblank `kid`, configured issuer, exact audience, and Customer-local private signing material. Private material MUST not be browser-held, persisted in an application database, returned, logged, audited, or telemetered.
- **FR-013**: The Bridge MUST publish public verification material and support publish-before-use, active, retirement, and fail-closed unknown/retired-key behavior without sharing central Gateway internal signing authority.
- **FR-014**: The Bridge MUST expose only a minimal exchange, public verification-key, and operational-health surface. A successful exchange MUST return the short-lived canonical upstream JWT and MAY additionally return only minimal safe token-lifecycle metadata required by the eventual client contract; exact JSON field names remain a design decision. It MUST NOT return native IDX AccessToken, RefreshToken, raw IDX claims, raw MenuDetail, signing material, or Customer authority.
- **FR-015**: Customer-specific endpoint, Entry admission, `integration_id`, `host_app`, issuer, audience, signing-key reference, verification source, and safe transport settings MUST be deployment-controlled. No Customer domain, identifier, credential, secret, or menu may be source-coded.
- **FR-016**: The Customer SPA integration MUST obtain its current native AccessToken through the existing frontend-auth layer, send it only to the Customer-local Bridge, use only the returned canonical JWT with the existing central Assistant session route, and open chat with the returned `sessionId`.
- **FR-017**: Feature 007 MUST use existing central Feature 004 TrustProfile, IntegrationBinding, internal JWT, and Backend CustomerScope behavior without changing their authority semantics, verification behavior, or session route.
- **FR-018**: A later design MUST assess the smallest safe reuse of pure Feature 006 IDX validation, claim consistency, permission normalization, and scope projection logic. It MUST NOT duplicate the central managed-exchange module or require a broad Feature 006 refactor.
- **FR-019**: The final completion gate MUST be real Customer staging evidence covering IDX login, local Bridge verification, canonical JWT, Feature 004 trust/profile verification, IntegrationBinding resolution, existing session creation, returned `sessionId`, and successful chat-window opening.
- **FR-020**: Feature 007 delivery MUST include deployment-controlled staging provisioning for the first real Customer through existing Feature 004 facilities: an existing Customer record, IntegrationBinding, allowedHostApp, RegisteredUpstreamTrustProfile, Bridge issuer, exact audience, accepted algorithm, Bridge JWKS source, and required enabled/readiness lifecycle state. This provisioning MUST precede the final staging/session gate; it MUST NOT create another Customer-resolution mechanism, let the Bridge JWT establish Customer authority, change IntegrationBinding semantics, or change Feature 004 verifier behavior.

### Security Requirements

- **SR-001**: Native IDX AccessToken, RefreshToken, raw claims, and raw MenuDetail MUST remain absent from central Assistant paths, persistence, logs, audit payloads, telemetry, snapshots, and public errors.
- **SR-002**: The Bridge MUST not use local IDX ES512 verification, guessed IDX keys/JWKS, browser identity attestation, browser-selected authority, username/password login, or RefreshToken processing.
- **SR-003**: The Bridge MUST fail closed for malformed credential, endpoint rejection, unavailable or malformed MenuDetail, invalid identity, ambiguous organization, Entry mismatch, signing failure, key mismatch, and central trust or binding failure.
- **SR-004**: The Bridge MUST retain production-safe endpoint controls appropriate to a protected native-token destination, including HTTPS, destination validation, redirect denial, bounded response handling, bounded deadline, and no uncontrolled retry.

### Explicit Non-Goals

- IDX login/logout, IDX Auth Backend changes, IDX infrastructure changes, or RefreshToken lifecycle changes.
- Customer application, SCM, or business Backend changes; Customer account storage; business connectors; RAG; agent behavior; or business tools.
- Generic IAM, identity-broker, OAuth/OIDC provider, or Customer lifecycle/admin/billing platform.
- Browser/SDK private-key handling, browser JWT signing, Customer-specific central Gateway handlers, or new IDX-specific central session endpoints.
- Feature 002, 003, 004, 005, or 006 redesigns or production-behavior changes.

### Key Entities

- **Customer-side Identity Bridge**: The Assistant-owned runtime deployed in a Customer environment that verifies the current IDX AccessToken and issues only a canonical upstream JWT.
- **Bridge Deployment Configuration**: Customer-specific operational values such as protected endpoint, admission Entry, canonical integration/HostApp, signing reference, issuer, audience, and public verification source.
- **Accepted IDX Identity**: The reduced identity produced after successful MenuDetail verification: accepted `sub`, organization, and `idx_entry` admission anchor.
- **Canonical Upstream Credential**: The short-lived Bridge-signed Feature 004-compatible JWT containing six canonical identity semantics and no Customer authority.
- **Bridge Signing Domain**: The Customer-local asymmetric signing and public verification-key lifecycle, distinct from central Gateway internal signing.
- **Staging Session Bootstrap Evidence**: Evidence that one real Customer flow reaches a `sessionId` and opens the existing Assistant chat without sensitive native IDX material crossing into central services.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 — IDENTITY_BRIDGE_RUNTIME_READY**: 100% of Bridge runtime checks show that native bearer input is accepted only for local exchange and no native credential reaches central Assistant services.
- **SC-002 — IDX_BRIDGE_VERIFICATION_READY**: 100% of IDX verification tests require protected MenuDetail acceptance before identity parsing, reject invalid identity/Entry cases, and derive only deterministic approved menu scopes.
- **SC-003 — BRIDGE_CANONICAL_JWT_READY**: 100% of issued-credential checks contain only the six Feature 004 canonical semantics, with deployment-owned integration/HostApp, empty roles, one accepted organization, and no Customer authority.
- **SC-004 — BRIDGE_JWKS_TRUST_READY**: 100% of valid Bridge credentials are accepted through a registered Feature 004 TrustProfile, while incorrect issuer, audience, signature, unknown key, and retired key cases fail closed.
- **SC-005 — CUSTOMER_SPA_BRIDGE_HANDOFF_READY**: 100% of SPA handoff checks send a current IDX AccessToken only to the Customer-local Bridge, use only the returned canonical JWT centrally, and exclude RefreshToken from Bridge traffic.
- **SC-006 — CUSTOMER_SESSION_BOOTSTRAP_READY**: 100% of session-bootstrap tests with the required existing Feature 004 staging provisioning resolve Customer and HostApp only through IntegrationBinding and return a valid `sessionId` from the existing session route.
- **SC-007 — CUSTOMER_IDENTITY_SESSION_INTEGRATION_READY**: A real first-Customer staging UAT, after the required existing Feature 004 staging provisioning is enabled and ready, demonstrates existing IDX login through chat-window opening, including a real `sessionId` and evidence that neither native IDX credentials nor raw MenuDetail crossed into central Assistant services.

`CUSTOMER_IDENTITY_SESSION_INTEGRATION_READY=YES` may be recorded only after SC-007 is satisfied; synthetic tests alone cannot close this feature.

## Assumptions and Compatibility Assessment

- The first Customer SPA is client-rendered, owns IDX login and refresh scheduling, and may make only the narrow additive Assistant-to-Bridge handoff.
- The Bridge is expected to be repository-owned under `apps/identity-bridge` in later implementation, but its deployment is Customer-local and independent from `apps/gateway`.
- Existing Feature 004 accepts RS256 canonical upstream JWTs through registered TrustProfiles and public JWKS. Existing central provisioning supplies the Customer record, IntegrationBinding, allowed HostApp, TrustProfile, Bridge issuer/audience, JWKS source, and active readiness state.
- The exact exchange and operational route names, transport mechanism, and private-key provider are later design decisions; they must meet the authority and safety requirements above.
- Existing Customer SPA token-payload console logging is a required real-UAT security cleanup item. It is not identity authority and is outside this repository's production code scope.

### Responsibility Review

| Feature | Overlap | Classification | Resolution |
| --- | --- | --- | --- |
| Feature 003 | NO | None | It owns central Gateway-to-Backend internal signing, not the Customer-local upstream issuer. |
| Feature 004 | YES | CONTRACT_REUSE | Feature 007 produces the existing canonical upstream contract for unchanged TrustProfile and IntegrationBinding processing. |
| Feature 005 | YES | SEMANTIC_REUSE | The Bridge preserves verified-native-identity, admission, canonicalization, and issuance semantics locally; Feature 005 central control-plane persistence and exchange runtime remain central-only. |
| Feature 006 | YES | SEMANTIC_REUSE | The Bridge preserves IDX MenuDetail, claim consistency, Entry, and permission semantics without changing Feature 006 or copying its central module. |

No unresolved `ACTUAL_DUPLICATE_RESPONSIBILITY` exists: Feature 007 owns the Customer deployment boundary; Features 003–006 retain their central contracts and responsibilities.

```text
FEATURE003_RESPONSIBILITY_OVERLAP=NO
FEATURE004_RESPONSIBILITY_OVERLAP=YES (CONTRACT_REUSE)
FEATURE005_RESPONSIBILITY_OVERLAP=YES (SEMANTIC_REUSE)
FEATURE006_RESPONSIBILITY_OVERLAP=YES (SEMANTIC_REUSE)
FEATURE007_SPEC_READY=YES
CUSTOMER_NATIVE_TOKEN_CENTRAL_EGRESS_REQUIRED=NO
CUSTOMER_AUTH_BACKEND_CHANGE_REQUIRED=NO
CUSTOMER_BUSINESS_BACKEND_CHANGE_REQUIRED=NO
FEATURE004_MODIFICATION_REQUIRED=NO
FEATURE006_SEMANTIC_CHANGE_REQUIRED=NO
REAL_CUSTOMER_STAGING_REQUIRED_FOR_FINAL_GATE=YES
SESSION_ID_REQUIRED_FOR_FINAL_GATE=YES
CHAT_WINDOW_OPEN_REQUIRED_FOR_FINAL_GATE=YES
```
