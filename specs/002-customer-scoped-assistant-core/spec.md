# Feature Specification: Customer-Scoped Assistant Core

**Feature Branch**: `002-customer-scoped-assistant-core`

**Created**: 2026-07-31

**Status**: Draft

**Input**: Customer is the first-class data ownership and security isolation boundary for a shared Assistant Backend.

## Clarifications

### Session 2026-07-31

- Q: Which data migration paths must this feature support? → A: Both reset/seed for rebuildable development or test data and expand → explicit backfill → enforce for retained data.
- Q: Does Backend require a Customer master owner? → A: Yes. A minimal Customer record is the ownership target; this does not introduce a Customer management UI, Gateway registry, or platform control plane.
- Q: What is the role of `integration_id`? → A: It is a Gateway-signed canonical identity claim; this feature does not implement issuer onboarding, client allowlists, or external claims mapping.
- Q: May `roles` and `permission_scopes` be empty? → A: Yes. Both are string arrays whose elements must be non-empty after trimming; an empty array represents a verified identity with no granted authorization. Permission checks deny operations that require absent scopes.
- Q: How is the Gateway rollout coordinated? → A: Feature 002 may use test internal-JWT fixtures for Backend development and verification. Before production enables the required customer claims, Feature 003/Gateway must formally sign `customer_id` and `integration_id`; public identity headers are not an interim fallback.
- Q: What is the KnowledgeDocument RAG access policy? → A: `visibility` is either `CUSTOMER` or `ORGANIZATION`. `CUSTOMER` requires an empty `organizationIds` allowlist and permits all Organizations in the same Customer; `ORGANIZATION` requires a non-empty allowlist containing the requesting canonical `organizationId`. `requiredPermissionScopes` uses ALL semantics; an empty array imposes no additional scope restriction. HostApp is not a knowledge visibility boundary. Unknown, missing, malformed, or internally inconsistent policy is denied before candidate selection; document writes/updates use the existing validation error contract to reject it.
- Repository basis: the current identity context is built from public headers and a single role, current persisted records lack `customerId`, retrieval reads globally active knowledge chunks, and several flows address records by global ID or global idempotency key. This feature replaces those behaviors for customer-owned operations.
- Legacy-contract conflict: `src/identity/identity-context.validator.ts` currently rejects an empty `permissionScopes` array with `length > 0`, and `test/unit/identity-context-validation.spec.ts` treats that array as invalid. The target contract in this feature intentionally replaces that legacy requirement; no existing formal roles/scopes regex or enum grammar was found.

## Context and Terminology

The shared Backend serves multiple Customers. The mandatory ownership hierarchy is:

```text
Customer → Organization → HostApp → Actor
```

- **Customer / customerId**: the outermost Backend data ownership and security isolation boundary.
- **Organization**: a business boundary within one Customer. It cannot replace `customerId`.
- **HostApp**: an integrated host application within one Customer. It cannot replace `customerId` or organization.
- **Actor**: a signed user acting within the Customer, organization, and HostApp context.
- **Roles**: `string[]` supplied only by signed identity claims; roles support authorization but cannot replace `customerId`.
- **Permission scopes**: signed fine-grained authorization values; they cannot replace `customerId`.
- **requestId**: a tracing and audit-correlation value generated or normalized by the Gateway, Backend, or trusted tracing mechanism. It is not an identity claim or authorization boundary.

This specification uses `Customer` and `customerId` consistently. It does not define a separate tenant identifier.

## Internal Assistant Context *(mandatory by Constitution)*

All protected business endpoints that access customer-owned data or perform business operations must accept only a Gateway-issued, verified internal identity token. The Backend must validate signature, issuer, audience, `iat`, `exp`, and, when present, `nbf` before establishing the request context. Missing tokens and tokens that cannot be verified, have missing or invalid registered validation claims, or have invalid signatures, issuer, audience, `exp`, or `nbf` must return `401 IDENTITY_TOKEN_INVALID` before business work begins. External customer access tokens and public identity headers must not establish or supplement that context.

