# Feature Specification: Managed Identity Exchange

**Feature Branch**: `005-managed-identity-exchange`  
**Created**: 2026-08-20  
**Status**: Draft  
**Input**: Provide a configuration-first, server-side external identity integration framework that exchanges verified native credentials for Feature 004-compatible canonical upstream JWTs without Customer-specific core logic.

## Product Context and Boundary

Customers and Host Frontends may already use native credentials that do not meet the Feature 004 Canonical Upstream Identity Contract v1. Feature 005 adds an optional managed server-side exchange path:

```text
Customer / Host Frontend
  → opaque native credential + public integration selector
  → Managed Identity Exchange
  → registered Identity Provider Instance and Provider Adapter
  → Verified External Identity
  → Integration Admission Policy
  → server-side canonicalization and optional permission integration
  → short-lived canonical upstream JWT
  → Feature 004 trust profile → IntegrationBinding → Customer
  → Gateway internal JWT → Feature 002 CustomerScope
```

Feature 005 ends when it issues a credential that Feature 004 can verify under its existing registered trust profile. It does not resolve Customer, access `IntegrationBinding.customerId`, decide HostApp admission, verify Feature 004 trust profiles, select Gateway candidates, issue the Gateway internal JWT, or change Feature 002 CustomerScope.

Two product onboarding paths remain available:

- **Customer-managed canonical identity**: a Customer trusted server issues a Feature 004-compatible canonical upstream JWT directly to Feature 004. Feature 005 is not required.
- **Managed native-credential exchange**: a Host Frontend supplies an opaque native credential to Feature 005, which verifies and canonicalizes it server-side before issuing the same Feature 004-compatible credential.

The managed path is additive and never a fallback that weakens, replaces, or bypasses the direct Feature 004 path.

### Authority Ownership

| Value or decision | Authoritative owner | Explicit non-authority |
| --- | --- | --- |
| Integration selection | Registered server-side integration and identity configuration | Browser selector, native token claims, page context |
| Integration admission | Registered Integration Admission Policy applied to Verified External Identity | Public selector alone, unverified claims, Customer-specific core logic |
| Native credential validity | Registered Identity Provider Adapter and Provider Instance after server-side verification | Decoded JWT payload, browser assertion, `validated=true` input |
| Canonical `integration_id` and `host_app` | Registered integration/canonicalization configuration | Browser/native claims unless separately verified and accepted by registered policy |
| Canonical `sub` | Provider-verified subject authority in Verified External Identity | Unverified native claims or browser input |
| Canonical `org_id` | Provider-verified organization authority, or an explicitly registered deterministic single-organization binding | Browser input, selector-derived inference, guessed organization mapping |
| Roles and permission scopes | Server-owned role/permission policy; empty collections when no authoritative projection exists | Browser-provided roles/scopes or guessed mappings |
| Customer | Feature 004 `IntegrationBinding.integrationId → customerId` | Feature 005, native credential, provider instance, issuer, organization |
| HostApp admission | Feature 004 `IntegrationBinding.allowedHostApp` | Feature 005 provider/canonicalization configuration |
| Managed upstream signing | Managed issuer configuration in a trust domain separate from Gateway internal signing | Gateway internal signing private key, Gateway internal `kid`, browser |

### Feature 004 Compatibility

The managed issuer MUST produce the existing six canonical upstream semantics: `integration_id`, `sub`, `org_id`, `host_app`, `roles`, and `permission_scopes`. Required scalar values are nonblank; roles and permission scopes are arrays and may be empty as the minimum-privilege baseline. The issuer uses asymmetric signing, a nonblank `kid`, a registered issuer, exact audience, short lifetime, and a registered JWKS source compatible with Feature 004.

Each managed issuer/profile arrangement remains subject to Feature 004's enabled-profile, exact issuer/audience/policy, verified integration-anchor, and exactly-one `VerifiedProfileDecision` requirements. Managed configurations may share issuer, audience, JWKS, or signing keys only when the verified `integration_id` yields exactly one decision; zero or ambiguous decisions remain Feature 004 fail-closed outcomes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Exchange a Verified Native Credential (Priority: P1)

