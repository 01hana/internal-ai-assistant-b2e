# Reusable Customer Capability Artifact Map

This is a documentation map extracted from the [Shinmone `work-orders.count` acceptance](./shinmone/work-orders-count-acceptance.md), not another registry or runtime schema. It complements the [onboarding guide](./onboarding-guide.md), [process checklist](./capability-onboarding-checklist.md), and [release review checklist](./review-checklist.md). A second Customer normally supplies scoped artifacts and approved provisioning; it does not fork Generic Core.

## Ownership by Layer

| Layer | Existing owner / example | What a new Customer does |
| --- | --- | --- |
| Generic / reusable | Capability catalog, semantic resolver, parameter resolver, binding engine (`src/capabilities/`); Tool Registry, CustomerToolPolicy service and permission precheck (`src/tools/`, `src/permissions/`); Connector Runtime manifest loader/execution; Gateway, verified identity/trusted context, grounded answer flow. | Reuse unchanged under normal read-only onboarding. A required Core, Gateway, Identity, or generic Connector change is an architecture review, not Customer configuration. |
| Product-owned central contract | Exact global ToolDefinition registration and output policy, e.g. `scripts/seed.ts`. | Reference an existing approved version or register an approved bounded ToolDefinition. Global registration does **not** grant any Customer permission. |
| Customer-scoped central | Customer/integration/HostApp record; Capability Pack with semantic metadata, canonical parameters and exact Capability → Tool bindings; enabled CustomerToolPolicy; adapter binding and Connector deployment authority. | Review and provision only the new Customer's scope and exact versions. No wildcard policy or shared cross-Customer semantic pool. |
| Customer-local | Fixed Connector operation manifests, upstream method/path/query and response extraction; integration registration, credential provider/profile, upstream trust and destination policy. | Deploy reviewed operations and credential configuration within Customer-local ownership. Record references only, never secret values. |
| Human-reviewed business authority | Label, object, meaning, date basis and period boundaries, company scope, permission, sensitivity/field disclosure, unsupported cases. | Business, technical, security and operations owners approve unresolved meanings and release boundaries; source extraction alone cannot approve them. |

For Shinmone, `工單`, `VendorCode`, System Company/Supplier rules, `/Dashboard/KPIStats`, and `NewOrders.Current` remain in Customer artifacts, specific Tool metadata, tests, or onboarding evidence. They must not become generic product decision rules.

## Minimum First Read-only Capability Set

`Required` means the information or authority must exist before execution; it may reference an already registered artifact rather than require a new file. `Conditional` means only when the Customer's integration needs a new implementation or source.

| Artifact | Necessity | Owner and review |
| --- | --- | --- |
| CustomerProfile: exact Customer, integration, HostApp, locale, owners and source inventory | Required | Central Customer scope; human-reviewed identity and ownership. |
| BusinessVocabulary and approved semantic meaning, date/scope/disclosure rules | Required | Customer-scoped; human-reviewed, with source evidence. |
| CapabilityDefinition and semantic profile | Required | Central Customer Capability Pack; human-reviewed meaning, then validated by existing loader. |
| CapabilityParameters and supported canonical values/aliases | Required when parameterized; explicitly record none otherwise | Central pack; human-reviewed semantics and unsupported values. |
| CapabilityBinding to an exact Tool version | Required for Tool-backed capability | Central Customer-scoped; reviewed closed constraints/mappings. |
| ToolDefinition reference or newly approved global exact contract | Required | Product-owned central Tool Registry; active, read-only, schema-compatible. Not a Customer grant. |
| CustomerToolPolicy, roles/scopes and Tool permission requirement | Required | Central Customer-scoped runtime provisioning; security/permission owner approval. |
| ConnectorManifest with fixed operation, response validation/extraction | Required for Connector-backed Tool | Customer-local; technical review and contract tests. |
| CredentialConfiguration reference/profile and lifecycle owner | Required for authenticated upstream; no secret in docs | Customer-local; security and operations review. A new provider implementation is conditional. |
| DeploymentBinding: exact adapter operation, Connector deployment, destination/trusted context | Required for remote Connector execution | Central deployment authority plus Customer-local registration; operations review. |
| SemanticEvalSet and negative/isolation/permission/manifest tests | Required | Customer-specific tests; reviewed expected outcomes. |
| AcceptanceRecord, including real E2E evidence and known limits | Required before acceptance | Human-reviewed closure; never infer a deployed commit from runtime success. |
| Frontend source, Backend source, OpenAPI, SDK, documents or interview | Conditional sources, not mandatory repo pairs | Use the strongest available evidence for each fact; unresolved semantics go to Human Review. |

## Source Discovery: No Mandatory Frontend + Backend Pair

`FRONTEND_REPO_ALWAYS_REQUIRED=NO` and `BACKEND_REPO_ALWAYS_REQUIRED=NO`. Prefer the following evidence for the particular claim, recording version and conflicts; the tiers are a discovery guide, not permission to overrule human review:

1. Tier 1: OpenAPI, official API contract, or authoritative Backend source.
2. Tier 2: Backend implementation, DTOs, and tests.
3. Tier 3: Frontend usage, UI vocabulary, and SDKs—inspect when terminology, real usage, filters, user-facing concepts, or a source conflict needs corroboration.
4. Tier 4: Business documents and operator interviews.
5. Tier 5: Human Review to settle unresolved business semantics and acceptance decisions.

An official API contract may be enough to establish technical shape without either repository. No tier alone turns a field name into approved business meaning. If reliable technical evidence is unavailable or sources conflict, mark the claim unresolved and stop its promotion.

## `GENERIC_CORE_NO_POLLUTION_RULES`

- Generic Core must not branch on a Customer ID to select business behavior.
- Generic Resolver must not hardcode Customer vocabulary, example sentences or a Customer-specific date parser.
- Generic Tool engine must not know a Customer endpoint, route, raw response field or arbitrary HTTP behavior.
- Generic permission logic must not hardcode a Customer business role or bypass exact CustomerToolPolicy and verified identity.
- Generic Connector Runtime must not contain Customer API schema, response inference, credential value or company-filter rule; its manifest engine may validate declared Customer-local contracts.
- LLM output, user input and onboarding documents never become Tool, permission, identity, Connector, or deployment authority.

## Second Customer Assessment

`SECOND_CUSTOMER_READINESS=CONDITIONAL` for a normal, approved read-only business capability that fits the existing exact Tool/Connector contracts. The work is new Customer/integration configuration, approved vocabulary and Capability Pack, exact ToolDefinition registration or reference, CustomerToolPolicy, Connector mapping/credential configuration, scoped tests, and human E2E acceptance. No generic resolver, Feature 011 authority, Gateway, or generic Connector engine change is expected for that contract. The current `HEAD` still registers Mock adapters in `ConnectorsModule`; their removal and the expanded synthetic second-Customer acceptance test remain uncommitted and need separate verification. If a specific Customer requires a new security or execution primitive, stop for separate architecture review rather than adding a Customer-specific branch. This conditional assessment is architectural guidance, not automatic approval of a future Customer or capability.
