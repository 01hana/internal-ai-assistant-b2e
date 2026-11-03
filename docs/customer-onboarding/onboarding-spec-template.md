# Customer AI Assistant Onboarding Specification Template

## Purpose And Authority Boundary

Use this document as a Customer-agnostic information model for onboarding a new
Customer integration. Copy it for an onboarding engagement, replace every
placeholder, attach evidence, and preserve unresolved items for human review.

This template is an onboarding SOP, not a runtime loader schema, deployment
manifest, production Capability Pack, ToolDefinition, CustomerToolPolicy, or
permission source. Existing Feature 008–012 specifications and runtime contracts
remain authoritative. If this template conflicts with an authoritative feature
specification or an implemented validated contract, stop and request human
review rather than changing runtime authority here.

The following review-status vocabulary is closed for this template:

| Status | Meaning |
| --- | --- |
| `AUTO_EXTRACTED` | Directly extracted from an identified technical source; not yet business-approved. |
| `AI_INFERRED` | Proposed by AI from evidence; never production authority. |
| `HUMAN_VERIFIED` | Reviewed and approved by the responsible human owner for the stated scope and date. |
| `NEEDS_HUMAN_REVIEW` | Insufficient or conflicting authority; blocks production use where semantics are required. |
| `UNSUPPORTED` | Deliberately unsupported by the proposed capability or current runtime. |
| `DEPRECATED` | Retained for traceability but not for new use. |

> `AI_INFERRED` does not equal production authority. Only human-verified
> business semantics may advance into production capability design.

## Customer Integration Profile

```yaml
customerIntegrationProfile:
  customerId: "<customer-id>"
  displayName: "<display-name>"
  integrationId: "<integration-id>"
  hostApps: []
  locale: "<locale>"
  timezone: "<IANA-timezone>"
  sourceAvailability:
    openApi: false
    backendSource: false
    frontendSource: false
    otherDocumentation: false
  owners:
    technicalOwner: "<name-or-team>"
    businessOwner: "<name-or-team>"
  reviewDate: "<YYYY-MM-DD>"
  reviewStatus: NEEDS_HUMAN_REVIEW
```

`customerId`, `integrationId`, and `hostApps` document the intended onboarding
scope. They never override verified request identity, active integration, or
HostApp scope at runtime.

## Source Authority

Record each source independently. A source may establish technical facts without
establishing business meaning. Prefer exact file, commit, version, URL identifier,
collection version, test name, or interview record over a general description.

| Source ID | Type | Location / version | Facts it can support | Owner | Captured on | Review status | Notes / conflicts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `<source-id>` | `OpenAPI / Swagger` / `Backend source` / `Frontend API client` / `SDK` / `Postman Collection` / `Integration tests` / `Existing documents` / `Human interview` | `<reference>` | `<bounded claim>` | `<owner>` | `<date>` | `AUTO_EXTRACTED` | `<notes>` |

For every recorded fact, retain its `sourceEvidence` and `reviewStatus`. Human
interviews must identify the speaker/owner and review date. Conflicts stay
explicit and become Human Review Questions; do not resolve them by source order
or AI preference.

## Technical API Inventory

This inventory is domain-neutral and descriptive. Listing an operation does not
register a Tool, authorize execution, or approve it for Assistant use.

```yaml
technicalApiInventory:
  - operationId: "<source-operation-id-or-stable-local-id>"
    source: "<source-id>"
    method: "<HTTP-method>"
    path: "<documented-path>"
    readWrite: "<READ|WRITE|UNKNOWN>"
    authenticationRequirement: "<technical-description-without-secret>"
    technicalDescription: "<observed-transport-behavior>"
    requestParameters:
      - name: "<name>"
        location: "<path|query|header|cookie>"
        type: "<type>"
        required: false
        allowedValues: null
        default: null
        technicalDescription: "<source-backed-description>"
        businessMeaning: null
        reviewStatus: NEEDS_HUMAN_REVIEW
        sourceEvidence: ["<source-id#location>"]
    requestBody:
      contentType: "<media-type-or-null>"
      required: false
      schema: {}
      sourceEvidence: []
    responseSchema:
      statusCodes: []
      schema: {}
      sourceEvidence: []
    httpErrors:
      - status: "<status>"
        technicalMeaning: "<source-backed-meaning>"
    applicationErrors:
      - code: "<code>"
        technicalMeaning: "<source-backed-meaning>"
    reviewStatus: AUTO_EXTRACTED
```

