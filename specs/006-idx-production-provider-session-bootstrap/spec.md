# Feature Specification: IDX Production Provider Session Bootstrap

**Feature Branch**: `006-idx-production-provider-session-bootstrap`  
**Created**: 2026-08-25  
**Status**: Draft  
**Input**: Production-enable the existing IDX provider capability, define its native credential and permission contracts, and specify the Host/SDK path from a native IDX credential to an Assistant session without Customer-specific source code.

## Product Context and Boundary

Feature 006 production-enables the existing Feature 005 managed identity exchange capability for the shared IDX Auth system. It turns a native IDX AccessToken, already accepted by IDX's protected MenuDetail resource, into the existing six-claim managed canonical credential that Feature 004 verifies before it creates an Assistant session.

The feature is configuration-first. A new IDX-backed integration is enabled by provisioning a Provider Instance, integration selector, Entry admission anchor, canonical HostApp projection, permission policy, Feature 004 IntegrationBinding, and matching Feature 004 trust profile. It does not introduce Customer-specific branches or select a Customer production environment.

Feature 004 remains unchanged and solely owns upstream managed-JWT verification, `IntegrationBinding.integrationId → customerId` resolution, `allowedHostApp` admission, and Gateway internal JWT issuance. Feature 005 remains the issuer of a managed credential only; it does not resolve Customer authority. Feature 002 CustomerScope remains unchanged.

### Authority Ownership

| Value or decision | Authoritative owner | Explicit non-authority |
| --- | --- | --- |
| Native IDX credential validity | IDX protected MenuDetail endpoint accepting the exact Bearer token | Decoded JWT claims, local ES512 verification, browser assertion |
| IDX subject and organization | Registered claims from an IDX credential accepted by the protected endpoint | Selector, browser input, Customer configuration |
| IDX integration admission | Selected integration's registered exact `idx_entry` admission policy evaluated against verified `UUID_Entry` | Public selector alone, `UUID_Company`, Customer-specific source |
| Canonical `integration_id` and `host_app` | Feature 005 registered integration/canonicalization configuration | Browser or IDX native claims |
| Canonical roles | Existing Feature 005 minimum-privilege policy | `UserType`, `IsAdmin` |
| Canonical permission scopes | IDX MenuDetail material returned by the successful protected verification request and the registered IDX projection policy | Native JWT `Permissions`, `Permission_Hash`, browser values |
| Customer and final HostApp admission | Feature 004 IntegrationBinding | Feature 005, IDX credentials, Provider Instance |
| Native AccessToken and RefreshToken lifecycle | Existing Host authentication system | Assistant code, SDK session bootstrap |

### Delivery Boundaries

| Delivery area | Feature 006 requirement |
| --- | --- |
| Server work in this repository | Enable the IDX Provider Instance contract, verify the credential through its configured MenuDetail endpoint, map verified identity/admission/permissions, and issue the existing managed credential without changing Feature 004. |
| Required Host/SDK integration contract | Obtain the current native AccessToken through the existing opaque credential provider; exchange it using the provisioned selector; use the returned managed credential to create Assistant sessions; re-exchange when the managed credential expires. |
| SDK implementation work | Out of scope until the actual SDK source repository or package is provided. This feature does not create, alter, or claim completion of SDK files. |

### Host/SDK Bootstrap Contract

1. The Host authentication system authenticates the user, selects or auto-selects an IDX Entry, and obtains the current native IDX AccessToken. It owns the native AccessToken and RefreshToken lifecycle.
2. The client obtains that current native credential through the existing opaque credential-provider contract.
3. The client requests `POST /api/v1/identity/exchange` with `Authorization: Bearer <IDX AccessToken>` and body `{ "integrationSelector": "<provisioned public selector>" }`.
4. Feature 005 returns its existing managed response: `accessToken`, `tokenType: "Bearer"`, `expiresIn`, and `requestId`.
5. The client requests `POST /api/v1/assistant/sessions` using `Authorization: Bearer <managed JWT>`, never the IDX AccessToken.
6. Feature 004 verifies that managed JWT and resolves Customer through its existing IntegrationBinding; the existing Gateway-to-Backend chain creates the session and returns `sessionId`.
7. Subsequent Assistant calls use `sessionId` as conversation identity and continue to authenticate according to the existing Assistant API contract. When the managed JWT expires, the client repeats steps 2–6; it does not treat the session as a credential or manage RefreshToken.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exchange a Valid IDX Credential (Priority: P1)

