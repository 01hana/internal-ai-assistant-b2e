# Feature Specification: Customer Integration Contract v1

**Feature Branch**: `004-customer-integration-contract`  
**Created**: 2026-08-14  
**Status**: Draft  
**Input**: Customer identity onboarding must use a standard registered trust contract rather than Customer-specific Gateway changes.

## Product Context and Boundary

Customer systems use different identity arrangements, including standards-compatible tokens, proprietary token claims, and legacy authentication services. This feature defines the product requirements for onboarding those systems to the existing Assistant Platform trust chain:

```text
Customer trusted identity
  → Gateway verification against a registered trust profile
  → existing IntegrationBinding
  → existing Customer
  → existing Gateway internal identity
  → Backend Feature 002 CustomerScope
```

This feature does not redesign the Assistant runtime owned by Feature 001, the verified internal identity and CustomerScope boundary owned by Feature 002, or the Gateway-to-Backend internal identity lifecycle owned by Feature 003.

### Canonical Upstream Identity Contract v1

For either supported onboarding pattern, the credential presented to Gateway MUST convey the following verified semantics:

| Semantic | Contract requirement |
| --- | --- |
| `integration_id` | A stable identity for an Assistant Platform-registered integration. It is not browser-selected or derived from lower-level identifiers. |
| `sub` | A stable authenticated principal within the integration's trusted identity domain. |
| `org_id` | The authenticated user's actual operating organization or business boundary. |
| `host_app` | The Host Application the registered integration is authorized to represent. |
| `roles` | A collection of approved canonical-role projections; an empty collection is valid. |
| `permission_scopes` | A collection of approved canonical permission-scope projections; an empty collection is valid. |

The contract defines required semantics and trust boundaries, not a Customer-specific claim mapping or a complete token wire format.

### Supported Onboarding Patterns

- **Direct Trusted JWT**: A Customer's existing trusted identity credential already meets the registered Gateway-facing upstream trust contract. It does not require a Customer-specific Gateway claim adapter. No Customer Backend change is required solely for Assistant identity translation.
- **Trusted Server-side Token Exchange**: A Customer's existing identity is verified and translated by a trusted Customer server, BFF, identity bridge, or future managed adapter into the same Gateway-facing contract. Feature 004 defines that contract and a reference/test fixture; the deployment location and any production Customer-specific exchange service are intentionally not prescribed.

Identity translation MUST NOT run in the browser or Assistant SDK, and neither pattern changes the Gateway's generic trust boundary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Onboard a Direct-compatible Customer (Priority: P1)

A platform operator can register a Customer integration whose existing trusted identity already satisfies the Canonical Upstream Identity Contract v1, allowing it to use the Assistant without Customer-specific Gateway business logic.

**Why this priority**: Direct compatibility makes Customer onboarding repeatable while preserving the established identity boundary.

**Independent Test**: Register one enabled integration with a valid trust profile and a compatible Customer credential, then verify that its trusted identity reaches the existing Customer binding without a Customer-specific Gateway behavior.

**Acceptance Scenarios**:

1. **Given** an existing Customer and an enabled registered integration with a matching trust profile, **When** the Customer presents a compatible trusted credential, **Then** the Gateway accepts the verified identity and resolves only that integration's existing Customer binding.
2. **Given** a Customer credential includes identifiers that resemble Customer or organization authority, **When** it is accepted, **Then** those values do not replace the Customer selected by the existing IntegrationBinding.
3. **Given** a Customer requires no identity translation because its credential satisfies the contract, **When** it is onboarded, **Then** no Customer Backend change is required for Assistant identity translation.

---

### User Story 2 - Onboard a Legacy Customer through Trusted Token Exchange (Priority: P1)

A legacy Customer can retain its existing authentication while a trusted server-side boundary supplies a short-lived credential that meets the same Gateway-facing identity contract.

**Why this priority**: It lets Customers with incompatible legacy claims adopt the platform without moving identity authority into the browser or changing Gateway core behavior.

**Independent Test**: Use a legacy identity at a trusted server-side translation boundary and verify that the resulting credential is evaluated through the same registered trust profile and binding flow as a direct-compatible Customer.

**Acceptance Scenarios**:

1. **Given** a legacy Customer whose original credential does not meet the contract, **When** its trusted server-side boundary verifies and translates that identity, **Then** Gateway evaluates the resulting credential through the common contract, as demonstrated by the Feature 004 reference/test fixture.
2. **Given** a legacy Customer integration, **When** its frontend uses the Assistant SDK, **Then** the SDK provides an opaque credential and does not map legacy claims into canonical identity fields.
3. **Given** an attempt to translate identity in browser code or sign a trusted credential with browser-held key material, **When** authentication is requested, **Then** no trusted identity is established.

---

### User Story 3 - Run Multiple Customer Trust Profiles Safely (Priority: P1)

A platform operator can operate integrations for different Customers with different issuers, audiences, and verification-key sources without cross-integration or cross-Customer identity leakage.

**Why this priority**: Multi-Customer onboarding is the core scalability outcome of this feature.

**Independent Test**: Register Customer A and Customer B with distinct trust profiles and verification material, authenticate each, and prove that neither can resolve the other's profile, Host Application, or Customer binding.

**Acceptance Scenarios**:

1. **Given** enabled integrations for Customers A and B with different registered trust profiles, **When** each presents its valid credential, **Then** each is evaluated only against its own registered trust contract.
2. **Given** Customer A attempts to use Customer B's profile or binding, **When** authentication is requested, **Then** the request fails closed and does not disclose Customer B information.
3. **Given** verifier selection uses unverified `iss` or `kid` metadata as a routing hint, **When** final identity is established, **Then** exactly one enabled candidate trust profile succeeds cryptographic verification and full registered-policy evaluation before it provides authority.

---

### User Story 4 - Disable a Compromised or Retired Integration (Priority: P2)

A platform operator can disable an integration so that future authentication requests fail safely without disrupting other enabled Customer integrations.

**Why this priority**: Operators need a prompt containment action for a compromised, retired, or incorrectly configured integration.

**Independent Test**: Disable one of two otherwise valid registered integrations and attempt new authentication for both.

**Acceptance Scenarios**:

1. **Given** an enabled integration is disabled or revoked, **When** a new authentication request arrives for it, **Then** authentication fails before protected Assistant business work begins.
2. **Given** a different integration remains enabled, **When** the first integration is disabled, **Then** the enabled integration continues to be evaluated by its own trust profile.
3. **Given** an unknown, disabled, or unbound integration, **When** authentication fails, **Then** the response does not reveal another integration, Customer, or binding.

---

### User Story 5 - Integrate the SDK Without Customer-specific Identity Logic (Priority: P2)

A Customer frontend can use the same Assistant SDK model regardless of whether its Customer uses direct trusted credentials or server-side token exchange.

**Why this priority**: A stable SDK contract prevents Customer-specific identity logic from spreading into client applications.

**Independent Test**: Configure two Customer frontends using different onboarding patterns, supply credentials through the same token-provider model, and verify that neither frontend derives or modifies canonical identity values.

**Acceptance Scenarios**:

1. **Given** either supported onboarding pattern, **When** the frontend requests an Assistant credential, **Then** the SDK receives it only as an opaque access token through `getAccessToken()`.
2. **Given** browser configuration, page context, route data, local storage, request bodies, or SDK options contain identity-like values, **When** the SDK sends a request, **Then** none establishes or elevates trusted identity.
3. **Given** a Customer changes between direct-compatible and trusted-exchange onboarding, **When** its frontend continues to use the SDK, **Then** its public SDK identity model remains unchanged.

### Edge Cases

