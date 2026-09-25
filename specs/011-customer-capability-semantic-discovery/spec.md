# Feature Specification: Feature 011 — Customer Capability Catalog & Semantic Capability Discovery

**Canonical Feature Path**: `specs/011-customer-capability-semantic-discovery`
**Created**: 2026-09-21
**Status**: Draft — discovery/specification only

## Problem Statement

The Assistant can already execute an authorized, evidence-producing reference operation for a supported monthly work-order question. Its current semantic path, however, relies on a narrow set of business terms and Tool-oriented discovery metadata. Other valid phrasings or parameter values can degrade into a generic missing-business-object clarification even when the business capability is identifiable.

Adding more exact questions, Customer vocabulary, Tool-name inference, or Customer branches to Assistant Core would make every Customer onboarding a Core source change. It would also confuse a business capability with its current execution Tool and risk leaking one Customer's semantic catalog into another Customer's session.

Feature 011 introduces a Customer-owned declarative capability catalog and generic semantic capability discovery. It resolves natural language into a canonical capability and typed parameters, reports typed clarification, unavailable, or ambiguous outcomes, and supplies a non-authoritative binding reference to the existing Tool/RAG/Hybrid paths. It does not execute arbitrary operations or generate final natural-language answers.

## Product Principle

> AI Assistant is a reusable core architecture. Customer-specific business capabilities and data are installed separately when a Customer adopts the product.

A new Customer whose requirements are expressible with supported platform primitives MUST be onboardable by provisioning Customer-owned capability/configuration material and bindings, without changing generic Assistant production source. Assistant Core MUST NOT become the combined business-question catalog of all Customers.

## Goals

- Define a Customer-owned declarative catalog of available business capabilities, semantic metadata, canonical parameters, and execution-binding references, including bounded declarative mapping from canonical parameters to execution-target inputs.
- Resolve varied natural-language expressions to one canonical Customer capability without exhaustive question templates.
- Produce typed `RESOLVED`, `NEEDS_CLARIFICATION`, `CAPABILITY_UNAVAILABLE`, or `AMBIGUOUS` outcomes before execution.
- Preserve the distinction between business capability and execution Tool.
- Preserve the distinction between canonical capability parameters and execution-target or Tool input arguments.
- Keep discovery within the verified active Customer and integration boundary and prevent cross-Customer semantic leakage.
- Preserve all Feature 008, Feature 009, and Feature 010 execution, authorization, grounding, and compatibility boundaries.
- Prove reuse with the current Shinmone reference and a semantically different Synthetic Customer B catalog.
- Leave an extension path for Customer-owned knowledge/RAG capability metadata without redesigning RAG in V1.

## Non-Goals

- Final LLM answer or clarification synthesis; this belongs to Feature 012.
- Autonomous agents, agent loops, recursive planning, retry-based discovery, or arbitrary multi-step execution.
- Arbitrary API discovery, arbitrary HTTP, free-form SQL, scripts, commands, or model-created routes, Tools, manifests, or capabilities.
- Write/action capability support, approval workflow redesign, or any relaxation of current risk controls.
- One Tool per wording variation, one capability per sentence, or an exhaustive Customer question list.
- Refactoring or deleting the proven `work-orders.monthly-new-count@1.0.0` Tool in this specification round.
- Connector transport, credential, binding, upstream request, response projection, or manifest redesign.
- Existing RAG provider, document authorization, ranking, evidence, or grounding redesign.
- Selecting the persistence, registry, provisioning, matching, confidence, or migration implementation before design approval.

## Core and Customer-Pack Ownership

### Assistant Core owns

- Generic tokenization/parsing seams, semantic resolution mechanics, candidate comparison, typed outcomes, parameter-schema enforcement, bounded ambiguity handling, and safe audit decisions.
- Verified request scope consumption and fail-closed handoff to existing retrieval and execution paths.
- Generic concepts such as capability, parameter, semantic metadata, binding, permission, evidence, knowledge source, ambiguity, and missing parameter.
- Contract validation that prevents Customer packs from acquiring identity, permission, transport, credential, or arbitrary execution authority.

### Customer capability packs own

- Customer business capabilities, descriptions, terminology, aliases, semantic examples, canonical parameter vocabulary, and supported parameter values.
- Required and optional parameter declarations, parameter types and constraints, and Customer-scoped availability metadata.
- References that bind a canonical capability to an already-supported execution target.
- Closed, versioned, declarative parameter mappings from validated canonical parameters to execution-target inputs, plus bounded binding constants required by an existing target contract.
- Future-compatible declarations of Customer knowledge-source capabilities, without containing retrieval logic.

### Customer packs must not own

- Generic Core algorithms or executable routing code.
- Identity claims, Customer selection, roles, permission scopes, permission decisions, risk overrides, or approval decisions.
- Credentials, tokens, connector context, HTTP methods/routes, upstream query spelling, response pointers, raw schemas, SQL, scripts, commands, prompts that override system behavior, or arbitrary execution instructions.
- ToolDefinition, CustomerToolPolicy, Connector Runtime manifest, or evidence authority.

