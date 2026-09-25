# Design: Feature 011 — Customer Capability Catalog & Semantic Capability Discovery

**Canonical Feature Path**: `specs/011-customer-capability-semantic-discovery`
**Design Date**: 2026-09-21
**Status**: Draft — design only, pending human approval
**Authoritative Requirements**: `specs/011-customer-capability-semantic-discovery/spec.md`

## 1. Design Summary

Feature 011 introduces one Customer-scoped semantic layer between the existing Feature 010 follow-up context and the existing Feature 008 Tool lane. Customer-owned capability packs define business vocabulary, canonical parameters, and declarative bindings. Generic Core validates those packs, resolves meaning within the already-verified Customer/integration/HostApp scope, and emits one closed typed outcome.

The supported execution flow is:

```text
natural-language message + bounded Feature 010 context
  → verified Customer/integration/HostApp scope
  → active Customer capability catalog
  → generic deterministic semantic resolution
  → canonical capability + canonical typed parameters
  → typed Feature 011 outcome
  → Customer-scoped compatible binding
  → exact accounting of every supplied parameter by mapping or semantic constraint
  → declarative canonical-parameter → Tool-argument mapping where applicable
  → exact current ToolDefinition resolution + input-schema validation
  → existing Feature 008/009/010 Tool, Connector, projection, and evidence path
```

Feature 011 does not introduce an execution authority, public API, second Tool registry, second RAG stack, model-generated operation, or final answer path. `GroundedContextBundleV1` remains unchanged. Feature 012 remains responsible for final natural-language answers and clarification wording.

### 1.1 Human-approved outcome interpretation

An unrecognized or insufficiently recognized business meaning returns `NEEDS_CLARIFICATION` with reason code `CAPABILITY_NOT_RECOGNIZED`, no capability reference or authority, zero ToolCalls, and zero Customer business requests. `CAPABILITY_UNAVAILABLE` is reserved for a recognized capability whose relevant canonical parameters are semantically valid but for which the active verified Customer/integration/HostApp scope has no compatible active binding. These are two distinct non-executing cases within the existing four-outcome union.

## 2. Current Repository Seams

### 2.1 Reused ownership

- `AssistantPlanningService` remains the orchestration entry point. It loads bounded conversation context, calls query understanding, persists the existing execution plan, and invokes the existing grounded retrieval router.
- `ConversationSemanticReconstructorService` and `FollowUpSemanticResolverService` remain Feature 010 owners for bounded semantic frames and follow-up inheritance/replacement/clarification.
- `GroundedRetrievalRouterService` remains the owner of `CONTEXT_ONLY`, `RAG`, `TOOL`, `HYBRID`, `CLARIFY`, and `INSUFFICIENT` routing and continues enforcing `MAX_TOOL_NEEDS_PER_TURN=1`.
- `ToolRegistryService` remains the ToolDefinition authority. It already supports exact read-only Tool resolution and closed input-schema validation.
- `CustomerToolPolicyService` and `ToolPermissionPrecheckService` remain the Customer policy and permission authorities.
- `AssistantReadonlyRuntimeService` remains the only read-only Tool execution path and continues to own current Tool re-resolution, ToolCall lifecycle, adapter selection, connector execution, result projection, and safe failure.
- `GroundedToolRetrievalService`, evidence services, and `GroundedContextBundleService` remain unchanged owners of projected Tool evidence, EvidenceRef creation, retrieval coverage, and grounding.
- `CustomerScope` and `HostIntegrationContext` already carry verified `customerId`, `integrationId`, and `hostApp`; Feature 011 consumes them and never accepts replacement scope from text, page context, prior conversation, or pack data.

### 2.2 Semantic logic narrowed or replaced

The current Tool-backed semantic path contains business ownership that Feature 011 must remove from generic Core:

- `domain-lexicon.ts` contains work-order, inventory, order, partner, metric, and temporal vocabulary shared globally.
- `DefaultTokenizerAdapter` and `normalizeDomainTerms` consume that global vocabulary.
- `entity-extractor.ts` embeds `SO-`, `WO-`, and `SKU-` business identifier assumptions.
- `RuleBasedQueryUnderstandingPipeline` contains inventory-specific frame enrichment, structured-resource special cases, and a hard-coded unsupported `last_month` branch.
- `clarification-need.generator.ts` contains an order-specific missing-identifier rule.
- `ToolDiscoveryService` reads `x-assistant-discovery-v1` from ToolDefinition input schemas, matches business concepts, binds Tool arguments, and therefore couples business meaning to Tool identity.

Feature 011 replaces those Tool-backed semantic responsibilities with Customer-pack lookup and capability resolution. Generic sentence splitting, bounded normalization, risk classification, page-context/deixis mechanics, Feature 010 follow-up resolution, document-query compatibility, need decomposition, and retrieval routing remain reusable.

## 3. Decision 1 — Pack Persistence and Provisioning

### Decision

V1 capability packs are immutable JSON files deployed with the Backend and loaded into a validated in-memory registry at startup. Deployment supplies an ordered JSON array of absolute paths through `ASSISTANT_CAPABILITY_PACK_PATHS_JSON`.

Each path must identify a regular, non-symbolic-link file. Production deployment mounts the files read-only. The loader reads each file once, applies byte and contract bounds, freezes the accepted values, builds scoped indexes, and exposes no raw pack after initialization.

The configured release is atomic: any unreadable file, unknown contract version, malformed object, duplicate active scope, duplicate scoped capability identity, ambiguous compatible binding set, or forbidden field makes the capability subsystem unready and prevents request admission. It never serves a partially accepted release.

Provisioning consists of:

1. validate a proposed complete path set offline with the same production parser;
2. deploy immutable versioned files;
3. update the path-list configuration;
4. restart and require capability readiness before traffic;
5. roll back by restoring the previous validated path set and restarting.

An `active` flag controls pack, capability, and binding activation. Exactly one active pack may cover a verified `(customerId, integrationId, hostApp)` tuple. Files contain no secret material.

### Alternatives considered

- **Database records**: supports dynamic lifecycle but requires new Prisma models, migrations, repositories, seed behavior, and control-plane APIs that V1 does not need.
- **Hybrid file plus database activation**: adds two sources of truth and reconciliation complexity without a V1 requirement for live activation.
- **Environment JSON containing full packs**: follows some connector registry patterns but is unsuitable for larger localized semantic metadata and produces poor review and rollback ergonomics.

### Why selected

The repository already uses closed, versioned, startup-loaded configuration registries and immutable Connector manifest files. A file-backed registry is the smallest design that provides deterministic lookup, reviewable Customer ownership, versioning, activation, reproducible tests, and rollback without creating a new control plane.

### Security implications

Atomic validation prevents partially valid catalogs from authorizing semantic resolution. Read-only regular-file checks reduce replacement and symlink risks. Files cannot contain credentials, permission scopes, identity overrides, routes, response pointers, SQL, scripts, prompts with control authority, or executable code.