- Two integrations share the same subject, organization, Host Application, roles, or permission scopes but remain bound to different Customers.
- A token names a `customer_id`, `customer`, `tenant`, or organization that conflicts with the registered binding.
- A single-organization user, multi-organization user, or active-organization selection lacks a deterministic verified operating boundary.
- A required semantic is missing, blank, malformed, or supplied only from browser-controlled state; `roles` and `permission_scopes` may instead be valid empty collections.
- A candidate profile has zero candidates, zero successful verifications, or multiple ambiguous successful trust decisions.
- An issuer, exact expected audience, verification key, cryptographic algorithm, time claim, or verification-key source is unknown, unavailable, mismatched, expired, invalid, or rotated without a valid trusted key.
- An unverified routing hint points to an incorrect profile, or an integration/profile is disabled during normal operation.
- Audit or diagnostic output would otherwise include a raw credential, signed token, private key, or sensitive claim dump.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support onboarding through both Direct Trusted JWT and Trusted Server-side Token Exchange patterns using one common Gateway-facing identity contract.
- **FR-002**: The system MUST allow each usable Customer Integration to have a registered upstream trust profile that references that stable integration identity. The trust profile MUST NOT independently determine Customer or create a second Customer binding authority.
- **FR-003**: A registered trust profile MUST define the referenced integration identity, allowed Host Application, one active trusted issuer, one exact expected audience, verification-key or JWKS source, allowed cryptographic policy, enabled/disabled trust lifecycle, and upstream verification requirements. It MUST NOT contain or determine Customer authority.
- **FR-004**: The system MUST accept identity authority only after successful cryptographic verification against a registered trust profile.
- **FR-005**: A verified upstream identity MUST provide non-blank `integration_id`, `sub`, `org_id`, and `host_app` semantics consistent with its registered integration contract.
- **FR-006**: `integration_id` MUST identify an Assistant Platform-registered integration and MUST NOT be generated, selected, or inferred from browser state, Host routes, page context, local storage, organization identifiers, user identifiers, or Customer-specific legacy identifiers.
- **FR-007**: `sub` MUST represent a stable authenticated principal from the Customer's trusted identity boundary and MUST NOT be determined by browser bodies, page context, UI user state, or query parameters.
- **FR-008**: `org_id` MUST represent the user's deterministically verified current organization or business boundary. An integration that cannot reliably determine the active organization MUST NOT issue organization-authoritative upstream identity.
- **FR-009**: `host_app` MUST match the Host Application allowed by the registered integration contract and MUST NOT be trusted solely from browser configuration, SDK options, request data, or page context.
- **FR-010**: `roles` and `permission_scopes` MUST each allow an empty collection as the valid minimum-privilege projection.
- **FR-011**: A non-empty `roles` projection MUST have explicit business semantics, server-side authority, and a documented versioned mapping contract.
- **FR-012**: A non-empty `permission_scopes` projection MUST be server-owned, documented, versioned, and enforceable.
- **FR-013**: The system MUST resolve Customer only as `verified integration_id` → existing `IntegrationBinding` → `IntegrationBinding.customerId`. `IntegrationBinding.customerId` is the sole Customer authority for Gateway-to-Backend identity; trust profiles and upstream credentials, including `customer_id`, `customer`, `tenant`, or organization-like claims, MUST NOT decide, replace, infer, or override that Customer.
- **FR-014**: The system MUST support multiple concurrently enabled integrations with distinct issuers, audiences, or verification-key sources without requiring Customer-specific Gateway source behavior for each Customer.
- **FR-015**: The system MUST define a lifecycle in which an integration is provisioned, has a trust profile registered, becomes enabled, accepts eligible credentials, and can be disabled or revoked.
- **FR-016**: Disabling or revoking an integration MUST prevent its new authentication requests from establishing trusted identity while not changing the trust decision for other enabled integrations.
- **FR-017**: The Assistant SDK MUST expose the same public credential model for every Customer through `getAccessToken()` and MUST treat the supplied credential as opaque.
- **FR-018**: A direct-compatible Customer MUST NOT be required to modify its Customer Backend solely to provide Assistant identity translation.
- **FR-019**: A legacy Customer that needs translation MUST limit its added responsibility to a trusted server-side identity boundary; Assistant sessions, history, streaming, retrieval, orchestration, workflows, approvals, and business audit remain Assistant Platform responsibilities.
- **FR-020**: Security-relevant trust decisions MUST be auditably distinguishable by integration, trust-profile decision, verification outcome class, binding resolution, disabled/unknown integration state, and issuer/audience mismatch where applicable.
- **FR-021**: Feature 004 MUST define the Trusted Server-side Token Exchange Contract and provide a reference/test fixture that demonstrates legacy identity translation into the common Gateway-facing contract. It MUST NOT require a production-ready Customer-specific exchange server or Customer production rollout.
- **FR-022**: The initial release MUST use deployment-controlled provisioning so that a platform operator can provision, update, or disable integration trust configuration through a controlled deployment mechanism. The provisioning technology is a design decision.