## User Scenarios & Testing

### User Story 1 — Resolve Customer Capabilities from Natural Language (Priority: P1)

As an authenticated internal user, I want different natural expressions of the same business need to resolve to one canonical Customer capability so that supported questions do not depend on exact wording.

**Independent Test**: A Customer pack supplies business terminology and examples for a monthly-new-work-order capability. Multiple paraphrases resolve to the same capability and canonical `timeRange=this_month` parameter without exact-question production rules or Tool-name inference.

**Acceptance Scenarios**:

1. **Given** two or more expressions with equivalent meaning, **When** they are resolved against the same active Customer catalog, **Then** they produce the same canonical capability and equivalent typed parameters.
2. **Given** wording not listed as an exact example but covered by the pack's semantic metadata, **When** it is resolved, **Then** resolution may succeed without adding a new Core rule or Tool.
3. **Given** a resolved capability, **When** the semantic result is inspected, **Then** it contains no connector route, upstream field, credential, response pointer, or raw Tool implementation detail.

---

### User Story 2 — Return Typed Missing, Unavailable, and Ambiguous Outcomes (Priority: P1)

As an internal user, I want the Assistant to distinguish missing information from unavailable or ambiguous capabilities so that later clarification is specific and no unsupported operation is invented.

**Independent Test**: Unrecognized or insufficiently recognized business meaning returns `NEEDS_CLARIFICATION` with a reason equivalent to `CAPABILITY_NOT_RECOGNIZED` and no capability authority; a recognized work-order-count request without a time range returns `NEEDS_CLARIFICATION` and identifies `timeRange`; a value that cannot be normalized to the canonical parameter contract returns typed invalid-parameter clarification; conflicting values return typed conflicting-parameter clarification; a recognized canonical `today` value with no compatible active binding returns `CAPABILITY_UNAVAILABLE`; and two equally valid capability matches return `AMBIGUOUS`. Every non-resolved case executes zero Tools and zero Customer business requests.

**Acceptance Scenarios**:

1. Missing required parameters are reported by canonical parameter name rather than as a generic missing business object.
2. Missing, invalid, and conflicting canonical parameter issues are distinguishable structured clarification reasons; exact result field and type names remain a design decision.
3. A value that cannot be normalized to a valid canonical parameter value returns typed invalid-parameter clarification, not capability unavailable.
4. A valid canonical value with no compatible active binding returns unavailable, not missing, invalid, conflicting, or resolved.
5. Multiple equally valid Customer-scoped candidates return bounded safe ambiguity metadata and no selected binding.
6. Unknown or insufficiently recognized business meaning returns `NEEDS_CLARIFICATION` with a bounded reason equivalent to `CAPABILITY_NOT_RECOGNIZED`, no capability reference or authority, zero ToolCalls, and zero Customer business requests; it MUST NOT return `CAPABILITY_UNAVAILABLE`, borrow another Customer's capability, or invent a Tool/API operation.

---

### User Story 3 — Bind Capability to Existing Authorized Execution (Priority: P1)

As an authorized internal user, I want a resolved capability to enter the existing execution path so that current permission, Tool, projection, evidence, and grounding controls remain authoritative.

**Independent Test**: The supported Shinmone monthly capability binds to the existing `work-orders.monthly-new-count@1.0.0` Tool with `timeRange=this_month` explicitly consumed by a binding semantic constraint and no Tool input mapping. Synthetic Customer B separately proves canonical `itemRef` mapped to Tool argument `sku`. In both cases every supplied resolved canonical parameter is accounted for, the resulting Tool arguments are validated against the current ToolDefinition input schema, and the Tool is re-resolved under the current CustomerToolPolicy and permission scopes before the normal Feature 008/009/010 path can run.

**Acceptance Scenarios**:

1. Capability resolution produces a canonical capability and parameters before any execution target is selected.
2. Canonical capability parameter names and shapes are not required to equal the selected Tool's input argument names and shapes.
3. The Customer-owned binding references an existing supported execution target and may account for a supplied resolved canonical parameter exactly once by mapping it to a declared target input or by declaring a bounded semantic constraint that the target inherently represents; bounded declared binding constants may satisfy target inputs but do not consume canonical parameters.
4. A binding grants no authority: current ToolDefinition activity, CustomerToolPolicy, mapped input schema validation, risk classification, permission precheck, connector selection, projection, and EvidenceRef rules still apply.
5. Missing, stale, inactive, incompatible, or invalid bindings or mappings fail closed with zero downstream business request.
6. A binding that does not explicitly account for every supplied resolved canonical parameter is incompatible and releases no Tool candidate; canonical parameters are never silently dropped.

---

### User Story 4 — Isolate Customer Catalogs and Prove Second-Customer Reuse (Priority: P1)