When no reliable source establishes a parameter's business meaning, use exactly:

```yaml
businessMeaning: null
reviewStatus: NEEDS_HUMAN_REVIEW
```

Never infer production business semantics from a field name, route name,
operation ID, sample value, UI label, or neighboring field alone.

## Technical Response Inventory

Record only fields needed to assess a potential capability, projection, or safe
error. Raw response inventory is not permission to expose the raw response.

```yaml
technicalResponseInventory:
  - operationId: "<operation-id>"
    fields:
      - jsonPath: "<JSONPath-or-JSON-Pointer>"
        type: "<type>"
        nullable: true
        technicalDescription: "<source-backed-shape-or-behavior>"
        businessMeaning: null
        sensitivity: "<PUBLIC|INTERNAL|CONFIDENTIAL|RESTRICTED|UNKNOWN>"
        assistantEligible: false
        reviewStatus: NEEDS_HUMAN_REVIEW
        sourceEvidence: ["<source-id#location>"]
```

Names such as `amount`, `status`, `count`, `current`, `total`, `qty`, and
`value` are insufficient to establish units, population, time boundary,
aggregation, lifecycle meaning, or production business authority.

## Business Concept Catalog

Concepts are Customer-owned semantics. The optional `domain`, `entity`,
`operation`, and `measure` fields help organize meaning but are not mandatory and
must not be fabricated merely to fill a taxonomy.

```yaml
businessConcepts:
  - conceptId: "<stable-customer-scoped-id>"
    canonicalName: "<customer-approved-name>"
    description: "<customer-approved-definition>"
    aliases: []
    relationships:
      - type: "<customer-defined-relation>"
        targetConceptId: "<concept-id>"
    domain: null       # optional
    entity: null       # optional
    operation: null    # optional
    measure: null      # optional
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

## Business Vocabulary

Business vocabulary is Customer-owned semantic configuration. It cannot grant
identity, permission, execution, Tool, Connector, or evidence authority.

```yaml
businessVocabulary:
  - canonicalTerm: "<term>"
    aliases: []
    abbreviations: []
    deprecatedTerms: []
    description: "<customer-approved-meaning>"
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Never combine semantic candidates from multiple Customers into one candidate
pool, even when keys, aliases, actors, organizations, or HostApps collide.

## Assistant Capability Catalog

A capability describes a clear business ability a user can complete through the
Assistant. It is not an API endpoint and must not be named or defined solely by
HTTP method/path.

```yaml
assistantCapabilities:
  - capabilityKey: "<customer-scoped-key>"
    label: "<safe-user-facing-label>"
    description: "<business-ability>"
    kind: "<READ_ONLY_TOOL|KNOWLEDGE|META_HELP|CONVERSATION|other-reviewed-kind>"
    discoverable: false
    active: false
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Capability identity is scoped to the verified Customer, integration, and
applicable HostApp context. A matching key in another Customer is unrelated.

## Capability Semantic Definition

```yaml
capabilitySemantics:
  - capabilityKey: "<capability-key>"
    locale: "<locale>"
    businessMeaning: "<customer-approved-meaning>"
    aliases: []
    examples: []
    negativeExamples: []
    concepts: []
    domain: null       # optional
    entity: null       # optional
    operation: null    # optional
    measure: null      # optional
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Semantic examples are matching/evaluation material, not execution authority.
They cannot create a capability, Tool, argument, route, permission, or API call.

## Capability Parameters

Record both what the Assistant can recognize and what the current approved
binding can execute. Recognition never implies executable support.

