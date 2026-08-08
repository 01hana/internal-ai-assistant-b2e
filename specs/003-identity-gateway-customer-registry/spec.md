# Feature Specification: Identity Gateway and Customer Integration Registry

**Feature Branch**: `003-identity-gateway-customer-registry`
**Created**: 2026-08-07
**Status**: Draft

## Feature Summary

Feature 002 has completed the Backend half of the trusted identity boundary: after a valid internal JWT is received, the Backend verifies it, validates canonical claims, creates `RequestIdentityContext` and `CustomerScope`, and applies Customer-qualified business isolation. Production rollout remains blocked because there is no production Gateway runtime that can establish the trusted identity, bind an integration to an existing Customer, sign the required token, publish its public keys, and prove the complete trust chain.

Feature 003 delivers that production identity enablement boundary. It does not replace Backend authorization, CustomerScope, RAG, tool, workflow, feedback, review, or audit behavior.

## Problem Statement / Product Context

The Backend must not infer Customer identity from a host application, organization, actor, page context, request body, metadata, or public headers. A shared Backend needs a trusted Gateway that can resolve a verified integration to one explicit existing Customer, derive canonical identity from a trusted upstream authentication context, and issue a Backend-compatible internal JWT.

The resulting production trust chain is:

```text
External / Host request
        ↓
Gateway validates trusted integration / authentication context
        ↓
Gateway resolves explicit Integration → Customer binding
        ↓
Gateway derives canonical identity
        ↓
Gateway signs internal JWT
        ↓
Gateway attaches internal JWT only to its trusted protected Backend request
        ↓
Backend verifies signature, algorithm, issuer, audience, JWKS/kid, and time validity
        ↓
Backend validates canonical claims
        ↓
RequestIdentityContext → CustomerScope → Customer-qualified business work
```

Host, page, body, metadata, and public request headers cannot directly establish Backend Customer identity.

## Scope

### In Scope

- A narrow Integration Registry or equivalent authority for a stable integration identifier, explicit binding to one existing Customer, allowed HostApp/integration context, enabled/disabled trust state, and audit-safe issuance lookup decision.
- A production Gateway runtime that validates its configuration, resolves trusted identity issuance input, issues Backend-compatible internal JWTs, publishes public JWKS, and can participate in real Gateway-to-Backend verification.
- Canonical identity issuance, RS256 signing, issuer/audience alignment, `kid` key selection, key rotation requirements, safe token/key redaction, and local development verification.
- Cross-Customer issuance isolation for integrations that intentionally share lower-level organization, actor, HostApp, roles, and permission scopes.

### Out of Scope

- A second canonical Customer root, Customer administration, onboarding UI, billing, subscription, lifecycle, merge, deletion, or generic IAM platform.
- HostApp Capability Registry, Host-specific PageContext policy, screen/entity/interaction eligibility, selectedRows policy, sourceSystem governance, or Orders/Inventory reference integration. These belong to Feature 004.
- Connector registry, connector credentials, frontend SDK token issuance, Host proxy, data-adapter runtime, Gateway routing/deployment implementation details, or credential-storage design.
- Changes to Feature 002 Backend JWT verification, canonical claim validation, RequestIdentityContext, CustomerScope, CustomerToolPolicy, RAG isolation, workflow isolation, feedback/review/audit isolation, or public identity-header behavior.

## Trust Boundaries and Identity Authority

### Integration → Customer binding

An integration identifier must resolve through an explicit, verifiable, unique binding to an existing Feature 002 Customer root. The binding must also constrain the allowed HostApp or equivalent integration context and its enabled/disabled trust state.

`customer_id` must not be inferred from organization, HostApp, actor, roles, permission scopes, page context, screen, entity, request body, public headers, metadata, document content, or any lower-level identifier. A disabled, unknown, unbound, mismatched, or context-incompatible integration must fail closed without issuing a canonical internal JWT, calling a protected Backend business endpoint, selecting a default Customer, or disclosing another Customer or integration.

### Upstream authority

`sub`, `org_id`, `host_app`, `roles`, and `permission_scopes` must originate from Gateway-validated authentication or approved integration authority. Persona names, screens, PageContext, visible columns, client requests, or capability metadata must never elevate permissions.

Public headers, including `x-customer-id`, `x-integration-id`, `x-organization-id`, `x-host-app`, `x-actor-id`, `x-role`, `x-roles`, and `x-permission-scopes`, are not Backend identity authority. Receiving a header at a Gateway boundary does not make it trusted until Gateway-defined verification and explicit binding have completed.

## Canonical Internal JWT Contract