As a product operator, I want each Customer to install its own capability catalog so that the same Assistant Core supports different businesses without cross-Customer leakage or source branches.

**Independent Test**: Shinmone and Synthetic Customer B use the same generic resolver with different vocabulary, capabilities, parameters, and Tool bindings. Colliding organization, actor, and HostApp fixture values do not allow either Customer to discover the other's capabilities.

**Acceptance Scenarios**:

1. Catalog lookup starts with verified `customerId` and `integrationId`, plus applicable verified HostApp context, before semantic candidates are materialized.
2. Customer A cannot resolve, enumerate, infer, or bind a Customer B-only capability.
3. A compatible new Customer can be installed using supported catalog and binding primitives with no generic production source change.
4. Removing all Shinmone catalog/configuration artifacts leaves generic resolution and Synthetic Customer B acceptance passing.
5. The same `capabilityKey`, aliases, examples, and parameter names may exist independently in both catalogs without merging their identities or candidates.

---

### User Story 5 — Preserve Grounded Retrieval and Future Knowledge Extensibility (Priority: P2)

As a product architect, I want capability discovery to integrate with existing Tool/RAG/Hybrid routing and remain extensible to Customer knowledge sources so that Customer ownership does not stop at Tools.

**Independent Test**: V1 resolves a Tool-backed capability into the existing Feature 010 flow without changing `GroundedContextBundleV1`; a contract fixture demonstrates that future knowledge-source metadata can be represented without embedding retrieval logic or bypassing current RAG authorization.

**Acceptance Scenarios**:

1. V1 Tool capability resolution enters the existing bounded Tool or Hybrid lane and retains Feature 010 need, coverage, evidence, and citation semantics.
2. Capability metadata cannot place raw connector or pre-projection data into `GroundedContextBundleV1`.
3. Future knowledge capability metadata remains declarative and cannot select inaccessible documents, bypass Customer/organization/permission filters, or become evidence by itself.

### Edge Cases