After the token is verified, the required canonical identity claims are `customer_id`, `integration_id`, `sub`, `org_id`, `host_app`, `roles`, `permission_scopes`, and `jti`. `customer_id`, `integration_id`, `sub`, `org_id`, `host_app`, and `jti` must be non-empty strings. `roles` and `permission_scopes` must be string arrays whose elements are non-empty after trimming; either array may be empty. Empty arrays represent a verified identity with no granted authorization, so the permission pipeline must deny any operation that requires an absent scope. A token that is successfully verified but has missing, blank, wrongly typed, or inconsistent canonical claims must return `403 IDENTITY_CONTEXT_INVALID`. No public-header fallback is permitted.

The canonical request context must contain customer, organization, HostApp, actor, auth, and requestId. Auth must retain the signed-token identity needed for traceability, including token ID and issuer metadata, without retaining raw tokens. Health, readiness, metrics, and public documentation may follow deployment policy, but must not expose Customer data or business-operation capability.

SDKs and Customer Hosts may securely transport an existing login credential or session, provide a same-origin BFF/reverse proxy, and supply page context and operation input. They must not create, overwrite, or decide canonical customer, integration, organization, HostApp, actor, roles, or permission scopes. Identity Gateway remains responsible for canonical identity mapping.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use isolated conversations and history (Priority: P1)

An internal user uses assistant sessions and message history within their Customer. A different Customer cannot discover, resume, read, or modify those resources even when organization ID, actor ID, and HostApp are identical.

**Why this priority**: Session and history access is the entry point to customer-owned conversation data; a weak boundary leaks all downstream context.

**Independent Test**: Create two Customers using the same organization ID, actor ID, and HostApp. Create a session and messages for one Customer, then attempt each read and write path using the other Customer's signed identity.

**Acceptance Scenarios**:

1. **Given** a verified identity for Customer A, **When** it creates and resumes a session, **Then** the session, messages, context state, plans, and answer records are owned by Customer A.
2. **Given** Customer B has the same organization ID, actor ID, and HostApp as Customer A, **When** Customer B requests Customer A's session or message history by ID, **Then** it receives not-found or the established safe error and no resource-existence information.
3. **Given** a request has no token or a token with invalid signature, issuer, audience, `exp`, or `nbf`, **When** it calls a protected assistant endpoint, **Then** no session or message operation begins and it receives `401 IDENTITY_TOKEN_INVALID`.
4. **Given** a request has a successfully verified token with missing, blank, wrongly typed, or inconsistent canonical claims, **When** it calls a protected assistant endpoint, **Then** no session or message operation begins and it receives `403 IDENTITY_CONTEXT_INVALID`.

---

### User Story 2 - Retrieve only Customer-owned knowledge and evidence (Priority: P1)

An internal user receives answers grounded only in knowledge and evidence owned by their Customer.

**Why this priority**: Retrieval before customer filtering can disclose another Customer's documents even if the final response is filtered.

**Independent Test**: Store matching knowledge for two Customers and make the same query under otherwise identical organization, actor, and HostApp values.

**Acceptance Scenarios**:

1. **Given** Customer A and Customer B each have matching active knowledge, **When** Customer A asks a matching question, **Then** candidate, selected evidence, and answer references contain only Customer A's records.
2. **Given** Customer A has no matching knowledge and Customer B does, **When** Customer A performs retrieval, **Then** Customer A receives a no-evidence outcome and no Customer B metadata, count, title, source key, or content.
3. **Given** two Customers use the same source key and version, **When** both knowledge documents are stored, **Then** both are accepted and remain independently addressable within their respective Customer scope.
4. **Given** Customer A contains matching knowledge from a different organization or a source not visible to the requesting actor, **When** the actor performs retrieval, **Then** those records are excluded before candidate selection and no candidate, metadata, or count about them is returned.
5. **Given** a Customer-wide document has `visibility=CUSTOMER` and an empty `organizationIds` allowlist, **When** actors from different Organizations in that Customer retrieve it, **Then** both may enter the organization filter and must still pass all required permission scopes.
6. **Given** an Organization-visible document has `visibility=ORGANIZATION`, **When** the canonical organizationId is absent from its non-empty allowlist, **Then** it is excluded before candidate selection and caller receives only safe no-evidence behavior.
7. **Given** a document policy is missing, unknown, malformed, or internally inconsistent, **When** it is written or updated, **Then** the existing validation error contract rejects the save; **When** legacy data with that policy reaches retrieval, **Then** it is denied by default without materializing document information.