A Host Frontend obtains an Assistant-compatible credential from the managed exchange without deriving trusted identity in the browser.

**Why this priority**: It is the primary value for Customers whose existing credential cannot directly meet Feature 004.

**Independent Test**: Submit a valid opaque native credential with a registered integration selector; verify that server-side provider verification precedes canonicalization and that the issued credential passes the existing Feature 004 path.

**Acceptance Scenarios**:

1. **Given** an enabled registered integration, provider instance, canonicalization policy, and Feature 004-compatible issuer profile, **When** the provider verifies a native credential, **Then** the exchange issues a short-lived canonical upstream JWT with server-owned integration and HostApp values.
2. **Given** a request containing Customer-like or identity-like browser fields, **When** the exchange succeeds, **Then** no such field determines Customer, canonical identity, roles, or permission scopes.

---

### User Story 2 - Onboard an Integration by Configuration (Priority: P1)

A platform operator onboards a Customer using a supported provider type by configuring an integration and provider instance rather than changing Assistant source code.

**Why this priority**: Configuration-first onboarding is the scalability goal of the feature.

**Independent Test**: Create two registered integrations using existing provider-type capability with distinct instances; show that each uses only its registered configuration without source changes.

**Acceptance Scenarios**:

1. **Given** a supported provider type, **When** an operator registers a new Customer integration and provider instance, **Then** that integration can be enabled through provisioning only.
2. **Given** provider instances differ in endpoint or policy, **When** each is used, **Then** they use the same adapter capability without Customer-specific branching in exchange, Gateway, Backend, or SDK core.

---

### User Story 3 - Reuse One Provider Adapter (Priority: P1)

Multiple integrations use instances of one provider adapter without making each Customer a separate identity implementation.

**Why this priority**: Provider development and Customer provisioning must be separate lifecycle decisions.

**Independent Test**: Configure multiple enabled instances of one provider type, including a non-IDX Customer, and prove each routes only through its own registered instance.

**Acceptance Scenarios**:

1. **Given** several integrations share a provider type, **When** they exchange credentials, **Then** each uses its registered instance configuration and canonicalization policy.
2. **Given** one Provider Instance serves Integration A and Integration B, **When** a credential admitted only to A is sent with B's public selector, **Then** B admission fails closed and no B canonical upstream JWT is issued.
3. **Given** a new identity protocol is unsupported, **When** it is introduced, **Then** a new adapter may be added without changing the exchange core, Feature 004 Gateway core, or Backend core.

---

### User Story 4 - Fail Closed Before Issuance (Priority: P1)

An invalid, malformed, unavailable, disabled, or ambiguously verified native credential never creates an Assistant credential.

**Why this priority**: Native credentials must never become authority through decoding or infrastructure failure.

**Independent Test**: Exercise malformed credentials, provider rejections, disabled providers, provider timeouts, ambiguous responses, and unknown selectors; verify that no canonical upstream JWT is issued.

**Acceptance Scenarios**:

1. **Given** provider verification rejects or cannot conclusively verify a credential, **When** exchange is requested, **Then** the request fails closed and no token is minted.
2. **Given** a provider endpoint is unavailable or returns an invalid response, **When** exchange is requested, **Then** the request remains unverified and safe diagnostics only are recorded.

---

### User Story 5 - Canonicalize Only a Verified Identity (Priority: P1)

The exchange creates canonical claims only from a server-verified external identity and registered policy.

**Why this priority**: It prevents a native credential's unverified payload from becoming Assistant authority.

**Independent Test**: Supply a syntactically decodable native JWT with forged subject, organization, issuer, roles, and permissions; verify that no canonical identity is composed until its provider reports verified identity and the selected integration admits that identity.

**Acceptance Scenarios**:

1. **Given** an unverified native credential, **When** it contains identity-like claims, **Then** those claims are not trusted by exchange core.
2. **Given** a verified external identity lacks provider-verified organization authority, **When** the selected integration has an explicitly registered deterministic single-organization binding, **Then** policy may project that registered organization to `org_id`.
3. **Given** a verified external identity lacks both provider-verified organization authority and a registered deterministic organization binding, **When** exchange is requested, **Then** issuance fails closed.

---

### User Story 6 - Separate Identity from Permissions (Priority: P2)

An integration can obtain identity and permissions from separate trusted sources without requiring every identity provider to implement permission retrieval.

**Why this priority**: Identity and authorization data may be owned by different systems.

**Independent Test**: Exchange an identity using an identity provider with no permission source and verify valid empty roles/scopes; separately use an authorized permission source to project normalized permissions.

**Acceptance Scenarios**:

1. **Given** no authoritative role mapping or permission source, **When** identity verification succeeds, **Then** roles and scopes are valid empty collections.
2. **Given** an optional registered permission source succeeds, **When** its normalized permissions are projected, **Then** the exchange emits only policy-approved canonical scopes.

---

### User Story 7 - Use IDX as an Isolated Delegated Reference (Priority: P2)

An IDX-style native credential is verified only by the registered IDX delegated-verification adapter and its configured external contract.

**Why this priority**: It demonstrates support for a proprietary credential without contaminating the framework.

**Independent Test**: Configure an IDX provider instance with a validated delegated-verification contract and demonstrate that successful verification creates a verified external identity, while a missing contract or rejection creates no Assistant token.

**Acceptance Scenarios**:

1. **Given** IDX delegated verification is configured and succeeds, **When** exchange occurs, **Then** IDX-specific handling remains inside the IDX adapter boundary.
2. **Given** the IDX endpoint contract is absent or incomplete, **When** IDX exchange is requested, **Then** the provider is not production-enabled and exchange fails closed without ES512 or decode-only fallback.

---

### User Story 8 - Onboard a New Non-IDX Customer (Priority: P2)

A previously unknown Customer uses a supported provider type without requiring knowledge of its application source or a Customer-specific condition.

**Why this priority**: It proves the framework is a product capability rather than an IDX integration.

**Independent Test**: Provision a synthetic non-IDX integration from an existing provider type, configure its instance and policy, and verify exchange through the common path.

**Acceptance Scenarios**:

1. **Given** a supported provider type, **When** a new Customer supplies its required configuration and opaque native credential, **Then** onboarding needs only provisioning and enablement.
2. **Given** a Customer needs an unsupported identity protocol, **When** onboarding is attempted, **Then** the system requires a new provider adapter rather than Customer-specific core behavior.

---

### User Story 9 - Retain Direct Feature 004 Onboarding (Priority: P2)

A Customer that can already issue canonical upstream JWTs uses Feature 004 directly and does not need the managed exchange.

**Why this priority**: Managed exchange must not become a mandatory identity broker.

**Independent Test**: Authenticate one direct Customer and one managed-exchange Customer concurrently through their registered Feature 004 profiles; prove both retain their respective trust paths.

**Acceptance Scenarios**:

1. **Given** a Customer trusted server already issues a compatible credential, **When** it calls Gateway, **Then** it bypasses Feature 005 without changed Feature 004 behavior.
2. **Given** direct and managed paths operate together, **When** requests are authenticated, **Then** Feature 004 preserves integration/profile isolation and Customer binding authority for both.

### Edge Cases