- The active Customer or integration has no installed capability pack.
- A pack is malformed, unsupported, inactive, duplicated, exceeds bounds, or contains forbidden authority/execution fields.
- Two capabilities share aliases or examples and remain equally plausible after parameter compatibility is considered.
- A capability is recognized but one or more required parameters are absent, malformed, conflicting, or outside the declared value set.
- A canonical parameter cannot be normalized, or two supplied values conflict, even though the capability itself is recognizable.
- A capability and parameters resolve, but no active compatible binding exists.
- A binding maps or semantically constrains some supplied canonical parameters but leaves another supplied parameter unaccounted for.
- A binding mapping references an undeclared canonical parameter, supplies an undeclared constant, produces an unknown target field, or yields Tool arguments that fail the current ToolDefinition input schema.
- The application-owned V1 semantic locale has no exact profile in the selected scoped capability definition.
- A binding references a missing, inactive, non-read-only, schema-incompatible, or Customer-policy-denied Tool.
- User text, page context, prior conversation, a Customer pack, or a model attempts to supply `customerId`, integration, HostApp, roles, permission scopes, Tool authority, connector configuration, or credentials.
- A prior conversation frame names a capability that is no longer present or available in the current Customer catalog.
- Two Customers intentionally reuse the same capability key, alias, organization ID, actor ID, or HostApp value.
- A future knowledge capability refers to a source the current user cannot access.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST support a declarative Customer capability pack containing bounded capability definitions, semantic metadata, typed parameter definitions, Customer-scoped availability, and execution-binding references.
- **FR-002**: Catalog discovery MUST be scoped first by verified `customerId` and `integrationId`, and by applicable verified HostApp context; request text, page context, prior conversation, Customer pack content, and model output MUST NOT establish or replace this scope.
- **FR-003**: Customer capability packs MUST be provisioned separately from generic Assistant Core and MUST NOT require generic production source changes for a new Customer using supported primitives.
- **FR-004**: Core MUST consume all valid Customer packs through one generic contract and MUST NOT branch on Customer ID, integration ID, HostApp, Customer name, business vocabulary, capability key, Tool key, or exact question.
- **FR-005**: Customer business vocabulary, aliases, examples, canonical business concepts, and Customer-specific parameter spelling MUST be owned by Customer packs, not generic Core.
- **FR-006**: Semantic examples MAY guide generic matching but MUST NOT be interpreted as an exhaustive exact-question template list or executable instructions.
- **FR-007**: Semantic resolution MUST produce exactly one typed outcome equivalent to `RESOLVED`, `NEEDS_CLARIFICATION`, `CAPABILITY_UNAVAILABLE`, or `AMBIGUOUS`.
- **FR-008**: A resolved outcome MUST identify one canonical capability and a bounded set of canonical typed parameters, with safe resolution provenance sufficient for audit and testing. Semantic Core MUST resolve only canonical capability parameters and MUST NOT know Customer Tool or API argument spelling.
- **FR-009**: When a capability is identified but required parameters are absent, `NEEDS_CLARIFICATION` MUST identify every missing canonical parameter and MUST NOT degrade to a generic missing-business-object reason.
- **FR-010**: `NEEDS_CLARIFICATION` MUST distinguish structured missing, invalid, and conflicting canonical parameter issues. Missing MUST NOT be treated as invalid; invalid MUST NOT be treated as capability unavailable; conflicting MUST NOT be treated as capability unavailable; all clarification cases MUST cause zero Tool or Customer API execution. Exact result field and type names remain a design decision.
- **FR-011**: `CAPABILITY_UNAVAILABLE` MUST mean that the intended capability and relevant canonical semantic values are valid, but the active verified Customer/integration/HostApp scope has no compatible active execution binding for that resolved combination. The system MUST NOT silently replace, widen, or map a valid value to another value. A supplied value that cannot be normalized to a valid canonical parameter value MUST instead use typed invalid-parameter clarification.
- **FR-012**: Equally valid candidates MUST return ambiguity with bounded safe candidate references and MUST NOT select a candidate by arbitrary ordering.
- **FR-013**: Unknown or unavailable meaning MUST NOT cause the system to infer business semantics from Tool names, descriptions, connector manifests, API paths, response fields, or another Customer's catalog.
- **FR-014**: Business capability and execution Tool MUST remain separate identities. A capability binding MAY reference an existing ToolDefinition or another future explicitly supported target type, but semantic Core MUST NOT construct or mutate the target and canonical capability parameters MUST NOT be assumed to be Tool input arguments.
- **FR-015**: V1 acceptance MUST support read-only Tool-backed capabilities. Write/action capabilities, confirmations, and approvals remain out of scope and MUST NOT be enabled by a pack.
- **FR-016**: Before Tool execution, the system MUST apply the selected binding's validated declarative parameter mapping, re-resolve the current ToolDefinition and CustomerToolPolicy, validate the resulting Tool arguments against the current ToolDefinition input schema, and complete the current Feature 008 permission precheck.
- **FR-017**: Capability packs and bindings MUST NOT grant roles or permission scopes, weaken ToolDefinition requirements, override risk, skip confirmation/approval rules, or act as evidence of authorization.
- **FR-018**: Organization, actor, roles, and permission scopes MUST come from verified current identity. They MAY constrain downstream availability/authorization but MUST NOT be asserted by user text or pack metadata.
- **FR-019**: Missing, invalid, inactive, incompatible, ambiguous, or unavailable catalog/binding state MUST fail closed before Tool or Customer business-data invocation.
- **FR-020**: Feature 011 MUST preserve Feature 008 ownership of Tool validation, authorization, execution lifecycle, projection, masking/minimization, and EvidenceRef creation.
- **FR-021**: Feature 011 MUST preserve Feature 009 ownership of Connector Runtime operations, manifests, credentials, bindings, upstream transport, response validation, and extraction.
- **FR-022**: Feature 011 MUST preserve Feature 010 ownership of bounded conversation context, follow-up resolution, retrieval modes/needs, current-authority re-entry, coverage, evidence normalization, citations, and `GroundedContextBundleV1`.
- **FR-023**: Feature 011 MAY make only the narrowly required integration change that supplies canonical capability resolution to existing Feature 010 routing; it MUST NOT create a second Tool, RAG, Hybrid, evidence, or answer path.
- **FR-024**: `GroundedContextBundleV1` MUST remain unchanged and MUST receive only existing safe projected Tool evidence or authorized document evidence, never catalog definitions, raw connector output, pre-projection data, or authority-bearing pack fields.
- **FR-025**: Existing public Assistant HTTP, SSE, SDK, history, AnswerDecision, and safe-failure contracts MUST remain unchanged.
- **FR-026**: Resolution decisions MUST be auditable with request correlation, verified Customer/integration/HostApp context, outcome, safe capability/binding references when applicable, missing/invalid/conflicting parameter names, bounded candidate count, and duration, without recording credentials, tokens, raw pack secrets, raw connector data, or unrestricted user content.
- **FR-027**: Customer packs MUST be treated as untrusted configuration until validated against a closed, versioned, bounded contract; unknown versions/fields, duplicates, oversized metadata, forbidden fields, or invalid bindings MUST be rejected or excluded fail-closed.
- **FR-028**: Packs MUST be declarative and MUST NOT contain executable code, arbitrary prompts with control authority, SQL, scripts, commands, URLs/routes, credentials, connector references, response pointers, or model-generated Tool/API definitions.
- **FR-029**: The implementation MUST replace Customer-specific business vocabulary and special cases in generic semantic/query logic with Customer-pack metadata while retaining only Customer-neutral linguistic and safety mechanics in Core.
- **FR-030**: Feature 011 MUST include regression guards that detect Customer names, business vocabulary, API details, Tool-specific inference, exact reference questions, and Customer-ID branches in generic production ownership.
- **FR-031**: Shinmone acceptance MUST resolve multiple monthly-new-work-order paraphrases to one canonical capability and `timeRange=this_month` without exact-question rules.
- **FR-032**: Shinmone acceptance MUST return typed missing `timeRange` when the capability is identifiable but time is absent, and typed unavailable for `timeRange=today` while no compatible binding exists; both cases MUST execute zero ToolCalls.
- **FR-033**: The supported Shinmone monthly capability MAY bind to existing `work-orders.monthly-new-count@1.0.0`; the Tool and its downstream Feature 008/009 authority MUST remain unchanged.
- **FR-034**: Synthetic Customer B acceptance MUST use different business vocabulary, canonical capability/parameters, and execution binding through the same generic Core, with no Shinmone registration or generic Customer branch.
- **FR-035**: Cross-Customer tests MUST use colliding lower-level scope values and prove that Customer A cannot discover, infer, bind, or execute Customer B capabilities and vice versa.
- **FR-036**: V1 catalog contracts MUST leave a bounded declarative extension point for Customer-owned knowledge-source capability metadata, while existing RAG authorization and retrieval remain unchanged.
- **FR-037**: Clarification, unavailable, and ambiguity outcomes MUST provide structured internal information only; Feature 011 MUST NOT generate final user-facing clarification or answer prose.
- **FR-038**: Feature 011 MUST NOT introduce an autonomous agent loop, arbitrary capability discovery, fallback execution, cross-Customer search, or model authority over capability/binding selection.
- **FR-039**: Feature 009 T126–T142 MUST remain pending and MUST NOT be executed as part of Feature 011 specification or implementation acceptance.
- **FR-040**: A Customer-owned capability binding MAY define a bounded declarative mapping from canonical capability parameters to inputs of an existing supported execution target and MAY supply bounded manifest/configuration-owned fixed values required by that target's existing contract.
- **FR-041**: Every mapped execution-target value MUST originate only from a validated canonical parameter or a declared bounded binding constant. A mapping MUST NOT create arbitrary model-selected or user-selected fields or values.
- **FR-042**: Parameter mappings MUST be closed, versioned, validated, and declarative. They MUST NOT contain executable code, HTTP methods or routes, response pointers, credentials, SQL, scripts, Connector implementation details, or arbitrary API instructions. The exact mapping contract shape remains a design decision.
- **FR-043**: A parameter mapping MUST NOT grant execution or permission authority and MUST NOT replace or weaken the current ToolDefinition, CustomerToolPolicy, input-schema, risk, permission, or downstream authorization checks.
- **FR-044**: Capability identity MUST be scoped by the verified active `customerId`, verified `integrationId`, applicable verified HostApp boundary, and `capabilityKey`. A `capabilityKey` is neither a global cross-Customer authority nor a globally unique business identity; the exact persistence or composite-key representation remains a design decision.
- **FR-045**: Candidate materialization MUST occur only after selecting the active Customer/integration catalog and applicable verified HostApp scope. Core MUST NOT materialize a global multi-Customer candidate pool and filter it afterward.
- **FR-046**: The same `capabilityKey`, aliases, examples, or parameter names MAY legally exist in multiple Customer packs and MUST NOT merge catalog identity, candidates, or semantic metadata across Customers.
- **FR-047**: Capability binding lookup MUST remain within the same verified Customer/integration and applicable HostApp scope used for resolution, and foreign Customer capability or binding existence MUST remain undisclosed.
- **FR-048**: Unknown or insufficiently recognized business meaning MUST return `NEEDS_CLARIFICATION` with a bounded reason equivalent to `CAPABILITY_NOT_RECOGNIZED`, no capability reference or authority, zero ToolCalls, and zero Customer business requests. It MUST NOT return `CAPABILITY_UNAVAILABLE`.
- **FR-049**: Every supplied resolved canonical parameter MUST be accounted for exactly once by either a declarative canonical-parameter-to-Tool-argument mapping or an explicit bounded binding semantic constraint. A parameter accounted for by one mechanism MUST NOT also be consumed by the other. An unaccounted supplied parameter makes the binding incompatible, releases no Tool candidate, and therefore yields `CAPABILITY_UNAVAILABLE` when no other compatible active binding exists.
- **FR-050**: A binding semantic constraint MUST be compatibility metadata only: it declares the exact bounded canonical enum values inherently represented by the target operation, grants no execution or permission authority, performs no argument mapping, and contains no expression language. Optional canonical parameters that were not supplied require no runtime accounting; when supplied, they are subject to FR-049.
- **FR-051**: Pack startup validation MUST reject unknown mapping or constraint parameters, unknown constrained enum values, contradictory or duplicate parameter-consumption declarations, implicit fixed semantics, unknown or duplicate mapping targets, and statically unsatisfied required Tool inputs. Runtime MUST recheck complete supplied-parameter coverage before releasing a Tool candidate and MUST NOT remove or ignore an unaccounted parameter.
- **FR-052**: Feature 011 V1 MUST use the existing application-owned `zh-TW` semantic locale already supplied by current query-understanding and grounding orchestration. Locale is semantic matching input only and MUST NOT establish Customer scope or execution authority. Resolution MUST require an exact compatible locale profile; absence MUST fail safely as unrecognized meaning without cross-locale fallback or LLM language detection.