### Compatibility implications

No Prisma schema, migration, public endpoint, SDK contract, or existing Tool/Connector configuration changes are required. Absence of a configured pack fails semantic discovery closed and performs no ToolCall.

### Migration implications

Customer semantics move from generic source and ToolDefinition discovery extensions into versioned files. Existing ToolDefinition and CustomerToolPolicy provisioning remains unchanged.

## 4. Decision 2 — Closed Versioned Contracts

### Decision

All objects are plain JSON objects with exact keys. Unknown keys, prototypes, non-finite numbers, duplicate normalized values, or values outside bounds reject the entire configured release. Arrays preserve declaration order only for deterministic diagnostics; identity and matching do not depend on file order.

### 4.1 Shared bounds

```text
MAX_PACK_BYTES=262144
MAX_CAPABILITIES_PER_PACK=128
MAX_BINDINGS_PER_PACK=256
MAX_SEMANTIC_PROFILES_PER_CAPABILITY=4
MAX_PARAMETERS_PER_CAPABILITY=16
MAX_ENUM_VALUES_PER_PARAMETER=64
MAX_MAPPINGS_PER_BINDING=32
MAX_TERMS_PER_LIST=32
MAX_EXAMPLES_PER_PROFILE=16
MAX_HOST_APPS_PER_PACK=16
MAX_CANDIDATES_MATERIALIZED=32
MAX_AMBIGUOUS_CANDIDATE_REFS=5
MAX_TEXT_LENGTH=256
MAX_EXAMPLE_LENGTH=256
MAX_IDENTIFIER_LENGTH=128
MAX_BOUNDED_STRING_LENGTH=256
```

Identifiers match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, must not contain `*`, and are compared exactly. Versions match semantic version syntax. Locales use a bounded BCP-47-shaped identifier. All lists are non-empty unless explicitly stated otherwise.

### 4.2 Pack and capability contracts

```ts
interface CustomerCapabilityPackV1 {
  readonly version: '1';
  readonly packId: string;
  readonly packVersion: string;
  readonly customerId: string;
  readonly integrationId: string;
  readonly hostApps: readonly string[];
  readonly active: boolean;
  readonly capabilities: readonly CapabilityDefinitionV1[];
  readonly bindings: readonly CapabilityBindingV1[];
}

interface CapabilityDefinitionV1 {
  readonly version: '1';
  readonly capabilityKey: string;
  readonly active: boolean;
  readonly kind: 'READ_ONLY_TOOL';
  readonly safeLabel: string;
  readonly semanticProfiles: readonly CapabilitySemanticMetadataV1[];
  readonly parameters: readonly CapabilityParameterDefinitionV1[];
}

type SemanticSignalGroup = 'resource' | 'intent' | 'metric';

interface CapabilitySemanticMetadataV1 {
  readonly version: '1';
  readonly locale: string;
  readonly aliases: readonly string[];
  readonly examples: readonly string[];
  readonly resourceTerms: readonly string[];
  readonly intentTerms: readonly string[];
  readonly metricTerms: readonly string[];
  readonly requiredSignalGroups: readonly SemanticSignalGroup[];
}
```

Rules:

- `(customerId, integrationId, hostApp, capabilityKey)` is the scoped capability identity after HostApp expansion.
- `capabilityKey` uniqueness is enforced only inside that scope; it is not a global authority.
- Every locale is unique inside a capability. Normalized aliases and terms are unique inside their semantic profile.
- Required signal groups must have at least one declared term. At least one alias or resource term and one metric or intent term are required for a Tool-backed capability.
- `safeLabel` is bounded candidate display metadata only. It is not user-facing final prose or authority.
- V1 rejects capability kinds other than `READ_ONLY_TOOL`.

### 4.3 Parameter contracts

```ts
interface EnumCapabilityParameterV1 {
  readonly version: '1';
  readonly parameterName: string;
  readonly type: 'enum';
  readonly required: boolean;
  readonly semanticTerms: readonly string[];
  readonly values: readonly {
    readonly value: string;
    readonly aliases: readonly string[];
  }[];
}

interface BoundedStringCapabilityParameterV1 {
  readonly version: '1';
  readonly parameterName: string;
  readonly type: 'bounded_string';
  readonly required: boolean;
  readonly semanticTerms: readonly string[];
  readonly maxLength: number;
  readonly tokenSyntax: 'SAFE_IDENTIFIER';
  readonly prefixes: readonly string[];
}

type CapabilityParameterDefinitionV1 =
  | EnumCapabilityParameterV1
  | BoundedStringCapabilityParameterV1;
```

Rules:

- Canonical parameter names are unique within a capability.
- Enum canonical values are safe identifiers. An alias maps to exactly one canonical value after normalization.
- `bounded_string` uses a closed Core-owned safe-identifier tokenizer. Packs may declare bounded literal prefixes but may not supply regexes, templates, code, or transformations.
- `maxLength` is between 1 and `MAX_BOUNDED_STRING_LENGTH`.
- Empty prefixes mean any token satisfying `SAFE_IDENTIFIER`; otherwise exactly one declared prefix must match.
- Page-context or inherited values are accepted only after the same type and bounds validation as current-text values.

### 4.4 Binding and mapping contracts

```ts
interface CapabilityBindingV1 {
  readonly version: '1';
  readonly bindingId: string;
  readonly bindingVersion: string;
  readonly active: boolean;
  readonly capabilityKey: string;
  readonly semanticConstraints: readonly {
    readonly version: '1';
    readonly parameterName: string;
    readonly operator: 'ENUM_VALUE_IN';
    readonly allowedValues: readonly string[];
  }[];
  readonly target: {
    readonly kind: 'TOOL';
    readonly toolKey: string;
    readonly toolVersion: string;
  };
  readonly mappings: readonly CapabilityParameterMappingV1[];
}

type CapabilityParameterMappingV1 =
  | {
      readonly version: '1';
      readonly targetArgument: string;
      readonly source: 'CANONICAL_PARAMETER';
      readonly parameterName: string;
    }
  | {
      readonly version: '1';
      readonly targetArgument: string;
      readonly source: 'BOUND_CONSTANT';
      readonly value: string | number | boolean;
    };
```

Rules:

- Bindings inherit Customer/integration/HostApp scope from their pack and cannot restate or override it.
- `semanticConstraints` and `mappings` are the two explicitly permitted empty lists: Shinmone uses an empty mapping list, while Customer B uses an empty semantic-constraint list.
- `semanticConstraints` is bounded compatibility metadata, not an argument mapper or execution authority. `ENUM_VALUE_IN` applies only to enum parameters and `allowedValues` is required, non-empty, and means the target inherently represents exactly those declared canonical values. There is no omission rule that means "accept" or "ignore," and there is no general expression language.
- A supplied resolved canonical parameter is accounted for in exactly one way: one `CANONICAL_PARAMETER` mapping (`MAPPED_PARAMETER`) or one explicit semantic constraint (`BINDING_SEMANTIC_CONSTRAINT`). A parameter cannot use both mechanisms, cannot appear in multiple source mappings or constraints, and cannot be silently discarded.
- Optional parameters absent from the resolved parameter map require no runtime accounting. If an optional parameter is supplied, the same exactly-one accounting rule applies. An absent optional mapping source omits only its declared optional Tool target; it cannot satisfy a required Tool input.
- Every mapping source parameter and semantic-constraint parameter must exist in the referenced capability definition. Every constrained value must exist in that parameter's declared enum values.
- Every target argument is assigned exactly once. No dynamic field names, nested target paths, templates, expressions, response mappings, connector arguments, or arbitrary transforms exist.
- Constants are bounded JSON scalars. Strings use the same prohibited-value checks as Tool input validation and are at most 256 characters.
- Startup validation rejects unknown mapping sources, unknown constraint parameters, unknown constrained enum values, duplicate source consumption, duplicate constraints, a parameter declared in both mechanisms, duplicate target assignments, and fixed binding semantics not expressed as constraints. Every required capability parameter must have exactly one static consumption declaration; an optional parameter may have none, in which case that binding is compatible only when the optional parameter is unsupplied. Startup validation exact-resolves the referenced read-only ToolDefinition version; every target argument must be a declared top-level input property, mapped constant types/enums must be statically compatible, and all statically knowable required arguments must be satisfiable.
- Runtime first verifies that every supplied resolved canonical parameter is accounted for exactly once and that every semantic constraint accepts its value. Any unaccounted, multiply consumed, or constraint-rejected parameter makes that binding incompatible; the parameter remains in the semantic result and no Tool candidate is released from that binding.
- Runtime then applies mappings only to already validated canonical values, exact-resolves the ToolDefinition again, and calls the current `validateNamedOperation` schema boundary on the complete mapped argument object.
- Mapping and binding never bypass current CustomerToolPolicy, roles, permission scopes, risk, connector compatibility, projection, or evidence rules.

### Alternatives considered

- Embedding semantic data in ToolDefinition input schemas preserves current coupling and makes Tool identity semantic authority.
- General expressions or templates are more flexible but create an executable language and allow arbitrary payload construction.
- Allowing arbitrary regexes enables Customer-specific parsing code and denial-of-service risk.

### Why selected

The contracts provide the two canonical-parameter accounting primitives actually required: validated canonical values copied into a known Tool field and explicit bounded semantic constraints for values inherently represented by a target. Bounded constants remain a separate way to satisfy Tool inputs and never count as canonical-parameter consumption. Exact versions and closed objects make provisioning and rollback deterministic.

### Security implications

The pack cannot mint identities, permissions, Tools, APIs, or target fields. Closed parsing, scalar-only constants, and exact Tool field validation prevent executable or arbitrary payload construction.

### Compatibility implications

Existing Tools remain unchanged, including `work-orders.monthly-new-count@1.0.0`, whose empty input schema requires an empty mapping while its binding explicitly consumes `timeRange=this_month` through a semantic constraint. Existing Tool schema validation remains the final input authority.

### Migration implications

The new contracts replace semantic metadata and argument binding currently embedded in ToolDefinition input schemas. They do not replace ToolDefinition itself.

## 5. Decision 3 — Scoped Registry and Isolation

### Decision

The registry stores active catalogs under the exact tuple:

```text
CatalogScopeKey = customerId + NUL + integrationId + NUL + hostApp
CapabilityIdentity = CatalogScopeKey + NUL + capabilityKey
BindingIdentity = CatalogScopeKey + NUL + bindingId + NUL + bindingVersion
```

Its request-facing interface accepts one verified scope and returns one immutable scoped catalog. It deliberately has no `listAll`, global search, cross-Customer candidate iterator, or lookup by `capabilityKey` alone.

```ts
interface CustomerCapabilityCatalogRegistry {
  resolveCatalog(scope: Pick<CustomerScope, 'customerId' | 'integrationId' | 'hostApp'>):
    | { readonly available: true; readonly catalog: ScopedCapabilityCatalogV1 }
    | { readonly available: false; readonly reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' };
}
```

Candidate materialization, semantic scoring, parameter resolution, and binding lookup operate only on `catalog`. A foreign catalog is indistinguishable from absent data. Binding lookup uses the same scoped catalog object that produced the capability result.

### Alternatives considered

- A global candidate index followed by Customer filtering is operationally convenient but violates the pre-materialization isolation requirement.
- Customer-only indexing omits integration and HostApp applicability and can expose capabilities across Customer applications.
- Global capability-key uniqueness confuses a configuration key with a cross-Customer business identity.

### Why selected

The tuple is already present in verified Backend identity context and exactly matches the approved security boundary. It permits legal key/alias collisions without merge behavior.

### Security implications

Scope is supplied only by `CustomerScope`/`HostIntegrationContext`. Packs, user text, model output, page context, and prior conversation cannot select a scope. Unknown and foreign capability keys yield the same bounded non-disclosure behavior.

### Compatibility implications

No Gateway or identity contract changes are needed. Existing Customer A/B tests can deliberately reuse organization, actor, and HostApp values while Customer/integration scope remains authoritative.

### Migration implications

The registry becomes the only capability-candidate source; existing verified identity objects supply its key without a data migration.

### Flow 1 — Pack loading and scope

```text
configured absolute paths
  → regular/non-symlink/read-only checks
  → byte bound + JSON parse
  → closed V1 validation
  → duplicate/compatibility validation
  → expand explicit hostApps
  → immutable Map<customerId+integrationId+hostApp, ScopedCatalog>
  → readiness PASS

any failure → no partial registry → readiness FAIL → no request admission
```

### Flow 7 — Customer isolation

```text
Customer A verified scope ─→ resolve A catalog ─→ materialize A candidates only
                                  ╳
Customer B verified scope ─→ resolve B catalog ─→ materialize B candidates only

same hostApp / organizationId / actorId / aliases / parameter names
  do not affect the first lookup key and cannot merge the catalogs
```

## 6. Decision 4 — Deterministic Semantic Resolution

### Decision

V1 uses deterministic structured scoring over the selected Customer catalog. It does not call an LLM.

Input normalization performs Unicode NFKC normalization, lowercases Latin text, collapses whitespace, and separates punctuation. It preserves original text only transiently and never writes unrestricted query text to the capability audit event.

For the request locale, the resolver:

1. selects the exact locale profile; absence of that locale excludes the capability;
2. matches normalized aliases and resource/intent/metric terms as bounded terms, not whole-question templates;
3. requires every declared `requiredSignalGroup` to have at least one match;
4. computes a score from alias coverage, required-group coverage, optional-group coverage, bounded example token/ngram overlap, and validated parameter signals;
5. caps materialization at 32 eligible candidates before ranking;
6. accepts a top score only at or above `0.70`;
7. returns `AMBIGUOUS` when another candidate is within `0.05` of the top score;
8. returns `NEEDS_CLARIFICATION` with `CAPABILITY_NOT_RECOGNIZED` when no candidate passes.