```yaml
capabilityParameters:
  - capabilityKey: "<capability-key>"
    name: "<canonical-parameter-name>"
    type: "<type>"
    required: false
    businessMeaning: "<customer-approved-meaning>"
    semanticTerms: []
    canonicalValues: []
    validation: "<closed-validation-rule>"
    recognized:
      values: []
      description: "<what-semantic-resolution-may-recognize>"
    executable:
      values: []
      description: "<what-active-approved-bindings-can-execute>"
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

An unsupported value must produce a typed clarification/unavailable outcome as
defined by the authoritative runtime contract. Never silently convert it into a
different supported value, widen it, or drop a supplied parameter.

## Capability Output Contract

Define a canonical Assistant business result, not a Customer raw API response.
Every field must pass business, sensitivity, minimization, and safety review.

```yaml
capabilityOutputContracts:
  - capabilityKey: "<capability-key>"
    schema: "<versioned-schema-id-or-inline-closed-schema>"
    fields:
      - name: "<canonical-field-name>"
        type: "<type>"
        businessMeaning: "<customer-approved-meaning>"
        nullable: true
        safeForAssistant: false
        sourceEvidence: []
        reviewStatus: NEEDS_HUMAN_REVIEW
```

## Capability Discovery Metadata

This metadata supports questions such as “你可以做什麼？” (“What can you
do?”), “你現在可以回答什麼？” (“What can you answer now?”), and “可以問哪些
問題？” (“What may I ask?”). Discovery must be derived only from the current
scoped, active, discoverable, and authorized capability set.

```yaml
capabilityDiscovery:
  - capabilityKey: "<capability-key>"
    locale: "<locale>"
    visible: false
    title: "<safe-title>"
    description: "<safe-description>"
    examples: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Never expose internal Tool keys, Customer API URLs, credentials, Connector
topology, or internal permission implementation through discovery metadata.

## Capability To Tool Binding

This is Central Customer-scoped configuration. It narrows a human-reviewed
capability toward an existing execution contract but grants no execution or
permission authority.

```yaml
capabilityToolBindings:
  - bindingId: "<binding-id>"
    capabilityKey: "<capability-key>"
    active: false
    semanticConstraints: []
    toolKey: "<registered-tool-key>"
    toolVersion: "<exact-version>"
    parameterMappings: []
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Bind only to a registered, approved, active, schema-compatible canonical Tool
contract. At execution time the existing Tool Registry, CustomerToolPolicy,
input validation, risk, permission, Connector, projection, and evidence controls
remain authoritative. Every supplied canonical parameter must be accounted for;
no parameter may be silently discarded.

## Canonical Tool Contract

The canonical Tool contract is a reusable business execution interface owned by
the existing central Tool authority.

```yaml
canonicalToolContractReference:
  toolKey: "<registered-tool-key>"
  version: "<exact-version>"
  businessMeaning: "<reviewed-business-operation>"
  inputSchema: {}
  outputSchema: {}
  timeout: "<bounded-duration>"
  readWrite: "<READ|WRITE>"
  registryEvidence: "<authoritative-registration-reference>"
  reviewStatus: NEEDS_HUMAN_REVIEW
```

The contract must not contain a Customer API URL, Customer credential, Customer
token, or Customer-specific endpoint. This section references/reviews an
authoritative Tool contract; it does not define a second Tool registry.

## Customer-Local Operation Mapping

Customer-specific API execution details belong to Customer-local Connector
Runtime configuration. This onboarding record may describe the proposed mapping
for review but does not activate or replace the authoritative operation manifest.

```yaml
customerLocalOperationMappings:
  - canonicalOperation: "<canonical-operation>"
    upstream:
      method: "<fixed-reviewed-method>"
      path: "<fixed-reviewed-path>"
    argumentMappings: []
    response:
      validation: "<closed-bounded-validation>"
      extraction: "<closed-reviewed-extraction>"
      normalization: "<canonical-result-normalization>"
    limits:
      timeout: "<bounded-duration>"
      maximumResponseBytes: "<bounded-size>"
    safeErrors: []
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

The LLM, user input, page context, or Central Assistant must never select an
arbitrary URL, path, method, response pointer, or credential profile.

## Credential And Session Ownership

Record ownership only; never place credential material in onboarding artifacts.

```yaml
credentialSessionOwnership:
  credentialOwner: CUSTOMER_LOCAL
  refreshOwner: CUSTOMER_LOCAL
  revocationOwner: CUSTOMER_LOCAL
  credentialProviderReference: "<non-secret-local-provider-id>"
  sessionBoundaryNotes: "<ownership-and-lifecycle-only>"
  reviewStatus: NEEDS_HUMAN_REVIEW
```