### Security and Fail-Closed Requirements

- Catalog selection MUST begin at the verified Customer boundary before semantic matching; filtering after cross-Customer candidate materialization is forbidden.
- Capability identity and binding lookup MUST remain within the verified active Customer/integration and applicable HostApp scope; a globally materialized multi-Customer candidate pool is forbidden even if later filtering would occur.
- Catalog records, aliases, examples, parameter values, and bindings from another Customer MUST be indistinguishable from nonexistent data to the active request.
- Semantic resolution and capability bindings are non-authoritative. Current identity, CustomerToolPolicy, permission scopes, ToolDefinition, risk controls, and downstream source authorization remain authoritative.
- Documents, prior Assistant prose, page context, model output, and Customer pack examples are untrusted semantic inputs and cannot issue instructions or grant execution authority.
- Invalid catalog state, catalog lookup failure, candidate overflow, parameter overflow, binding mismatch, or audit failure MUST produce a safe non-executing result.
- Feature 011 is read-only. No confirmation, approval, write Tool, or human-approval bypass is introduced. Existing handoff/escalation behavior remains available for unsupported or policy-governed cases.

## Architecture Invariants

```text
CUSTOMER_BUSINESS_SEMANTICS_IN_CORE=FORBIDDEN
EXACT_QUESTION_MATCHING_REQUIRED=NO
TOOL_KEY_SEMANTIC_INFERENCE_REQUIRED=NO
CUSTOMER_ID_BRANCHES_IN_GENERIC_CORE=FORBIDDEN
CUSTOMER_API_DETAILS_IN_SEMANTIC_CORE=FORBIDDEN
CAPABILITY_DISCOVERY_CUSTOMER_SCOPED=YES
CANONICAL_PARAMETERS_TYPED=YES
MISSING_PARAMETERS_TYPED=YES
CAPABILITY_AND_TOOL_SEPARATED=YES
CANONICAL_PARAMETERS_EQUAL_TOOL_ARGUMENTS=NO
DECLARATIVE_PARAMETER_BINDING_REQUIRED=YES
EVERY_RESOLVED_PARAMETER_ACCOUNTED_FOR=YES
SILENT_CANONICAL_PARAMETER_DROP=FORBIDDEN
CROSS_CUSTOMER_CAPABILITY_LEAKAGE=FORBIDDEN
NEW_SUPPORTED_CUSTOMER_REQUIRES_GENERIC_CORE_CHANGE=NO
AUTONOMOUS_AGENT_LOOP_REQUIRED=NO
FINAL_LLM_SYNTHESIS_IN_FEATURE011=NO

CAPABILITY_PACK_IDENTITY_AUTHORITY=NO
CAPABILITY_PACK_PERMISSION_AUTHORITY=NO
CAPABILITY_BINDING_EXECUTION_AUTHORITY=NO
CAPABILITY_DISCOVERY_BEFORE_CUSTOMER_SCOPE=FORBIDDEN
GLOBAL_CROSS_CUSTOMER_CANDIDATE_POOL=FORBIDDEN
ARBITRARY_TOOL_OR_API_INVENTION=FORBIDDEN
UNRESOLVED_CAPABILITY_EXECUTION=FORBIDDEN
FEATURE008_TOOL_AUTHORITY_PRESERVED=YES
FEATURE009_CONNECTOR_AUTHORITY_PRESERVED=YES
FEATURE010_RETRIEVAL_AUTHORITY_PRESERVED=YES
GROUNDED_CONTEXT_BUNDLE_V1_PRESERVED=YES
PUBLIC_ASSISTANT_CONTRACT_CHANGED=NO
```