---

### User Story 3 - Use Customer-authorized tools without cross-customer deduplication (Priority: P1)

An internal user can use only tools enabled for their Customer and permitted by their signed roles and permission scopes.

**Why this priority**: A global tool catalog must not make a tool automatically available to every Customer or cause one Customer's idempotency request to suppress another's operation.

**Independent Test**: Configure different Customer tool policies for the same product tool and use the same idempotency key from two Customers.

**Acceptance Scenarios**:

1. **Given** a global ToolDefinition is enabled by Customer A's policy and authorized by Customer A's signed scopes, **When** Customer A invokes it, **Then** execution is permitted and the resulting tool call is owned by Customer A.
2. **Given** the same ToolDefinition is disabled or disallowed by Customer B's policy, **When** Customer B requests it, **Then** execution is blocked before any connector operation and the denial is audited for Customer B.
3. **Given** Customer A and Customer B submit the same idempotency key, **When** each invokes an otherwise permitted operation, **Then** each Customer has independent idempotency behavior; one Customer cannot deduplicate or reveal the other's operation.

---

### User Story 4 - Keep approvals, actions, and escalations within one Customer (Priority: P2)

An internal user creates or manages an approval, action draft, or escalation only within the Customer that owns its originating assistant work.

**Why this priority**: These records can authorize side effects and therefore require the strongest ownership checks.

**Independent Test**: Create each workflow record for Customer A, then access, approve, confirm, cancel, or resolve it with an otherwise identical Customer B identity.

**Acceptance Scenarios**:

1. **Given** Customer A creates a high-risk request, **When** it becomes an approval, action draft, or escalation, **Then** the workflow record and all side-effect checks retain Customer A ownership.
2. **Given** Customer B uses a valid global ID from Customer A, **When** Customer B reads or transitions the workflow record, **Then** it receives a safe not-found or established authorization error and no state changes occur.
3. **Given** a side-effect operation is retried within one Customer, **When** its idempotency key matches an earlier operation from that Customer, **Then** only that Customer's retry behavior is used.

---

### User Story 5 - Review, feedback, and audit Customer-owned outcomes (Priority: P2)

An internal user submits feedback and reviews operational outcomes without seeing another Customer's messages, review items, or audit information.

**Why this priority**: Feedback and review records can indirectly reveal conversation content, tool results, and operational failures.

**Independent Test**: Create feedback, review items, and audit events for Customer A; use the same organization ID, actor ID, and HostApp under Customer B to list, fetch, or transition them.

**Acceptance Scenarios**:

1. **Given** Customer A submits feedback for an assistant answer, **When** related review and audit records are created, **Then** each record is traceable to Customer A and the originating evidence or tool activity.
2. **Given** Customer B requests Customer A's feedback, review item, or audit-linked resource by ID or list filter, **When** Customer B is otherwise identical at lower ownership levels, **Then** it cannot read or transition Customer A's resource.
3. **Given** a review list is requested by Customer B, **When** Customer A has matching review status and source type, **Then** Customer A's records are not included before application-level filtering.

---

### User Story 6 - Safely migrate existing data to Customer ownership (Priority: P3)

An operator can prepare the Backend for Customer-scoped operation without silently assigning existing data to the wrong Customer.

**Why this priority**: Incorrect historical ownership is a permanent cross-customer data leak risk.

**Independent Test**: Exercise both rebuildable-data and retained-data migration paths with data that cannot be safely inferred from organization, actor, or HostApp alone.

**Acceptance Scenarios**:

1. **Given** development or test data is explicitly declared rebuildable, **When** the environment is reset and reseeded, **Then** newly seeded records have explicit Customer ownership.
2. **Given** rebuildable knowledge data is reset and reseeded, **When** each KnowledgeDocument is created, **Then** it explicitly carries `customerId`, `visibility`, `organizationIds`, and `requiredPermissionScopes` that form a valid access policy.
3. **Given** retained knowledge data requires migration, **When** a document has no approved valid access-policy mapping, **Then** it cannot enter retrieval or enforcement and is not inferred to be `CUSTOMER`-wide.
4. **Given** retained data has explicit approved Customer ownership and access-policy mappings, **When** backfill and validation complete, **Then** enforcement occurs only after every in-scope record is mapped and validates against the access-policy rules.

### Edge Cases

- Two Customers use identical organization ID, actor ID, HostApp, source key/version, and idempotency key.
- A request has no token, an unverifiable token, or a token with missing or invalid registered validation claims, signature, issuer, audience, `iat`, `exp`, or `nbf`.
- A signed token has valid verification but lacks, empties, mis-types, or has inconsistent canonical customer claims.
- A verified token contains an empty `roles` or `permission_scopes` array; protected actions requiring absent permission scopes are denied without treating the identity as invalid.
- Public identity headers conflict with verified identity claims.
- A globally valid ID refers to a resource owned by another Customer.
- A Customer has no matching knowledge while another Customer has an exact match.
- A Customer has matching knowledge in another organization or behind a visibility or permission restriction.
- A `CUSTOMER` document carries a non-empty organizationIds allowlist, or an `ORGANIZATION` document has an empty allowlist.
- An organizationIds or requiredPermissionScopes array contains blank, duplicate-before-normalization, wrongly typed, or invalid elements.
- A legacy document has a missing, unknown, malformed, or inconsistent access policy; retrieval returns safe no-evidence without revealing it.
- A global product tool exists but has no enabled policy for the requesting Customer.
- A child record is referenced directly after its parent is missing or owned by another Customer.
- A retained-data backfill contains unmapped or ambiguously mapped records.
- A future platform control plane requests cross-Customer access through a general Assistant endpoint.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Protected business endpoints MUST establish identity only from a verified Gateway-issued internal identity token and MUST reject external customer tokens as Backend identity tokens.
- **FR-002**: Missing tokens and tokens that cannot be verified or have missing or invalid registered validation claims, signature, issuer, audience, `iat`, `exp`, or `nbf` MUST return `401 IDENTITY_TOKEN_INVALID` before protected business work begins.
- **FR-003**: After token verification, the token MUST contain canonical claims `customer_id`, `integration_id`, `sub`, `org_id`, `host_app`, `roles`, `permission_scopes`, and `jti`. The canonical string claims MUST be non-empty; `roles` and `permission_scopes` MUST be string arrays whose elements are non-empty after trimming, while either array MAY be empty.
- **FR-004**: A successfully verified token with missing, blank, wrongly typed, or inconsistent canonical claims MUST return `403 IDENTITY_CONTEXT_INVALID` before protected business work begins.
- **FR-005**: Public identity headers, including customer, actor, role, organization, HostApp, and permission headers, MUST not create, supplement, override, or act as fallback for the verified identity context.
- **FR-006**: An empty `roles` or `permission_scopes` array MUST represent a verified identity with no granted authorization; the permission pipeline MUST deny operations requiring absent permission scopes rather than reject the identity context.
- **FR-007**: The canonical request context MUST separate requestId from identity claims and contain Customer, organization, HostApp, actor, auth traceability, roles, and permission scopes. requestId MUST be used only for tracing and audit correlation and MUST be generated or normalized by Gateway, Backend, or a trusted tracing mechanism.
- **FR-008**: The Backend MUST maintain a minimal Customer ownership root for all customer-owned data. `Customer.id` is the canonical `customerId`; the Customer record MUST NOT store a second self-referencing `customerId`. This feature MUST NOT add Customer administration, lifecycle, Gateway registry, or platform-control-plane behavior.
- **FR-009**: Assistant sessions MUST be owned and queried within Customer scope before organization, HostApp, actor, role, and permission checks are applied.
- **FR-010**: Messages, history, context state, execution plans, answer decisions, clarification questions, grounding checks, and query-understanding records MUST be proven to belong to the Customer through direct ownership or a Customer-scoped parent relationship protected by relational integrity.
- **FR-011**: Knowledge documents and chunks, retrieval runs and candidates, evidence references, tool calls, approvals, action drafts, escalations, feedback, review items, and audit events MUST retain direct Customer ownership because they are independently queried, uniquely constrained, audited, or externally referenced.
- **FR-012**: Customer-owned create, find, list, update, and delete operations MUST apply Customer scope before evaluating global IDs, parent references, pagination, status filters, or application-level visibility logic.
- **FR-013**: A request for another Customer's resource MUST return not-found or the established safe authorization error and MUST not reveal that the resource exists.
- **FR-014**: Customer-owned child records MUST either retain direct Customer ownership or be constrained to a Customer-scoped parent. Relations spanning session, message, document, chunk, retrieval, tool, or workflow aggregates MUST use Customer-qualified parent keys, composite foreign keys, or equivalent relational integrity; application-side checks alone are insufficient to prevent association across Customers.
- **FR-015**: Customer-scoped unique keys and indexes MUST allow different Customers to use the same idempotency key and knowledge source key/version while preventing collisions within one Customer.
- **FR-016**: KnowledgeDocument MUST persist `visibility`, `organizationIds`, and `requiredPermissionScopes` as its effective access policy; KnowledgeChunk MUST inherit that policy only through its document relation. Valid visibility values are `CUSTOMER` and `ORGANIZATION` only. `CUSTOMER` requires an empty organizationIds array and applies to all Organizations in the Customer; `ORGANIZATION` requires a non-empty allowlist that contains the requesting canonical organizationId. organizationIds and requiredPermissionScopes MUST be normalized to unique, non-blank valid strings. requiredPermissionScopes MUST use ALL semantics; an empty array imposes no additional scope restriction. HostApp MUST NOT be a knowledge visibility boundary in this feature.
- **FR-017**: Retrieval MUST apply Customer → visibility/organization → requiredPermissionScopes ALL check before candidate selection and ranking. It MUST NOT retrieve globally or obtain unauthorized candidate content, title, source key, metadata, count, or embedding reference before applying those filters. Missing, unknown, malformed, or inconsistent policy MUST be deny-by-default at retrieval; the caller receives safe no-evidence and document existence is not disclosed. KnowledgeDocument create/update with such policy MUST be rejected through the existing validation error contract.
- **FR-018**: Every evidence reference and retrieval candidate selected for an answer MUST be traceable to the requesting Customer's authorized source.
- **FR-019**: ToolDefinition MUST remain a global product contract. CustomerToolPolicy MUST govern only Customer-level tool enablement and permission policy; it MUST NOT introduce connector binding, connector credentials, connector instances, or secret references.
- **FR-020**: Tool permission evaluation and idempotency behavior MUST be Customer-scoped before any tool or side-effect execution.
- **FR-021**: Approval, action-draft, escalation, feedback, review, and audit operations MUST enforce Customer ownership before reads, lists, state transitions, or audit writes.
- **FR-022**: Audit records MUST identify the Customer as well as organization, HostApp, actor, requestId, decision, and relevant session, message, evidence, tool, or workflow references; raw tokens MUST not be recorded.
- **FR-023**: General Assistant runtime, RAG, tool, approval, action, and user-facing APIs MUST NOT access resources across Customers.
- **FR-024**: Any future cross-Customer operational capability MUST use a separately specified platform-control-plane identity model, API boundary, authorization policy, and audit trail; it MUST NOT reuse Assistant runtime paths.
- **FR-025**: Rebuildable development and test data MAY be reset and reseeded only with explicit Customer ownership and an explicit valid KnowledgeDocument access policy.
- **FR-026**: Retained data migration MUST follow expand, explicit backfill, and enforce phases. It MUST NOT infer Customer ownership or KnowledgeDocument access policy from organization, HostApp, actor, roles, permission scopes, or unverified metadata; records lacking an approved valid policy MUST neither enter retrieval nor enforcement.
- **FR-027**: Feature 002 MAY use test internal-JWT fixtures for Backend development and verification. Before production enables required customer claims, Feature 003/Gateway MUST formally sign `customer_id` and `integration_id`; public identity headers MUST NOT be used as an interim fallback. Customer identity claims are a Gateway contract dependency. This feature MUST NOT implement external issuer onboarding, external claims mapping, client allowlists, Gateway CustomerIntegration registry, or Gateway production changes.