Never store AccessTokens, RefreshTokens, passwords, API keys, session cookies,
private signing keys, or other native credential material here or in the Central
Backend. `connectorContextRef` is an opaque transient reference, not a credential
and not semantic configuration; its value must not be copied into this document.

## Permission Requirements

```yaml
permissionRequirements:
  - capabilityKey: "<capability-key>"
    requiredRoles: []
    requiredScopes: []
    requiredPolicies: []
    sensitivity: "<classification>"
    authoritySource: "<existing-central-authority-reference>"
    reviewStatus: NEEDS_HUMAN_REVIEW
```

The LLM does not own permission authority. Connector Runtime does not replace
central permission authority. Pack metadata, user text, and onboarding documents
cannot assert identity, roles, scopes, policy decisions, or authorization.

## Knowledge And Document Capability

Not every query needs a Tool. SOPs, manuals, policies, FAQs, procedures, and
internal documents may be candidates for the existing authorized RAG/knowledge
lane, subject to Customer/organization/permission filters and evidence rules.

```yaml
knowledgeCapabilities:
  - key: "<knowledge-capability-key>"
    description: "<business-information-need>"
    sources: []
    retrievalAllowed: false
    sensitivity: "<classification>"
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

This metadata cannot select inaccessible documents, contain document contents,
create a second RAG stack, define ranking authority, or become evidence itself.

## Meta And Help Capability

Meta/help answers should dynamically describe only capabilities that are
currently scoped, active, discoverable, and authorized. They do not call a
Customer business API.

```yaml
metaHelpCapability:
  supportedQuestions:
    - "你可以做什麼？"
    - "你能回答哪些問題？"
    - "我可以怎麼問？"
  eligibilityInputs: [active, discoverable, authorized]
  customerBusinessApiRequired: false
  reviewStatus: NEEDS_HUMAN_REVIEW
```

## Conversation And Follow-Up Semantics

```yaml
conversationFollowUpSemantics:
  - capabilityKey: "<capability-key>"
    inheritableParameters: []
    replaceableParameters: []
    nonInheritableParameters: []
    clarificationRules: []
    sourceEvidence: []
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Prior conversation is context, not identity, permission, capability, Tool, or
evidence authority. Inheritance stays within current verified scope and current
active capability compatibility.

## Unsupported Capability Backlog

```yaml
unsupportedCapabilityBacklog:
  - userNeed: "<observed-need>"
    businessConcept: "<concept-id-or-null>"
    candidateCapability: "<candidate-or-null>"
    reason: "<unsupported-reason>"
    sourceEvidence: []
    priority: "<customer-owned-priority>"
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Backlog entries do not authorize fallback execution or nearest-capability
substitution.

## Human Review Questions

When Codex, automation, or reviewers do not know an answer, create a question
instead of guessing.

```yaml
humanReviewQuestions:
  - source: "<source-id-or-review-stage>"
    subject: "<field-capability-or-conflict>"
    question: "<one-answerable-question>"
    reason: "<why-source-authority-is-insufficient>"
    blocking: true
    owner: "<responsible-human>"
    resolution: null
    reviewStatus: NEEDS_HUMAN_REVIEW
```

## Semantic Evaluation Dataset

Avoid single “magic sentence” acceptance. For each capability include positive
paraphrases, negative examples, ambiguous examples, missing-parameter cases,
unsupported-parameter cases, and follow-ups.

```yaml
semanticEvaluationDataset:
  - caseId: "<stable-case-id>"
    category: "<POSITIVE|NEGATIVE|AMBIGUOUS|MISSING_PARAMETER|UNSUPPORTED_PARAMETER|FOLLOW_UP>"
    locale: "<locale>"
    utterance: "<test-utterance>"
    priorTurns: []
    expected:
      intentType: "<expected-typed-intent>"
      capability: "<capability-key-or-null>"
      parameters: {}
      execution: "<EXECUTE|CLARIFY|UNAVAILABLE|NO_EXECUTION>"
    reviewStatus: NEEDS_HUMAN_REVIEW