## Key Entities

- **Customer Capability Pack**: Customer-owned, versioned, declarative collection of capabilities and semantic/binding metadata available within a verified Customer/integration context.
- **Capability Definition**: Customer-scoped business capability identity, description, availability, parameter contract, and semantic metadata, independent of any particular Tool or API. Its key may be reused by another Customer and has no global authority or uniqueness.
- **Capability Semantic Metadata**: Customer-owned terminology, aliases, descriptions, and examples consumed by generic semantic resolution; it is non-executable and non-authoritative.
- **Capability Parameter Definition**: Canonical parameter name, type, required/optional status, supported constraints/values, and Customer-owned terminology used to derive a typed value.
- **Capability Resolution Result**: Typed resolved, clarification, unavailable, or ambiguous decision containing only bounded safe semantic data and no execution authority.
- **Capability Binding**: Customer-owned, Customer/integration-scoped reference from a canonical capability and compatible canonical parameters to an existing supported execution target. It accounts for every supplied resolved canonical parameter exactly once through either a closed declarative mapping or an explicit bounded semantic constraint representing fixed target semantics. It may also contain bounded binding constants for target inputs, grants no execution or permission authority, and contains no connector implementation details.

These entity names describe required concepts only. Exact versioned type names and persistence models are design decisions.