#### V1 locale source and matching policy

The current repository exposes optional locale inputs at the tokenizer boundary but does not carry an authoritative caller-supplied locale through the Assistant request contract. Its query-understanding pipeline and `GroundedContextBundleV1` assembly both currently supply the application-owned constant `zh-TW`. Feature 011 V1 reuses that existing application locale as its sole semantic-profile locale; it does not accept locale from user text, page context, pack content, or an unverified request field.

Catalog scope is selected first from verified `customerId`, `integrationId`, and HostApp. Only then does locale select semantic metadata inside that already-scoped catalog. Locale grants no capability, binding, Tool, permission, or execution authority. V1 requires an exact `zh-TW` profile and performs no cross-locale fallback: a capability without that exact profile is excluded, and if no candidate remains the result is `NEEDS_CLARIFICATION(CAPABILITY_NOT_RECOGNIZED)` with zero execution. Packs may retain bounded unique locale identifiers for future contract evolution, but cannot change the V1 active locale. No automatic or LLM-based language detection is introduced.

Weights are normalized per capability so large metadata lists do not gain an advantage:

```text
alias coverage             0.35
required signal coverage   0.35
optional signal coverage   0.10
best example overlap       0.10
validated parameter signal 0.10
```

Example overlap uses bounded normalized token and character-bigram coverage; exact equality receives no special branch. Examples are evidence for scoring only and never commands, templates, or execution inputs. This supports unseen paraphrases composed from known Customer vocabulary without requiring the exact sentence to be stored.

### Alternatives considered

- **Exact question matching** is deterministic but fails unseen wording and is explicitly forbidden.
- **Model-only classification** offers flexibility but the current `classifyIntent` contract returns one free-form label with a fixed confidence and no closed capability/parameter result schema.
- **Hybrid deterministic plus model-assisted matching** could improve recall but adds latency, cost, nondeterminism, and a new semantic-model trust boundary before V1 has stable pack fixtures.

### Why selected

The approach is implementable with current dependencies, deterministic in tests, locale-versionable at the metadata level, bounded, and sufficient for compositional Shinmone and Customer B acceptance. The exact V1 locale rule matches current application behavior and preserves existing Feature 010 zero-LLM-call expectations.

### Security implications

Only scoped declared candidates participate. Scoring cannot create keys, parameters, enum values, bindings, Tools, or scope. Scores never grant execution authority.

### Compatibility implications

No LLM provider interface or answer-generation behavior changes. A future version may introduce a bounded classifier behind the same resolver interface only if it receives an already-scoped bounded catalog and its closed output is fully re-resolved against registry data.

### Migration implications

Tool-backed matching stops reading `x-assistant-discovery-v1`. Existing metadata may remain during a compatibility window but has no Feature 011 semantic effect.

### Flow 2 — Capability resolution

```text
verified scoped catalog + normalized current meaning
  → required-group eligibility
  → bounded deterministic scoring
  ├─ no score ≥ 0.70 → NEEDS_CLARIFICATION(CAPABILITY_NOT_RECOGNIZED)
  ├─ top tie within 0.05 → AMBIGUOUS(max 5 safe refs)
  └─ one winner → canonical capability → parameter resolution
```

## 7. Decision 5 — Canonical Parameter Resolution

### Decision

Parameter resolution is capability-owned and happens before binding selection.

For enum parameters, normalized aliases map only to declared canonical values. Repeated aliases for the same value deduplicate. Two distinct canonical values for one parameter produce a conflict. A recognized parameter mention that cannot normalize to a declared value produces an invalid issue. No mention for a required parameter produces a missing issue.

For bounded strings, Core accepts only tokens admitted by the declared closed syntax, prefix list, and maximum length. Distinct admitted values conflict. A captured value outside the syntax or bounds is invalid. Arbitrary user strings never become enum values.

Current-message values take precedence only through the existing Feature 010 `REPLACE` decision. Inherited values are revalidated against the current active capability definition. Pack changes, scope changes, expired context, or values no longer declared cannot be inherited into execution.

Outcome precedence is deterministic:

```text
conflicting parameter issues
  → NEEDS_CLARIFICATION
else invalid parameter issues
  → NEEDS_CLARIFICATION
else missing required parameters
  → NEEDS_CLARIFICATION
else all canonical parameters valid
  → binding selection
```

Exact result field names are fixed by the V1 union below; final user-facing prose remains Feature 012.

### Alternatives considered

- Passing normalized terms directly as Tool arguments repeats the current capability/Tool coupling.
- Treating every unsupported value as unavailable confuses semantic invalidity with missing execution coverage.
- Pack-provided regexes or functions create an unbounded parsing language.

### Why selected

The model cleanly separates semantic validity from executable availability and supports both the Shinmone enum and Customer B bounded identifier without embedding Customer-specific parsing branches in Core.

### Security implications

All values are bounded before binding, and invalid or conflicting raw values are not copied into results or audit metadata.

### Compatibility implications

Existing Feature 010 follow-up provenance remains intact. Existing Tool input schemas still make the final argument decision.

### Migration implications

Inherited and current semantic values move from global Core lexicon normalization to capability-owned parameter definitions, while the existing follow-up decision mechanics remain.

### Flow 3 — Parameter resolution

```text
winning capability + current signals + resolved Feature 010 frame
  → resolve each declared canonical parameter
      ├─ absent required value → missingParameters
      ├─ captured but invalid → invalidParameters
      ├─ >1 distinct valid value → conflictingParameters
      └─ one valid value → canonical typed value
  → any issue → NEEDS_CLARIFICATION, zero binding and zero ToolCall
  → no issue → immutable canonical parameter map
```

## 8. Decision 6 — Typed Resolution Result

### Decision

The internal result is a closed discriminated union. It contains no final prose, permission result, credential, connector context, raw pack metadata, or foreign candidate.

