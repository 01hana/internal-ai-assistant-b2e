# Customer AI Assistant Onboarding Review Checklist

Use this checklist with a completed
[`onboarding-spec-template.md`](./onboarding-spec-template.md). An unchecked
blocking item prevents production activation. Completion of this checklist does
not itself change runtime configuration or grant authority.

## Technical Source Review

- [ ] Customer/integration/HostApp scope, locale, timezone, owners, and review date are recorded.
- [ ] OpenAPI, Backend, Frontend client, SDK, Postman, tests, documents, and interviews were checked for availability.
- [ ] Every technical fact links to an exact source/version/location.
- [ ] Conflicting, missing, stale, or uncertain facts are marked `NEEDS_HUMAN_REVIEW`.
- [ ] API operations, parameters, bodies, responses, HTTP errors, and application errors are inventoried where relevant.
- [ ] No business meaning was inferred from a field, path, sample, or operation name alone.
- [ ] No credential, token, private key, session cookie, live Customer data, or live `connectorContextRef` is present.

## Business Semantics Review

- [ ] Business concepts and vocabulary are Customer-owned and Customer-scoped.
- [ ] Optional domain/entity/operation/measure metadata was used only when supported.
- [ ] Capability definitions describe user business abilities, not endpoints.
- [ ] Parameter and output meanings include source evidence and responsible owner.
- [ ] `AI_INFERRED` content is not treated as production authority.
- [ ] Only `HUMAN_VERIFIED` semantics are proposed for production capability design.
- [ ] No cross-Customer semantic candidate pool, fallback, or semantic borrowing exists.

## Capability Design Review

- [ ] Capability key, label, description, kind, active/discoverable state, and status are recorded.
- [ ] Locale, meaning, aliases, positive examples, and negative examples are reviewed.
- [ ] Required/optional canonical parameters and validation are explicit.
- [ ] Recognized values and executable values are explicitly separated.
- [ ] Unsupported values are not silently converted, widened, or dropped.
- [ ] Canonical Assistant output is defined instead of exposing raw Customer responses.
- [ ] Discovery metadata exposes no Tool key, API URL, credential, topology, or permission implementation.
- [ ] Conversation inheritance/replacement/clarification rules stay within current verified scope.
- [ ] Unsupported needs are recorded as backlog, not fallback execution authority.

## Tool Contract Review

- [ ] Each Tool-backed binding references an existing registered and approved Tool contract.
- [ ] Exact Tool version, active state, read/write behavior, and schema compatibility are checked.
- [ ] Every supplied canonical parameter is accounted for by a closed mapping or reviewed semantic constraint.
- [ ] Binding constants and mappings are bounded, declarative, and source-backed.
- [ ] Binding metadata contains no URL, route, response pointer, credential, script, SQL, or arbitrary instruction.
- [ ] Tool Registry, CustomerToolPolicy, input validation, risk, approval, permission, projection, and evidence remain authoritative.
- [ ] No second Tool registry or LLM-created Tool/API contract was introduced.

## Customer-Local Mapping Review

- [ ] Canonical operation maps to one fixed reviewed method/path in Customer-local configuration.
- [ ] Argument mapping, response validation, extraction, normalization, limits, and safe errors are explicit.
- [ ] Operation mapping matches the authoritative Customer-local manifest schema.
- [ ] Arbitrary user/model-selected URL, method, path, header, or response pointer is impossible.
- [ ] Credential provider is registered and remains Customer-local.
- [ ] Credential refresh and revocation ownership remain Customer-local.
- [ ] Native credentials never enter Central Backend, onboarding artifacts, logs, telemetry, or semantic configuration.
- [ ] Raw Customer responses are bounded and minimized before central projection.

## Permission And Security Review

- [ ] Required roles, scopes, policies, sensitivity, and authority source are recorded.
- [ ] Identity and permission inputs come only from current verified authority.
- [ ] LLM cannot grant permission or bypass Capability/Tool/permission registries.
- [ ] Connector Runtime does not replace central permission authority.
- [ ] Customer/integration/HostApp scope is enforced before semantic candidate materialization and binding lookup.
- [ ] Cross-Customer collisions reveal no foreign existence, semantics, bindings, data, or errors.
- [ ] Knowledge sources retain Customer/organization/permission filtering.
- [ ] No agent loop, long-term memory, second RAG stack, arbitrary HTTP, or LLM Tool authority was added.
- [ ] Feature 008–012 authority, public contracts, Gateway, Identity Bridge, Connector lifecycle, Prisma, Tool policy, and permission model remain unchanged.

## Semantic Evaluation Review

- [ ] Every capability has multiple positive paraphrases.
- [ ] Negative and neighboring-capability examples are covered.
- [ ] Ambiguous, missing-parameter, invalid/conflicting, and unsupported-parameter cases are covered.
- [ ] Follow-up inheritance and replacement cases are covered.
- [ ] Expected intent, capability, canonical parameters, and execution outcome are explicit.
- [ ] Zero-execution cases assert zero Tool calls and zero Customer business requests.
- [ ] Cross-Customer collision/isolation cases are included without a shared candidate pool.
- [ ] Acceptance does not depend on a single magic sentence.

## Production Activation Review

- [ ] All blocking Human Review Questions are resolved by named owners.
- [ ] Technical, business, security, and operations owners approved their boundaries and dates.
- [ ] Production artifacts were generated/reviewed through their authoritative runtime workflows, not from this template alone.
- [ ] End-to-end positive and fail-closed acceptance evidence is attached.
- [ ] Capability/binding activation uses exact reviewed versions and verified scope.
- [ ] Customer-local deployment, credential lifecycle, observability, rollback, and revocation are ready.
- [ ] Help/discovery output was checked against the active, discoverable, authorized set.
- [ ] No unresolved `AI_INFERRED` or `NEEDS_HUMAN_REVIEW` business semantics entered production.
- [ ] Final activation approval is explicit; onboarding document completion was not treated as activation.

## Review Record

```yaml
reviewRecord:
  customerId: "<customer-id>"
  integrationId: "<integration-id>"
  templateVersionReference: "<commit-or-version>"
  technicalReviewer: "<name-or-team>"
  businessReviewer: "<name-or-team>"
  securityReviewer: "<name-or-team>"
  operationsReviewer: "<name-or-team>"
  reviewDate: "<YYYY-MM-DD>"
  blockingItemsRemaining: true
  productionActivationApproved: false
  evidenceReferences: []
```