## Shinmone Reference Acceptance

- At least three semantically equivalent monthly-new-work-order expressions MUST resolve to one canonical capability with `timeRange=this_month`; the expressions are acceptance fixtures, not production templates.
- A work-order-new-count expression without a time range MUST return `NEEDS_CLARIFICATION` with `missingParameters=["timeRange"]` and zero ToolCalls.
- `今天新增幾張工單` MUST recognize `today` as a valid canonical time value, resolve the intended capability and canonical `timeRange=today`, then return `CAPABILITY_UNAVAILABLE` because the installed reference binding supports only the monthly combination, with zero ToolCalls and zero Shinmone business requests.
- A supplied time value that cannot be normalized to a valid canonical value MUST return typed invalid-parameter clarification and MUST NOT return `CAPABILITY_UNAVAILABLE`.
- A supported monthly request MUST bind through Customer-owned configuration to existing `work-orders.monthly-new-count@1.0.0`. The binding MUST explicitly constrain `timeRange` to `[this_month]`, thereby consuming the fixed monthly semantic condition, and MUST use an empty Tool-input mapping because the existing Tool accepts no inputs. The resulting empty Tool arguments MUST pass the current ToolDefinition input schema, CustomerToolPolicy, and permission precheck before entering the existing Feature 008/009/010 path.
- `Dashboard/KPIStats`, `NewOrders`, upstream `TimeRange=thisMonth`, response pointers, credentials, and connector details MUST remain outside generic semantic Core.

## Synthetic Customer B Acceptance

- Customer B MUST install a different capability catalog with different business vocabulary, canonical parameters, and binding while using the same generic Core contracts and resolver.
- Customer B MAY use the existing Synthetic Customer B inventory Tool fixture, but its semantic capability identity MUST remain distinct from the Tool identity and its supplied canonical `itemRef` MUST be explicitly mapped to Tool argument `sku`.
- The acceptance topology MUST contain no Customer B or Shinmone branch in generic production source.
- Removing Shinmone capability/configuration artifacts MUST leave Customer B resolution and execution acceptance passing.
- Tests with colliding organization, actor, and HostApp values MUST yield zero cross-Customer candidates, bindings, ToolCalls, evidence, or existence disclosure.

## RAG and Knowledge Extensibility

Feature 011 V1 is accepted primarily through Tool-backed capabilities. Its Customer-pack contract MUST nevertheless permit a future declarative knowledge capability to describe discoverable business meaning and a trusted knowledge-source binding reference.

Such metadata MUST NOT contain retrieval algorithms, document contents, permission decisions, ranking authority, model prompts with control authority, or evidence. Future knowledge execution must continue through the current Customer/organization/permission-filtered RAG path and existing evidence normalization. No Feature 011 requirement authorizes a second RAG stack or changes current knowledge persistence.

## Compatibility Requirements

- Feature 008 permission, Tool lifecycle, adapter selection, output validation, projection/masking, and evidence responsibilities remain unchanged.
- Feature 009 Connector Runtime, binding/credential security, service proof, manifest-driven request/response handling, and Customer-local boundary remain unchanged.
- Feature 010 conversation scope, semantic follow-up decisions, bounded need decomposition, retrieval modes, one-Tool-need limit, prior-evidence eligibility, coverage, evidence/citation normalization, and `GroundedContextBundleV1` remain unchanged except for the narrow semantic-discovery input integration required by Feature 011.
- No Prisma schema/migration, Connector manifest, public endpoint, SDK, SSE event/payload, history shape, or public AnswerDecision change is required by this specification.
- The Feature 010 document's former naming of Feature 011 as Grounded LLM Answer Synthesis is historical. This Feature 011 specification supersedes that successor name; synthesis is now Feature 012. Feature 010 artifacts are not rewritten in this round.

## Success Criteria