An authenticated IDX user obtains a short-lived Assistant-compatible credential without the browser deriving identity from the native token.

**Why this priority**: It creates the secure IDX-to-Assistant onboarding path.

**Independent Test**: With an enabled IDX configuration and a valid native AccessToken, verify that the configured protected MenuDetail resource accepts the exact token before a managed credential is issued.

**Acceptance Scenarios**:

1. **Given** an enabled IDX Provider Instance and integration configuration, **When** IDX accepts the exact native Bearer token at its configured MenuDetail endpoint, **Then** the exchange returns the existing managed credential response with a short-lived canonical credential.
2. **Given** a decodable IDX token, **When** IDX has not accepted that exact token through the protected endpoint, **Then** no identity claims are trusted and no managed credential is issued.

---

### User Story 2 - Admit Exactly One IDX Entry (Priority: P1)

An IDX user's selected Entry admits only the integration provisioned for that Entry.

**Why this priority**: An Entry is the verified integration boundary for IDX-backed integrations.

**Independent Test**: Use the same accepted IDX credential with two selectors whose admission policies expect different Entry UUIDs; only the matching selector may issue a credential.

**Acceptance Scenarios**:

1. **Given** an accepted credential whose `UUID_Entry` matches the selected integration's registered `idx_entry` anchor, **When** exchange is requested, **Then** admission succeeds.
2. **Given** an accepted credential whose `UUID_Entry` does not match the selected integration's admission anchor, **When** exchange is requested, **Then** admission fails closed and no managed credential is issued.

---

### User Story 3 - Map a Verified IDX Identity (Priority: P1)

An accepted IDX credential becomes a canonical Assistant identity only when its IDX identity claims are internally consistent.

**Why this priority**: It prevents a mismatched or partial native identity from becoming authority.

**Independent Test**: Exercise accepted credentials with matching and mismatching `sub` and `UUID_User`, then inspect the managed credential claims.

**Acceptance Scenarios**:

1. **Given** an accepted IDX credential with nonblank equal `sub` and `UUID_User`, a nonblank `UUID_Company`, and a nonblank `UUID_Entry`, **When** it is admitted, **Then** its canonical subject is `sub`, organization is `UUID_Company`, and verified anchor is `{ kind: "idx_entry", value: UUID_Entry }`.
2. **Given** an accepted IDX credential with missing or unequal `sub` and `UUID_User`, **When** exchange is requested, **Then** identity mapping fails closed.
3. **Given** `UserType` or `IsAdmin` values, **When** exchange succeeds, **Then** canonical `roles` is `[]`.

---

### User Story 4 - Normalize IDX Menu Permissions (Priority: P1)

An Assistant session receives only deterministic, semantic permissions derived from the IDX MenuDetail result that accepted the native credential.

**Why this priority**: Assistant authorization must use authoritative, reusable semantic scopes rather than opaque IDX identifiers.

**Independent Test**: Submit accepted MenuDetail responses with multiple menus, enabled operations, duplicates, and no enabled operations; verify the resulting canonical scopes.

**Acceptance Scenarios**:

1. **Given** a valid MenuDetail record, **When** it has `MenuID` and no Y operations, **Then** its output includes exactly `menu:<MenuID>:read`.
2. **Given** a valid MenuDetail record with a Y value for an allowed operation, **When** permissions are projected, **Then** it additionally includes `menu:<MenuID>:<lowercase-action>`.
3. **Given** duplicate records or repeated permissions, **When** scopes are projected, **Then** scopes are unique and deterministically ordered.

---

### User Story 5 - Reuse IDX by Provisioning (Priority: P1)

A platform operator enables a new IDX-backed integration without adding Customer-specific adapter code.