### Security Requirements

- **SR-001**: Browser clients, the SDK, public headers, request bodies, query parameters, page context, route data, local storage, and UI state MUST NOT establish, supplement, override, or elevate `integration_id`, `sub`, `org_id`, `host_app`, `roles`, `permission_scopes`, or Customer authority.
- **SR-002**: The SDK MUST NOT decode credentials to create trusted canonical identity, map Customer-specific claims, mint trusted upstream credentials, or hold signing private keys.
- **SR-003**: A browser MUST NOT translate legacy identity claims into trusted canonical identity or hold signing private key material.
- **SR-004**: Customer-specific legacy claim names and mappings MUST NOT become the platform-wide contract or standard Gateway customer-specific logic.
- **SR-005**: Before cryptographic verification succeeds, only unverified `iss` and `kid` metadata MAY be used as a non-authoritative candidate trust-profile routing hint. `integration_id`, `sub`, `org_id`, `host_app`, `roles`, `permission_scopes`, Customer, and all other unverified claims MUST NOT provide final authority.
- **SR-006**: Final trust requires one enabled candidate trust profile, successful cryptographic verification, issuer/audience/algorithm/time-policy compliance with that profile, complete verified canonical identity semantics, verified `integration_id` resolution through the existing IntegrationBinding, a registered HostApp match, and exactly one valid integration/trust decision.
- **SR-007**: Zero candidates, zero successful verifications, or multiple ambiguous successful trust decisions MUST fail closed before protected Assistant business work.
- **SR-008**: A failed trust request MUST NOT fall back to Backend direct mode, browser identity headers, another Customer profile, automatic Customer creation, select the first profile or integration, or alter an integration binding.
- **SR-009**: An integration's credential MUST NOT use another integration's trust profile, Customer binding, or HostApp authority, and MUST NOT cross the existing Backend CustomerScope boundary.
- **SR-010**: Upstream verification trust MUST use secure public verification material, bounded caching, normal signing-key rotation for its one active issuer, and fail-closed handling for unknown keys and invalid signatures. Multiple concurrently authoritative issuers for one active trust profile are not supported in v1.
- **SR-011**: Audit, observability, errors, and diagnostic output MUST NOT retain raw bearer credentials, complete JWTs, private keys, or sensitive claim dumps.
- **SR-012**: This feature MUST preserve Feature 002's requirement that browser credentials cannot directly establish Backend trusted identity and MUST preserve Feature 003's generic Gateway internal identity chain.
- **SR-013**: The system MUST NOT provide a Customer-specific Gateway handler as the standard onboarding mechanism.

### Key Entities

- **Canonical Upstream Identity Contract v1**: The common verified identity semantics that every Customer credential must provide to Gateway, independent of Customer-native claim names.
- **Customer Integration**: A stable Assistant Platform integration identity. The existing IntegrationBinding is the sole mapping from that identity to one existing Customer.
- **Registered Upstream Trust Profile**: The registered upstream verification policy associated with one Customer Integration. It references the integration identity but does not contain or determine Customer authority.
- **Trusted Server-side Exchange Boundary**: A Customer-controlled trusted service boundary that may translate legacy identity into the common upstream contract.
- **Verified Upstream Identity**: The authenticated integration, subject, organization, Host Application, and approved authorization projections available only after valid verification and profile evaluation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of onboarding tests for a new direct-compatible Customer show it can use a registered integration and trust profile without Customer-specific Gateway source behavior.
- **SC-002**: 100% of legacy-onboarding tests using the Token Exchange reference/test fixture show a trusted server-side exchange credential follows the same Gateway-facing contract and SDK request model as a direct-compatible credential, without requiring a production Customer-specific issuer.
- **SC-003**: In tests with at least two integrations using distinct issuer or verification-key sources, 100% of valid requests select exactly one correct enabled trust profile and retain Customer and integration isolation; zero or ambiguous successful decisions fail closed.
- **SC-004**: 100% of tested credentials containing Customer-like claims leave Customer authority determined only by the existing IntegrationBinding.customerId.
- **SC-005**: 100% of browser and SDK tampering tests for `integration_id`, `org_id`, `host_app`, `roles`, or `permission_scopes` fail to establish or elevate trusted identity.
- **SC-006**: 100% of new authentication requests for a disabled integration fail closed, while valid requests for separately enabled integrations continue to be evaluated normally.
- **SC-007**: 100% of legacy-exchange acceptance evidence keeps Customer-specific identity translation at a trusted server-side boundary and demonstrates no corresponding Customer-specific SDK or Gateway core identity logic.