- A browser supplies an unknown, disabled, or cross-integration selector; it establishes no identity and does not reveal provider, integration, or Customer inventory. Changing a selector from Integration A to B cannot admit the same credential to B unless B's registered Integration Admission Policy accepts the verified identity.
- A decodable native token has forged claims, unsupported algorithm, missing `kid`, or stale time values; none is trusted before its provider verifies it.
- A registered delegated-verification endpoint redirects, resolves to a prohibited destination, times out, exceeds response limits, returns ambiguous data, or fails; verification remains failed.
- Verified identity is valid but canonicalization lacks a nonblank subject, integration, or HostApp source; no token is issued. An absent provider-verified organization is permitted only with an explicitly registered deterministic single-organization binding; otherwise no token is issued.
- Permission retrieval fails, returns malformed data, or has no policy-approved projection; issuance fails unless policy explicitly permits no permission source and emits empty collections.
- Provider instances share a managed issuer/JWKS/key; Feature 004 accepts only a single verified profile decision and fails closed for ambiguity.
- A native credential, provider response, JWT, authorization header, key, or sensitive permission payload is presented to logging, telemetry, audit, or public error paths.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support an optional managed server-side identity exchange that turns a verified native credential into a Feature 004-compatible canonical upstream JWT.
- **FR-002**: The system MUST preserve Customer-managed direct canonical-JWT onboarding to Feature 004 without requiring Feature 005.
- **FR-003**: The managed exchange MUST distinguish Provider Type capability from Provider Instance configuration; one provider type MAY serve many instances and integrations.
- **FR-004**: A new integration using a supported provider type MUST be onboardable through registered configuration and deployment-controlled provisioning without Customer-specific Gateway, Backend, SDK, or exchange-core source changes.
- **FR-005**: The exchange MUST route a request from a server-side registered integration selector to its registered provider instance and canonicalization policy.
- **FR-006**: The exchange MUST create a Verified External Identity only after the selected provider instance completes server-side credential verification.
- **FR-007**: The exchange MUST canonicalize only a selected-integration-admitted Verified External Identity and registered server-side policy into nonblank `integration_id`, `sub`, `org_id`, and `host_app`, plus valid `roles` and `permission_scopes` collections. `sub` MUST originate from provider-verified subject authority. `org_id` MUST originate from provider-verified organization authority or an explicitly registered deterministic single-organization binding; otherwise issuance MUST fail closed.
- **FR-008**: `integration_id` and `host_app` MUST come from trusted registered integration/canonicalization configuration, not from browser-selected or unverified native-credential claims.
- **FR-009**: The exchange MUST allow roles and permission scopes to be empty and MUST emit empty roles where no authoritative role-mapping contract exists.
- **FR-010**: Identity verification and permission retrieval/projection MUST be separable; a provider adapter MUST NOT be required to supply permissions.
- **FR-011**: A permission integration, when configured, MUST yield a server-owned normalized permission model before projection to canonical scopes; its source-specific identifiers are not core semantic authority.
- **FR-012**: The exchange MUST issue only short-lived, asymmetrically signed canonical upstream JWTs with registered issuer, exact audience, and nonblank `kid`; native credentials and unapproved native claims MUST NOT be copied into them.
- **FR-013**: Managed issuer and Feature 004 trust-profile configuration MUST remain compatible with Feature 004's registered policy and exactly-one `VerifiedProfileDecision` contract.
- **FR-014**: The system MUST support a delegated-HTTP provider type whose endpoint and response contract are registered per Provider Instance.
- **FR-015**: An IDX delegated-verification adapter MAY be the v1 reference provider, but IDX claim interpretation, permission mapping, and external verification behavior MUST remain outside the exchange core.
- **FR-016**: IDX permission normalization MUST preserve the verified semantic action model of implicit read plus insert, update, delete, print, import, export, copy, and approval where its registered provider policy supplies them; UUID-to-resource interpretation remains adapter-owned.
- **FR-017**: The SDK/Host integration MUST retain the accepted opaque `getAccessToken()` credential model; this feature MUST NOT invent or require a changed public SDK API in this repository.
- **FR-018**: The exchange MUST record safe lifecycle and decision outcomes by request, integration reference, provider type, result category, and issued-token lifecycle metadata without retaining sensitive credential material.
- **FR-019**: Provider, provider-instance, integration, and permission-policy enablement MUST be independently controllable through deployment-controlled provisioning.
- **FR-020**: The exchange MUST apply a server-side registered Integration Admission Policy after provider verification and before canonicalization. The policy MUST deterministically establish that the Verified External Identity is eligible for the selected integration using provider-verified, adapter-defined anchors; without such a policy, or if it rejects, issuance MUST fail closed.

### Security Requirements