**Why this priority**: The reusable provider capability is the feature's product value.

**Independent Test**: Provision two IDX-backed integrations with distinct Provider Instance configuration or Entry anchors and show that both use the same IDX capability while retaining admission isolation.

**Acceptance Scenarios**:

1. **Given** the IDX provider capability is ready, **When** an operator provisions a new integration's configuration and Feature 004 binding/trust profile, **Then** it becomes eligible without a new Customer-specific code branch.
2. **Given** two integrations use the IDX capability, **When** each exchanges a credential, **Then** each uses only its own registered endpoint, selector, admission anchor, canonical HostApp, and permission policy.

---

### User Story 6 - Fail Closed for Credential and Provider Failures (Priority: P1)

An IDX failure never creates a managed credential or reveals IDX internals to a caller.

**Why this priority**: Native credentials must not gain authority through provider errors or local token inspection.

**Independent Test**: Exercise IDX 401, IDX 403, IDX 500/503, network/timeout, and invalid successful responses; verify generic Feature 005 exchange outcomes and absence of an issued credential.

**Acceptance Scenarios**:

1. **Given** IDX returns 401, **When** exchange is requested, **Then** the credential is rejected without issuing a managed credential.
2. **Given** IDX returns 403, **When** exchange is requested, **Then** the authenticated/authorization rejection fails closed without issuing a managed credential.
3. **Given** IDX is unavailable, times out, or returns 500/503, **When** exchange is requested, **Then** it is classified internally as provider unavailable and returns the existing safe public exchange outcome.
4. **Given** IDX returns HTTP success but its application `Code` is not 200 or its MenuDetail body is invalid, **When** exchange is requested, **Then** it is classified internally as a malformed provider response and no managed credential is issued.

---

### User Story 7 - Bootstrap an Assistant Session (Priority: P1)

A Host application converts its current IDX credential into an Assistant session through the existing managed and Feature 004 paths.

**Why this priority**: It makes the provider capability usable by an Assistant Host without allowing the native credential into the Assistant runtime path.

**Independent Test**: Starting from a Host-provided current IDX AccessToken, complete exchange and session creation; verify that the session is created using the managed credential and unchanged Feature 004 behavior.

**Acceptance Scenarios**:

1. **Given** the Host has a current native IDX AccessToken and a provisioned public selector, **When** it requests identity exchange, **Then** it receives the existing managed credential response.
2. **Given** a managed credential from exchange, **When** the client creates an Assistant session, **Then** the session path uses that managed credential rather than the IDX AccessToken and Feature 004 resolves Customer through its existing IntegrationBinding.
3. **Given** an existing Assistant conversation and an expired managed credential, **When** the client re-exchanges the current native credential, **Then** authentication is refreshed without treating a new managed credential as a reason to destroy the existing conversation session.

---

### User Story 8 - Preserve Credential and Session Boundaries (Priority: P2)

The Host keeps control of IDX credential lifecycle while the Assistant session remains a conversation reference, not an authentication credential.

**Why this priority**: It prevents accidental expansion into credential storage or refresh-token management.

**Independent Test**: Inspect client and server contracts for native AccessToken persistence, RefreshToken handling, and session use across a managed-token re-exchange.

**Acceptance Scenarios**:

1. **Given** a native IDX AccessToken expires, **When** a managed credential must be refreshed, **Then** the Host's existing authentication callback provides the current native credential and Assistant code does not handle the RefreshToken.
2. **Given** a created `sessionId`, **When** later Assistant calls are made, **Then** it identifies the conversation according to the existing Assistant API contract and is never accepted as an authentication credential.

---

### User Story 9 - Keep SDK Work Explicitly Scoped (Priority: P2)

An integration team can implement the required Host/SDK contract without this repository falsely claiming an SDK implementation.

**Why this priority**: The current Gateway repository does not include SDK source.

**Independent Test**: Review the feature deliverables and verify server requirements, client contract requirements, and out-of-repository SDK implementation work are separately identified.

**Acceptance Scenarios**:

1. **Given** SDK source is not in scope, **When** Feature 006 is completed in this repository, **Then** it defines the required credential-provider and bootstrap contract but creates no fabricated SDK files.
2. **Given** an SDK implementation repository is later in scope, **When** it is updated, **Then** it obtains the native credential through the existing opaque Host callback and follows the defined exchange/session sequence.

### Edge Cases

- The configured MenuDetail endpoint must be HTTPS and pass the existing Feature 005 destination, DNS-rebinding, redirect, response-size, deadline, and no-retry safeguards; no native credential is sent when those controls reject the destination.
- A selected IDX token has no `kid`, uses ES512, is expired, or has otherwise suspicious decoded fields. No local cryptographic verification, key guessing, or decode-only fallback is performed; only the configured protected endpoint can establish native credential validity.
- `sub`, `UUID_User`, `UUID_Company`, `UUID_Entry`, or required MenuDetail fields are missing, blank, malformed, or inconsistent. Exchange fails closed before managed credential issuance.
- A successful response contains unknown MenuDetail fields, invalid operation values, a missing `MenuID`, or an invalid `Code`. It is a malformed provider response and cannot silently produce empty scopes.
- A native AccessToken is presented for an Entry belonging to Integration A with Integration B's selector. Selector replay cannot bypass B's exact `idx_entry` admission policy.
- Requests, logs, audit events, telemetry, public errors, and stored records must not expose raw IDX access/refresh tokens, authorization headers, native claims, or raw MenuDetail payloads.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST production-enable IDX only through a registered IDX Provider Instance with a configured protected MenuDetail endpoint, registered response contract, and existing Feature 005 production-safe destination policy.
- **FR-002**: The system MUST send a native IDX AccessToken only as `Authorization: Bearer <token>` to the selected registered IDX MenuDetail endpoint and MUST not send it to a Permission Source or any browser-selected destination.
- **FR-003**: The system MUST treat native IDX credential verification as successful only when that protected request returns HTTP success, application `Code == 200`, and a response conforming to the registered MenuDetail contract.
- **FR-004**: The system MUST parse accepted IDX identity claims only after successful delegated verification of the exact native credential; it MUST not establish identity from decoded native claims, token lifetime checks, local ES512 verification, a guessed key/JWKS contract, or browser attestation.
- **FR-005**: Successful IDX identity mapping MUST require a nonblank `sub`, `UUID_User`, `UUID_Company`, and `UUID_Entry`; `UUID_User` MUST equal `sub`, `UUID_Company` MUST map to verified organization, and `UUID_Entry` MUST produce the verified anchor `{ kind: "idx_entry", value: UUID_Entry }`.
- **FR-006**: The selected integration's existing Feature 005 Integration Admission Policy MUST require an exact verified `idx_entry` anchor match. A selector alone or a nonmatching Entry MUST not admit an integration.
- **FR-007**: Canonical `integration_id` and `host_app` MUST remain server-owned Feature 005 configuration. Customer resolution and HostApp admission MUST remain Feature 004 responsibilities.
- **FR-008**: V1 canonical roles MUST be `[]`. `UserType` and `IsAdmin` MUST NOT create canonical roles.
- **FR-009**: The MenuDetail response from the successful protected verification request MUST be the authoritative V1 permission material. Native JWT `Permissions` and `Permission_Hash` MAY be ignored by V1 authorization logic.
- **FR-010**: Each valid MenuDetail record MUST establish `menu:<MenuID>:read`; Y-valued `Insert`, `Update`, `Delete`, `Print`, `Import`, `Export`, `Copy`, and `Approval` operations MUST additionally establish the corresponding lowercase action scope.
- **FR-011**: Canonical permission scopes MUST use exactly `menu:<MenuID>:<action>`, deduplicate results, retain deterministic order, never encode Customer ID or integration ID, and never expose an IDX UUID where `MenuID` supplies the semantic resource.
- **FR-012**: The IDX adapter MAY provide constrained trusted MenuDetail material to Feature 005's existing permission boundary, but no separate Permission Source may receive the native AccessToken or raw native token payload.
- **FR-013**: The IDX provider capability MUST use one reusable adapter capability and server-controlled provisioning for each integration; it MUST NOT contain Customer-specific branches, hardcoded Customer values, integration selectors, Entry UUIDs, endpoints, domains, or credentials.
- **FR-014**: Failure outcomes MUST preserve the existing Feature 005 non-enumerating public error contracts. Internally, IDX 401 is credential rejection; IDX 403 is authorization rejection; IDX 500/503 and network/deadline failures are provider unavailable; and invalid success application/schema responses are malformed provider responses.
- **FR-015**: The Host/SDK bootstrap contract MUST obtain the current IDX AccessToken through the established opaque credential-provider contract, exchange it with the provisioned selector, and use only the returned managed credential to create an Assistant session.
- **FR-016**: The Host authentication system MUST retain ownership of native AccessToken and RefreshToken lifecycle. Feature 006 MUST NOT add Assistant-managed native-token persistence or RefreshToken handling.
- **FR-017**: When a managed credential expires, the client MUST obtain the current native credential through the Host's existing callback and repeat exchange. This re-exchange MUST NOT itself destroy an existing Assistant conversation session.
- **FR-018**: `sessionId` MUST remain a conversation identity under the existing Assistant API contract and MUST NOT be treated as an authentication credential.
- **FR-019**: The feature specification MUST separately identify server requirements implementable in this repository, the required Host/SDK integration contract, and SDK implementation work that remains out of scope until SDK source is available.
- **FR-020**: The IDX adapter's existing disabled state may be replaced only by a constrained provider-local extension that represents validated structured MenuDetail material and normalizes it into the approved semantic permissions. This extension MUST preserve Feature 005's verified-anchor, trusted-material, and native-credential boundaries.