## Explicit Non-goals

- Customer lifecycle management, Customer administration, billing, subscription, merge, or deletion.
- A generic IAM platform, OAuth/OIDC provider, universal identity broker, or arbitrary API gateway.
- Browser JWT signing, browser legacy-claim translation, SDK JWT decoding, SDK claim mapping, or SDK private-key storage.
- A Customer-specific permission-model redesign or Customer-specific Gateway hard-coded logic.
- Shinmone SCM authentication refactoring, Shinmone production deployment repair, or a required Shinmone production rollout.
- Changes to Feature 001 Assistant runtime responsibilities.
- Changes to Feature 002 Backend trusted identity verification, canonical claim validation, RequestIdentityContext, CustomerScope, or Customer-scoped business behavior.
- Changes to Feature 003 Gateway internal JWT signing, internal JWKS lifecycle, or Gateway-to-Backend transport.
- Business-data connectors, connector credentials, Customer business API access, RAG connectors, or a generic data-adapter platform.
- A runtime or public administration interface, Customer self-service provisioning, or generic management CLI for trust-profile provisioning.
- Capability governance, PageContext policy, selected-row policy, source-system governance, or Feature 005+ design.

## Relationship to Business Data Connectors

Identity integration and business-data connectivity are separate product concerns. This feature only standardizes Customer identity onboarding and upstream trust. Customer business operations such as order retrieval, inventory lookup, and customer lookup are out of scope and require a separately specified connector capability.

## Assumptions

- Feature 002's existing Customer root and Feature 003's existing IntegrationBinding remain the sole Customer authority; this feature adds requirements around onboarding into that established boundary.
- The existing Gateway remains the generic verification and internal identity boundary. Feature 004 does not reopen Feature 003 or require a second Gateway trust chain.
- A Customer's trusted server-side exchange boundary may be its existing Backend, BFF, dedicated identity bridge, or a future managed adapter; selecting one is a later design decision.
- `roles` and `permission_scopes` may legitimately be empty when no approved, enforceable canonical projection exists.
- Shinmone may later serve as a reference legacy integration, but its native claim names are not platform-contract vocabulary.
- Deployment-controlled provisioning may use any controlled deployment mechanism; this specification does not select its technology or prohibit implementation-supporting persistence changes.

## Clarifications

- An active trust profile has one active trusted issuer. Normal signing-key rotation for that issuer, including multiple valid verification keys, is supported; concurrent dual-issuer authority requires a future contract extension and explicit profile replacement/version transition.
- Every trust profile registers one exact expected audience. Integrations MAY share an audience value, but sharing a value does not share identity or Customer authority.
- Before verification, only unverified `iss` and `kid` may narrow candidate profiles. They never establish authority. Zero candidates, zero successful verifications, and multiple successful decisions all fail closed.
- Token Exchange v1 delivers the trusted server-side exchange contract and a reference/test fixture, not a production Customer adapter, managed exchange service, or Shinmone production issuer.
- Provisioning is deployment-controlled in v1. A platform operator can provision, update, and disable trust configuration through a controlled deployment mechanism; no runtime/public management interface is required.

## Scope-Conflict Assessment

No scope conflict with Features 001–003 is identified. Feature 001 retains Assistant runtime ownership. Feature 002 remains the only trusted internal identity and CustomerScope owner. Feature 003 retains the generic verified-upstream-to-IntegrationBinding-to-internal-JWT chain and its internal signing lifecycle. This feature specifies scalable Customer onboarding requirements at the external upstream trust boundary only; it does not add HostApp capability governance or business-data connector behavior.