- **SC-001**: All accepted paraphrase fixtures for a capability produce the same canonical capability and equivalent typed parameters in 100% of deterministic regression runs.
- **SC-002**: Every recognized fixture missing a required parameter reports the exact canonical missing-parameter set; zero such fixtures degrade to generic missing-business-object clarification.
- **SC-003**: In 100% of outcome fixtures, unknown or insufficiently recognized meaning produces `NEEDS_CLARIFICATION(CAPABILITY_NOT_RECOGNIZED)` without capability authority; missing, invalid, and conflicting values produce their distinct typed clarification classifications; valid canonical combinations without a compatible active binding produce capability unavailable; every such outcome produces zero ToolCalls and zero Customer business requests.
- **SC-004**: Ambiguity fixtures return bounded typed ambiguity with zero arbitrary winner selection and zero execution.
- **SC-005**: Cross-Customer isolation fixtures expose zero foreign capability, semantic metadata, binding, Tool, evidence, or existence information, including when lower-level identifiers collide.
- **SC-006**: Static architecture guards find zero Customer names, Customer business vocabulary, Customer API details, exact reference questions, Tool-key semantic inference, or Customer-ID branches in generic semantic/discovery production ownership.
- **SC-007**: Shinmone reference acceptance and Synthetic Customer B acceptance both use the same generic resolution mechanics with different Customer-owned packs and bindings.
- **SC-008**: Onboarding an acceptance Customer whose needs use supported primitives changes only Customer-owned configuration/fixtures and requires zero generic production source changes.
- **SC-009**: Resolved Tool-backed acceptance preserves current ToolDefinition, CustomerToolPolicy, permission, projection, EvidenceRef, retrieval coverage, and `GroundedContextBundleV1` contracts.
- **SC-010**: Existing focused Feature 008/009/010 compatibility, Customer isolation, permission, Tool, RAG/Hybrid, public API/SSE/history, and prohibited-material regressions remain passing.
- **SC-011**: Every supplied resolved canonical parameter in every Tool-backed fixture is accounted for exactly once by a validated mapping or explicit semantic constraint. Fixtures prove mapped-only and constraint-only compatibility, reject unaccounted parameters and unknown source/target fields fail-closed, and validate resulting Tool arguments against the current ToolDefinition input schema before execution.
- **SC-012**: Shinmone proves the generic semantic-constraint mechanism with `timeRange=[this_month]` and an empty mapping; `timeRange=today` remains valid but unavailable. Customer B proves the generic mapped-parameter mechanism with `itemRef` to `sku`. Neither case requires a Customer-specific Core branch.
- **SC-013**: V1 resolution uses only the application-owned `zh-TW` locale, exact-matches semantic profiles, and performs zero cross-locale fallback or language-model detection; a missing exact profile safely yields capability-not-recognized clarification.

## Open Design Questions

The following are intentionally deferred to `design.md` after human approval of this specification:

1. Where Customer capability packs are persisted.
2. Whether provisioning uses file configuration, database records, or a hybrid.
3. Exact versioned contract and result type names.
4. Exact catalog/registry ownership and lifecycle.
5. Deterministic versus bounded model-assisted semantic matching and its trust boundary.
6. Confidence representation, thresholds, and tie-breaking inputs.
7. Capability-binding storage, activation, compatibility, and rotation.
8. Exact closed, versioned declarative parameter-mapping contract shape and validation representation.
9. Customer provisioning, validation, rollback, and observability workflow.
10. Migration sequence from current generic domain lexicon and ToolDefinition discovery metadata.
11. The minimum future knowledge-capability metadata shape that preserves existing RAG authority.

These questions MUST be resolved before implementation planning. They do not weaken the resolved ownership, isolation, typed-outcome, permission, or fail-closed requirements in this specification.

## Feature 012 Boundary

`Feature 012 — Grounded LLM Answer Synthesis` consumes the preserved `GroundedContextBundleV1` plus typed Feature 011 clarification/unavailable/ambiguity information where applicable. Feature 012 owns prompt/model-context assembly, provider/model invocation, natural answer and clarification wording, citation placement, claim validation, partial/unsupported language, hallucination controls, token budgets, streaming, and final Assistant UX acceptance.

Feature 011 MUST NOT call the final answer-generation path, generate final clarification prose, treat a model as semantic or permission authority, or alter evidence to improve prose. Feature 012 MUST NOT reinterpret capability resolution to bypass Feature 011 typed outcomes or Feature 008/009/010 authority.

## Assumptions

- V1 supports read-only Tool-backed capabilities and one Tool need per turn under the existing Feature 010 bound.
- Existing ToolDefinitions and CustomerToolPolicies remain the execution and authorization authorities; a capability catalog does not replace either.
- Semantic examples are representative metadata, not production question templates or a completeness guarantee.
- A capability may use the same key in separate Customer catalogs because verified Customer scope is always part of lookup identity.
- Catalog persistence, provisioning, and matching technology remain design decisions; the product behavior and security requirements above apply regardless of those choices.
- Feature 009 T126–T142 remain pending and are neither prerequisites nor authorized work for Feature 011.

## Specification Completion State

```text
FEATURE011_NAME=Customer Capability Catalog & Semantic Capability Discovery
FEATURE012_NAME=Grounded LLM Answer Synthesis
FEATURE011_DISCOVERY_FOR_SPEC_COMPLETE=YES
FEATURE011_SPEC_CREATED=YES
DESIGN_CREATED=NO
PLAN_CREATED=NO
TASKS_CREATED=NO
PRODUCTION_IMPLEMENTATION_CHANGED=NO
```