```ts
interface CapabilityRefV1 {
  readonly packId: string;
  readonly packVersion: string;
  readonly capabilityKey: string;
  readonly safeLabel: string;
}

type CanonicalParameterValueV1 = string | number | boolean;

type CapabilityResolutionResultV1 =
  | {
      readonly version: '1';
      readonly outcome: 'RESOLVED';
      readonly capability: CapabilityRefV1;
      readonly parameters: Readonly<Record<string, CanonicalParameterValueV1>>;
      readonly bindingRef: { readonly bindingId: string; readonly bindingVersion: string };
      readonly toolCandidate: {
        readonly key: string;
        readonly version: string;
        readonly arguments: Readonly<Record<string, unknown>>;
        readonly reason: 'customer_capability_binding';
      };
    }
  | {
      readonly version: '1';
      readonly outcome: 'NEEDS_CLARIFICATION';
      readonly reasonCode: 'CAPABILITY_NOT_RECOGNIZED';
      readonly missingParameters: readonly [];
      readonly invalidParameters: readonly [];
      readonly conflictingParameters: readonly [];
    }
  | {
      readonly version: '1';
      readonly outcome: 'NEEDS_CLARIFICATION';
      readonly capability: CapabilityRefV1;
      readonly reasonCode: 'PARAMETER_ISSUES';
      readonly missingParameters: readonly string[];
      readonly invalidParameters: readonly { readonly parameterName: string; readonly reasonCode: string }[];
      readonly conflictingParameters: readonly { readonly parameterName: string; readonly candidateCount: number }[];
    }
  | {
      readonly version: '1';
      readonly outcome: 'CAPABILITY_UNAVAILABLE';
      readonly capability: CapabilityRefV1;
      readonly parameters: Readonly<Record<string, CanonicalParameterValueV1>>;
      readonly reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING';
    }
  | {
      readonly version: '1';
      readonly outcome: 'AMBIGUOUS';
      readonly reasonCode: 'MULTIPLE_CAPABILITIES';
      readonly candidates: readonly CapabilityRefV1[];
    };
```

The `CAPABILITY_NOT_RECOGNIZED` variant deliberately has no `capability` field, so insufficient recognition cannot create capability authority. Parameter arrays are sorted by canonical parameter name. Candidate references are sorted by capability key after scoring and capped at five. `candidateCount` is capped at the configured candidate bound. Invalid/conflicting records never include raw values.

### Alternatives considered

- Reusing free-form `clarificationNeeds` as the resolver authority cannot express the required typed distinctions.
- Adding public HTTP/SSE outcome variants would broaden Feature 011 and break Feature 010 compatibility.

### Why selected

The union is exhaustive and maps deterministically into existing planning behavior while remaining internal and safe.

### Security implications

Only scoped safe references appear; invalid and conflicting issues expose parameter names and bounded reason metadata rather than raw values.

### Compatibility implications

Existing public response types remain unchanged. The current clarification/no-answer machinery consumes an adapter projection of the union rather than becoming a second answer system.

### Migration implications

Existing free-form clarification needs remain a compatibility projection, while the new internal union becomes the authoritative semantic result.

### Flow 6 — Non-resolved outcomes

```text
NEEDS_CLARIFICATION ─→ existing clarificationNeeds ─→ F010 CLARIFY ─→ zero ToolCalls
AMBIGUOUS            ─→ bounded candidateRefs       ─→ F010 CLARIFY ─→ zero ToolCalls
CAPABILITY_UNAVAILABLE
                     ─→ UNSUPPORTED need/reason     ─→ F010 INSUFFICIENT
                                                                  └─ zero ToolCalls

Feature 012 later owns natural-language rendering; Feature 011 emits no prose.
```

## 9. Decision 7 — Binding Selection and Parameter Mapping

### Decision

After all canonical parameters validate, the scoped binding registry filters active bindings for the capability. A binding is compatible only when each supplied resolved canonical parameter is consumed exactly once by either a `CANONICAL_PARAMETER` mapping (`MAPPED_PARAMETER`) or a matching `semanticConstraints` entry (`BINDING_SEMANTIC_CONSTRAINT`). A constraint is compatible only when the supplied canonical enum value is in its exact `allowedValues` set. An optional parameter absent from the resolved parameter map needs no consumption and does not make a binding incompatible.

Compatibility never means "ignore unknown semantics." If the resolved parameters are `{ timeRange: this_month, status: open }` and a binding accounts only for `timeRange`, `status` remains visible to the coverage check, the binding is incompatible, and it releases no Tool candidate. If no other active binding accounts for the complete parameter set, the outcome is `CAPABILITY_UNAVAILABLE` with zero ToolCalls and zero Customer business requests.

- zero compatible bindings returns `CAPABILITY_UNAVAILABLE`;
- one compatible binding proceeds to mapping;
- multiple compatible bindings are a deployment configuration defect rejected during startup validation, not an arbitrary runtime tie-break.

Static provisioning validation exact-resolves the referenced ToolDefinition and checks read-only status, version, mapping and constraint source existence, declared enum values, mutually exclusive and unique consumption declarations, explicit fixed semantics, declared target fields, target uniqueness, compatible constant types/enums, and statically satisfiable required fields. Runtime repeats complete supplied-parameter coverage, constraint compatibility, exact Tool resolution, mapping, and validation of the complete result through the existing Tool schema validator.

The execution plan carries the expected Tool version internally. The existing runtime re-resolves the current ToolDefinition; a missing, inactive, non-read-only, or version-drifted definition fails closed as `tool_contract_mismatch` before ToolCall start. It never falls forward to a newer Tool version.

### Alternatives considered

- Selecting the first compatible binding makes file order execution authority.
- Inferring a Tool from its name or description violates capability/Tool separation.
- Letting mappings call connector profiles or transform responses duplicates Feature 009.

### Why selected

Exact selection and two-stage validation prevent stale configuration and preserve ToolDefinition as the input contract authority.

### Security implications

Mappings cannot create fields, code, routes, credentials, or permissions. Constants pass prohibited-value checks. Binding references grant no access.

### Compatibility implications

The resulting candidate retains the existing `{key, arguments, reason}` shape with an internal expected version added for fail-closed compatibility. CustomerToolPolicy and permission precheck execute exactly as today.

### Migration implications

The current monthly Shinmone Tool requires no arguments, so its mapping is empty; its binding nevertheless accounts for `timeRange` through the explicit semantic constraint `timeRange=[this_month]`. Customer B proves the other generic mechanism by accounting for `itemRef` through the mapping `itemRef → sku`.

### Flow 4 — Binding and mapping

```text
canonical capability + validated parameters + same scoped catalog
  → active compatible binding filter
       (every supplied parameter consumed exactly once by mapping or constraint)
  ├─ 0 → CAPABILITY_UNAVAILABLE
  ├─ >1 → impossible in ready registry; fail closed
  └─ 1 → exact ToolDefinition(name, version)
           → verify complete supplied-parameter accounting again
           → copy declared canonical values / bounded constants
           → reject duplicate or unknown target arguments
           → validate complete Tool input schema
           → one version-pinned Tool candidate
```

## 10. Decision 8 — Feature 010 Integration Seam

### Decision

Feature 011 integrates inside `RuleBasedQueryUnderstandingPipeline` after bounded context is loaded and before existing Tool-oriented discovery. The sequence is deliberately two-stage around Feature 010 follow-up:

1. select the scoped catalog from verified identity;
2. extract current-message semantic signals and a provisional Customer-scoped semantic frame;
3. run the existing Feature 010 follow-up resolver using that frame and bounded prior frames;
4. revalidate the resolved/inherited frame against the current catalog;
5. perform final capability and parameter resolution;
6. adapt the typed result into the existing query-understanding/planning contracts.