- **SR-001**: Native credentials, decoded native claims, browser-provided flags, headers, request bodies, query values, page context, local storage, and UI state MUST NOT establish trusted identity before provider verification.
- **SR-002**: Browser selectors are non-authoritative lookup inputs only; they MUST NOT decide Customer, canonical identity, provider endpoint, issuer, JWKS source, roles, scopes, or HostApp admission.
- **SR-003**: The exchange MUST NOT resolve, persist, issue, infer, or accept `customerId` authority. Customer resolution remains exclusively Feature 004 `IntegrationBinding.integrationId → customerId`.
- **SR-004**: The exchange MUST NOT replace Feature 004 trust-profile verification, candidate routing, JWKS policy, integration-to-Customer binding, Gateway internal JWT issuance, or Feature 002 CustomerScope.
- **SR-005**: Delegated HTTP verification MUST use registered production-safe HTTPS endpoints; reject URL credentials/fragments, redirects, unsafe destinations, DNS rebinding/private-address policy failures, invalid response type/size, timeout, and ambiguous responses.
- **SR-006**: A native credential MAY be forwarded only to the selected registered provider endpoint and MUST NOT be logged or forwarded to a URL selected by native claims or browser input. Feature 005-owned frontend code and the Assistant SDK MUST NOT create a new persistent native-credential copy in localStorage, sessionStorage, IndexedDB, or equivalent browser storage; existing Host authentication-system storage remains outside Feature 005 scope.
- **SR-007**: Provider rejection, malformed credentials, disabled configuration, unavailable provider, malformed/ambiguous provider response, canonicalization failure, permission projection failure, and token issuance failure MUST fail closed without issuing an Assistant credential.
- **SR-008**: Audit, telemetry, logs, exceptions, and public responses MUST NOT expose raw native credentials, refresh tokens, authorization headers, Assistant JWTs, private keys, complete provider responses, or sensitive permission payloads.
- **SR-009**: Public errors MUST not enumerate Customer, integration, provider instance, endpoint, issuer, key, or permission inventory; provider infrastructure diagnostics remain server-internal.
- **SR-010**: Feature 005 core MUST NOT contain Customer-, HostApp-, issuer-, or protocol-specific source branches. Provider-specific behavior belongs only in a provider/permission adapter boundary.
- **SR-011**: The IDX reference provider MUST NOT implement ES512 verification in exchange core, assume a `kid`, use decode-only verification, accept browser attestation, guess an IDX endpoint, hardcode permission UUID mappings, or derive roles from `UserType` or `IsAdmin` without an authoritative registered mapping.
- **SR-012**: Managed upstream JWT signing MUST use a logical trust domain distinct from Gateway-to-Backend internal JWT signing. Managed issuer and Gateway internal issuer authority, private key material, and signing-key identity/`kid` MUST NOT be reused, although shared infrastructure capabilities may be used without sharing signing authority or key material.
- **SR-013**: Feature 005-owned frontend code and the Assistant SDK MUST NOT create long-lived persistent storage for managed Assistant credentials. If a future SDK cache is introduced, it SHOULD be short-lived and memory-only; Host authentication-system credential storage remains outside Feature 005 scope.

### Key Entities