### Security Requirements

- **SR-001**: IDX native credentials MUST never establish Assistant identity, permissions, Customer, integration, HostApp, or provider destination authority before the configured protected endpoint accepts the exact Bearer token.
- **SR-002**: The system MUST NOT implement local ES512 verification, key guessing, `kid` assumptions, a guessed IDX JWKS contract, decode-only trust, username/password authentication, RefreshToken handling, or browser identity authority.
- **SR-003**: A native IDX AccessToken MUST be forwarded at most once and only to the selected registered IDX identity-provider endpoint. It MUST NOT be forwarded to any Permission Source.
- **SR-004**: The system MUST retain Feature 005 HTTPS, SSRF, DNS, redirect, rebinding, deadline, bounded-response, and no-retry safeguards for IDX Provider Instances.
- **SR-005**: The system MUST NOT log, audit, persist, expose, or include in telemetry/errors any raw IDX token, authorization header, RefreshToken, raw native claims, or raw MenuDetail payload.
- **SR-006**: The system MUST NOT modify Feature 004 upstream verification, IntegrationBinding Customer authority, allowedHostApp admission, Gateway internal JWT issuance, or Feature 002 CustomerScope.

### Key Entities

- **IDX Provider Instance**: A server-provisioned IDX identity-provider configuration with a protected MenuDetail endpoint and validated response contract.
- **IDX Verified Identity**: The Feature 005 Verified External Identity created only after IDX accepts the native credential; it has subject, organization, `idx_entry` anchor, and constrained trusted permission material.
- **IDX Entry Admission Anchor**: The exact verified `{ kind: "idx_entry", value: UUID_Entry }` anchor used by an integration's registered admission policy.
- **MenuDetail Permission Material**: The validated MenuDetail records returned during delegated verification and used as the sole V1 IDX permission authority.
- **Canonical IDX Permission Scope**: A deduplicated, deterministic `menu:<MenuID>:<action>` scope derived from a MenuDetail record.
- **Managed Credential**: The existing short-lived Feature 005 canonical credential accepted by the unchanged Feature 004 path.
- **Assistant Session**: The existing conversation identity created after Feature 004 accepts the managed credential; it is not a credential.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 — IDX_PROVIDER_CAPABILITY_READY**: 100% of IDX provider contract tests prove that a managed credential is issued only after the configured MenuDetail endpoint accepts the exact native Bearer token and returns a valid successful MenuDetail contract.
- **SC-002 — IDX_PROVIDER_CAPABILITY_READY**: 100% of identity tests reject absent, blank, or mismatched `sub`/`UUID_User`, absent organization or Entry values, and selector-to-Entry admission mismatches without issuing a managed credential.
- **SC-003 — IDX_PROVIDER_CAPABILITY_READY**: 100% of permission projection tests produce only deterministic, deduplicated `menu:<MenuID>:<action>` scopes, add implicit `read` for every valid menu, and never derive roles from `UserType` or `IsAdmin`.
- **SC-004 — IDX_PROVIDER_CAPABILITY_READY**: 100% of IDX 401, 403, unavailable, deadline, malformed-success, unsafe-destination, and invalid-configuration tests fail closed with no managed credential and no raw provider/token disclosure.
- **SC-005 — IDX_PROVIDER_CAPABILITY_READY**: At least two independently provisioned IDX integrations demonstrate reuse of one provider capability while an Entry accepted for one integration is denied for the other without Customer-specific source behavior.
- **SC-006 — IDX_PROVIDER_CAPABILITY_READY**: 100% of managed IDX credential session tests traverse the unchanged Feature 004 trust and IntegrationBinding path before an Assistant session is created.
- **SC-007 — IDX_PROVIDER_CAPABILITY_READY**: 100% of managed-credential refresh tests retain the existing conversation session while the client re-exchanges its current native credential; no Assistant component handles a RefreshToken.
- **SC-008 — CUSTOMER_PRODUCTION_DEPLOYMENT_READY**: A specific Customer may claim production deployment readiness only after it has a provisioned production-safe IDX endpoint, validated MenuDetail contract, enabled Provider Instance, selector, Entry admission policy, canonical HostApp configuration, permission policy, Feature 004 IntegrationBinding, matching enabled trust profile, and its actual Host/SDK integration tested in its target environment.
- **SC-009 — CUSTOMER_PRODUCTION_DEPLOYMENT_READY**: `IDX_PROVIDER_CAPABILITY_READY` alone does not claim any Customer production domain, credential, deployment, or SDK implementation is complete.