The Gateway must issue exactly the application claims already required by Feature 002:

| Claim | Contract |
| --- | --- |
| `customer_id` | Non-blank string from explicit Integration → Customer binding. |
| `integration_id` | Non-blank stable canonical integration identifier. |
| `sub` | Non-blank actor identifier from trusted upstream identity. |
| `org_id` | Non-blank organization identifier from trusted upstream identity. |
| `host_app` | Non-blank HostApp identifier allowed by the binding. |
| `roles` | `string[]`; empty is valid; each element is non-blank after trimming. |
| `permission_scopes` | `string[]`; empty is valid; each element is non-blank after trimming. |
| `jti` | Gateway-generated, non-client-controlled token identity and trace value. |
| `iss`, `aud`, `iat`, `exp` | Required registered claims aligned with Backend verification. |
| `nbf` | Optional; when issued it must satisfy Backend time validation. |
| `kid` | Required protected-header key identifier for public-key selection and rotation. |

`jti` provides token identity and traceability; it does not by itself create a distributed replay-prevention platform.

## Signing, JWKS, and Rotation Requirements

The Gateway must sign internal JWTs with RS256 only. It must reject client-selected algorithms and must not use HS256, `none`, unsigned JWTs, or a shared plaintext signing secret as the production design. Issuer and audience must exactly align with the Backend's configured internal JWT issuer and audience; the JWKS URL is a separate endpoint and need not equal the issuer URL.

The Gateway must publish a Backend-reachable public JWKS containing the data needed for verification: `kty`, `kid`, `alg`, `use`, `n`, and `e`. JWKS and all other public output must exclude private RSA material such as `d`, `p`, `q`, `dp`, `dq`, and `qi`.

Key rotation must use `kid`: a new signing key is published before issuance switches to its new `kid`; Backend verification must accept a token under that published key; retirement must follow a defined policy that does not silently invalidate still-valid tokens. Unknown `kid` must fail closed.

## Production Identity Configuration Contract

Each production environment or production-like deployment environment must provide verifiable identity configuration for the Gateway issuer, Gateway audience, Gateway public JWKS location, Gateway signing-key source/configuration, token-time settings, Backend expected issuer, Backend expected audience, and Backend JWKS URI. The Gateway issuer and audience must exactly match the Backend configuration for that environment, and the Backend must be able to reach the Gateway public JWKS.

Signing-key configuration must be production-safe and private signing material must not be stored in source control. The deployment mechanism, cloud/provider choice, secret product, networking implementation, and deployment platform remain design and deployment concerns rather than requirements for this specification.

## Redaction and Security Requirements

Gateway responses, logs, audit metadata, observability, exceptions, and tests must not retain raw Authorization headers, Bearer tokens, complete JWTs, JWT signatures, private signing keys, private JWKs, credentials, passwords, secrets, or API keys. Safe audit/observability values may include canonical Customer/integration/HostApp/actor identifiers, `jti`, `kid`, requestId, and a safe decision reason where permitted by the Feature 002 redaction contract.

Frontend clients must not mint canonical Backend JWTs. The canonical internal JWT is a Gateway-to-Backend service credential and MUST NOT be returned to an external or Frontend caller as a reusable Backend credential. An external or Frontend caller MUST NOT establish Backend identity by submitting an arbitrary canonical internal JWT unless the request traverses the explicitly trusted Gateway/service boundary defined by the system architecture. Feature 003 does not define a token-exchange protocol or Frontend authentication model, and it must preserve Feature 002's no-public-header-fallback rule.

## User Scenarios & Testing

### User Story 1 - Resolve a trusted Integration to its Customer (Priority: P1)

An integration operator can use a valid trusted integration context only when the Gateway resolves it to one explicit Customer binding.

**Why this priority**: An incorrect binding breaks the platform's outermost security boundary before the Backend can protect data.

**Independent Test**: Register Integration A → Customer A and Integration B → Customer B with identical lower-level identity attributes; resolve each independently.

**Acceptance Scenarios**:

1. **Given** an enabled Integration A explicitly bound to Customer A, **When** Gateway receives valid trusted context for A, **Then** issuance resolves Customer A and only the allowed HostApp context.
2. **Given** Integration A and B share organization, actor, HostApp, roles, and scopes, **When** each is resolved, **Then** their Customer and integration identities remain distinct.
3. **Given** an unknown, disabled, unbound, or context-mismatched integration, **When** issuance is requested, **Then** no token is issued and the response does not disclose another binding.

---

### User Story 2 - Issue a canonical internal identity JWT (Priority: P1)