- **Provider Type**: A reusable server-side adapter capability for one verification approach, such as delegated HTTP; it is not a Customer integration.
- **Provider Instance**: A registered, lifecycle-controlled configuration of one Provider Type for one or more integrations, including its server-owned verification contract and endpoint policy.
- **Integration Selector**: A public lookup reference that selects registered server configuration but proves no identity.
- **Verified External Identity**: The result of successful provider verification containing only provider-confirmed external identity semantics; it is never a decoded native payload.
- **Integration Admission Policy**: A server-owned, integration-specific rule that determines whether a Verified External Identity may be used with the selected integration. It evaluates only provider-verified, adapter-defined anchors such as tenant, audience, resource, organization, or subject namespace; it does not hardcode provider claim names in exchange core.
- **Canonicalization Policy**: Server-owned rules that combine registered integration values and verified identity values into Feature 004 canonical upstream semantics.
- **Permission Source and Normalized Permission**: Optional separate authority that turns trusted provider-specific permission data into semantic subject/action information before canonical-scope projection.
- **Managed Issuer Configuration**: Server-owned signing and Feature 004-compatible trust-registration arrangement for exchange-issued upstream credentials; it never owns Customer authority.
- **Exchange Audit Outcome**: A redacted lifecycle record of selection, verification, projection, issuance, and failure category.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of managed-exchange success tests show server-side provider verification before canonical JWT issuance and successful traversal of the unchanged Feature 004 trust chain.
- **SC-002**: 100% of supported-provider onboarding tests add a new integration through configuration/provisioning only, with no Customer-specific core source change.
- **SC-003**: One provider adapter demonstrably serves at least two independently configured integrations, including one non-IDX conceptual Customer scenario.
- **SC-004**: 100% of malformed, rejected, disabled, unavailable, ambiguous, and projection-failure test cases issue no Assistant-compatible credential.
- **SC-005**: 100% of authority-boundary tests prove unverified native claims and browser data cannot establish integration, HostApp, roles, scopes, Customer, or outbound provider authority.
- **SC-006**: 100% of managed issuer topology tests either produce exactly one Feature 004 verified-profile decision or fail closed.
- **SC-007**: 100% of delegated HTTP security tests reject unsafe endpoint, routing, transport, and response conditions without credential/diagnostic disclosure.
- **SC-008**: Direct Feature 004 onboarding and managed exchange onboarding both retain their supported paths without regression to Feature 002 CustomerScope or Feature 004 Customer/HostApp authority.

## Explicit Non-Goals

- Modifying IDX Auth Backend, a Customer Backend, Customer Auth Backend, Customer Identity Provider implementation, or Customer native-token issuance mechanism as a v1 requirement; nor researching Customer Backend source to onboard a supported provider type. Host Frontend SDK installation, integration configuration, and opaque credential-callback wiring remain expected integration work.
- Implementing an IDX ES512 cryptographic verifier, decode-only native-token trust, or a guessed IDX endpoint contract.
- Supporting every identity protocol in v1; standard OIDC/JWT/JWKS and future custom adapters are extension targets.
- Accepting browser-defined provider URLs, issuers, keys, Customer identity, canonical claims, role mappings, or permission mappings.
- Customer-specific Gateway logic, Customer-specific JWT mappers in exchange core, Shinmone-specific logic, or business connector/tool integration.
- Replacing Feature 004 trust profiles, IntegrationBinding authority, Gateway internal JWTs, or Feature 002 CustomerScope.
- Feature 005-owned browser persistence of native credentials or long-lived managed Assistant credentials; existing Host authentication-system credential storage is outside Feature 005 scope.

## Clarifications and Assumptions

- **IDX delegated verification contract**: The verification endpoint, HTTP method, authenticated response schema, invalid-token response, and 401/403 semantics are not yet authoritative. They are a provider-specific production-enable dependency, not a framework blocker. Until configured and validated, IDX exchange fails closed.
- **IDX roles**: `UserType` and `IsAdmin` have no accepted authoritative mapping to Assistant roles. V1 emits `roles: []` unless a future registered mapping is approved.
- **IDX permissions**: The IDX adapter may normalize verified menu/permission data into semantic subject/action values, including implicit read semantics, but the final `permission_scopes` string convention remains open until an authoritative projection contract exists.
- **SDK source**: This repository contains no SDK package or implementation. Feature 005 server behavior must remain compatible with an opaque credential-provider model, but this specification does not define whether an existing SDK API such as `getAccessToken()` supplies a native credential or a managed Assistant credential. Browser-to-exchange-to-Gateway API wiring belongs to a later feature with SDK source in scope; no Feature 005 requirement may regress the accepted SDK public contract.
- **Provider extensions**: V1 establishes the adapter/instance framework and delegated HTTP capability. OIDC/JWT/JWKS and other custom provider adapters may be added later without changing Feature 005 core, Gateway core, or Backend core.