### Key Entities

- **Customer**: minimal Backend ownership root for customer-scoped data. `Customer.id` is the canonical `customerId`; the record does not store a separate self-reference to itself.
- **Canonical Request Identity Context**: verified Customer, integration, organization, HostApp, actor, roles, permission scopes, token traceability, and separate requestId.
- **Customer-owned conversation aggregate**: session and its customer-scoped conversation and orchestration children.
- **Customer-owned knowledge and retrieval aggregate**: knowledge sources, chunks, retrieval activity, candidates, and evidence.
- **CustomerToolPolicy**: Customer-specific enablement and permission policy over a global ToolDefinition.
- **Customer-owned workflow aggregate**: tool calls, approvals, action drafts, escalations, feedback, review items, and audit records.

## Explicitly Out of Scope

- Gateway CustomerIntegration registry, external customer JWT issuer/audience/JWKS onboarding, client allowlists, and external claims mapping.
- Connector Framework, connector instances, connector bindings, connector credentials, and secret references.
- Frontend SDK authentication transport and Customer Host BFF/reverse-proxy implementation.
- Platform control plane, Customer management UI, and cross-Customer operations.
- Customer lifecycle management, Customer disable/delete behavior, retention workflow, and Customer administration.
- Any production implementation change in `apps/gateway`.
- Changes to Feature 001 documents in this feature-delivery scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In isolation tests using two Customers with identical organization ID, actor ID, and HostApp, 100% of attempted cross-Customer session, history, knowledge, retrieval, tool, workflow, feedback, review, and audit access paths return no customer-owned data and perform no unauthorized state change.
- **SC-002**: 100% of protected-endpoint tests with missing or unverifiable tokens or missing or invalid registered validation claims, signature, issuer, audience, `iat`, `exp`, or `nbf` stop before customer-owned data work and return `401 IDENTITY_TOKEN_INVALID`; 100% of tests with verified tokens containing invalid canonical claims stop before that work and return `403 IDENTITY_CONTEXT_INVALID`.
- **SC-003**: 100% of retrieval tests where a matching knowledge source belongs to another Customer or is unauthorized by organization, visibility, or permission filters produce no selected evidence, candidate metadata, or count from that source.
- **SC-004**: In test scenarios, two Customers can independently use the same idempotency key and the same knowledge source key/version without collision or cross-Customer deduplication.
- **SC-005**: 100% of retained-data migration fixtures containing unmapped Customer ownership or missing/invalid KnowledgeDocument access-policy mappings stop before enforcement and never enter retrieval; fixtures with explicit approved Customer ownership and valid access-policy mappings complete with ownership and policy validation.

## Assumptions

- The Gateway will eventually provide the required `customer_id` and `integration_id` in a signed internal identity token; this feature defines the dependency but does not implement the Gateway.
- Feature 002 may use test internal-JWT fixtures. Production rollout depends on Feature 003/Gateway formally signing `customer_id` and `integration_id`; public identity headers are never an interim fallback.
- The minimal Customer ownership root is required for ownership and migration mapping only. Customer lifecycle management, disable/delete behavior, retention, and administration are deferred to a later Customer administration or platform-control-plane feature.
- Knowledge visibility is Customer/Organization only; HostApp-specific knowledge requires a later, separate specification and cannot be inferred from canonical HostApp.
- Existing Feature 001 data and interfaces are migration baselines, not proof of Customer isolation.
- Existing identity error semantics remain the contract for invalid required identity context; this feature does not introduce a public fallback identity path.
- General Assistant endpoints remain single-Customer endpoints. Cross-Customer platform operations require a later, separate feature.