A trusted Gateway can issue and attach a canonical internal identity JWT to a protected Backend request after successful upstream authentication and explicit Integration → Customer resolution. The token is a Gateway-to-Backend service-to-service credential, not an application credential received by a user or Frontend client.

**Why this priority**: This is the production prerequisite for all protected Backend operations.

**Independent Test**: Use an enabled explicit binding and trusted actor context to have Gateway attach one token to a protected Backend request, then validate its canonical claims and registered metadata at the Backend boundary.

**Acceptance Scenarios**:

1. **Given** valid issuance input, **When** Gateway issues a token, **Then** it contains every required canonical claim, RS256 metadata, a Gateway-generated `jti`, and valid time claims.
2. **Given** empty trusted roles or permission scopes, **When** a token is issued, **Then** the corresponding empty arrays remain valid without implicit authorization.
3. **Given** a client supplies conflicting public identity headers or body values, **When** a token is issued, **Then** those values do not override canonical identity.
4. **Given** an external or Frontend caller, **When** it requests or submits a canonical internal JWT outside the trusted Gateway-to-Backend path, **Then** it cannot receive a reusable Backend credential or establish Backend identity.

---

### User Story 3 - Reject unauthorized identity issuance (Priority: P1)

An attacker or misconfigured integration cannot obtain a token for another Customer or a more privileged identity.

**Why this priority**: Issuance is the trust boundary; failure must happen before a protected Backend call.

**Independent Test**: Attempt issuance with unknown, disabled, Customer-mismatched, HostApp-mismatched, invalid upstream, and permission-escalating inputs.

**Acceptance Scenarios**:

1. **Given** Integration A, **When** it requests Customer B identity, **Then** Gateway rejects without issuing a token or revealing Customer B existence.
2. **Given** an upstream identity lacks a trusted role or scope, **When** client-controlled context claims it, **Then** Gateway does not grant it.
3. **Given** invalid upstream credentials or identity, **When** issuance is requested, **Then** Gateway fails closed before Backend business work.

---

### User Story 4 - Publish public verification keys (Priority: P1)

The Backend can obtain the Gateway public key needed to validate a genuine issued token.

**Why this priority**: Signature verification cannot establish production trust without a reachable public key source.

**Independent Test**: Retrieve the Gateway JWKS and validate one issued token by its `kid` using the Backend's Remote-JWKS verifier.

**Acceptance Scenarios**:

1. **Given** an active signing key, **When** Backend obtains Gateway JWKS, **Then** the matching public key is available with required public metadata and no private material.
2. **Given** a token with unknown `kid`, **When** Backend verifies it, **Then** verification fails closed.

---

### User Story 5 - Rotate signing keys safely (Priority: P2)

An operator can introduce and retire signing keys without silently breaking valid-token verification.

**Why this priority**: Long-lived production trust requires an auditable key lifecycle.

**Independent Test**: Publish an overlap of current and new public keys, switch issuance to the new `kid`, verify both policy-eligible token states, then retire the old key according to the declared retirement policy.

**Acceptance Scenarios**:

1. **Given** a new signing key is prepared, **When** it is published before issuance switches, **Then** a token carrying the new `kid` is accepted by Backend.
2. **Given** an old key remains needed by valid tokens, **When** rotation occurs, **Then** retirement does not silently invalidate those tokens outside the declared policy.

---

### User Story 6 - Complete real Gateway-to-Backend identity integration (Priority: P1)

A real Gateway runtime can call a protected Backend endpoint with its own issued token.

**Why this priority**: Static fixtures cannot demonstrate the production trust chain.

**Independent Test**: Start real Gateway and Backend runtimes, issue a Gateway token, and call a protected Backend endpoint through Backend Remote-JWKS verification.

**Acceptance Scenarios**:

1. **Given** aligned issuer, audience, and JWKS configuration, **When** Gateway calls Backend with its token, **Then** Backend accepts the verified canonical identity.
2. **Given** an invalid signature, wrong issuer/audience, expired/future token, or unknown `kid`, **When** it reaches Backend, **Then** Backend rejects before protected business work.

---

### User Story 7 - Protect tokens, keys, and identity metadata (Priority: P2)

Security operators can investigate issuance decisions without exposing credentials or token material.

**Why this priority**: Observability must not create a second credential leak path.

**Independent Test**: Exercise successful and failed issuance, JWKS publication, rotation, and Backend integration while scanning public output, logs, audit metadata, and exception surfaces for prohibited material.

**Acceptance Scenarios**:

1. **Given** issuance or verification succeeds or fails, **When** telemetry is recorded, **Then** safe trace fields may remain while raw token, signature, Authorization, and private-key material are absent.
2. **Given** a client supplies spoofed public identity headers, **When** Gateway and Backend handle the request, **Then** those headers never become canonical identity authority.

### Edge Cases

- Integration A and B intentionally share `org_id`, `sub`, `host_app`, roles, and scopes.
- A binding is disabled, missing its Customer, has no allowed HostApp match, or conflicts with claimed context.
- Canonical string claims are blank, roles/scopes are not arrays, or either array contains a blank element.
- The token has a client-selected algorithm, missing/unknown `kid`, invalid signature, wrong issuer/audience, invalid `iat`, expired `exp`, or future `nbf`.
- JWKS omits the active public key, exposes private material, is unavailable, or has not published a new key before issuance switches.
- A rotation attempts premature old-key retirement.
- Raw credentials or token material are present in nested errors, audit metadata, logs, or test output.

## Functional Requirements

- **FR-001**: The system MUST maintain a stable integration identifier with one explicit, verifiable binding to one existing Customer root for identity issuance.
- **FR-002**: The binding MUST record the allowed HostApp or equivalent integration context and an enabled/disabled trust state.
- **FR-003**: The system MUST resolve `customer_id` only from the explicit binding and MUST NOT infer it from lower-level identity, request, content, or metadata values.
- **FR-004**: The system MUST derive `sub`, `org_id`, `host_app`, roles, and permission scopes only from trusted upstream identity or approved integration authority.
- **FR-005**: Unknown, disabled, unbound, Customer-mismatched, HostApp-mismatched, or invalid-upstream issuance requests MUST fail closed before token issuance or protected Backend business work.
- **FR-006**: Safe issuance failures MUST NOT disclose another Customer, integration, binding, or credential detail.
- **FR-007**: The Gateway MUST issue all canonical application claims listed in the Canonical Internal JWT Contract without changing Feature 002 claim semantics.
- **FR-008**: Canonical string claims MUST be non-blank; `roles` and `permission_scopes` MUST be arrays of non-blank strings and MAY be empty.
- **FR-009**: The Gateway MUST generate `jti`; client input MUST NOT determine it.
- **FR-010**: Issued tokens MUST contain `iss`, `aud`, `iat`, and `exp`; optional `nbf` MUST satisfy Backend time validation.
- **FR-011**: Issued tokens MUST use RS256 and a non-blank `kid`; client-selected signing algorithm, HS256, `none`, unsigned tokens, and shared plaintext production signing secrets are prohibited.
- **FR-012**: Gateway issuer and audience MUST exactly align with the Backend internal JWT configuration for the deployed environment.
- **FR-013**: The Gateway MUST publish a Backend-reachable public JWKS with `kty`, `kid`, `alg`, `use`, `n`, and `e` for active verification keys.
- **FR-014**: JWKS and all public output MUST exclude private signing material, including `d`, `p`, `q`, `dp`, `dq`, and `qi`.
- **FR-015**: The Gateway MUST publish a new public key before issuing tokens with its new `kid`.
- **FR-016**: The key-retirement policy MUST prevent silent invalidation of still-valid tokens and MUST define rollback-safe handling for a failed rollout.
- **FR-017**: Unknown `kid`, invalid signature, wrong issuer/audience, and invalid token time claims MUST fail closed at the Backend boundary.
- **FR-018**: The Gateway MUST provide a local development path that proves runtime start, JWKS reachability, issuance, Backend acceptance, and negative token rejection.
- **FR-019**: Feature completion MUST include a real Gateway-issued token accepted by a protected Backend endpoint through Remote-JWKS verification; static fixtures and mock verifiers alone are insufficient.
- **FR-020**: Integration A MUST NOT obtain a token for Customer B, even when all lower-level identity values are identical.
- **FR-021**: Public identity headers and client-controlled body, page, metadata, and capability values MUST NOT establish, supplement, override, or elevate canonical Backend identity.
- **FR-022**: The Gateway MUST redact raw Authorization values, Bearer tokens, full JWTs, signatures, private keys/JWKs, credentials, passwords, secrets, and API keys from responses, logs, audit metadata, observability, exceptions, and test artifacts.
- **FR-023**: Audit-safe issuance and rotation records MUST retain only approved traceability fields and safe decision reasons.
- **FR-024**: Feature 003 MUST reuse the existing Feature 002 Customer root and MUST NOT create a second Customer authority, Customer lifecycle platform, or replacement Backend identity context.
- **FR-025**: Production rollout MUST remain blocked until all Feature 003 readiness requirements have real runtime evidence.
- **FR-026**: Canonical internal JWTs MUST be Gateway-to-Backend service-to-service credentials. The Gateway MUST attach an issued token only on the trusted Gateway-to-Backend request path and MUST NOT expose it to external or Frontend callers as a reusable Backend credential.
- **FR-027**: Each production environment or production-like deployment environment MUST provide validated Gateway and Backend identity configuration, including exact issuer/audience alignment, a Backend-reachable Gateway public JWKS, production-safe signing-key source/configuration, and compatible token lifetime and time-validation settings. The deployment mechanism remains a design and deployment concern.