Thus Feature 010 follow-up resolution happens before final capability resolution, while scoped current-message signal extraction happens first so the follow-up resolver has safe dimensions to merge. Prior context is semantic input only; it cannot select a catalog, restore a removed capability, or bypass current validation.

Outcome adaptation is:

| Feature 011 outcome | Existing Feature 010 projection |
|---|---|
| `RESOLVED` | exactly one planned Tool candidate and one Tool retrieval need |
| `NEEDS_CLARIFICATION` | blocking structured clarification need; router `CLARIFY` |
| `AMBIGUOUS` | blocking clarification with bounded scoped candidate refs; router `CLARIFY` |
| `CAPABILITY_UNAVAILABLE` | unsupported retrieval need with bounded reason; router `INSUFFICIENT` |

`QueryUnderstandingOutput` may carry the internal typed result transiently for planning and audit. Existing persistence fields retain bounded projections: candidate Tools, clarification needs, task type, and confidence. The complete result need not add a Prisma column because the safe resolution summary is appended to AuditEvent.

### Alternatives considered

- Resolving capabilities before loading conversation context breaks Feature 010 follow-ups.
- Running follow-up before scoped signal extraction leaves the resolver dependent on the current global lexicon.
- Adding a parallel capability execution coordinator creates a second Tool path.

### Why selected

This is the narrowest replacement seam: it changes who owns business semantics while preserving planning, routing, execution, evidence, and public behavior.

### Security implications

Every inherited value is revalidated under the current scope and pack. Non-resolved outcomes cannot construct a candidate Tool.

### Compatibility implications

Feature 010 continues to enforce four retrieval needs and one Tool need. `GroundedContextBundleV1`, evidence normalization, coverage, SSE, history, and public AnswerDecision shapes do not change.

### Migration implications

The current Tool discovery call is replaced at this single pipeline seam after capability packs cover the reference fixtures; no parallel discovery fallback remains.

### Flow 5 — Existing Tool execution re-entry

```text
RESOLVED Tool candidate
  → existing ExecutionPlan candidateTools
  → existing F010 GroundedRetrievalRouter (max one Tool need)
  → existing GroundedToolRetrievalService
  → existing AssistantReadonlyRuntimeService
  → current ToolDefinition + CustomerToolPolicy + permission precheck
  → existing adapter / Feature 009 Connector Runtime
  → existing projection + EvidenceRef
  → unchanged GroundedContextBundleV1
```

## 11. Decision 9 — Migration Boundary

### Decision

Migration is a seam replacement, not a query-understanding rewrite.

Retain:

- sentence splitting and bounded generic text normalization;
- generic risk/write-intent safety classification;
- page-context/deixis source validation;
- bounded conversation loading and follow-up decision mechanics;
- task/need caps and retrieval mode selection;
- document-query behavior until a later Customer-owned knowledge capability version exists;
- Tool registry, exact Tool lookup, Tool schema validation, CustomerToolPolicy, permission checks, runtime, projection, and evidence.

Retire from Tool-backed semantic authority after pack fixtures are active:

- work-order, inventory, order, partner, metric, and Customer temporal aliases in the global Core lexicon;
- `SO-`, `WO-`, and `SKU-` business identifier ownership in generic extraction, replacing it with closed pack parameter metadata and generic safe-token mechanics;
- `enrichInventoryAvailability`;
- structured-resource special casing in the rule-based pipeline;
- the `last_month` hard-coded unsupported branch;
- the missing-order-identifier clarification branch;
- ToolDefinition `x-assistant-discovery-v1` matching and argument binding.

During migration, predecessor metadata may remain stored for compatibility tests, but Feature 011 tests prove it is not consulted. Once every supported Tool-backed capability has a pack, the old discovery parser/service can be removed in a separately reviewed cleanup without changing ToolDefinition execution contracts.

### Alternatives considered

- A complete query-understanding rewrite risks Feature 010 regression and broadens scope.
- Keeping both semantic authorities active creates nondeterministic or duplicate Tool candidates.

### Why selected

Only the ownership violation needs replacement. The surrounding orchestration and security boundaries are already proven.

### Security implications

One resolver is authoritative per request. There is no fallback from a failed pack result to Tool-key inference or the legacy global lexicon.

### Compatibility implications

Existing non-Tool document behavior and every downstream Tool/RAG authority remain unchanged.

### Migration implications

The old semantic path is retired only after equivalent pack-backed coverage passes; later removal of unused discovery metadata is a separate reviewed cleanup.

## 12. Decision 10 — Reference Customer Packs

### Decision

Provide two Customer-owned pack designs that deliberately differ in vocabulary, capability identity, parameter shape, and mapping while using the same generic registry and resolver.

### 12.1 Shinmone reference

The reference pack declares:

```text
capabilityKey=work-orders.count
kind=READ_ONLY_TOOL
required parameter=timeRange: enum
canonical values=this_month, today
this_month aliases include 本月 and 這個月
today aliases include 今天
active binding semanticConstraints=[timeRange ENUM_VALUE_IN [this_month]]
target=work-orders.monthly-new-count@1.0.0
mappings=[]
```

At least three monthly paraphrase fixtures combine declared work-order, new-count/count, and monthly terms without whole-question rules. Missing time yields `missingParameters=["timeRange"]`. `today` is semantically valid but does not satisfy the only active binding's exact semantic constraint, so no binding accounts for that value and the result is `CAPABILITY_UNAVAILABLE` with zero ToolCalls and zero Customer business requests. For `this_month`, the constraint explicitly consumes `timeRange`; it is not silently dropped. The monthly request requires no Tool argument mapping because the existing zero-argument Tool itself represents the fixed monthly operation, and it enters the current permission and evidence path without any Shinmone API behavior change.

`Dashboard/KPIStats`, `NewOrders`, upstream `TimeRange=thisMonth`, response pointers, credentials, connector instance details, and application-code handling remain exclusively in downstream Tool/Connector configuration.

### 12.2 Synthetic Customer B

The Customer B pack declares a distinct inventory capability such as `inventory.item-availability`, Customer B vocabulary, and a required `itemRef: bounded_string` parameter. Its binding has no semantic constraint for `itemRef`, targets `inventory.stock-on-hand@1.0.0`, and consumes the supplied canonical parameter through the explicit mapping `itemRef` to Tool argument `sku`.

Acceptance uses the same resolver and registry interfaces, with distinct verified Customer/integration scope and deliberate collisions in `organizationId`, `actorId`, and `hostApp`. No Shinmone registration or source branch exists. Removing Shinmone files leaves Customer B acceptance passing.

### Alternatives considered

Reusing Tool keys as capability keys or using the same vocabulary for both fixtures would preserve semantic/Tool coupling and would not prove productization.

### Why selected

Distinct identities and parameters prove that Customer-owned configuration—not a generic Core branch—controls business meaning. Together, Shinmone and Customer B prove both generic accounting mechanisms: `BINDING_SEMANTIC_CONSTRAINT` and `MAPPED_PARAMETER`.