## Explicit Non-Goals

- Deploying or selecting a specific Customer production environment, domain, Entry, credential, or integration selector.
- Modifying IDX Auth Backend, handling IDX username/password sign-in, or handling IDX RefreshToken lifecycle.
- Local IDX ES512/JWKS verification, key guessing, decode-only trust, or browser attestation.
- Customer-specific SCM code, Customer-specific permission resource mappings, or a new SCM-specific connector.
- Changing Feature 004, Feature 002 CustomerScope, IntegrationBinding Customer authority, or Gateway internal identity issuance.
- Granting Assistant tool permissions beyond transporting canonical `permission_scopes`.
- Implementing SDK source code when its repository/package is not in scope.

## Assumptions and Compatibility Assessment

- IDX's configured protected MenuDetail endpoint is the authoritative credential-verification mechanism. Its concrete endpoint, production domain, and credentials are provisioning inputs and are not fixed by this feature.
- A successful MenuDetail response has HTTP success, application `Code == 200`, and a registered schema containing records with `UUID`, `MenuID`, and the supported operation indicators.
- Feature 005's existing public error projector remains authoritative for public exchange failures; IDX-specific classifications are internal only.
- Feature 005 and Feature 004 authority boundaries are compatible with this feature. Feature 005 already supports provider-verified anchors and a trusted permission-material boundary; Feature 004 remains the sole Customer and final HostApp-admission authority.
- The current disabled IDX adapter and its present trusted-material shape cannot safely represent structured MenuDetail records because that shape contains only a kind, optional reference, and string values. Feature 006 therefore requires a constrained IDX-local structured trusted-material contract plus IDX normalizer. This is a narrow extension to the existing Feature 005 boundary, not a redesign of its core authority model.
- The Gateway repository does not contain the actual SDK implementation. This specification defines its required Host/SDK contract only; SDK implementation is a future scoped deliverable.