### Key Entities

- **Integration Binding**: A stable integration identity, its explicit link to one existing Customer, allowed integration/HostApp context, enabled state, and safe issuance decision context.
- **Trusted Upstream Identity**: The verified external or Host authentication context from which actor, organization, HostApp, roles, and permission scopes can be derived without client authority.
- **Internal Identity Token**: The RS256 Gateway-issued canonical JWT consumed by Feature 002 Backend verification.
- **Signing Key Lifecycle**: The active and retiring public/private key relationship needed for `kid` selection, JWKS publication, rollout, and retirement policy.

## Non-Functional / Security Requirements

- The Gateway must fail closed for identity, binding, signing, key, JWKS, and time-validation failures.
- Private signing material must be protected from clients, repositories, logs, audit metadata, exception details, and public JWKS.
- Token issuance and key changes must have auditable, redacted traceability.
- Production evidence must use real Gateway and Backend runtimes, not test-only signer or static-verifier fixtures.
- The feature must preserve Feature 002's customer-first isolation and safe no-disclosure behavior.

## Dependencies and Future Work

### Feature 002 Compatibility Contract

Feature 002 remains authoritative for JWT cryptographic verification, canonical claim validation, `RequestIdentityContext`, `CustomerScope`, Customer-qualified data access, CustomerToolPolicy, RAG isolation, workflow isolation, and feedback/review/audit isolation. Feature 003 must issue the exact identity contract those boundaries already require and must not duplicate their runtime behavior.

### Feature 004 Boundary

Feature 004 may define HostApp capability governance, PageContext policy, selectedRows behavior, sourceSystem evidence consistency, and reference Orders/Inventory integration. Feature 003 only issues the canonical `host_app` claim required for future safe use.

## Success Criteria

- **SC-001**: 100% of valid issuance tests produce all eight canonical application claims with valid registered token metadata.
- **SC-002**: 100% of A/B isolation tests keep distinct `customer_id` and `integration_id` when lower-level identity values are identical.
- **SC-003**: 100% of unknown, disabled, unbound, mismatched, or invalid-upstream issuance cases produce no token and no protected Backend business work.
- **SC-004**: A genuine issued token is accepted by a protected Backend endpoint through the configured public JWKS path.
- **SC-005**: 100% of invalid-signature, wrong-issuer, wrong-audience, unknown-`kid`, expired, future, and malformed-token cases fail before protected business work.
- **SC-006**: Every published verification key contains required public metadata and no private RSA material.
- **SC-007**: A new-key rollout proves that Backend accepts a token with the new published `kid` before old-key retirement.
- **SC-008**: Rotation verification demonstrates no silent invalidation of tokens that remain valid under the declared retirement policy.
- **SC-009**: Security-output scans find zero raw Authorization headers, JWTs, signatures, or private-key material in required Gateway response, log, audit, observability, exception, and test surfaces.
- **SC-010**: 100% of conflicting public identity-header tests leave canonical identity unchanged or fail closed.
- **SC-011**: A documented local development path demonstrates Gateway start, JWKS reachability, issuance, Backend acceptance, and required negative token rejection.
- **SC-012**: Production-readiness evidence for every production environment or production-like deployment environment proves exact Gateway/Backend issuer alignment, exact Gateway/Backend audience alignment, Backend-reachable Gateway JWKS, production-safe signing-key source/configuration, and compatible token lifetime/time-validation configuration.
- **SC-013**: Production readiness is marked READY only when SC-001 through SC-012 have real runtime and deployment identity-configuration evidence; otherwise rollout remains BLOCKED.

## Assumptions / Decisions

- Feature 002's existing Customer root is the only canonical Customer authority.
- Upstream authentication protocol, registry storage, key storage, rotation deployment procedure, token lifetime value, and exact error envelope are design decisions, provided they satisfy this specification and existing Backend compatibility contract.
- A server-side global replay cache is not required solely because `jti` exists; any future replay policy must be specified separately.
- No blocking open questions remain for specification planning.

## Open Questions

None. Implementation-specific choices are intentionally deferred to design.