### Security implications

Colliding lower-level values cannot affect first-step catalog selection, and neither pack exposes the other's existence.

### Compatibility implications

Both existing Tools remain unchanged and continue through their current CustomerToolPolicy, permission, connector, projection, and evidence paths.

### Migration implications

The packs replace current discovery fixture metadata only after equivalent behavior is covered.

## 13. Decision 11 — Architecture Guards

### Decision

Static/regression guards scan only generic semantic production ownership, including the future generic capability module, query-understanding pipeline, and Tool discovery integration seam. Customer-owned pack/configuration paths, dedicated fixture builders, and tests are explicit allowed ownership paths.

Guards detect:

- known Customer names or Customer business terms in generic semantic registries;
- Customer API routes, upstream fields, or response pointers;
- complete reference questions;
- literal equality/switch branches on Customer, integration, or HostApp identifiers;
- Tool-key/name/description use as semantic matching input;
- registry methods or loops that enumerate catalogs before verified scope lookup;
- fallback from capability resolution to legacy Tool discovery;
- executable mapping constructs, templates, functions, regex fields, or prohibited authority fields in pack contracts.

Behavioral isolation tests are authoritative where regex guards would be unreliable: instrument the registry so a Customer A request proves that no Customer B catalog or candidate is read or materialized.

### Alternatives considered

- Repository-wide string bans would incorrectly reject Customer-owned files and tests.
- Code review alone does not provide a durable regression gate.

### Why selected

Scoped guards enforce ownership without confusing valid Customer configuration with generic Core leakage.

### Security implications

The guards prevent future cross-Customer candidate pools, Customer branches, and Tool-key semantic inference.

### Compatibility implications

Allowed-path declarations avoid false positives in Customer-owned configuration and predecessor fixtures.

### Migration implications

The guard scope expands to the new generic capability module as the old Tool discovery semantic path is retired; onboarding a pack does not edit the guard.

## 14. Decision 12 — Safe Observability and Audit

### Decision

Use the existing append-only `AuditEvent` mechanism with a new internal event type `capability_resolution_completed`. No new table is required.

Allowed metadata:

```text
requestId correlation from the enclosing event
verified customerId / integrationId / hostApp from CustomerScope
packId / packVersion
outcome
capabilityKey when resolved or safely scoped
parameter names and statuses only
candidate count
bindingId / bindingVersion when selected
bounded reason code
durationMs
```

Forbidden metadata:

```text
raw or unrestricted user query
raw pack, aliases, examples, or full semantic profiles
raw parameter values where they may contain Customer data
Tool arguments or business values
tokens, JWTs, credentials, Authorization
connectorContextRef, binding reference values from Connector Runtime
raw connector or upstream data
arbitrary exception.message
```

Audit write failure is fail-closed before Tool candidate release. Operational logs use the same bounded metadata and never dump parsed packs or result objects.

### Alternatives considered

- Persisting full resolution results increases leakage and creates a new data model.
- Console diagnostics are not durable or consistently redacted.

### Why selected

Existing audit infrastructure already provides request correlation and Customer ownership. Bounded summaries satisfy traceability without expanding persistence.

### Security implications

No secret, unrestricted text, or business-data surface is introduced; audit failure blocks candidate release.

### Compatibility implications

Existing audit consumers tolerate a new event type because event names are strings and metadata is JSON.

### Migration implications

Capability summaries are added to existing append-only audit flow without a new persistence model or backfill.

## 15. Decision 13 — Future Knowledge Capability Seam

### Decision

V1 accepts only `READ_ONLY_TOOL` capabilities and `TOOL` bindings. The internal resolver and registry use a versioned target discriminant so a later pack version may add a declarative knowledge-source reference. V1 rejects that future variant rather than silently ignoring it.

A future knowledge binding must reference an already-supported, Customer-scoped retrieval authority and re-enter the current RAG lane. It may not contain document content, retrieval algorithms, ranking policy, permission decisions, prompts, or evidence.

### Alternatives considered

- Adding a V1 knowledge registry duplicates the current RAG stack.
- Omitting a discriminated target seam would force Tool-specific assumptions into every capability type.

### Why selected

The seam preserves extensibility while keeping V1 acceptance and implementation Tool-backed.

### Security implications

Unknown target kinds fail closed and future knowledge metadata cannot become retrieval or evidence authority.

### Compatibility implications

Current RAG authorization, Customer/organization/permission filtering, evidence normalization, and `GroundedContextBundleV1` remain unchanged.

### Migration implications

Adding knowledge-backed capabilities requires a later versioned contract and separate review; V1 data needs no forward migration beyond version discrimination.

## 16. Validation Architecture

### 16.1 Unit and contract coverage

- Parse valid V1 packs and reject unknown versions, unknown fields, excessive sizes/counts, invalid identifiers, duplicate normalized aliases, duplicate enum mappings, prohibited fields, and non-scalar constants.
- Reject duplicate active pack scopes, duplicate scoped capability identities, overlapping compatible bindings, unknown mapping sources or constraint parameters, unknown constrained enum values, duplicate or contradictory parameter-consumption declarations, implicit fixed semantics, unknown or duplicate mapping targets, stale Tool versions, and statically unsatisfied required Tool arguments.
- Prove Unicode normalization, case folding, required-group gating, score threshold `0.70`, ambiguity delta `0.05`, candidate cap, deterministic ordering, and no exact-question branch.
- Prove enum normalization, bounded-string validation, missing/invalid/conflicting precedence, and no arbitrary enum creation.
- Prove an exact application-owned `zh-TW` profile is required after verified-scope selection; a missing exact profile produces capability-not-recognized clarification with no cross-locale fallback, pack-established scope, or language-model detection.
- Prove runtime coverage accepts a binding when every supplied parameter is mapped, accepts one when every supplied parameter is covered by an exact semantic constraint, and rejects one when any supplied parameter is unaccounted for. Also prove optional unsupplied parameters require no accounting and optional supplied parameters do.
- Prove the closed result union and absence of prose, authority fields, connector fields, raw values in invalid/conflicting issues, and foreign candidate references.

### 16.2 Integration acceptance