```

Datasets are Customer-scoped. They must test collision/isolation and never form a
globally materialized cross-Customer semantic candidate pool.

## Security Review

- [ ] LLM cannot create arbitrary API calls.
- [ ] LLM cannot select arbitrary URL, path, or method.
- [ ] LLM cannot bypass the Capability Registry.
- [ ] LLM cannot bypass the Tool Registry.
- [ ] LLM cannot bypass permission or policy checks.
- [ ] LLM cannot access Customer credentials.
- [ ] Customer credentials remain Customer-local.
- [ ] Customer raw responses are validated, bounded, minimized, and projected.
- [ ] Cross-Customer semantic candidates are never mixed or materialized together.
- [ ] Capability/binding metadata contains no authority-bearing identity or permission claims.
- [ ] No onboarding artifact contains tokens, secrets, raw native credentials, or private keys.
- [ ] Unsupported meaning fails closed without silent substitution or arbitrary execution.

## Deployment Ownership Matrix

| Concern | Owner | Authoritative location / boundary |
| --- | --- | --- |
| Generic Core | Central Assistant | Application code and validated central contracts |
| Intent Router | Central Assistant | Existing query-understanding/routing path |
| Semantic Resolver | Central Assistant | Generic resolver mechanics; consumes only scoped Customer semantics |
| Tool Registry | Central Assistant | Existing canonical ToolDefinition registry |
| Canonical Tool Contract | Central Assistant | Registered, approved, versioned ToolDefinition |
| Customer Profile | Central Assistant, Customer-scoped configuration | Verified integration configuration; cannot override identity |
| Business Vocabulary | Customer-owned; centrally consumed configuration | Customer-scoped semantic configuration / capability pack |
| Capability Catalog | Customer-owned; centrally validated configuration | Customer-scoped capability pack |
| Capability to Tool Binding | Central Customer-scoped configuration | Validated capability pack binding to an existing Tool contract |
| Connector Registration | Central Assistant | Existing trusted Connector/adapter registration and endpoint policy |
| Customer API Operation Manifest | Customer-local Connector Runtime | Fixed, validated local manifest |
| API Mapping | Customer-local Connector Runtime | Fixed argument/response mapping in local configuration |
| Credential Provider | Customer-local Connector Runtime | Registered local provider/strategy |
| Native Credentials | Customer-local system only | Protected Customer-side credential/session authority; never Central |
| `connectorContextRef` | Customer-local lifecycle; transient central carriage only | Opaque, short-lived, revocable reference; never semantics or credential storage |

This matrix documents the current Central Assistant versus Customer-local
Connector Runtime boundary. It does not relocate or duplicate any authority.

## Recommended Customer Configuration Layout

The following is conceptual onboarding/architecture guidance only. It is not a
runtime loader schema and this documentation task does not create these files.

```text
customer-config/
└── <customer-id>/
    ├── customer-profile.yaml
    ├── business-concepts.yaml
    ├── vocabulary.yaml
    ├── capabilities.yaml
    ├── bindings.yaml
    ├── permissions.yaml
    ├── knowledge-sources.yaml
    ├── semantic-evals.yaml
    └── review-status.yaml
```

Customer-local conceptual layout:

```text
connector-runtime/
└── config/
    ├── operation-manifest.yaml
    ├── credential-provider-config
    ├── response-mapping
    └── deployment-config
```

Do not modify a production loader merely to match these examples. Production
configuration must use the separately reviewed and authoritative runtime schema.

## Onboarding Lifecycle

```text
Customer technical sources
→ automated inventory
→ business semantic inference candidates
→ human review
→ HUMAN_VERIFIED semantics
→ capability catalog
→ capability → Tool binding
→ Customer-local operation mapping
→ permission/security validation
→ semantic evaluation
→ end-to-end acceptance
→ production activation
```

AI inference is not production authority. Each arrow is a review gate, not an
automatic promotion. Production activation requires separately validated
authoritative runtime artifacts and explicit human approval.

## Final Review Record

```yaml
finalReview:
  technicalOwnerApproval: null
  businessOwnerApproval: null
  securityOwnerApproval: null
  operationsOwnerApproval: null
  unresolvedBlockingQuestions: []
  semanticEvaluationEvidence: []
  endToEndAcceptanceEvidence: []
  productionActivationApproved: false
  approvalDate: null
  reviewStatus: NEEDS_HUMAN_REVIEW
```