- Multiple Shinmone monthly paraphrases resolve to `work-orders.count` with `timeRange=this_month` and one monthly binding.
- A recognizable request without time yields `NEEDS_CLARIFICATION` and exactly `missingParameters=["timeRange"]`.
- An unrecognized business meaning yields `NEEDS_CLARIFICATION(CAPABILITY_NOT_RECOGNIZED)`.
- A malformed or non-normalizable time value yields invalid-parameter clarification.
- Conflicting time expressions yield conflicting-parameter clarification.
- A recognized capability with semantically valid canonical parameters and no compatible active binding yields `CAPABILITY_UNAVAILABLE`, zero ToolCalls, and zero Customer requests.
- A generic all-mapped fixture accounts for every supplied parameter through `MAPPED_PARAMETER` and is binding-compatible; a generic all-constrained fixture accounts for every supplied parameter through `BINDING_SEMANTIC_CONSTRAINT` and is binding-compatible.
- A fixture with at least one supplied parameter accounted for by neither mechanism makes that binding incompatible and yields `CAPABILITY_UNAVAILABLE` with zero ToolCalls when no complete alternative binding exists.
- `今天新增幾張工單` yields valid `timeRange=today`, `CAPABILITY_UNAVAILABLE`, zero ToolCalls, and zero Customer requests because no active constraint accepts that value.
- The supported Shinmone monthly path consumes `timeRange=this_month` through its exact semantic constraint, yields an empty mapped argument object, re-resolves `work-orders.monthly-new-count@1.0.0`, passes current policy/permission checks, and creates evidence only through the existing path.
- Customer B resolves distinct vocabulary and consumes `itemRef` by mapping it to `sku` through the same Core services.
- Cross-Customer tests collide organization, actor, HostApp, aliases, parameter names, and capability keys while proving zero foreign catalog read, candidate materialization, binding lookup, ToolCall, evidence, or existence disclosure.

### 16.3 Feature 010 and predecessor compatibility

- Current follow-up inheritance and replacement run before final capability resolution; inherited values are revalidated against the active pack.
- Clarification, ambiguity, and unavailable outcomes perform zero Tool or Customer API invocation.
- Exactly one resolved Tool need re-enters current `TOOL` or `HYBRID` routing; multiple Tool needs remain unsupported.
- `GroundedContextBundleV1`, public Assistant HTTP/SSE/SDK/history, AnswerDecision, and safe-failure contracts remain byte/shape compatible.
- Focused Feature 008 permission/runtime/projection/evidence, Feature 009 transport/isolation, and Feature 010 follow-up/Tool/RAG/Hybrid/coverage suites remain passing.
- Feature 010 no-LLM-generation tests continue to report zero LLM calls.
- Architecture guards prove no Customer branches, Tool-key inference, exact-question rules, or global candidate pool in generic production ownership.
- Feature 009 T126–T142 remain pending and are not part of acceptance.

## 17. Constitution and Boundary Check

```text
CUSTOMER_BUSINESS_SEMANTICS_IN_CORE=FORBIDDEN
EXACT_QUESTION_MATCHING_REQUIRED=NO
TOOL_KEY_SEMANTIC_INFERENCE_REQUIRED=NO
CUSTOMER_ID_BRANCHES_IN_GENERIC_CORE=FORBIDDEN
CUSTOMER_API_DETAILS_IN_SEMANTIC_CORE=FORBIDDEN
CAPABILITY_DISCOVERY_CUSTOMER_SCOPED=YES
GLOBAL_CROSS_CUSTOMER_CANDIDATE_POOL=FORBIDDEN
CANONICAL_PARAMETERS_TYPED=YES
CANONICAL_PARAMETERS_EQUAL_TOOL_ARGUMENTS=NO
DECLARATIVE_PARAMETER_BINDING_REQUIRED=YES
EVERY_RESOLVED_PARAMETER_ACCOUNTED_FOR=YES
SILENT_CANONICAL_PARAMETER_DROP=FORBIDDEN
MISSING_PARAMETERS_TYPED=YES
CAPABILITY_AND_TOOL_SEPARATED=YES
CROSS_CUSTOMER_CAPABILITY_LEAKAGE=FORBIDDEN
NEW_SUPPORTED_CUSTOMER_REQUIRES_GENERIC_CORE_CHANGE=NO
AUTONOMOUS_AGENT_LOOP_REQUIRED=NO
MODEL_ASSISTED_MATCHING_USED=NO
FINAL_LLM_SYNTHESIS_IN_FEATURE011=NO

FEATURE008_TOOL_AUTHORITY_PRESERVED=YES
FEATURE009_CONNECTOR_AUTHORITY_PRESERVED=YES
FEATURE010_RETRIEVAL_AUTHORITY_PRESERVED=YES
GROUNDED_CONTEXT_BUNDLE_V1_PRESERVED=YES
PUBLIC_ASSISTANT_CONTRACT_CHANGED=NO
PRISMA_CHANGE_REQUIRED=NO
```

The design satisfies the Constitution's Customer-first isolation, trusted-identity, Tool-first, fail-closed, evidence, and audit requirements. No lower-level organization, actor, HostApp, role, or permission field can replace Customer scope. No semantic result can authorize execution.

## 18. Explicitly Deferred to Feature 012

Feature 012 owns prompt/model-context assembly, provider/model invocation, natural answer text, natural clarification and unavailable wording, citation placement, claim validation, hallucination controls, partial/unsupported language, token budgets, streaming generation, and final Assistant UX acceptance.

Feature 011 emits only typed bounded internal decisions. It does not call final answer generation, create user-facing prose, reinterpret evidence, or permit a model to choose scope, capabilities, parameters, bindings, Tools, or permissions.

## 19. Design Completion State

```text
FEATURE011_DESIGN_CREATED=YES
FEATURE011_SPEC_REFINED=YES

PACK_PERSISTENCE_DECIDED=YES
PACK_PROVISIONING_DECIDED=YES
SCOPED_CAPABILITY_IDENTITY_DECIDED=YES

VERSIONED_CONTRACTS_DESIGNED=YES
SEMANTIC_RESOLUTION_MECHANISM_DECIDED=YES
MODEL_ASSISTED_MATCHING_USED=NO

CANONICAL_PARAMETER_MODEL_DESIGNED=YES
TYPED_RESOLUTION_UNION_DESIGNED=YES

CAPABILITY_BINDING_REGISTRY_DESIGNED=YES
DECLARATIVE_PARAMETER_MAPPING_DESIGNED=YES
BINDING_SEMANTIC_CONSTRAINT_DESIGNED=YES
EVERY_RESOLVED_PARAMETER_ACCOUNTED_FOR=YES
SILENT_CANONICAL_PARAMETER_DROP=FORBIDDEN
TOOL_INPUT_REVALIDATION_PRESERVED=YES

LOCALE_SOURCE_POLICY_DECIDED=YES
LLM_LANGUAGE_DETECTION_ADDED=NO

FEATURE010_INTEGRATION_SEAM_DESIGNED=YES
GROUNDED_CONTEXT_BUNDLE_V1_CHANGED=NO

SHINMONE_REFERENCE_PACK_DESIGNED=YES
SYNTHETIC_CUSTOMER_B_PACK_DESIGNED=YES
CROSS_CUSTOMER_ISOLATION_DESIGNED=YES
ARCHITECTURE_GUARDS_DESIGNED=YES

PRISMA_CHANGE_IMPLEMENTED=NO
PRODUCTION_IMPLEMENTATION_CHANGED=NO
PLAN_CREATED=NO
TASKS_CREATED=NO
REAL_TOOL_INVOCATION_EXECUTED=NO
FEATURE009_T126_T142_EXECUTED=NO
```
